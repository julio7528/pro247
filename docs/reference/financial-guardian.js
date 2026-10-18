"use strict";

const accounting = require("./accounting");
const financialReports = require("./financial-reports");

const TIME_ZONE = "America/Cuiaba";
const FORECAST_DAYS = 30;
const MAX_ITEMS = 30;
const MAX_EVIDENCE = 8;
const DUE_DATE_CONCENTRATION_THRESHOLD_PERCENT = 50;
const DUE_DATE_CONCENTRATION_MINIMUM_TITLES = 2;

function isValidDate(value) {
  return accounting.validDate(value);
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthOf(date) {
  return date.slice(0, 7);
}

function shiftMonth(period, delta) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}

function monthEnd(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function dayInMonth(date) {
  return Number(date.slice(8, 10));
}

function daysInMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function safeSum(values) {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new Error("Há valor financeiro fora do limite seguro de centavos.");
    total += value;
    if (!Number.isSafeInteger(total)) throw new Error("A soma financeira excede o limite seguro de centavos.");
  }
  return total;
}

function safeGeneratedAt(value) {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  return new Date().toISOString();
}

function makeUnavailable(referenceDate, generatedAt, limitation) {
  return {
    referenceDate,
    timeZone: TIME_ZONE,
    generatedAt,
    status: "unavailable",
    coverage: {
      dataKind: "unknown",
      forecastDays: FORECAST_DAYS,
      obligations: "unavailable",
      cash: "unavailable",
      competence: "unavailable",
      expenses: "unavailable",
    },
    summary: {
      payables: null,
      receivables: null,
      cash: null,
      health: null,
      competence: null,
      expenses: null,
    },
    items: [],
    limitations: [limitation],
  };
}

function compareItems(a, b) {
  return a.priority - b.priority
    || (a.facts?.date || a.facts?.firstNegativeDate || "").localeCompare(b.facts?.date || b.facts?.firstNegativeDate || "")
    || a.id.localeCompare(b.id);
}

function addItem(items, item) {
  items.push(item);
}

function baseItem(referenceDate, ruleCode, severity, kind, title, summary, facts, options = {}) {
  const idPart = options.identity || "aggregate";
  return {
    id: `guardian:${ruleCode.toLowerCase()}:${referenceDate}:${idPart}`,
    ruleCode,
    severity,
    kind,
    title,
    summary,
    facts,
    evidence: (options.evidence || []).slice(0, MAX_EVIDENCE),
    assumptions: (options.assumptions || []).slice(0, 5),
    limitations: (options.limitations || []).slice(0, 5),
    priority: options.priority ?? 50,
  };
}

function closeItem(item) {
  const { priority, ...serializable } = item;
  return serializable;
}

function resultGroups(incomeStatement) {
  const groups = incomeStatement?.groups;
  if (!Array.isArray(groups)) return null;
  const byNumber = new Map(groups.map((group) => [group.groupNumber, group]));
  const revenue = byNumber.get(4);
  const costs = byNumber.get(5);
  const expenses = byNumber.get(6);
  if (![revenue, costs, expenses].every((group) => group && Number.isSafeInteger(group.totalCents) && Array.isArray(group.rows))) return null;
  return { revenue, costs, expenses };
}

function periodHasPostedEntries(finance, period, cutoffDate) {
  return (finance.journalEntries || []).some((entry) => entry.status === accounting.POSTED
    && entry.period === period && entry.postingDate <= cutoffDate);
}

function resultClassificationIsComplete(finance, period, cutoffDate) {
  const byId = new Map((finance.planAccounts || []).map((account) => [account.id, account]));
  for (const entry of finance.journalEntries || []) {
    if (entry.status !== accounting.POSTED || entry.period !== period || entry.postingDate > cutoffDate) continue;
    for (const line of entry.lines || []) {
      const account = byId.get(line.accountId);
      const group = account ? accounting.getAccountGroup(finance, line.accountId) : null;
      if (!account || account.postable !== true || !Number.isInteger(group) || group < 1 || group > 6) return false;
    }
  }
  return true;
}

function incomeStatementAsOf(finance, period, cutoffDate) {
  // The accounting report owns DRE aggregation. Filter a new array so entries
  // posted after the as-of date cannot leak into a month-to-date result.
  const snapshot = {
    ...finance,
    journalEntries: finance.journalEntries.filter((entry) => entry.status !== accounting.POSTED || entry.postingDate <= cutoffDate),
  };
  const statement = accounting.getIncomeStatement(snapshot, period);
  return resultGroups(statement.accrual);
}

function mtdWindow(period, referenceDate) {
  const lastDay = Math.min(dayInMonth(referenceDate), daysInMonth(period));
  return { fromDate: `${period}-01`, toDate: `${period}-${String(lastDay).padStart(2, "0")}` };
}

function expenseComparison(finance, currentPeriod, referenceDate, currentExpenseCents, limitations) {
  const previousPeriod = shiftMonth(currentPeriod, -1);
  const currentWindow = mtdWindow(currentPeriod, referenceDate);
  const previousWindow = mtdWindow(previousPeriod, referenceDate);

  if (!periodHasPostedEntries(finance, previousPeriod, previousWindow.toDate)) {
    limitations.push(`A comparação de despesas com ${previousPeriod} foi omitida porque não há histórico de lançamentos por competência nesse período.`);
    return null;
  }
  if (!resultClassificationIsComplete(finance, previousPeriod, previousWindow.toDate)) {
    limitations.push(`A comparação de despesas com ${previousPeriod} foi omitida porque há lançamentos sem classificação contábil disponível.`);
    return null;
  }
  const priorGroups = incomeStatementAsOf(finance, previousPeriod, previousWindow.toDate);
  if (!priorGroups) {
    limitations.push(`A comparação de despesas com ${previousPeriod} não pôde ser calculada pela DRE disponível.`);
    return null;
  }
  const priorCents = priorGroups.expenses.totalCents;
  const delta = currentExpenseCents - priorCents;
  return {
    currentPeriod,
    fromDate: currentWindow.fromDate,
    toDate: currentWindow.toDate,
    previousPeriod,
    previousFromDate: previousWindow.fromDate,
    previousToDate: previousWindow.toDate,
    currentCents: currentExpenseCents,
    previousCents: priorCents,
    deltaCents: delta,
    variationPercent: priorCents === 0 ? null : (delta / Math.abs(priorCents)) * 100,
    previousWindowShortened: Math.min(dayInMonth(referenceDate), daysInMonth(previousPeriod))
      < Math.min(dayInMonth(referenceDate), daysInMonth(currentPeriod)),
    percentageUnavailableReason: priorCents === 0 ? "A base de comparação é zero; não há percentual calculável." : null,
  };
}

function accountExpenseConcentration(groups, limitations) {
  const expenseRows = groups.expenses.rows
    .filter((row) => Number.isSafeInteger(row.amountCents) && row.amountCents > 0)
    .slice()
    .sort((a, b) => b.amountCents - a.amountCents || a.accountId.localeCompare(b.accountId));
  const total = groups.expenses.totalCents;
  if (!Number.isSafeInteger(total) || total <= 0) {
    limitations.push("A concentração de despesas foi omitida porque o total líquido de despesas não é positivo ou não pode ser calculado.");
    return null;
  }
  return {
    totalCents: total,
    topAccounts: expenseRows.slice(0, 3).map((row) => ({
      accountId: row.accountId,
      code: row.code,
      name: safeRecordText(row.name, "Conta sem classificação", 120),
      amountCents: row.amountCents,
      sharePercent: (row.amountCents / total) * 100,
    })),
  };
}

function mapDashboardTitles(finance, dashboard, kind) {
  const documents = kind === "payable" ? finance.payables : finance.receivables;
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const reportEvents = dashboard.cash.forecastEvents.filter((event) => {
    if (kind === "payable") return event.sourceType === "payable" || event.sourceType === "draft-payable";
    return event.sourceType === "receivable" || event.sourceType === "draft-receivable";
  });
  return reportEvents.map((event) => {
    const document = documentsById.get(event.sourceId);
    if (!document || !isValidDate(document.dueDate) || !Number.isSafeInteger(Math.abs(event.amountCents))) return null;
    const recognized = kind === "payable" ? event.sourceType === "payable" : event.sourceType === "receivable";
    return {
      id: document.id,
      dueDate: document.dueDate,
      projectedDate: event.date,
      amountCents: Math.abs(event.amountCents),
      recognized,
      entityType: kind,
      party: safeRecordText(kind === "payable" ? document.creditor : document.debtor, "Parte não informada", 120),
      description: safeRecordText(document.description, "Descrição não informada", 160),
    };
  }).filter(Boolean);
}

function classifyDueWindows(rows, referenceDate) {
  const tomorrow = shiftDate(referenceDate, 1);
  const edge7 = shiftDate(referenceDate, 7);
  const buckets = {
    overdue: [],
    dueToday: [],
    next7Days: [],
  };
  for (const row of rows) {
    const bucket = row.dueDate < referenceDate ? "overdue"
      : row.dueDate === referenceDate ? "dueToday"
        : row.dueDate >= tomorrow && row.dueDate <= edge7 ? "next7Days" : null;
    if (bucket) buckets[bucket].push(row);
  }
  return buckets;
}

function summarizeRows(rows) {
  return {
    count: rows.length,
    amountCents: safeSum(rows.map((row) => row.amountCents)),
  };
}

function dueSummary(recognizedBuckets, draftBuckets, referenceDate) {
  return {
    overdue: summarizeRows(recognizedBuckets.overdue),
    dueToday: summarizeRows(recognizedBuckets.dueToday),
    next7Days: {
      ...summarizeRows(recognizedBuckets.next7Days),
      fromDate: shiftDate(referenceDate, 1),
      toDate: shiftDate(referenceDate, 7),
    },
    draftEstimates: {
      overdue: summarizeRows(draftBuckets.overdue),
      dueToday: summarizeRows(draftBuckets.dueToday),
      next7Days: {
        ...summarizeRows(draftBuckets.next7Days),
        fromDate: shiftDate(referenceDate, 1),
        toDate: shiftDate(referenceDate, 7),
      },
    },
  };
}

function safeRecordText(value, fallback, maximum = 180) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : fallback;
}

function contractBucket(rows) {
  const ordered = rows.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)
    || b.amountCents - a.amountCents || a.id.localeCompare(b.id));
  return {
    count: rows.length,
    amountCents: safeSum(rows.map((row) => row.amountCents)),
    items: ordered.slice(0, 4).map((row) => ({
      id: row.id,
      dueDate: row.dueDate,
      party: row.party,
      description: row.description,
      outstandingCents: row.amountCents,
      recognized: row.recognized,
    })),
  };
}

function contractObligations(recognizedBuckets, draftBuckets) {
  const result = {
    overdue: contractBucket(recognizedBuckets.overdue),
    dueToday: contractBucket(recognizedBuckets.dueToday),
    next7Days: contractBucket(recognizedBuckets.next7Days),
  };
  const draftRows = [...draftBuckets.overdue, ...draftBuckets.dueToday, ...draftBuckets.next7Days];
  if (draftRows.length) {
    result.drafts = {
      overdue: contractBucket(draftBuckets.overdue),
      dueToday: contractBucket(draftBuckets.dueToday),
      next7Days: contractBucket(draftBuckets.next7Days),
    };
  }
  return result;
}

function evidenceForRows(rows) {
  return rows.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)
    || b.amountCents - a.amountCents || a.id.localeCompare(b.id))
    .slice(0, MAX_EVIDENCE)
    .map((row) => ({ entityType: row.entityType, entityId: row.id }));
}

function topTitleFacts(rows) {
  return rows.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)
    || b.amountCents - a.amountCents || a.id.localeCompare(b.id))
    .slice(0, MAX_EVIDENCE)
    .map((row) => ({ id: row.id, dueDate: row.dueDate, outstandingCents: row.amountCents }));
}

function buildObligationItems(items, referenceDate, kind, label, buckets) {
  const configs = [
    { key: "overdue", ruleCode: `${kind}_OVERDUE`, title: `${label} vencidos`, priority: kind === "PAYABLE" ? 1 : 4, severity: "warning", summary: `${label} reconhecidos com saldo em aberto e vencimento anterior a ${referenceDate}.` },
    { key: "dueToday", ruleCode: `${kind}_DUE_TODAY`, title: `${label} com vencimento hoje`, priority: kind === "PAYABLE" ? 2 : 5, severity: "warning", summary: `${label} reconhecidos com saldo em aberto e vencimento em ${referenceDate}.` },
    { key: "next7Days", ruleCode: `${kind}_NEXT_7_DAYS`, title: `${label} nos próximos 7 dias`, priority: kind === "PAYABLE" ? 20 : 21, severity: "info", summary: `${label} reconhecidos com saldo em aberto entre ${shiftDate(referenceDate, 1)} e ${shiftDate(referenceDate, 7)}.` },
  ];
  for (const config of configs) {
    const rows = buckets[config.key];
    if (!rows.length) continue;
    const total = summarizeRows(rows);
    addItem(items, baseItem(referenceDate, config.ruleCode, config.severity, "confirmed_fact", config.title, config.summary, {
      count: total.count,
      outstandingCents: total.amountCents,
      fromDate: config.key === "next7Days" ? shiftDate(referenceDate, 1) : config.key === "dueToday" ? referenceDate : null,
      toDate: config.key === "next7Days" ? shiftDate(referenceDate, 7) : config.key === "dueToday" ? referenceDate : shiftDate(referenceDate, -1),
      titles: topTitleFacts(rows),
      additionalTitlesOmitted: Math.max(0, rows.length - MAX_EVIDENCE),
    }, {
      evidence: evidenceForRows(rows),
      priority: config.priority,
    }));
  }
}

function buildDueDateConcentrationItems(items, referenceDate, rows) {
  if (!rows.length) return;
  const fromDate = shiftDate(referenceDate, 1);
  const toDate = shiftDate(referenceDate, 7);
  const totalNext7DaysCents = safeSum(rows.map((row) => row.amountCents));
  if (totalNext7DaysCents <= 0) return;
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.dueDate)) byDate.set(row.dueDate, []);
    byDate.get(row.dueDate).push(row);
  }
  for (const [date, titles] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (titles.length < DUE_DATE_CONCENTRATION_MINIMUM_TITLES) continue;
    const concentratedCents = safeSum(titles.map((row) => row.amountCents));
    const sharePercent = (concentratedCents / totalNext7DaysCents) * 100;
    if (sharePercent < DUE_DATE_CONCENTRATION_THRESHOLD_PERCENT) continue;
    const roundedSharePercent = Math.round(sharePercent * 100) / 100;
    addItem(items, baseItem(referenceDate, "DUE_DATE_CONCENTRATION", "info", "confirmed_fact", "Vencimentos concentrados em uma data", `${titles.length} contas a pagar reconhecidas vencem em ${date} e somam ${roundedSharePercent}% do valor reconhecido dos próximos 7 dias. Este é um alerta informativo.`, {
      fromDate,
      toDate,
      date,
      titleCount: titles.length,
      totalNext7DaysCents,
      concentratedCents,
      sharePercent: roundedSharePercent,
      thresholdPercent: DUE_DATE_CONCENTRATION_THRESHOLD_PERCENT,
      minimumTitleCount: DUE_DATE_CONCENTRATION_MINIMUM_TITLES,
    }, {
      evidence: evidenceForRows(titles),
      assumptions: [`Regra informativa: compara o valor dos títulos reconhecidos entre ${fromDate} e ${toDate}, inclusive; uma data precisa concentrar pelo menos ${DUE_DATE_CONCENTRATION_THRESHOLD_PERCENT}% do total e conter ao menos ${DUE_DATE_CONCENTRATION_MINIMUM_TITLES} títulos. Não classifica automaticamente uma crise.`],
      identity: date,
      priority: 22,
    }));
  }
}

function recognizedForecast(dashboard, type) {
  return dashboard.cash.forecastEvents.filter((event) => event.sourceType === type);
}

function projectionCurve(dashboard, referenceDate) {
  const fromDate = shiftDate(referenceDate, 1);
  const toDate = shiftDate(referenceDate, FORECAST_DAYS);
  const events = dashboard.cash.forecastEvents.filter((event) => ["payable", "receivable"].includes(event.sourceType));
  const byDate = new Map();
  for (const event of events) {
    if (!isValidDate(event.date) || event.date < fromDate || event.date > toDate || !Number.isSafeInteger(event.amountCents)) continue;
    byDate.set(event.date, safeSum([byDate.get(event.date) || 0, event.amountCents]));
  }
  const points = [];
  let balance = dashboard.cash.availableCents;
  for (let offset = 1; offset <= FORECAST_DAYS; offset += 1) {
    const date = shiftDate(referenceDate, offset);
    balance = safeSum([balance, byDate.get(date) || 0]);
    points.push({ date, balanceCents: balance });
  }
  const minimum = points.reduce((best, item) => item.balanceCents < best.balanceCents ? item : best, points[0]);
  return {
    fromDate,
    toDate,
    points,
    firstNegativeDate: points.find((point) => point.balanceCents < 0)?.date || null,
    minimumProjectedCents: minimum.balanceCents,
    minimumProjectedDate: minimum.date,
    closingProjectedCents: points.at(-1).balanceCents,
  };
}

function validateCashScenarioInput(scenario, referenceDate) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
    throw new TypeError("scenario deve ser um objeto estruturado.");
  }
  const prototype = Object.getPrototypeOf(scenario);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("scenario deve ser um objeto simples.");
  if (!isValidDate(referenceDate)) throw new TypeError("referenceDate deve ser uma data ISO válida.");

  const type = scenario.type;
  if (!["purchase", "payment", "settle_payable", "collect_receivable"].includes(type)) {
    throw new TypeError("type deve ser purchase, payment, settle_payable ou collect_receivable.");
  }
  const allowedKeys = new Set(["type", "date", "horizonDays"]);
  if (["purchase", "payment"].includes(type)) allowedKeys.add("amountCents");
  else {
    allowedKeys.add("amountCents");
    allowedKeys.add(type === "settle_payable" ? "payableId" : "receivableId");
  }
  for (const key of Object.keys(scenario)) {
    if (!allowedKeys.has(key)) throw new TypeError(`Campo não permitido no cenário: ${key}.`);
  }
  if (!Object.prototype.hasOwnProperty.call(scenario, "date") || !isValidDate(scenario.date)) {
    throw new TypeError("date deve ser uma data ISO válida.");
  }
  const horizonDays = scenario.horizonDays === undefined ? FORECAST_DAYS : scenario.horizonDays;
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > FORECAST_DAYS) {
    throw new RangeError(`horizonDays deve ser um inteiro entre 1 e ${FORECAST_DAYS}.`);
  }
  const toDate = shiftDate(referenceDate, horizonDays);
  if (scenario.date < referenceDate || scenario.date > toDate) {
    throw new RangeError(`date deve estar entre ${referenceDate} e ${toDate}, inclusive.`);
  }

  const amountProvided = Object.prototype.hasOwnProperty.call(scenario, "amountCents");
  if (["purchase", "payment"].includes(type) && !amountProvided) {
    throw new TypeError("amountCents é obrigatório para compra ou pagamento genérico.");
  }
  if (amountProvided && (!Number.isSafeInteger(scenario.amountCents) || scenario.amountCents <= 0)) {
    throw new TypeError("amountCents deve ser um inteiro seguro positivo de centavos.");
  }

  let sourceId = null;
  if (type === "settle_payable") sourceId = scenario.payableId;
  if (type === "collect_receivable") sourceId = scenario.receivableId;
  if (sourceId !== null && (typeof sourceId !== "string" || !sourceId.trim() || sourceId.length > 200)) {
    throw new TypeError(type === "settle_payable" ? "payableId inválido." : "receivableId inválido.");
  }
  if (["settle_payable", "collect_receivable"].includes(type) && sourceId === null) {
    throw new TypeError(type === "settle_payable" ? "payableId é obrigatório." : "receivableId é obrigatório.");
  }

  return {
    type,
    date: scenario.date,
    horizonDays,
    amountCents: amountProvided ? scenario.amountCents : null,
    sourceId,
  };
}

function unavailableCashScenario(referenceDate, scenario, limitation) {
  const source = scenario.sourceId ? {
    entityType: scenario.type === "settle_payable" ? "payable" : "receivable",
    entityId: scenario.sourceId,
  } : null;
  return {
    status: "unavailable",
    hypothetical: true,
    referenceDate,
    cutoffDate: referenceDate,
    timeZone: TIME_ZONE,
    scenario: {
      type: scenario.type,
      date: scenario.date,
      amountCents: scenario.amountCents,
      source,
    },
    horizonDays: scenario.horizonDays,
    fromDate: referenceDate,
    toDate: shiftDate(referenceDate, scenario.horizonDays),
    baseline: null,
    simulation: null,
    daily: [],
    assumptions: [],
    limitations: [limitation],
  };
}

function scenarioCashReliability(finance, dashboard, referenceDate) {
  const cashAccountsExist = finance.planAccounts.some((account) => account.postable === true && account.cashEquivalent === true);
  const entryAffectsCash = (entry) => (entry.lines || []).some((line) => finance.planAccounts.some(
    (account) => account.id === line.accountId && account.cashEquivalent === true,
  ));
  const postedCashActivityExists = finance.journalEntries.some((entry) => entry.status === accounting.POSTED
    && entry.postingDate <= referenceDate && entryAffectsCash(entry));
  const futurePostedCashActivityExists = finance.journalEntries.some((entry) => entry.status === accounting.POSTED
    && entry.postingDate > referenceDate && entryAffectsCash(entry));
  const openingDraftPending = finance.journalEntries.some((entry) => entry.status === accounting.DRAFT
    && entry.sourceEventType === "opening-draft");
  const availableCents = dashboard.cash.availableCents;
  const reliable = cashAccountsExist && postedCashActivityExists && !openingDraftPending
    && Number.isSafeInteger(availableCents);

  let limitation = null;
  if (!cashAccountsExist) limitation = "O plano não identifica contas de caixa ou banco habilitadas; o cenário foi omitido.";
  else if (!postedCashActivityExists && futurePostedCashActivityExists) {
    limitation = `Há atividade postada afetando caixa ou banco somente após ${referenceDate}; o saldo atual não pode ser confirmado sem presumir zero.`;
  } else if (!postedCashActivityExists) {
    limitation = `Não há lançamento postado afetando contas de caixa ou banco até ${referenceDate}; o saldo inicial não pode ser confirmado sem presumir zero.`;
  } else if (openingDraftPending) {
    limitation = "Há um rascunho de saldo de abertura pendente; o saldo de caixa e o cenário não foram tratados como confirmados.";
  } else if (!Number.isSafeInteger(availableCents)) {
    limitation = "O saldo disponível não é um inteiro seguro de centavos; o cenário foi omitido.";
  }
  return { reliable, limitation };
}

function scenarioCurve(referenceDate, horizonDays, openingCents, events, omittedSourceEvent, replacementEvents = []) {
  const toDate = shiftDate(referenceDate, horizonDays);
  const byDate = new Map();
  for (const event of events) {
    if (omittedSourceEvent && event.sourceType === omittedSourceEvent.sourceType
      && event.sourceId === omittedSourceEvent.sourceId) continue;
    if (!isValidDate(event.date) || event.date <= referenceDate || event.date > toDate) continue;
    if (!Number.isSafeInteger(event.amountCents)) throw new Error("O evento previsto não contém centavos seguros.");
    byDate.set(event.date, safeSum([byDate.get(event.date) || 0, event.amountCents]));
  }
  for (const event of replacementEvents) {
    if (event.date < referenceDate || event.date > toDate) throw new Error("A data do evento hipotético está fora do horizonte.");
    if (!Number.isSafeInteger(event.amountCents)) throw new Error("O evento hipotético não contém centavos seguros.");
    byDate.set(event.date, safeSum([byDate.get(event.date) || 0, event.amountCents]));
  }

  const points = [];
  let balance = openingCents;
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = shiftDate(referenceDate, offset);
    balance = safeSum([balance, byDate.get(date) || 0]);
    points.push({ date, balanceCents: balance });
  }
  return points;
}

function summarizeScenarioCurve(points, openingCents) {
  const minimum = points.reduce((best, point) => point.balanceCents < best.balanceCents ? point : best, points[0]);
  const firstNegative = points.find((point) => point.balanceCents < 0) || null;
  return {
    openingCents,
    currentCents: points[0].balanceCents,
    closingCents: points.at(-1).balanceCents,
    minimumCents: minimum.balanceCents,
    minimumDate: minimum.date,
    firstNegativeDate: firstNegative?.date || null,
    firstNegativeCents: firstNegative?.balanceCents ?? null,
  };
}

function simulateCashScenario({ finance, referenceDate, scenario } = {}) {
  if (!isValidDate(referenceDate)) throw new TypeError("referenceDate deve ser uma data ISO válida no fuso local do negócio.");
  const input = validateCashScenarioInput(scenario, referenceDate);
  if (!finance || !Array.isArray(finance.planAccounts) || !Array.isArray(finance.journalEntries)
    || !Array.isArray(finance.payables) || !Array.isArray(finance.receivables)) {
    return unavailableCashScenario(referenceDate, input, "A estrutura financeira validada não contém os dados necessários para confirmar o saldo de caixa.");
  }

  let dashboard;
  try {
    dashboard = financialReports.getDashboard(finance, {
      fromDate: referenceDate,
      toDate: referenceDate,
      horizonDays: input.horizonDays,
    }, { today: referenceDate });
  } catch {
    return unavailableCashScenario(referenceDate, input, "O Dashboard não conseguiu validar o saldo e os fluxos necessários para o cenário.");
  }

  const reliability = scenarioCashReliability(finance, dashboard, referenceDate);
  if (!reliability.reliable) return unavailableCashScenario(referenceDate, input, reliability.limitation);

  let omittedSourceEvent = null;
  let replacementEvents = [];
  let amountCents = input.amountCents;
  let source = null;
  if (["settle_payable", "collect_receivable"].includes(input.type)) {
    const isPayable = input.type === "settle_payable";
    const collection = isPayable ? finance.payables : finance.receivables;
    const document = collection.find((row) => row.id === input.sourceId);
    if (!document) throw new TypeError(isPayable ? "payableId não corresponde a uma conta a pagar existente." : "receivableId não corresponde a uma conta a receber existente.");
    const sourceType = isPayable ? "payable" : "receivable";
    const draftType = isPayable ? "draft-payable" : "draft-receivable";
    const event = dashboard.cash.forecastEvents.find((row) => row.sourceId === input.sourceId && row.sourceType === sourceType);
    if (!event) {
      const draftEvent = dashboard.cash.forecastEvents.find((row) => row.sourceId === input.sourceId && row.sourceType === draftType);
      const reason = draftEvent
        ? "O título precisa estar reconhecido para participar da projeção confirmada."
        : "O título não possui evento reconhecido em aberto dentro do horizonte do cenário.";
      throw new TypeError(reason);
    }
    if (!Number.isSafeInteger(event.amountCents) || (isPayable ? event.amountCents >= 0 : event.amountCents <= 0)) {
      throw new TypeError("O evento do título selecionado não contém um saldo reconhecido válido.");
    }
    omittedSourceEvent = event;
    const remainingCents = Math.abs(event.amountCents);
    amountCents = input.amountCents === null ? remainingCents : input.amountCents;
    if (amountCents > remainingCents) throw new RangeError("amountCents não pode exceder o saldo reconhecido em aberto.");
    const residualCents = remainingCents - amountCents;
    if (residualCents > 0) replacementEvents.push({
      date: event.date,
      amountCents: isPayable ? -residualCents : residualCents,
    });
    source = {
      entityType: isPayable ? "payable" : "receivable",
      entityId: document.id,
      dueDate: document.dueDate,
      baselineDate: event.date,
      outstandingCents: remainingCents,
    };
  }

  const recognizedEvents = dashboard.cash.forecastEvents.filter((event) => ["payable", "receivable"].includes(event.sourceType));
  let baselinePoints;
  let hypotheticalPoints;
  try {
    baselinePoints = scenarioCurve(referenceDate, input.horizonDays, dashboard.cash.availableCents, recognizedEvents, null);
    if (["purchase", "payment"].includes(input.type)) replacementEvents.push({
      date: input.date,
      amountCents: -amountCents,
    });
    else replacementEvents.push({
      date: input.date,
      amountCents: input.type === "settle_payable" ? -amountCents : amountCents,
    });
    hypotheticalPoints = scenarioCurve(
      referenceDate,
      input.horizonDays,
      dashboard.cash.availableCents,
      recognizedEvents,
      omittedSourceEvent,
      replacementEvents,
    );
  } catch {
    return unavailableCashScenario(referenceDate, { ...input, amountCents }, "Um saldo derivado excedeu o limite seguro de centavos; o cenário foi omitido.");
  }

  return {
    status: "complete",
    hypothetical: true,
    referenceDate,
    cutoffDate: referenceDate,
    timeZone: TIME_ZONE,
    scenario: {
      type: input.type,
      date: input.date,
      amountCents,
      source,
    },
    horizonDays: input.horizonDays,
    fromDate: referenceDate,
    toDate: shiftDate(referenceDate, input.horizonDays),
    baseline: summarizeScenarioCurve(baselinePoints, dashboard.cash.availableCents),
    simulation: summarizeScenarioCurve(hypotheticalPoints, dashboard.cash.availableCents),
    daily: baselinePoints.map((point, index) => ({
      date: point.date,
      baselineCents: point.balanceCents,
      hypotheticalCents: hypotheticalPoints[index].balanceCents,
    })),
    assumptions: [
      "O cenário altera somente o caixa hipotético; nenhum documento, pagamento, recebimento ou lançamento contábil é criado.",
      "Títulos reconhecidos em aberto entram na projeção nas datas indicadas pelo Dashboard; eventos previstos não garantem liquidação ou recebimento.",
      source ? "A parcela simulada substitui o evento do mesmo título na data hipotética; o saldo residual permanece na data base, sem contagem dupla." : "Compra ou pagamento genérico reduz somente o caixa e não altera o resultado por competência.",
    ],
    limitations: [
      "Rascunhos e recorrências não registradas ficam fora da projeção confirmada.",
      "A projeção não garante que pagamentos e recebimentos ocorram nas datas previstas.",
    ],
  };
}

function conditionalReceiptRisks(dashboard, curve, referenceDate, finance) {
  if (curve.points.some((point) => point.balanceCents < 0)) return [];
  const receivablesById = new Map(finance.receivables.map((document) => [document.id, document]));
  const receipts = recognizedForecast(dashboard, "receivable")
    .filter((event) => {
      const document = receivablesById.get(event.sourceId);
      return document && document.dueDate > referenceDate && Number.isSafeInteger(event.amountCents) && event.amountCents > 0;
    })
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.sourceId.localeCompare(b.sourceId));
  const risks = [];
  for (const receipt of receipts) {
    let balance = dashboard.cash.availableCents;
    let firstNegative = null;
    let baselineAtFirstNegative = null;
    let counterfactualAtFirstNegative = null;
    for (const point of curve.points) {
      const index = curve.points.indexOf(point);
      const priorBalance = index === 0 ? dashboard.cash.availableCents : curve.points[index - 1].balanceCents;
      balance = safeSum([balance, point.balanceCents, -priorBalance]);
      if (point.date === receipt.date) balance = safeSum([balance, -receipt.amountCents]);
      if (balance < 0) {
        firstNegative = point.date;
        baselineAtFirstNegative = point.balanceCents;
        counterfactualAtFirstNegative = balance;
        break;
      }
    }
    if (!firstNegative || baselineAtFirstNegative < 0 || counterfactualAtFirstNegative >= 0) continue;
    risks.push({
      receivableId: receipt.sourceId,
      amountCents: receipt.amountCents,
      dueDate: receivablesById.get(receipt.sourceId).dueDate,
      projectedReceiptDate: receipt.date,
      firstNegativeDate: firstNegative,
      baselineCents: baselineAtFirstNegative,
      counterfactualCents: counterfactualAtFirstNegative,
    });
  }
  return risks.sort((a, b) => a.firstNegativeDate.localeCompare(b.firstNegativeDate)
    || b.amountCents - a.amountCents || a.receivableId.localeCompare(b.receivableId));
}

function conditionalScenario(dashboard, curve, referenceDate) {
  const futureEvents = dashboard.cash.forecastEvents.filter((event) => isValidDate(event.date)
    && event.date >= curve.fromDate && event.date <= curve.toDate);
  const drafts = futureEvents.filter((event) => ["draft-payable", "draft-receivable"].includes(event.sourceType));
  const recurring = futureEvents.filter((event) => event.sourceType === "recorrencia");
  const budgets = futureEvents.filter((event) => event.sourceType === "budget");
  const daily = new Map();
  for (const event of drafts.concat(recurring, budgets)) {
    if (!Number.isSafeInteger(event.amountCents)) continue;
    daily.set(event.date, safeSum([daily.get(event.date) || 0, event.amountCents]));
  }
  let balance = dashboard.cash.availableCents;
  const points = curve.points.map((point, index) => {
    const previous = index === 0 ? dashboard.cash.availableCents : curve.points[index - 1].balanceCents;
    balance = safeSum([balance, point.balanceCents, -previous, daily.get(point.date) || 0]);
    return { date: point.date, balanceCents: balance };
  });
  const minimum = points.reduce((best, item) => item.balanceCents < best.balanceCents ? item : best, points[0]);
  const firstNegative = points.find((point) => point.balanceCents < 0) || null;
  return {
    includesDraftPayablesCents: Math.abs(safeSum(drafts.filter((event) => event.sourceType === "draft-payable").map((event) => event.amountCents))),
    includesDraftReceivablesCents: safeSum(drafts.filter((event) => event.sourceType === "draft-receivable").map((event) => event.amountCents)),
    includesRecurringEstimatesCents: safeSum(recurring.map((event) => event.amountCents)),
    includesBudgetedPaymentsCents: Math.abs(safeSum(budgets.filter((event) => event.amountCents < 0).map((event) => event.amountCents))),
    includesBudgetedReceiptsCents: safeSum(budgets.filter((event) => event.amountCents > 0).map((event) => event.amountCents)),
    firstNegativeDate: firstNegative?.date || null,
    firstNegativeCents: firstNegative?.balanceCents ?? null,
    minimumProjectedCents: minimum.balanceCents,
    minimumProjectedDate: minimum.date,
    closingProjectedCents: points.at(-1).balanceCents,
    basis: "Cenário separado e incerto; inclui rascunhos, estimativas recorrentes e orçamentos ativos planejados. Nada disso integra a projeção reconhecida.",
    referenceDate,
  };
}

function demoDataKind(finance) {
  return typeof finance.demoProfile === "string" && finance.demoProfile.trim() ? "demo" : "unknown";
}

function healthSummary(finance, referenceDate, limitations) {
  const period = monthOf(referenceDate);
  const hasPostedHistory = (finance.journalEntries || []).some((entry) => entry.status === accounting.POSTED
    && entry.postingDate <= referenceDate);
  if (!hasPostedHistory) {
    limitations.push("A Análise Financeira não foi resumida porque não há lançamentos postados até a data de referência.");
    return null;
  }
  if (!resultClassificationIsComplete(finance, period, referenceDate)) {
    limitations.push("A Análise Financeira foi omitida porque há classificação contábil ausente ou inválida no período corrente.");
    return null;
  }
  const snapshot = {
    ...finance,
    journalEntries: finance.journalEntries.filter((entry) => entry.status !== accounting.POSTED || entry.postingDate <= referenceDate),
  };
  try {
    const analysis = financialReports.getFinancialAnalysis(snapshot, {
      period,
      runwayDays: 30,
      trendCount: 2,
    }, { today: referenceDate });
    const balance = analysis.balance;
    const currentAvailable = balance.liquidityAvailability.currentLiabilitiesComplete;
    const generalAvailable = balance.liquidityAvailability.generalClassificationComplete;
    return {
      asOfDate: referenceDate,
      period,
      assetsCents: balance.assetsCents,
      liabilitiesCents: balance.liabilitiesCents,
      netWorthCents: balance.netWorthCents,
      ratios: {
        current: {
          value: currentAvailable ? balance.ratios.current.value : null,
          displayValue: currentAvailable ? balance.ratios.current.displayValue : "Dados insuficientes",
          available: currentAvailable,
        },
        immediate: {
          value: currentAvailable ? balance.ratios.immediate.value : null,
          displayValue: currentAvailable ? balance.ratios.immediate.displayValue : "Dados insuficientes",
          available: currentAvailable,
        },
        workingCapitalCents: currentAvailable ? balance.ratios.workingCapital.value : null,
        general: {
          value: generalAvailable ? balance.ratios.general.value : null,
          displayValue: generalAvailable ? balance.ratios.general.displayValue : "Dados insuficientes",
          available: generalAvailable,
        },
        debtToAssetsPercent: balance.ratios.debtAssets.value,
        thirdPartyToEquityPercent: balance.ratios.thirdPartyToEquity.value,
      },
      liquidityAvailability: {
        currentLiabilitiesComplete: currentAvailable,
        generalClassificationComplete: generalAvailable,
        unclassifiedAssetCount: balance.liquidityAvailability.unclassifiedAssets.length,
        unclassifiedLiabilityCount: balance.liquidityAvailability.unclassifiedLiabilities.length,
      },
      basis: "Indicadores selecionados da Análise Financeira existente, com partidas postadas até a data de referência; sem escore universal de saúde financeira.",
    };
  } catch {
    limitations.push("A Análise Financeira existente não conseguiu calcular um resumo patrimonial para esta data.");
    return null;
  }
}

function buildGuardianBriefing({ finance, referenceDate, generatedAt, integrity } = {}) {
  if (!isValidDate(referenceDate)) throw new TypeError("referenceDate deve ser uma data ISO válida no fuso local do negócio.");
  const createdAt = safeGeneratedAt(generatedAt);
  if (!finance || !Array.isArray(finance.planAccounts) || !Array.isArray(finance.journalEntries)
    || !Array.isArray(finance.payables) || !Array.isArray(finance.receivables)) {
    return makeUnavailable(referenceDate, createdAt, "A estrutura financeira validada não contém os dados necessários para montar o resumo do Guardian.");
  }

  const currentPeriod = monthOf(referenceDate);
  const currentMonthStart = `${currentPeriod}-01`;
  const limitations = [];
  const items = [];
  const dataKind = demoDataKind(finance);
  if (dataKind === "demo") limitations.push("A base está marcada como demonstrativa; estes resultados não representam necessariamente a situação real de uma empresa.");
  if (finance.journalEntries.length === 0) limitations.push("Não há histórico no Diário; saldos bancários e indicadores por competência não podem ser tratados como confirmados.");

  let dashboard;
  try {
    dashboard = financialReports.getDashboard(finance, {
      fromDate: referenceDate,
      toDate: referenceDate,
      horizonDays: FORECAST_DAYS,
    }, { today: referenceDate });
  } catch {
    return makeUnavailable(referenceDate, createdAt, "Os relatórios financeiros existentes não conseguiram validar os dados necessários para o Guardian.");
  }

  const payableRows = mapDashboardTitles(finance, dashboard, "payable");
  const receivableRows = mapDashboardTitles(finance, dashboard, "receivable");
  const recognizedPayables = payableRows.filter((row) => row.recognized);
  const draftPayables = payableRows.filter((row) => !row.recognized);
  const recognizedReceivables = receivableRows.filter((row) => row.recognized);
  const draftReceivables = receivableRows.filter((row) => !row.recognized);
  const payableRecognizedBuckets = classifyDueWindows(recognizedPayables, referenceDate);
  const payableDraftBuckets = classifyDueWindows(draftPayables, referenceDate);
  const receivableRecognizedBuckets = classifyDueWindows(recognizedReceivables, referenceDate);
  const receivableDraftBuckets = classifyDueWindows(draftReceivables, referenceDate);
  const payableSummary = contractObligations(payableRecognizedBuckets, payableDraftBuckets);
  const receivableSummary = contractObligations(receivableRecognizedBuckets, receivableDraftBuckets);

  buildObligationItems(items, referenceDate, "PAYABLE", "Contas a pagar", payableRecognizedBuckets);
  buildObligationItems(items, referenceDate, "RECEIVABLE", "Contas a receber", receivableRecognizedBuckets);
  buildDueDateConcentrationItems(items, referenceDate, payableRecognizedBuckets.next7Days);
  for (const [name, label, buckets, kind, priority] of [
    ["PAYABLE_DRAFT_ESTIMATE", "Contas a pagar em rascunho", payableDraftBuckets, "payable", 32],
    ["RECEIVABLE_DRAFT_ESTIMATE", "Contas a receber em rascunho", receivableDraftBuckets, "receivable", 33],
  ]) {
    const rows = [...buckets.overdue, ...buckets.dueToday, ...buckets.next7Days];
    if (!rows.length) continue;
    const total = summarizeRows(rows);
    addItem(items, baseItem(referenceDate, name, "info", "conditional_scenario", `${label}: estimativa`, "Rascunhos ainda não reconhecidos contabilmente; não são obrigações ou recebíveis reconhecidos.", {
      count: total.count,
      outstandingCents: total.amountCents,
      titles: topTitleFacts(rows),
      additionalTitlesOmitted: Math.max(0, rows.length - MAX_EVIDENCE),
    }, {
      evidence: evidenceForRows(rows.map((row) => ({ ...row, entityType: kind }))),
      assumptions: ["Valores baseados em títulos em rascunho; não entram na projeção reconhecida."],
      priority,
    }));
  }

  const cashAccountsExist = finance.planAccounts.some((account) => account.postable === true && account.cashEquivalent === true);
  const entryAffectsCash = (entry) => (entry.lines || []).some((line) => finance.planAccounts.some((account) => account.id === line.accountId && account.cashEquivalent === true));
  const postedCashActivityExists = finance.journalEntries.some((entry) => entry.status === accounting.POSTED
    && entry.postingDate <= referenceDate && entryAffectsCash(entry));
  const futurePostedCashActivityExists = finance.journalEntries.some((entry) => entry.status === accounting.POSTED
    && entry.postingDate > referenceDate && entryAffectsCash(entry));
  const openingDraftPending = finance.journalEntries.some((entry) => entry.status === accounting.DRAFT && entry.sourceEventType === "opening-draft");
  const cashReliable = cashAccountsExist && postedCashActivityExists && !openingDraftPending
    && Number.isSafeInteger(dashboard.cash.availableCents);
  let cashSummary = {
    availableCents: cashReliable ? dashboard.cash.availableCents : null,
    available: cashReliable,
    projectionAvailable: false,
    projectedClosingCents: null,
    minimumProjectedCents: null,
    minimumProjectedDate: null,
    firstNegativeDate: null,
    firstNegativeCents: null,
    recognizedOnly: true,
    horizonDays: FORECAST_DAYS,
    fromDate: shiftDate(referenceDate, 1),
    toDate: shiftDate(referenceDate, FORECAST_DAYS),
    conditionalReceiptRisks: [],
    uncertainScenario: null,
  };
  let curve = null;
  if (!cashAccountsExist) limitations.push("O plano não identifica contas de caixa ou banco habilitadas; saldo e cobertura de caixa foram omitidos.");
  else if (!postedCashActivityExists && futurePostedCashActivityExists) limitations.push(`Há atividade postada afetando caixa ou banco somente após ${referenceDate}; ela não comprova o saldo nesta data, por isso o saldo disponível e a projeção foram omitidos sem presumir zero.`);
  else if (!postedCashActivityExists) limitations.push(`Não há lançamento postado afetando contas de caixa ou banco até ${referenceDate}; o saldo inicial pode não estar registrado e a projeção foi omitida.`);
  else if (openingDraftPending) limitations.push("Há um rascunho de saldo de abertura pendente; o caixa disponível e as projeções não foram tratados como confirmados.");
  if (cashReliable) {
    try {
    curve = projectionCurve(dashboard, referenceDate);
    const risks = conditionalReceiptRisks(dashboard, curve, referenceDate, finance);
    cashSummary = {
      availableCents: dashboard.cash.availableCents,
      available: true,
      projectionAvailable: true,
      projectedClosingCents: curve.closingProjectedCents,
      minimumProjectedCents: curve.minimumProjectedCents,
      minimumProjectedDate: curve.minimumProjectedDate,
      firstNegativeDate: curve.firstNegativeDate,
      firstNegativeCents: curve.firstNegativeDate ? curve.points.find((point) => point.date === curve.firstNegativeDate).balanceCents : null,
      recognizedOnly: true,
      horizonDays: FORECAST_DAYS,
      fromDate: curve.fromDate,
      toDate: curve.toDate,
      basis: "Saldo contábil de caixa na data de referência mais títulos reconhecidos em aberto; projeção, não garantia.",
      conditionalReceiptRisks: risks.slice(0, 8),
      uncertainScenario: conditionalScenario(dashboard, curve, referenceDate),
    };
    if (dashboard.cash.availableCents < 0) {
      addItem(items, baseItem(referenceDate, "CASH_ACTUAL_NEGATIVE", "critical", "confirmed_fact", "Saldo contábil de caixa negativo", `O saldo contábil consolidado de caixa e bancos está negativo em ${referenceDate}.`, {
        date: referenceDate,
        availableCents: dashboard.cash.availableCents,
      }, { priority: 0 }));
    }
    if (curve.firstNegativeDate) {
      addItem(items, baseItem(referenceDate, "CASH_RECOGNIZED_PROJECTION_NEGATIVE", "critical", "forecast", "Projeção reconhecida de caixa negativa", `Na projeção com títulos reconhecidos, o caixa pode ficar negativo em ${curve.firstNegativeDate}.`, {
        firstNegativeDate: curve.firstNegativeDate,
        minimumProjectedCents: curve.minimumProjectedCents,
        minimumProjectedDate: curve.minimumProjectedDate,
        availableCents: dashboard.cash.availableCents,
      }, {
        assumptions: ["Títulos vencidos sem nova data informada foram posicionados no dia seguinte pela regra do Dashboard."],
        limitations: ["A projeção não garante que pagamentos e recebimentos ocorram nas datas previstas."],
        priority: 10,
      }));
    }
    for (const risk of risks.slice(0, 8)) {
      addItem(items, baseItem(referenceDate, "CASH_CONDITIONAL_RECEIPT_RISK", "warning", "conditional_scenario", "Dependência de recebimento previsto", `Se o recebimento projetado em ${risk.projectedReceiptDate} não ocorrer, o saldo projetado pode ficar negativo em ${risk.firstNegativeDate}.`, {
        receivableId: risk.receivableId,
        amountCents: risk.amountCents,
        dueDate: risk.dueDate,
        projectedReceiptDate: risk.projectedReceiptDate,
        firstNegativeDate: risk.firstNegativeDate,
        baselineCents: risk.baselineCents,
        counterfactualCents: risk.counterfactualCents,
      }, {
        evidence: [{ entityType: "receivable", entityId: risk.receivableId }],
        assumptions: ["O cenário remove somente este recebimento reconhecido; os demais movimentos previstos permanecem iguais."],
        limitations: ["Recebimentos previstos não são dinheiro recebido."],
        identity: risk.receivableId,
        priority: 15,
      }));
    }
    } catch {
      curve = null;
      cashSummary = {
        ...cashSummary,
        available: true,
        projectionAvailable: false,
        conditionalReceiptRisks: [],
        uncertainScenario: null,
      };
      limitations.push("A projeção de caixa foi omitida porque um saldo derivado excedeu o limite seguro de centavos.");
    }
  } else {
    cashSummary.uncertainScenario = null;
  }

  let competenceSummary = null;
  let expenseSummary = null;
  let currentResultGroups = null;
  const currentResultAvailable = periodHasPostedEntries(finance, currentPeriod, referenceDate);
  const currentClassificationComplete = resultClassificationIsComplete(finance, currentPeriod, referenceDate);
  if (!currentResultAvailable) {
    limitations.push(`Não há lançamentos contábeis por competência em ${currentPeriod} até ${referenceDate}; os valores da DRE não foram substituídos por zero.`);
  } else if (!currentClassificationComplete) {
    limitations.push(`Há lançamentos de ${currentPeriod} sem conta contábil disponível; resultado e análise de despesas foram omitidos.`);
  } else {
    try {
      currentResultGroups = incomeStatementAsOf(finance, currentPeriod, referenceDate);
    } catch {
      limitations.push(`A DRE por competência de ${currentPeriod} não pôde ser calculada até ${referenceDate}.`);
    }
  }

  if (currentResultGroups) {
    const revenueCents = currentResultGroups.revenue.totalCents;
    const costsCents = currentResultGroups.costs.totalCents;
    const expensesCents = currentResultGroups.expenses.totalCents;
    const economicResultCents = revenueCents - costsCents - expensesCents;
    if (![revenueCents, costsCents, expensesCents, economicResultCents].every(Number.isSafeInteger)) {
      limitations.push(`Os totais de ${currentPeriod} excedem o limite seguro; o checkpoint por competência foi omitido.`);
      currentResultGroups = null;
    } else {
      const comparison = expenseComparison(finance, currentPeriod, referenceDate, expensesCents, limitations);
      const concentration = accountExpenseConcentration(currentResultGroups, limitations);
      expenseSummary = {
        available: true,
        period: currentPeriod,
        cutoffDate: referenceDate,
        totalCents: expensesCents,
        topAccounts: concentration?.topAccounts || [],
        comparison,
      };
      if (dayInMonth(referenceDate) >= 25) {
        competenceSummary = {
          available: true,
          period: currentPeriod,
          cutoffDate: referenceDate,
          recognizedRevenueCents: revenueCents,
          recognizedCostsCents: costsCents,
          recognizedExpensesCents: expensesCents,
          economicResultCents,
          breakEvenRevenueGapCents: economicResultCents < 0 ? -economicResultCents : 0,
          assumption: "A diferença é receita adicional reconhecida sem custos, tributos, descontos ou outras despesas incrementais, mantendo custos e despesas atuais. Não é previsão de lucro nem entrada de caixa.",
        };
        addItem(items, baseItem(referenceDate, "COMPETENCE_MONTH_CHECKPOINT", economicResultCents < 0 ? "warning" : "info", "confirmed_fact", "Resultado por competência no mês", `A DRE de ${currentPeriod}, com lançamentos postados até ${referenceDate}, apresenta resultado ${economicResultCents < 0 ? "negativo" : "não negativo"}.`, {
          period: currentPeriod,
          cutoffDate: referenceDate,
          recognizedRevenueCents: revenueCents,
          recognizedCostsCents: costsCents,
          recognizedExpensesCents: expensesCents,
          economicResultCents,
          breakEvenRevenueGapCents: competenceSummary.breakEvenRevenueGapCents,
        }, {
          assumptions: [competenceSummary.assumption],
          priority: 40,
        }));
      } else {
        limitations.push("O checkpoint de competência e ponto de equilíbrio simplificado é exibido a partir do dia 25 do mês.");
      }
      if (concentration) {
        addItem(items, baseItem(referenceDate, "EXPENSE_CONCENTRATION", "info", "confirmed_fact", "Concentração das despesas por conta", `As maiores contas representam a distribuição das despesas por competência em ${currentPeriod}, até ${referenceDate}.`, {
          period: currentPeriod,
          asOfDate: referenceDate,
          totalExpensesCents: concentration.totalCents,
          topAccounts: concentration.topAccounts,
        }, {
          evidence: concentration.topAccounts.map((account) => ({ entityType: "account", entityId: account.accountId })),
          priority: 50,
        }));
      }
      if (comparison) {
        const direction = comparison.deltaCents > 0 ? "aumentaram" : comparison.deltaCents < 0 ? "diminuíram" : "não mudaram";
        addItem(items, baseItem(referenceDate, "EXPENSE_MTD_COMPARISON", "info", "historical_comparison", "Comparação de despesas por competência", `As despesas ${direction} de ${comparison.previousCents} para ${comparison.currentCents} centavos nos intervalos comparados.`, {
          ...comparison,
        }, {
          assumptions: ["Comparação por competência e janelas equivalentes até o mesmo dia do mês, limitadas ao último dia existente em cada período."],
          priority: 55,
        }));
      }
    }
  }

  if (!expenseSummary) {
    expenseSummary = {
      available: false,
      period: currentPeriod,
      cutoffDate: referenceDate,
      totalCents: null,
      topAccounts: [],
      comparison: null,
    };
  }
  if (!competenceSummary && dayInMonth(referenceDate) >= 25) {
    competenceSummary = {
      available: false,
      period: currentPeriod,
      cutoffDate: referenceDate,
      recognizedRevenueCents: null,
      recognizedCostsCents: null,
      recognizedExpensesCents: null,
      economicResultCents: null,
      breakEvenRevenueGapCents: null,
      assumption: null,
    };
  }

  let reportIntegrity = null;
  try {
    if (integrity && typeof integrity === "object" && typeof integrity.isValid === "boolean") {
      reportIntegrity = integrity;
    } else {
      const integrityFunction = typeof integrity === "function" ? integrity : financialReports.integrity;
      reportIntegrity = integrityFunction(finance, currentMonthStart, referenceDate);
    }
    if (reportIntegrity && reportIntegrity.isValid === false) {
      limitations.push("O relatório de integridade encontrou inconsistências no Diário; os valores existentes permanecem identificados como reportados e exigem revisão.");
    }
  } catch {
    limitations.push("Não foi possível conferir a integridade do Diário para este resumo.");
  }

  const health = reportIntegrity?.isValid === false
    ? (limitations.push("O resumo patrimonial foi omitido devido a inconsistências identificadas no Diário."), null)
    : healthSummary(finance, referenceDate, limitations);

  if (finance.demoProfile) {
    items.unshift(baseItem(referenceDate, "DATA_DEMO_PROFILE", "info", "confirmed_fact", "Base demonstrativa", "A origem dos dados está marcada como demonstração; os valores não descrevem necessariamente uma situação financeira real.", {
      dataKind: "demo",
    }, { priority: -10 }));
  }
  if (openingDraftPending) {
    items.push(baseItem(referenceDate, "OPENING_BALANCE_UNCONFIRMED", "warning", "confirmed_fact", "Saldo inicial pendente de confirmação", "Há um rascunho de abertura; os saldos de caixa e bancos foram omitidos até a validação desse saldo.", {}, { priority: 18 }));
  }

  const coverage = {
    dataKind,
    forecastDays: FORECAST_DAYS,
    obligations: "complete",
    cash: cashReliable && cashSummary.projectionAvailable ? "complete" : "partial",
    health: health ? "complete" : "partial",
    competence: competenceSummary?.available ? "complete" : "partial",
    expenses: expenseSummary?.available ? "complete" : "partial",
    reportsUsed: [
      "Dashboard",
      ...(currentResultGroups ? ["DRE por competência"] : []),
      ...(health ? ["Análise Financeira"] : []),
    ],
    dueDateConcentrationRule: {
      windowStartDate: shiftDate(referenceDate, 1),
      windowEndDate: shiftDate(referenceDate, 7),
      thresholdPercent: DUE_DATE_CONCENTRATION_THRESHOLD_PERCENT,
      minimumTitleCount: DUE_DATE_CONCENTRATION_MINIMUM_TITLES,
      severity: "info",
    },
    postingCutoffDate: referenceDate,
    projectedTitleTypes: ["reconhecido"],
    excludedFromRecognizedProjection: ["rascunhos", "recorrências não registradas"],
    demoProfile: dataKind === "demo" ? finance.demoProfile : null,
    ledgerIntegrity: reportIntegrity ? reportIntegrity.isValid : null,
  };
  const uniqueLimitations = [...new Set(limitations)];
  const status = uniqueLimitations.length ? "partial" : "complete";
  return {
    referenceDate,
    timeZone: TIME_ZONE,
    generatedAt: createdAt,
    status,
    coverage,
    summary: {
      payables: payableSummary,
      receivables: receivableSummary,
      cash: cashSummary,
      health,
      competence: competenceSummary,
      expenses: expenseSummary,
    },
    items: items.sort(compareItems).slice(0, MAX_ITEMS).map(closeItem),
    limitations: uniqueLimitations.slice(0, 30),
  };
}

module.exports = { buildGuardianBriefing, simulateCashScenario };
