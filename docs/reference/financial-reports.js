"use strict";

const accounting = require("./accounting");
const budgetPlanning = require("./budget-planning");

const VALID_LIQUIDITY_CLASSES = new Set([
  "current-asset", "long-term-receivable", "other-noncurrent-asset",
  "current-liability", "long-term-liability",
]);
const GROUP_NAMES = { 1: "Ativo", 2: "Passivo", 3: "Patrimônio Líquido", 4: "Receitas", 5: "Custos", 6: "Despesas" };

function safeSum(values) {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) throw new Error("O relatório excedeu o limite seguro de centavos.");
  }
  return total;
}

function negate(value) { return value === 0 ? 0 : -value; }

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T00:00:00.000Z"))
    && new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) === value;
}

function monthOf(date) { return date.slice(0, 7); }

function shiftDay(date, days) {
  const result = new Date(date + "T00:00:00.000Z");
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function monthEnd(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function shiftMonth(period, delta) {
  const [year, month] = period.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + delta, 1));
  return value.toISOString().slice(0, 7);
}

function localToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function accountById(finance) {
  return new Map((finance.planAccounts || []).map((account) => [account.id, account]));
}

function accountCode(finance, accountId) {
  return accounting.getPlanAccountCode(finance, accountId);
}

function accountPathCode(finance, account) {
  return accounting.getSubcategoryCode(finance, account.subcategoryId);
}

function entriesPosted(finance) {
  return (finance.journalEntries || []).filter((entry) => entry.status === accounting.POSTED);
}

function integrity(finance, fromDate = "0001-01-01", toDate = "9999-12-31") {
  const issues = [];
  const accounts = accountById(finance || {});
  const totals = { debitCents: 0, creditCents: 0 };
  if (!finance || !Array.isArray(finance.journalEntries) || !Array.isArray(finance.planAccounts)) {
    return { isValid: false, issues: [{ code: "estrutura", message: "Estrutura do Livro Diário indisponível." }], ...totals, differenceCents: 0 };
  }
  for (const entry of entriesPosted(finance)) {
    let debit = 0;
    let credit = 0;
    let valid = true;
    if (!validDate(entry.postingDate) || !/^\d{4}-\d{2}$/.test(entry.period) || !Array.isArray(entry.lines) || entry.lines.length < 2) {
      issues.push({ code: "cabecalho", entryId: entry.id || null, message: "Há lançamento postado com cabeçalho, período ou linhas inválidos." });
      valid = false;
    }
    for (const line of Array.isArray(entry.lines) ? entry.lines : []) {
      if (!line || typeof line !== "object") {
        issues.push({ code: "linha-invalida", entryId: entry.id || null, message: "Há linha postada inválida." });
        valid = false;
        continue;
      }
      const account = accounts.get(line.accountId);
      const validAmounts = Number.isSafeInteger(line.debitCents) && line.debitCents >= 0
        && Number.isSafeInteger(line.creditCents) && line.creditCents >= 0
        && ((line.debitCents > 0) !== (line.creditCents > 0));
      if (!account || !account.postable) {
        issues.push({ code: "conta-inexistente", entryId: entry.id || null, accountId: line.accountId || null, message: "Há linha contábil postada sem conta analítica válida." });
        valid = false;
      }
      if (!validAmounts) {
        issues.push({ code: "linha-invalida", entryId: entry.id || null, accountId: line.accountId || null, message: "Há linha postada com valor inválido ou sem um único lado contábil." });
        valid = false;
      }
      if (validAmounts) { debit += line.debitCents; credit += line.creditCents; }
    }
    if (debit !== credit) {
      issues.push({ code: "lancamento-desbalanceado", entryId: entry.id || null, message: "Há lançamento postado com débitos diferentes dos créditos." });
      valid = false;
    }
    if (valid && entry.postingDate >= fromDate && entry.postingDate <= toDate) {
      totals.debitCents += debit;
      totals.creditCents += credit;
    }
  }
  if (totals.debitCents !== totals.creditCents) {
    issues.push({ code: "razao-desbalanceado", message: "Os movimentos contabilizados no período não fecham entre débitos e créditos." });
  }
  return { isValid: issues.length === 0, issues, ...totals, differenceCents: totals.debitCents - totals.creditCents };
}

function balanceByAccount(finance, cutoffDate) {
  const values = new Map((finance.planAccounts || []).map((account) => [account.id, 0]));
  for (const entry of entriesPosted(finance)) {
    if (entry.postingDate > cutoffDate) continue;
    for (const line of entry.lines || []) {
      if (values.has(line.accountId)) values.set(line.accountId, values.get(line.accountId) + line.debitCents - line.creditCents);
    }
  }
  return values;
}

function naturalBalance(group, debitCreditBalance) {
  return [2, 3, 4].includes(group) ? -debitCreditBalance : debitCreditBalance;
}

function periodAmounts(finance, period, costCenterId = null, postingCutoff = monthEnd(period)) {
  const amounts = new Map((finance.planAccounts || []).map((account) => [account.id, 0]));
  for (const entry of entriesPosted(finance)) {
    if (entry.period !== period || entry.postingDate > postingCutoff) continue;
    for (const line of entry.lines || []) {
      const group = accounting.getAccountGroup(finance, line.accountId);
      if (![4, 5, 6].includes(group) || !amounts.has(line.accountId)) continue;
      let amount = group === 4 ? line.creditCents - line.debitCents : line.debitCents - line.creditCents;
      const allocations = line.costCenterAllocations || [];
      if (costCenterId) {
        if (costCenterId === "sem-centro") amount = allocations.length ? 0 : amount;
        else {
          const allocation = allocations.find((item) => item.costCenterId === costCenterId);
          amount = allocation ? Math.sign(amount) * allocation.amountCents : 0;
        }
      }
      amounts.set(line.accountId, amounts.get(line.accountId) + amount);
    }
  }
  return amounts;
}

function titleOutstandingAt(finance, title, kind, cutoffDate, postedById) {
  if (title.status === "cancelled") return 0;
  const recognition = title.recognitionEntryId ? postedById.get(title.recognitionEntryId) : null;
  const recognized = Boolean(recognition && recognition.postingDate <= cutoffDate);
  let settled = 0;
  const records = kind === "payable" ? title.settlements || [] : title.collections || [];
  for (const record of records) {
    if (!validDate(record.date) || record.date > cutoffDate) continue;
    const original = record.journalEntryId ? postedById.get(record.journalEntryId) : null;
    if (!original || original.postingDate > cutoffDate) continue;
    const reversal = record.reversalEntryId ? postedById.get(record.reversalEntryId) : null;
    if (reversal && reversal.postingDate <= cutoffDate) continue;
    settled += record.amountCents;
  }
  return { amountCents: Math.max(0, title.originalAmountCents - settled), recognized };
}

function documentAllocationsOutstanding(title, amountCents, kind, cutoffDate, postedById) {
  const allocations = Array.isArray(title.costCenterAllocations) && title.costCenterAllocations.length
    ? title.costCenterAllocations
    : title.costCenterId ? [{ costCenterId: title.costCenterId, amountCents: title.originalAmountCents }] : [];
  if (!allocations.length || !amountCents) return [];
  const records = kind === "payable" ? title.settlements || [] : title.collections || [];
  const byCenter = new Map(allocations.map((item) => [item.costCenterId, item.amountCents]));
  for (const record of records) {
    if (!validDate(record.date) || record.date > cutoffDate) continue;
    const source = record.journalEntryId ? postedById.get(record.journalEntryId) : null;
    const reversal = record.reversalEntryId ? postedById.get(record.reversalEntryId) : null;
    if (!source || source.postingDate > cutoffDate || (reversal && reversal.postingDate <= cutoffDate)) continue;
    for (const allocation of record.costCenterAllocations || []) {
      byCenter.set(allocation.costCenterId, Math.max(0, (byCenter.get(allocation.costCenterId) || 0) - allocation.amountCents));
    }
  }
  const remaining = [...byCenter.entries()].map(([costCenterId, value]) => ({ costCenterId, amountCents: value }));
  const total = safeSum(remaining.map((item) => item.amountCents));
  if (total === amountCents) return remaining;
  if (total <= 0) return [];
  let assigned = 0;
  return remaining.map((item, index) => {
    const share = index === remaining.length - 1 ? amountCents - assigned : Math.floor(amountCents * item.amountCents / total);
    assigned += share;
    return { costCenterId: item.costCenterId, amountCents: share };
  }).filter((item) => item.amountCents > 0);
}

function cashEvents(finance, fromDate, toDate) {
  const accounts = accountById(finance);
  const posted = entriesPosted(finance).slice().sort((a, b) => a.postingDate.localeCompare(b.postingDate) || (a.entryNumber || 0) - (b.entryNumber || 0));
  const postedById = new Map(posted.map((entry) => [entry.id, entry]));
  const events = [];
  for (const entry of posted) {
    if (entry.postingDate < fromDate || entry.postingDate > toDate) continue;
    const cashLines = (entry.lines || []).filter((line) => accounts.get(line.accountId)?.cashEquivalent === true);
    const cashDelta = safeSum(cashLines.map((line) => line.debitCents - line.creditCents));
    if (cashDelta === 0) continue;
    let classificationAccountId = null;
    let allocations = [];
    let titleKind = null;
    let titleId = null;
    if (entry.originModule === "contas-a-pagar" && entry.sourceEventType === "settlement") {
      const title = (finance.payables || []).find((item) => item.id === entry.sourceRecordId);
      const record = title?.settlements?.find((item) => item.journalEntryId === entry.id);
      if (title && record) { classificationAccountId = title.expenseAccountId; allocations = record.costCenterAllocations || []; titleKind = "payable"; titleId = title.id; }
    } else if (entry.originModule === "contas-a-receber" && entry.sourceEventType === "collection") {
      const title = (finance.receivables || []).find((item) => item.id === entry.sourceRecordId);
      const record = title?.collections?.find((item) => item.journalEntryId === entry.id);
      if (title && record) { classificationAccountId = title.revenueAccountId; allocations = record.costCenterAllocations || []; titleKind = "receivable"; titleId = title.id; }
    } else if (entry.reversalOfEntryId) {
      const original = postedById.get(entry.reversalOfEntryId);
      if (original?.sourceEventType === "settlement" && original.originModule === "contas-a-pagar") {
        const title = (finance.payables || []).find((item) => item.id === original.sourceRecordId);
        const record = title?.settlements?.find((item) => item.journalEntryId === original.id);
        if (title && record) { classificationAccountId = title.expenseAccountId; allocations = record.costCenterAllocations || []; titleKind = "payable"; titleId = title.id; }
      } else if (original?.sourceEventType === "collection" && original.originModule === "contas-a-receber") {
        const title = (finance.receivables || []).find((item) => item.id === original.sourceRecordId);
        const record = title?.collections?.find((item) => item.journalEntryId === original.id);
        if (title && record) { classificationAccountId = title.revenueAccountId; allocations = record.costCenterAllocations || []; titleKind = "receivable"; titleId = title.id; }
      }
    }
    if (!classificationAccountId) {
      const classified = (entry.lines || []).filter((line) => {
        if (accounts.get(line.accountId)?.cashEquivalent) return false;
        return [4, 5, 6].includes(accounting.getAccountGroup(finance, line.accountId));
      });
      const classificationCash = safeSum(classified.map((line) => line.creditCents - line.debitCents));
      if (classified.length && classificationCash === cashDelta) {
        for (const line of classified) {
          const amountCents = line.creditCents - line.debitCents;
          if (!amountCents) continue;
          events.push({ date: entry.postingDate, amountCents, accountId: line.accountId, groupNumber: accounting.getAccountGroup(finance, line.accountId), entryId: entry.id, entryNumber: entry.entryNumber, description: entry.description, costCenterAllocations: line.costCenterAllocations || [], kind: "manual" });
        }
        continue;
      }
    }
    const groupNumber = classificationAccountId ? accounting.getAccountGroup(finance, classificationAccountId) : null;
    events.push({
      date: entry.postingDate, amountCents: cashDelta,
      accountId: [4, 5, 6].includes(groupNumber) ? classificationAccountId : null,
      groupNumber: [4, 5, 6].includes(groupNumber) ? groupNumber : null,
      entryId: entry.id, entryNumber: entry.entryNumber, description: entry.description,
      costCenterAllocations: allocations, kind: titleKind === "payable" ? "payable-settlement" : titleKind === "receivable" ? "receivable-collection" : "other",
      sourceId: titleId,
    });
  }
  return events;
}

function titleRows(finance, kind, cutoffDate, postedById) {
  const titles = kind === "payable" ? finance.payables || [] : finance.receivables || [];
  return titles.filter((title) => title.status !== "cancelled" && validDate(title.dueDate)).map((title) => {
    const outstanding = titleOutstandingAt(finance, title, kind, cutoffDate, postedById);
    return {
      id: title.id,
      party: kind === "payable" ? title.creditor : title.debtor,
      name: kind === "payable" ? title.creditor : title.debtor,
      description: title.description,
      dueDate: title.dueDate,
      originalAmountCents: title.originalAmountCents,
      outstandingCents: outstanding.amountCents,
      recognized: outstanding.recognized,
      status: outstanding.amountCents === 0 ? "liquidado" : outstanding.recognized ? title.dueDate < cutoffDate ? "vencido" : "reconhecido" : "não reconhecido",
      accountId: kind === "payable" ? title.expenseAccountId : title.revenueAccountId,
      costCenterAllocations: documentAllocationsOutstanding(title, outstanding.amountCents, kind, cutoffDate, postedById),
      source: title,
    };
  }).filter((row) => row.outstandingCents > 0);
}

function dueDistribution(rows, cutoffDate) {
  const edge7 = shiftDay(cutoffDate, 7);
  const edge15 = shiftDay(cutoffDate, 15);
  const edge30 = shiftDay(cutoffDate, 30);
  const buckets = [
    { key: "overdue", label: "Vencidos", min: null, max: cutoffDate, test: (date) => date < cutoffDate },
    { key: "next7", label: "Até 7 dias", min: cutoffDate, max: edge7, test: (date) => date >= cutoffDate && date <= edge7 },
    { key: "days8to15", label: "8 a 15 dias", min: null, max: edge15, test: (date) => date > edge7 && date <= edge15 },
    { key: "days16to30", label: "16 a 30 dias", min: null, max: edge30, test: (date) => date > edge15 && date <= edge30 },
    { key: "beyond30", label: "Após 30 dias", min: null, max: null, test: (date) => date > edge30 },
  ];
  return buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, amountCents: safeSum(rows.filter((row) => bucket.test(row.dueDate)).map((row) => row.outstandingCents)), count: rows.filter((row) => bucket.test(row.dueDate)).length }));
}

function closeBalances(finance, cutoffDate) {
  const accountBalances = balanceByAccount(finance, cutoffDate);
  const accounts = accountById(finance);
  const groups = [1, 2, 3, 4, 5, 6].map((number) => {
    const rows = [...accounts.values()].filter((account) => accounting.getAccountGroup(finance, account.id) === number).map((account) => {
      const raw = accountBalances.get(account.id) || 0;
      return { accountId: account.id, code: accountCode(finance, account.id), name: account.name, balanceCents: naturalBalance(number, raw), rawBalanceCents: raw };
    });
    return { groupNumber: number, name: GROUP_NAMES[number], amountCents: safeSum(rows.map((row) => row.balanceCents)), rows };
  });
  return { accountBalances, groups };
}

function getDashboard(finance, filters, options = {}) {
  const { fromDate, toDate } = filters;
  const horizonDays = Number(filters.horizonDays || 30);
  if (!validDate(fromDate) || !validDate(toDate) || fromDate > toDate) throw new Error("Informe um intervalo de datas válido para o painel.");
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 90) throw new Error("O horizonte de projeção deve ficar entre 1 e 90 dias.");
  const today = options.today || localToday();
  const cutoffDate = toDate;
  const period = monthOf(toDate);
  const posted = entriesPosted(finance);
  const postedById = new Map(posted.map((entry) => [entry.id, entry]));
  const cashAccountsList = (finance.planAccounts || []).filter((account) => account.postable && account.cashEquivalent === true);
  const accountBalances = balanceByAccount(finance, cutoffDate);
  const cashByAccount = cashAccountsList.map((account) => ({
    accountId: account.id, code: accountCode(finance, account.id), name: account.name,
    balanceCents: accountBalances.get(account.id) || 0,
  })).sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
  const availableCashCents = safeSum(cashByAccount.map((item) => item.balanceCents));
  const selectedEvents = cashEvents(finance, fromDate, toDate);
  const realizedOperatingReceiptsCents = safeSum(selectedEvents.filter((event) => event.groupNumber === 4).map((event) => event.amountCents));
  const realizedOperatingPaymentsCents = negate(safeSum(selectedEvents.filter((event) => [5, 6].includes(event.groupNumber)).map((event) => event.amountCents)));
  const otherEvents = selectedEvents.filter((event) => ![4, 5, 6].includes(event.groupNumber));
  const otherInflowCents = safeSum(otherEvents.map((event) => Math.max(0, event.amountCents)));
  const otherOutflowCents = safeSum(otherEvents.map((event) => Math.max(0, -event.amountCents)));
  const payables = titleRows(finance, "payable", cutoffDate, postedById);
  const receivables = titleRows(finance, "receivable", cutoffDate, postedById);
  const payableOutstandingCents = safeSum(payables.map((item) => item.outstandingCents));
  const receivableOutstandingCents = safeSum(receivables.map((item) => item.outstandingCents));
  const payableOverdueCents = safeSum(payables.filter((item) => item.dueDate < cutoffDate).map((item) => item.outstandingCents));
  const receivableOverdueCents = safeSum(receivables.filter((item) => item.dueDate < cutoffDate).map((item) => item.outstandingCents));
  const edge7 = shiftDay(cutoffDate, 7);
  const edge30 = shiftDay(cutoffDate, 30);
  const payableNext7Cents = safeSum(payables.filter((item) => item.dueDate >= cutoffDate && item.dueDate <= edge7).map((item) => item.outstandingCents));
  const payableNext30Cents = safeSum(payables.filter((item) => item.dueDate >= cutoffDate && item.dueDate <= edge30).map((item) => item.outstandingCents));
  const receivableNext30Cents = safeSum(receivables.filter((item) => item.dueDate >= cutoffDate && item.dueDate <= edge30).map((item) => item.outstandingCents));
  const scheduledReceiptsInPeriodCents = safeSum(receivables.filter((item) => item.recognized && item.dueDate >= fromDate && item.dueDate <= toDate).map((item) => item.outstandingCents));
  const recognizedPayablesCents = safeSum(payables.filter((item) => item.recognized).map((item) => item.outstandingCents));
  const draftPayablesCents = payableOutstandingCents - recognizedPayablesCents;
  const recognizedReceivablesCents = safeSum(receivables.filter((item) => item.recognized).map((item) => item.outstandingCents));
  const draftReceivablesCents = receivableOutstandingCents - recognizedReceivablesCents;
  const periodEvents = selectedEvents;
  const paidInPeriodCents = negate(safeSum(periodEvents.filter((event) => event.kind === "payable-settlement").map((event) => event.amountCents)));
  const receivedInPeriodCents = safeSum(periodEvents.filter((event) => event.kind === "receivable-collection").map((event) => event.amountCents));
  const projectionFrom = shiftDay(cutoffDate, 1);
  const projectionTo = shiftDay(cutoffDate, horizonDays);
  const projectDate = (dueDate) => dueDate < projectionFrom ? projectionFrom : dueDate;
  const forecasts = [];
  for (const row of payables) {
    if (row.dueDate > projectionTo && row.dueDate >= projectionFrom) continue;
    forecasts.push({ date: projectDate(row.dueDate), amountCents: -row.outstandingCents, sourceType: row.recognized ? "payable" : "draft-payable", sourceId: row.id, description: row.description, accountId: row.accountId });
  }
  for (const row of receivables) {
    if (row.dueDate > projectionTo && row.dueDate >= projectionFrom) continue;
    forecasts.push({ date: projectDate(row.dueDate), amountCents: row.outstandingCents, sourceType: row.recognized ? "receivable" : "draft-receivable", sourceId: row.id, description: row.description, accountId: row.accountId });
  }
  const recurringEstimates = [];
  const representedRecurringIds = new Set((finance.receivables || []).filter((item) => item.status !== "cancelled" && item.recurringIncomeId && item.dueDate >= projectionFrom && item.dueDate <= projectionTo).map((item) => item.recurringIncomeId));
  for (const recurring of finance.recurringIncome || []) {
    if (!recurring.active || recurring.frequency !== "mensal" || representedRecurringIds.has(recurring.id)) continue;
    for (let date = projectionFrom; date <= projectionTo;) {
      const day = Number(recurring.dayOfMonth);
      const [year, month] = date.split("-");
      const candidate = year + "-" + month + "-" + String(day).padStart(2, "0");
      if (Number.isInteger(day) && day >= 1 && day <= Number(monthEnd(year + "-" + month).slice(8, 10)) && candidate >= projectionFrom && candidate <= projectionTo) {
        recurringEstimates.push({ date: candidate, amountCents: recurring.amountCents, sourceType: "recorrencia", sourceId: recurring.id, description: recurring.description });
      }
      const nextMonth = shiftMonth(date.slice(0, 7), 1);
      date = nextMonth + "-01";
    }
  }
  const budgetForecastEvents = budgetPlanning.buildBudgetForecastEvents(finance, {
    today: projectionFrom, fromDate: projectionFrom, toDate: projectionTo,
  });
  const budgetForecastEventsForDay = budgetPlanning.buildBudgetForecastEvents(finance, {
    today: cutoffDate, dateBasis: "planned", fromDate: cutoffDate, toDate: cutoffDate,
  });
  const budgetedPaymentsCents = safeSum(budgetForecastEvents.map((event) => Math.max(0, -event.amountCents)));
  const budgetedReceiptsCents = safeSum(budgetForecastEvents.map((event) => Math.max(0, event.amountCents)));
  forecasts.push(...budgetForecastEvents);
  const realizedDayEvents = selectedEvents.filter((event) => event.date === cutoffDate);
  const dayForecastRows = [
    ...payables.filter((row) => row.dueDate === cutoffDate).map((row) => ({
      date: cutoffDate, amountCents: -row.outstandingCents,
      sourceType: row.recognized ? "payable" : "draft-payable", sourceId: row.id,
      description: row.description, party: row.party, accountId: row.accountId,
    })),
    ...receivables.filter((row) => row.dueDate === cutoffDate).map((row) => ({
      date: cutoffDate, amountCents: row.outstandingCents,
      sourceType: row.recognized ? "receivable" : "draft-receivable", sourceId: row.id,
      description: row.description, party: row.party, accountId: row.accountId,
    })),
    ...budgetForecastEventsForDay,
  ];
  const recurringEstimatesForDay = [];
  for (const recurring of finance.recurringIncome || []) {
    const dueDay = Number(recurring.dayOfMonth);
    const alreadyRegistered = (finance.receivables || []).some((item) => item.status !== "cancelled"
      && item.recurringIncomeId === recurring.id && item.dueDate === cutoffDate);
    if (recurring.active && recurring.frequency === "mensal" && dueDay === Number(cutoffDate.slice(8, 10)) && !alreadyRegistered) {
      recurringEstimatesForDay.push({ date: cutoffDate, amountCents: recurring.amountCents, sourceType: "recorrencia", sourceId: recurring.id, description: recurring.description });
    }
  }
  const dailyCashFlow = {
    date: cutoffDate,
    realizedInflowsCents: safeSum(realizedDayEvents.map((event) => Math.max(0, event.amountCents))),
    realizedOutflowsCents: safeSum(realizedDayEvents.map((event) => Math.max(0, -event.amountCents))),
    realizedNetCents: safeSum(realizedDayEvents.map((event) => event.amountCents)),
    realizedEvents: realizedDayEvents,
    projectedReceiptsCents: safeSum(dayForecastRows.filter((event) => event.sourceType === "receivable").map((event) => event.amountCents)),
    projectedPaymentsCents: negate(safeSum(dayForecastRows.filter((event) => event.sourceType === "payable").map((event) => event.amountCents))),
    unrecognizedExpectedReceiptsCents: safeSum(dayForecastRows.filter((event) => event.sourceType === "draft-receivable").map((event) => event.amountCents)),
    unrecognizedExpectedPaymentsCents: negate(safeSum(dayForecastRows.filter((event) => event.sourceType === "draft-payable").map((event) => event.amountCents))),
    recurringEstimateCents: safeSum(recurringEstimatesForDay.map((event) => event.amountCents)),
    budgetedReceiptsCents: safeSum(budgetForecastEventsForDay.map((event) => Math.max(0, event.amountCents))),
    budgetedPaymentsCents: safeSum(budgetForecastEventsForDay.map((event) => Math.max(0, -event.amountCents))),
    forecastEvents: dayForecastRows,
    recurringEstimates: recurringEstimatesForDay,
  };
  const chartDays = [];
  let actual = safeSum(cashAccountsList.map((account) => {
    let value = 0;
    for (const entry of posted) if (entry.postingDate < fromDate) for (const line of entry.lines || []) if (line.accountId === account.id) value += line.debitCents - line.creditCents;
    return value;
  }));
  const openingCashAtRangeStart = actual;
  let baseline = actual;
  let scenario = actual;
  const daysBeforeCutoff = [];
  for (let day = fromDate; day <= toDate; day = shiftDay(day, 1)) daysBeforeCutoff.push(day);
  for (let day = projectionFrom; day <= projectionTo; day = shiftDay(day, 1)) daysBeforeCutoff.push(day);
  const allEvents = cashEvents(finance, fromDate, toDate);
  for (const day of daysBeforeCutoff) {
    const isFuture = day > cutoffDate;
    const actualDelta = isFuture ? 0 : safeSum(allEvents.filter((event) => event.date === day).map((event) => event.amountCents));
    const registeredForecasts = isFuture ? forecasts.filter((event) => event.date === day && ["payable", "receivable"].includes(event.sourceType)) : [];
    const expectedForecasts = isFuture ? forecasts.filter((event) => event.date === day && ["draft-payable", "draft-receivable"].includes(event.sourceType)) : [];
    const recurringForDay = isFuture ? recurringEstimates.filter((event) => event.date === day) : [];
    const budgetsForDay = isFuture ? budgetForecastEvents.filter((event) => event.date === day) : [];
    actual += actualDelta;
    baseline += actualDelta + safeSum(registeredForecasts.map((event) => event.amountCents));
    scenario += actualDelta + safeSum(registeredForecasts.concat(expectedForecasts, recurringForDay, budgetsForDay).map((event) => event.amountCents));
    chartDays.push({ date: day, actualCents: isFuture ? null : actual, projectedCents: isFuture ? baseline : null, scenarioCents: isFuture ? scenario : null });
  }
  const futureChart = chartDays.filter((point) => point.projectedCents != null);
  const minimumPoint = futureChart.length ? futureChart.reduce((min, point) => point.projectedCents < min.projectedCents ? point : min) : { date: cutoffDate, projectedCents: availableCashCents };
  const firstNegative = futureChart.find((point) => point.projectedCents < 0) || null;
  const accountingTotals = integrity(finance, fromDate, toDate);
  const balances = closeBalances(finance, cutoffDate);
  const competenceAmounts = competenceAmountsBetween(finance, fromDate, toDate);
  const accountingGroups = balances.groups.map((group) => ({
    groupNumber: group.groupNumber, name: group.name,
    amountCents: [1, 2, 3].includes(group.groupNumber) ? group.amountCents : safeSum([...competenceAmounts.entries()].filter(([accountId]) => accounting.getAccountGroup(finance, accountId) === group.groupNumber).map(([, amount]) => amount)),
    basis: [1, 2, 3].includes(group.groupNumber) ? "saldo no encerramento" : "movimento por competência",
  }));
  const centerTotals = new Map((finance.costCenters || []).map((center) => [center.id, { costCenterId: center.id, name: center.name, amountCents: 0 }]));
  centerTotals.set("", { costCenterId: null, name: "Sem centro de custo", amountCents: 0 });
  for (const item of payables) for (const allocation of item.costCenterAllocations) {
    const key = centerTotals.has(allocation.costCenterId) ? allocation.costCenterId : "";
    centerTotals.get(key).amountCents += allocation.amountCents;
  }
  return {
    fromDate, toDate, cutoffDate, horizonDays, projectionFrom, projectionTo, today,
    cash: {
      availableCents: availableCashCents, openingCents: openingCashAtRangeStart, accounts: cashByAccount,
      day: dailyCashFlow,
      realizedOperatingReceiptsCents, realizedOperatingPaymentsCents,
      realizedRevenueCents: safeSum(selectedEvents.filter((event) => event.groupNumber === 4).map((event) => event.amountCents)),
      realizedCostsCents: negate(safeSum(selectedEvents.filter((event) => event.groupNumber === 5).map((event) => event.amountCents))),
      realizedExpensesCents: negate(safeSum(selectedEvents.filter((event) => event.groupNumber === 6).map((event) => event.amountCents))),
      projectedReceiptsCents: safeSum(forecasts.filter((item) => item.sourceType === "receivable").map((item) => item.amountCents)),
      projectedPaymentsCents: safeSum(forecasts.filter((item) => item.sourceType === "payable").map((item) => -item.amountCents)),
      unrecognizedExpectedReceiptsCents: safeSum(forecasts.filter((item) => item.sourceType === "draft-receivable").map((item) => item.amountCents)),
      unrecognizedExpectedPaymentsCents: safeSum(forecasts.filter((item) => item.sourceType === "draft-payable").map((item) => -item.amountCents)),
      recurringEstimateCents: safeSum(recurringEstimates.map((item) => item.amountCents)),
      budgetedReceiptsCents,
      budgetedPaymentsCents,
      projectedClosingCents: futureChart.at(-1)?.projectedCents ?? availableCashCents,
      scenarioClosingCents: futureChart.at(-1)?.scenarioCents ?? availableCashCents,
      minimumProjectedCents: minimumPoint.projectedCents, minimumProjectedDate: minimumPoint.date,
      firstNegativeDate: firstNegative?.date || null,
      otherCashInflowCents: otherInflowCents, otherCashOutflowCents: otherOutflowCents,
      otherMovements: otherEvents,
      chart: chartDays,
      actualEvents: selectedEvents,
      forecastEvents: forecasts,
      recurringEstimates,
    },
    payables: {
      outstandingCents: payableOutstandingCents, recognizedOutstandingCents: recognizedPayablesCents, draftsCents: draftPayablesCents,
      overdueCents: payableOverdueCents, next7DaysCents: payableNext7Cents, next30DaysCents: payableNext30Cents,
      paidInPeriodCents, commitmentRatio: availableCashCents <= 0 ? null : payableNext30Cents / availableCashCents,
      dueDistribution: dueDistribution(payables, cutoffDate), upcoming: payables.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8),
      costCenters: [...centerTotals.values()].filter((item) => item.amountCents),
    },
    receivables: {
      outstandingCents: receivableOutstandingCents, recognizedOutstandingCents: recognizedReceivablesCents, unrecognizedCents: draftReceivablesCents,
      overdueCents: receivableOverdueCents, expectedNext30DaysCents: receivableNext30Cents, receivedInPeriodCents,
      scheduledInPeriodCents: scheduledReceiptsInPeriodCents,
      upcoming: receivables.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8),
      byRevenueAccount: [...new Set(receivables.map((item) => item.accountId))].map((id) => ({ accountId: id, code: id ? accountCode(finance, id) : "", name: id ? accountsName(finance, id) : "Sem classificação", amountCents: safeSum(receivables.filter((item) => item.accountId === id).map((item) => item.outstandingCents)) })),
      onTimeCollectionRate: onTimeRate(finance, "receivable", postedById, fromDate, toDate),
    },
    accounting: {
      groups: accountingGroups,
      debitCents: accountingTotals.debitCents, creditCents: accountingTotals.creditCents,
      differenceCents: accountingTotals.differenceCents,
      integrity: accountingTotals,
    },
  };
}

function accountsName(finance, id) { return accountById(finance).get(id)?.name || "Conta indisponível"; }

function competenceAmountsBetween(finance, fromDate, toDate) {
  const startPeriod = monthOf(fromDate);
  const endPeriod = monthOf(toDate);
  const values = new Map((finance.planAccounts || []).map((account) => [account.id, 0]));
  for (const entry of entriesPosted(finance)) {
    if (entry.period < startPeriod || entry.period > endPeriod || entry.postingDate > toDate) continue;
    for (const line of entry.lines || []) {
      const group = accounting.getAccountGroup(finance, line.accountId);
      if (group === 4) values.set(line.accountId, (values.get(line.accountId) || 0) + line.creditCents - line.debitCents);
      else if ([5, 6].includes(group)) values.set(line.accountId, (values.get(line.accountId) || 0) + line.debitCents - line.creditCents);
    }
  }
  return values;
}

function onTimeRate(finance, kind, postedById, fromDate, toDate) {
  const titles = kind === "payable" ? finance.payables || [] : finance.receivables || [];
  const recordsKey = kind === "payable" ? "settlements" : "collections";
  const completed = [];
  for (const title of titles) {
    if (title.status === "cancelled" || !validDate(title.dueDate)) continue;
    const records = (title[recordsKey] || []).filter((item) => {
      const entry = item.journalEntryId ? postedById.get(item.journalEntryId) : null;
      const reversal = item.reversalEntryId ? postedById.get(item.reversalEntryId) : null;
      return entry && entry.postingDate <= toDate && (!reversal || reversal.postingDate > toDate);
    });
    const total = safeSum(records.map((item) => item.amountCents));
    if (total !== title.originalAmountCents || !records.length) continue;
    const lastDate = records.map((item) => item.date).sort().at(-1);
    if (lastDate < fromDate || lastDate > toDate) continue;
    completed.push(lastDate <= title.dueDate);
  }
  return completed.length ? completed.filter(Boolean).length / completed.length : null;
}

function classifyLiquidity(finance, account) {
  if (VALID_LIQUIDITY_CLASSES.has(account.liquidityClass)) return account.liquidityClass;
  const group = accounting.getAccountGroup(finance, account.id);
  const code = accountPathCode(finance, account);
  if (group === 1 && (code === "1.1" || code.startsWith("1.1."))) return "current-asset";
  if (group === 2 && (code === "2.1" || code.startsWith("2.1."))) return "current-liability";
  if (group === 1) return "unclassified-noncurrent-asset";
  if (group === 2) return "unclassified-liability";
  return null;
}

function accountBalanceRows(finance, cutoffDate) {
  const balances = balanceByAccount(finance, cutoffDate);
  return (finance.planAccounts || []).filter((account) => account.postable).map((account) => {
    const group = accounting.getAccountGroup(finance, account.id);
    const amount = naturalBalance(group, balances.get(account.id) || 0);
    return { accountId: account.id, code: accountCode(finance, account.id), name: account.name, groupNumber: group, amountCents: amount, liquidityClass: classifyLiquidity(finance, account), cashEquivalent: account.cashEquivalent === true };
  });
}

function groupTotal(rows, group) { return safeSum(rows.filter((row) => row.groupNumber === group).map((row) => row.amountCents)); }

function ratio(numeratorCents, denominatorCents, multiply = 1) {
  if (!Number.isFinite(numeratorCents) || !Number.isFinite(denominatorCents)) return null;
  if (denominatorCents === 0) return null;
  return numeratorCents / denominatorCents * multiply;
}

function ratioRecord(value, formula, numeratorLabel, numeratorCents, denominatorLabel, denominatorCents, explanation, unit = "vezes") {
  return {
    value, displayValue: value == null ? (denominatorCents === 0 ? "Não calculável" : "Dados insuficientes") : value,
    formula, numeratorLabel, numeratorCents, denominatorLabel, denominatorCents, unit, explanation,
  };
}

function closeNetWorth(finance, cutoffDate) {
  const rows = accountBalanceRows(finance, cutoffDate);
  return groupTotal(rows, 1) - groupTotal(rows, 2);
}

function trendAmount(finance, selector, period) {
  const start = period + "-01";
  const end = monthEnd(period);
  if (selector === "cash") return safeSum(cashEvents(finance, start, end).map((event) => event.amountCents));
  const movements = periodAmounts(finance, period);
  if (selector === "revenue" || selector === "degree:4") return safeSum([...movements.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 4).map(([, amount]) => amount));
  if (selector === "cost" || selector === "degree:5") return safeSum([...movements.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 5).map(([, amount]) => amount));
  if (selector === "expense" || selector === "degree:6") return safeSum([...movements.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 6).map(([, amount]) => amount));
  if (selector === "result") return trendAmount(finance, "revenue", period) - trendAmount(finance, "cost", period) - trendAmount(finance, "expense", period);
  if (/^degree:[1-3]$/.test(selector)) {
    const group = Number(selector.slice(7));
    const rows = accountBalanceRows(finance, end);
    return groupTotal(rows, group);
  }
  if (/^degree:[4-6]$/.test(selector)) return trendAmount(finance, selector, period);
  if (selector.startsWith("account:")) {
    const id = selector.slice(8);
    const group = accounting.getAccountGroup(finance, id);
    const value = movements.get(id) || 0;
    if ([1, 2, 3].includes(group)) {
      const rows = accountBalanceRows(finance, end);
      return rows.find((row) => row.accountId === id)?.amountCents || 0;
    }
    return value;
  }
  if (selector.startsWith("subcategory:")) {
    const id = selector.slice(12);
    const prefix = accounting.getSubcategoryCode(finance, id) + ".";
    const selected = (finance.planAccounts || []).filter((account) => accountCode(finance, account.id).startsWith(prefix));
    return safeSum(selected.map((account) => {
      const group = accounting.getAccountGroup(finance, account.id);
      if ([1, 2, 3].includes(group)) return accountBalanceRows(finance, end).find((row) => row.accountId === account.id)?.amountCents || 0;
      return movements.get(account.id) || 0;
    }));
  }
  return 0;
}

function verticalRows(finance, sourceRows, group, amountByAccount, denominator) {
  return sourceRows.filter((row) => row.groupNumber === group).map((row) => {
    const amountCents = amountByAccount instanceof Map ? amountByAccount.get(row.accountId) || 0 : row.amountCents;
    return { accountId: row.accountId, code: row.code, name: row.name, amountCents, percentage: denominator === 0 ? null : amountCents / denominator * 100 };
  }).filter((row) => row.amountCents !== 0).sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
}

function getFinancialAnalysis(finance, filters, options = {}) {
  const period = filters.period;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period || "")) throw new Error("Informe um mês válido para a Análise Financeira.");
  const previousPeriod = shiftMonth(period, -1);
  const cutoffDate = monthEnd(period);
  const previousCutoff = monthEnd(previousPeriod);
  const runwayDays = Math.max(7, Math.min(180, Number(filters.runwayDays || 30)));
  const trendCount = Math.max(2, Math.min(12, Number(filters.trendCount || 6)));
  const selectedCenterId = filters.costCenterId || null;
  const centers = finance.costCenters || [];
  if (selectedCenterId && selectedCenterId !== "sem-centro" && !centers.some((center) => center.id === selectedCenterId)) throw new Error("Centro de custo inválido para a análise.");
  const rows = accountBalanceRows(finance, cutoffDate);
  const prevRows = accountBalanceRows(finance, previousCutoff);
  const assets = groupTotal(rows, 1);
  const liabilities = groupTotal(rows, 2);
  const bookedEquity = groupTotal(rows, 3);
  const currentAssetsRows = rows.filter((row) => row.groupNumber === 1 && row.liquidityClass === "current-asset");
  const currentLiabilityRows = rows.filter((row) => row.groupNumber === 2 && row.liquidityClass === "current-liability");
  const longReceivableRows = rows.filter((row) => row.groupNumber === 1 && row.liquidityClass === "long-term-receivable");
  const longLiabilityRows = rows.filter((row) => row.groupNumber === 2 && row.liquidityClass === "long-term-liability");
  const unclassifiedAssets = rows.filter((row) => row.groupNumber === 1 && row.amountCents !== 0 && row.liquidityClass === "unclassified-noncurrent-asset");
  const unclassifiedLiabilities = rows.filter((row) => row.groupNumber === 2 && row.amountCents !== 0 && row.liquidityClass === "unclassified-liability");
  const classificationCompleteForCurrent = unclassifiedLiabilities.length === 0;
  const classificationCompleteForGeneral = classificationCompleteForCurrent && unclassifiedAssets.length === 0;
  const currentAssets = safeSum(currentAssetsRows.map((row) => row.amountCents));
  const currentLiabilities = safeSum(currentLiabilityRows.map((row) => row.amountCents));
  const longReceivables = safeSum(longReceivableRows.map((row) => row.amountCents));
  const longLiabilities = safeSum(longLiabilityRows.map((row) => row.amountCents));
  const cashEquivalents = safeSum(rows.filter((row) => row.groupNumber === 1 && row.cashEquivalent).map((row) => row.amountCents));
  const previousCurrentAssets = safeSum(prevRows.filter((row) => row.groupNumber === 1 && row.liquidityClass === "current-asset").map((row) => row.amountCents));
  const previousCurrentLiabilities = safeSum(prevRows.filter((row) => row.groupNumber === 2 && row.liquidityClass === "current-liability").map((row) => row.amountCents));
  const previousAssets = groupTotal(prevRows, 1);
  const previousLiabilities = groupTotal(prevRows, 2);
  const previousCashEquivalents = safeSum(prevRows.filter((row) => row.groupNumber === 1 && row.cashEquivalent).map((row) => row.amountCents));
  const currentRatio = classificationCompleteForCurrent ? ratio(currentAssets, currentLiabilities) : null;
  const immediateRatio = classificationCompleteForCurrent ? ratio(cashEquivalents, currentLiabilities) : null;
  const workingCapital = classificationCompleteForCurrent ? currentAssets - currentLiabilities : null;
  const generalRatio = classificationCompleteForGeneral ? ratio(currentAssets + longReceivables, currentLiabilities + longLiabilities) : null;
  const previousCurrentRatio = classificationCompleteForCurrent && previousCurrentLiabilities !== 0 ? ratio(previousCurrentAssets, previousCurrentLiabilities) : null;
  const liabilitiesEquity = safeSum(rows.filter((row) => row.groupNumber === 3).map((row) => row.amountCents));
  const unclosedResult = safeSum(entriesPosted(finance).filter((entry) => entry.postingDate <= cutoffDate && entry.period <= period).flatMap((entry) => (entry.lines || []).map((line) => {
    const group = accounting.getAccountGroup(finance, line.accountId);
    if (group === 4) return line.creditCents - line.debitCents;
    if ([5, 6].includes(group)) return -(line.debitCents - line.creditCents);
    return 0;
  })));
  const adjustedEquity = liabilitiesEquity + unclosedResult;
  const previousLiabilitiesEquity = safeSum(prevRows.filter((row) => row.groupNumber === 3).map((row) => row.amountCents));
  const previousUnclosedResult = safeSum(entriesPosted(finance).filter((entry) => entry.postingDate <= previousCutoff && entry.period <= previousPeriod).flatMap((entry) => (entry.lines || []).map((line) => {
    const group = accounting.getAccountGroup(finance, line.accountId);
    if (group === 4) return line.creditCents - line.debitCents;
    if ([5, 6].includes(group)) return -(line.debitCents - line.creditCents);
    return 0;
  })));
  const previousAdjustedEquity = previousLiabilitiesEquity + previousUnclosedResult;
  const previousLongReceivables = safeSum(prevRows.filter((row) => row.groupNumber === 1 && row.liquidityClass === "long-term-receivable").map((row) => row.amountCents));
  const previousLongLiabilities = safeSum(prevRows.filter((row) => row.groupNumber === 2 && row.liquidityClass === "long-term-liability").map((row) => row.amountCents));
  const resultAmounts = periodAmounts(finance, period, selectedCenterId);
  const allPeriodAmounts = periodAmounts(finance, period);
  const revenue = safeSum([...resultAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 4).map(([, amount]) => amount));
  const costs = safeSum([...resultAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 5).map(([, amount]) => amount));
  const expenses = safeSum([...resultAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 6).map(([, amount]) => amount));
  const economicResult = revenue - costs - expenses;
  const previousAmounts = periodAmounts(finance, previousPeriod, selectedCenterId);
  const previousRevenue = safeSum([...previousAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 4).map(([, amount]) => amount));
  const previousCosts = safeSum([...previousAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 5).map(([, amount]) => amount));
  const previousExpenses = safeSum([...previousAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 6).map(([, amount]) => amount));
  const previousResult = previousRevenue - previousCosts - previousExpenses;
  const rangeEvents = cashEvents(finance, period + "-01", cutoffDate);
  const cashMovement = safeSum(rangeEvents.map((event) => event.amountCents));
  const priorPosted = entriesPosted(finance).filter((entry) => entry.postingDate <= cutoffDate);
  const postedById = new Map(priorPosted.map((entry) => [entry.id, entry]));
  const dashboardTitles = titleRows(finance, "payable", cutoffDate, postedById);
  const forecastPayables30 = safeSum(dashboardTitles.filter((item) => item.dueDate >= cutoffDate && item.dueDate <= shiftDay(cutoffDate, 30)).map((item) => item.outstandingCents));
  const analysisCash = safeSum(rows.filter((row) => row.groupNumber === 1 && row.cashEquivalent).map((row) => row.amountCents));
  const historyStart = shiftDay(cutoffDate, -runwayDays + 1);
  const historyEvents = cashEvents(finance, historyStart, cutoffDate);
  const cashByDay = new Map();
  for (const event of historyEvents) cashByDay.set(event.date, (cashByDay.get(event.date) || 0) + event.amountCents);
  const dailyOutflow = safeSum([...cashByDay.values()].map((amount) => Math.max(0, -amount)));
  const averageDailyOutflow = dailyOutflow / runwayDays;
  const expenseAccountId = filters.expenseAccountId || "";
  const selectedExpense = expenseAccountId ? resultAmounts.get(expenseAccountId) || 0 : 0;
  const selectedExpenseAccount = (finance.planAccounts || []).find((item) => item.id === expenseAccountId);
  const expenseConcentration = selectedExpenseAccount && accounting.getAccountGroup(finance, selectedExpenseAccount.id) === 6 ? ratio(selectedExpense, expenses, 100) : null;
  const currentNetWorth = assets - liabilities;
  const previousNetWorth = closeNetWorth(finance, previousCutoff);
  const netWorthEvolution = currentNetWorth - previousNetWorth;
  const trendSelector = filters.trendSelector || "expense";
  const trendPeriods = Array.from({ length: trendCount }, (_, index) => shiftMonth(period, index - trendCount + 1));
  const trend = trendPeriods.map((item) => ({ period: item, amountCents: trendAmount(finance, trendSelector, item) }));
  const currentTrend = trend.at(-1)?.amountCents || 0;
  const previousTrend = trend.length > 1 ? trend.at(-2).amountCents : 0;
  const trendVariationCents = currentTrend - previousTrend;
  const trendVariationPercent = previousTrend === 0 ? null : trendVariationCents / Math.abs(previousTrend) * 100;
  const groupRevenue = safeSum([...allPeriodAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 4).map(([, amount]) => amount));
  const groupCosts = safeSum([...allPeriodAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 5).map(([, amount]) => amount));
  const groupExpenses = safeSum([...allPeriodAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === 6).map(([, amount]) => amount));
  const vertical = {
    revenue: verticalRows(finance, rows, 4, allPeriodAmounts, groupRevenue),
    costs: verticalRows(finance, rows, 5, allPeriodAmounts, groupCosts),
    expenses: verticalRows(finance, rows, 6, allPeriodAmounts, groupExpenses),
    assets: verticalRows(finance, rows, 1, null, assets),
    liabilities: verticalRows(finance, rows, 2, null, liabilities),
  };
  const centerValues = new Map();
  for (const center of centers) centerValues.set(center.id, { costCenterId: center.id, name: center.name, revenueCents: 0, costsCents: 0, expensesCents: 0 });
  centerValues.set("", { costCenterId: null, name: "Sem centro de custo", revenueCents: 0, costsCents: 0, expensesCents: 0 });
  for (const entry of entriesPosted(finance)) {
    if (entry.period !== period) continue;
    for (const line of entry.lines || []) {
      const group = accounting.getAccountGroup(finance, line.accountId);
      if (![4, 5, 6].includes(group)) continue;
      const signed = group === 4 ? line.creditCents - line.debitCents : line.debitCents - line.creditCents;
      const allocations = line.costCenterAllocations || [];
      if (!allocations.length) {
        const item = centerValues.get("");
        item[group === 4 ? "revenueCents" : group === 5 ? "costsCents" : "expensesCents"] += signed;
      } else {
        for (const allocation of allocations) {
          const item = centerValues.get(allocation.costCenterId);
          if (item) item[group === 4 ? "revenueCents" : group === 5 ? "costsCents" : "expensesCents"] += Math.sign(signed) * allocation.amountCents;
        }
      }
    }
  }
  const allPayables = (finance.payables || []).filter((item) => item.status !== "cancelled");
  const onTimePaymentRate = onTimeRate(finance, "payable", postedById, "0001-01-01", cutoffDate);
  const ratios = {
    current: { ...ratioRecord(currentRatio, "Ativo Circulante ÷ Passivo Circulante", "Ativo Circulante", currentAssets, "Passivo Circulante", currentLiabilities, "Compara recursos realizáveis no curto prazo com obrigações classificadas como circulantes.", "vezes"), displayValue: classificationCompleteForCurrent ? ratioRecord(currentRatio, "", "", 0, "", currentLiabilities, "", "vezes").displayValue : "Dados insuficientes", previousValue: classificationCompleteForCurrent ? ratio(previousCurrentAssets, previousCurrentLiabilities) : null },
    immediate: { ...ratioRecord(immediateRatio, "Caixa e equivalentes ÷ Passivo Circulante", "Caixa e equivalentes", cashEquivalents, "Passivo Circulante", currentLiabilities, "Considera somente contas de caixa e banco marcadas no plano de contas.", "vezes"), displayValue: classificationCompleteForCurrent ? ratioRecord(immediateRatio, "", "", 0, "", currentLiabilities, "", "vezes").displayValue : "Dados insuficientes", previousValue: classificationCompleteForCurrent ? ratio(previousCashEquivalents, previousCurrentLiabilities) : null },
    workingCapital: { ...ratioRecord(workingCapital, "Ativo Circulante − Passivo Circulante", "Ativo Circulante", currentAssets, "Passivo Circulante", currentLiabilities, "Diferença patrimonial entre recursos e obrigações de curto prazo.", "R$"), displayValue: classificationCompleteForCurrent ? (workingCapital == null ? "Não calculável" : workingCapital) : "Dados insuficientes", previousValue: classificationCompleteForCurrent ? previousCurrentAssets - previousCurrentLiabilities : null },
    general: { ...ratioRecord(generalRatio, "(Ativo Circulante + Realizável a Longo Prazo) ÷ (Passivo Circulante + Passivo Não Circulante)", "Ativo Circulante + Realizável a Longo Prazo", currentAssets + longReceivables, "Passivo Circulante + Passivo Não Circulante", currentLiabilities + longLiabilities, "Requer classificação explícita dos saldos não circulantes relevantes.", "vezes"), displayValue: classificationCompleteForGeneral ? ratioRecord(generalRatio, "", "", 0, "", currentLiabilities + longLiabilities, "", "vezes").displayValue : "Dados insuficientes", previousValue: classificationCompleteForGeneral ? ratio(previousCurrentAssets + previousLongReceivables, previousCurrentLiabilities + previousLongLiabilities) : null },
    debtAssets: { ...ratioRecord(ratio(liabilities, assets, 100), "Passivo reconhecido ÷ Ativo × 100", "Passivo reconhecido", liabilities, "Ativo", assets, "Mostra a parcela do ativo financiada por obrigações reconhecidas.", "%"), previousValue: ratio(previousLiabilities, previousAssets, 100) },
    thirdPartyToEquity: { ...ratioRecord(adjustedEquity <= 0 ? null : ratio(liabilities, adjustedEquity, 100), "Passivo reconhecido ÷ (Patrimônio Líquido contabilizado + resultado acumulado não encerrado) × 100", "Passivo reconhecido", liabilities, "Patrimônio Líquido ajustado", adjustedEquity, adjustedEquity <= 0 ? "O patrimônio líquido ajustado é zero ou negativo; a comparação não é calculável." : "O denominador soma o Patrimônio Líquido contabilizado e o resultado acumulado por competência ainda não encerrado.", "%"), displayValue: adjustedEquity <= 0 ? "Não calculável" : ratio(liabilities, adjustedEquity, 100), previousValue: previousAdjustedEquity > 0 ? ratio(previousLiabilities, previousAdjustedEquity, 100) : null },
    shortTermDebtComposition: { ...ratioRecord(classificationCompleteForCurrent ? ratio(currentLiabilities, liabilities, 100) : null, "Passivo Circulante ÷ Passivo reconhecido × 100", "Passivo Circulante", currentLiabilities, "Passivo reconhecido", liabilities, "A composição exige classificar os passivos sem prazo definido.", "%"), displayValue: classificationCompleteForCurrent ? ratioRecord(ratio(currentLiabilities, liabilities, 100), "", "", 0, "", liabilities, "", "%").displayValue : "Dados insuficientes", previousValue: classificationCompleteForCurrent ? ratio(previousCurrentLiabilities, previousLiabilities, 100) : null },
  };
  const errorIntegrity = integrity(finance, period + "-01", cutoffDate);
  const resultAccountLines = [4, 5, 6].map((group) => ({
    groupNumber: group, name: GROUP_NAMES[group],
    amountCents: safeSum([...resultAmounts.entries()].filter(([id]) => accounting.getAccountGroup(finance, id) === group).map(([, amount]) => amount)),
    rows: (finance.planAccounts || []).filter((account) => accounting.getAccountGroup(finance, account.id) === group).map((account) => ({ accountId: account.id, code: accountCode(finance, account.id), name: account.name, amountCents: resultAmounts.get(account.id) || 0 })).filter((item) => item.amountCents !== 0),
  }));
  const liquidityAvailability = {
    currentLiabilitiesComplete: classificationCompleteForCurrent,
    generalClassificationComplete: classificationCompleteForGeneral,
    unclassifiedAssets: unclassifiedAssets.map((item) => ({ accountId: item.accountId, code: item.code, name: item.name, amountCents: item.amountCents })),
    unclassifiedLiabilities: unclassifiedLiabilities.map((item) => ({ accountId: item.accountId, code: item.code, name: item.name, amountCents: item.amountCents })),
  };
  return {
    period, previousPeriod, cutoffDate, previousCutoff, runwayDays, trendSelector,
    balance: {
      assetsCents: assets, liabilitiesCents: liabilities, bookedEquityCents: bookedEquity,
      unclosedAccumulatedResultCents: unclosedResult, adjustedEquityCents: adjustedEquity,
      reconciliationDifferenceCents: assets - liabilities - adjustedEquity,
      currentAssetsCents: currentAssets, currentLiabilitiesCents: currentLiabilities,
      longTermReceivablesCents: longReceivables, longTermLiabilitiesCents: longLiabilities,
      cashEquivalentsCents: cashEquivalents, netWorthCents: currentNetWorth,
      previousNetWorthCents: previousNetWorth, netWorthEvolutionCents: netWorthEvolution,
      unclosedCurrentPeriodResultCents: economicResult,
      previousCurrentRatio: previousCurrentRatio,
      ratios,
      liquidityAvailability,
    },
    debtComposition: { currentLiabilitiesCents: currentLiabilities, longTermLiabilitiesCents: longLiabilities, unclassifiedLiabilitiesCents: safeSum(unclassifiedLiabilities.map((item) => item.amountCents)), complete: classificationCompleteForCurrent },
    performance: {
      revenueCents: revenue, costsCents: costs, expensesCents: expenses, economicResultCents: economicResult,
      resultMargin: ratio(economicResult, revenue, 100), revenueCommitmentRatio: ratio(costs + expenses, revenue, 100),
      previous: { revenueCents: previousRevenue, costsCents: previousCosts, expensesCents: previousExpenses, economicResultCents: previousResult },
      accounts: resultAccountLines,
      costCenters: [...centerValues.values()].filter((item) => item.revenueCents || item.costsCents || item.expensesCents),
      explanation: "O resultado segue a competência dos lançamentos postados. O movimento de caixa segue as datas dos lançamentos que afetaram contas de caixa e banco.",
    },
    comparative: {
      trend, currentAmountCents: currentTrend, previousAmountCents: previousTrend,
      absoluteVariationCents: trendVariationCents, percentageVariation: trendVariationPercent,
      signConvention: "A variação percentual usa (valor atual − valor anterior) ÷ ABS(valor anterior) × 100; o sinal mostra a direção da mudança, mesmo para valores negativos.",
      vertical,
    },
    managerial: {
      coverageRatio: ratio(analysisCash, forecastPayables30), availableCashCents: analysisCash, forecastPayables30Cents: forecastPayables30,
      runwayDays, averageDailyOutflowCents: averageDailyOutflow,
      cashRunwayDays: averageDailyOutflow > 0 && analysisCash > 0 ? analysisCash / averageDailyOutflow : null,
      runwayExplanation: "Estimativa simples com gasto diário médio constante no intervalo histórico; não é garantia de previsão.",
      onTimePaymentRate,
      onTimePaymentDefinition: "Conta cada título pago uma vez. Um título fica em dia quando a última liquidação ativa ocorreu até o vencimento; liquidações parciais contam juntas.",
      expenseConcentration, expenseAccountId: selectedExpenseAccount?.id || null,
      expenseAccountName: selectedExpenseAccount?.name || null, totalExpensesCents: expenses, selectedExpenseCents: selectedExpense,
      currentNetWorthCents: currentNetWorth, previousNetWorthCents: previousNetWorth, netWorthEvolutionCents: netWorthEvolution,
      economicResultCents: economicResult, netCashMovementCents: cashMovement,
      cashResultExplanation: "A diferença entre competência e caixa pode decorrer de prazos, movimentos não operacionais, investimentos, financiamentos e outros eventos; não corresponde apenas a títulos em aberto.",
    },
    integrity: errorIntegrity,
  };
}

module.exports = {
  VALID_LIQUIDITY_CLASSES, safeSum, validDate, localToday, integrity,
  getDashboard, getFinancialAnalysis, classifyLiquidity,
};
