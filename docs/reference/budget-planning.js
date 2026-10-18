"use strict";

const MAX_OCCURRENCES_PER_BUDGET = 1000;
const MAX_TOTAL_OCCURRENCES = 10000;
const MAX_BUDGETS = 5000;
const MAX_OCCURRENCE_AMOUNT_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / MAX_TOTAL_OCCURRENCES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function validMonth(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function normalizeSearchText(value) {
  return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function monthDays(year, month) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Uses calendar arithmetic only. If a month is shorter than the intended day,
// use its last day and return to the original day in later months.
function generateMonthlyDates(firstDueDate, count) {
  if (!validDate(firstDueDate)) fail("Informe um primeiro vencimento válido no formato AAAA-MM-DD.");
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_OCCURRENCES_PER_BUDGET) {
    fail(`A quantidade deve estar entre 1 e ${MAX_OCCURRENCES_PER_BUDGET} vencimentos.`);
  }
  const [firstYear, firstMonth, intendedDay] = firstDueDate.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const absoluteMonth = firstYear * 12 + firstMonth - 1 + index;
    const year = Math.floor(absoluteMonth / 12);
    const month = absoluteMonth % 12 + 1;
    if (year > 9999) fail("A programação mensal não pode ultrapassar o ano 9999.");
    const day = Math.min(intendedDay, monthDays(year, month));
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
}

function normalizeText(value, label, max, { required = false } = {}) {
  if (value == null && !required) return "";
  if (typeof value !== "string") fail(`${label} deve ser um texto${required ? "" : " ou ficar em branco"}.`);
  const text = value.trim();
  if (required && !text) fail(`Informe ${label.toLocaleLowerCase("pt-BR")}.`);
  if (text.length > max) fail(`${label} deve ter até ${max} caracteres.`);
  return text;
}

function validatePartyFields(finance, { direction, partyId, partyName, existingPartyId = null, existingSnapshot = "" }) {
  const resolvedId = partyId == null || partyId === "" ? null : partyId;
  let resolvedName = normalizeText(partyName ?? "", "Contraparte", resolvedId ? 160 : 120);
  if (resolvedId !== null) {
    if (typeof resolvedId !== "string" || !UUID_RE.test(resolvedId)) fail("O identificador da contraparte deve ser um UUID válido.");
    const party = finance.parties.find((item) => item.id === resolvedId);
    if (!party) fail("A contraparte selecionada não existe.", 404);
    const requiredRole = direction === "payable" ? "supplier" : "customer";
    if (!party.roles.includes(requiredRole)) fail(direction === "payable" ? "Selecione uma contraparte com papel fornecedor." : "Selecione uma contraparte com papel cliente.");
    const keepingExisting = resolvedId === existingPartyId;
    if (!party.active && !keepingExisting) fail("Reative a contraparte antes de usá-la em um orçamento novo.", 409);
    if (keepingExisting && existingSnapshot) resolvedName = existingSnapshot;
    else {
      if (resolvedName && resolvedName !== party.name) fail("O nome da contraparte deve corresponder ao cadastro selecionado.");
      resolvedName = party.name;
    }
  }
  return { partyId: resolvedId, partySnapshotName: resolvedName };
}

function validateOptionalReferences(finance, { direction, suggestedAccountId, costCenterId }, accountingApi = null) {
  const accountId = suggestedAccountId == null || suggestedAccountId === "" ? null : suggestedAccountId;
  const centerId = costCenterId == null || costCenterId === "" ? null : costCenterId;
  if (accountId !== null) {
    if (typeof accountId !== "string") fail("A conta sugerida não é válida.");
    const eligibility = accountingApi?.getAccountEligibility?.(finance, accountId);
    if (!eligibility?.postable) fail("A conta sugerida não existe ou não é analítica.");
    const validGroups = direction === "payable" ? [5, 6] : [4];
    if (!validGroups.includes(eligibility.groupNumber)) fail(direction === "payable"
      ? "A conta sugerida para despesa deve ser analítica de Custos ou Despesas."
      : "A conta sugerida para receita deve ser analítica de Receitas.");
  }
  if (centerId !== null) {
    if (typeof centerId !== "string" || !finance.costCenters.some((item) => item.id === centerId)) fail("O centro de custo selecionado não existe.");
  }
  return { suggestedAccountId: accountId, costCenterId: centerId };
}

function normalizeOccurrence(finance, item, { allowId = false } = {}) {
  if (!isRecord(item)) fail("Cada vencimento previsto deve conter uma data e um valor.");
  if (allowId && item.id != null && (typeof item.id !== "string" || !UUID_RE.test(item.id))) fail("O identificador do vencimento deve ser um UUID válido.");
  if (!validDate(item.plannedDueDate)) fail("Informe uma data prevista válida no formato AAAA-MM-DD.");
  if (!Number.isSafeInteger(item.plannedAmountCents) || item.plannedAmountCents <= 0) fail("O valor previsto deve ser positivo e informado em centavos inteiros.");
  if (item.plannedAmountCents > MAX_OCCURRENCE_AMOUNT_CENTS) fail("O valor previsto excede o limite seguro permitido.");
  const notes = normalizeText(item.notes ?? "", "As observações do vencimento", 500);
  return {
    ...(allowId && item.id ? { id: item.id } : {}),
    plannedDueDate: item.plannedDueDate,
    plannedAmountCents: item.plannedAmountCents,
    notes,
  };
}

function normalizeCreateInput(finance, input, { randomUUID, now, accountingApi = null }) {
  if (!isRecord(input)) fail("Informe os dados do orçamento.");
  if (!new Set(["payable", "receivable"]).has(input.direction)) fail("Selecione Despesa (Contas a Pagar) ou Receita (Contas a Receber).");
  const title = normalizeText(input.title, "Descrição", 160, { required: true });
  const notes = normalizeText(input.notes ?? "", "As observações", 1000);
  const party = validatePartyFields(finance, input);
  const references = validateOptionalReferences(finance, input, accountingApi);
  if (!Array.isArray(input.occurrences) || input.occurrences.length < 1 || input.occurrences.length > MAX_OCCURRENCES_PER_BUDGET) {
    fail(`Inclua entre 1 e ${MAX_OCCURRENCES_PER_BUDGET} vencimentos previstos.`);
  }
  const scheduleMode = input.scheduleMode === "monthly" ? "monthly" : input.scheduleMode === "manual" ? "manual" : null;
  if (!scheduleMode) fail("Selecione geração mensal ou inclusão manual dos vencimentos.");
  let intendedDay = null;
  if (scheduleMode === "monthly") {
    if (!validDate(input.firstDueDate)) fail("Informe o primeiro vencimento mensal válido.");
    if (!Number.isSafeInteger(input.occurrenceCount) || input.occurrenceCount !== input.occurrences.length) fail("A quantidade mensal deve corresponder ao número de linhas revisadas.");
    if (!Number.isSafeInteger(input.defaultAmountCents) || input.defaultAmountCents <= 0 || input.defaultAmountCents > MAX_OCCURRENCE_AMOUNT_CENTS) fail("Informe um valor padrão positivo e dentro do limite seguro em centavos inteiros.");
    const dates = generateMonthlyDates(input.firstDueDate, input.occurrenceCount);
    intendedDay = Number(input.firstDueDate.slice(-2));
    for (let index = 0; index < dates.length; index += 1) {
      if (!input.occurrences[index] || !validDate(input.occurrences[index].plannedDueDate)) fail("Revise a data de cada vencimento mensal antes de salvar.");
    }
  } else if (input.occurrenceCount != null || input.firstDueDate != null || input.defaultAmountCents != null) {
    fail("A inclusão manual não aceita os parâmetros de geração mensal.");
  }
  const occurrences = input.occurrences.map((item) => ({
    id: randomUUID(),
    ...normalizeOccurrence(finance, item),
    status: "planned",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }));
  const budget = {
    id: randomUUID(),
    direction: input.direction,
    title,
    ...party,
    ...references,
    notes,
    status: "active",
    revision: 1,
    scheduleMode,
    intendedDay,
    occurrences,
    createdAt: now,
    updatedAt: now,
  };
  return budget;
}

function validateBudgets(finance, accountingApi = null) {
  if (!Array.isArray(finance.budgets)) fail("A coleção de orçamentos deve ser uma lista.", 500);
  if (finance.budgets.length > MAX_BUDGETS) fail("A coleção de orçamentos excede o limite defensivo.", 500);
  const budgetIds = new Set();
  const occurrenceIds = new Set();
  const conversionDocuments = new Set();
  let totalOccurrences = 0;
  for (const budget of finance.budgets) {
    if (!isRecord(budget) || !UUID_RE.test(budget.id || "") || !new Set(["payable", "receivable"]).has(budget.direction)
      || !["active", "archived"].includes(budget.status) || !Number.isSafeInteger(budget.revision) || budget.revision < 1
      || !Array.isArray(budget.occurrences) || budget.occurrences.length < 1 || budget.occurrences.length > MAX_OCCURRENCES_PER_BUDGET
      || typeof budget.title !== "string" || !budget.title.trim() || budget.title.length > 160
      || typeof budget.notes !== "string" || budget.notes.length > 1000
      || !["manual", "monthly"].includes(budget.scheduleMode)
      || budget.scheduleMode === "monthly" && (!Number.isInteger(budget.intendedDay) || budget.intendedDay < 1 || budget.intendedDay > 31)
      || budget.scheduleMode === "manual" && budget.intendedDay !== null
      || (budget.intendedDay !== null && (!Number.isInteger(budget.intendedDay) || budget.intendedDay < 1 || budget.intendedDay > 31))
      || typeof budget.createdAt !== "string" || typeof budget.updatedAt !== "string") fail("Há um orçamento salvo com estrutura inválida.", 500);
    if (budgetIds.has(budget.id)) fail("Há identificadores de orçamento duplicados.", 500);
    budgetIds.add(budget.id);
    if (budget.partyId !== null && (typeof budget.partyId !== "string" || !finance.parties.some((party) => party.id === budget.partyId))) fail("Um orçamento referencia uma contraparte inexistente.", 500);
    if (budget.partyId) {
      const party = finance.parties.find((item) => item.id === budget.partyId);
      if (!party.roles.includes(budget.direction === "payable" ? "supplier" : "customer")) fail("Um orçamento referencia uma contraparte com papel incompatível.", 500);
    }
    if (typeof budget.partySnapshotName !== "string" || budget.partySnapshotName.length > 120) fail("Um orçamento possui snapshot de contraparte inválido.", 500);
    if (budget.suggestedAccountId !== null) {
      if (!finance.planAccounts.some((account) => account.id === budget.suggestedAccountId)) fail("Um orçamento referencia uma conta inexistente.", 500);
      const eligibility = accountingApi?.getAccountEligibility?.(finance, budget.suggestedAccountId);
      const validGroups = budget.direction === "payable" ? [5, 6] : [4];
      if (eligibility && (!eligibility.postable || !validGroups.includes(eligibility.groupNumber))) fail("Um orçamento referencia uma conta de classificação incompatível.", 500);
    }
    if (budget.costCenterId !== null && !finance.costCenters.some((center) => center.id === budget.costCenterId)) fail("Um orçamento referencia um centro de custo inexistente.", 500);
    totalOccurrences += budget.occurrences.length;
    if (totalOccurrences > MAX_TOTAL_OCCURRENCES) fail("A quantidade total de vencimentos orçados excede o limite defensivo.", 500);
    for (const occurrence of budget.occurrences) {
      if (!isRecord(occurrence) || !UUID_RE.test(occurrence.id || "") || !validDate(occurrence.plannedDueDate)
        || !Number.isSafeInteger(occurrence.plannedAmountCents) || occurrence.plannedAmountCents <= 0
        || occurrence.plannedAmountCents > MAX_OCCURRENCE_AMOUNT_CENTS || typeof occurrence.notes !== "string" || occurrence.notes.length > 500
        || !["planned", "converted", "cancelled"].includes(occurrence.status)
        || !Number.isSafeInteger(occurrence.revision) || occurrence.revision < 1
        || typeof occurrence.createdAt !== "string" || typeof occurrence.updatedAt !== "string") fail("Há um vencimento de orçamento salvo com estrutura inválida.", 500);
      if (occurrenceIds.has(occurrence.id)) fail("Há identificadores de vencimento duplicados.", 500);
      occurrenceIds.add(occurrence.id);
      if (occurrence.status === "converted") {
        if (!new Set(["payable", "receivable"]).has(occurrence.documentType)
          || occurrence.documentType !== budget.direction || typeof occurrence.documentId !== "string"
          || !validDate(occurrence.convertedEffectiveDueDate) || !Number.isSafeInteger(occurrence.convertedEffectiveAmountCents)
          || occurrence.convertedEffectiveAmountCents <= 0 || occurrence.convertedEffectiveAmountCents > MAX_OCCURRENCE_AMOUNT_CENTS || typeof occurrence.convertedAt !== "string"
          || !UUID_RE.test(occurrence.documentId) || typeof occurrence.conversionSignature !== "string" || !/^[0-9a-f]{64}$/i.test(occurrence.conversionSignature)) fail("Um vencimento efetivado não possui referência completa ao documento.", 500);
        const key = `${occurrence.documentType}:${occurrence.documentId}`;
        if (conversionDocuments.has(key)) fail("Um documento financeiro está vinculado a mais de um vencimento orçado.", 500);
        conversionDocuments.add(key);
      } else if (["documentType", "documentId", "convertedAt", "convertedEffectiveDueDate", "convertedEffectiveAmountCents", "conversionSignature"].some((key) => Object.hasOwn(occurrence, key))) {
        fail("Um vencimento ainda não efetivado contém dados de conversão inválidos.", 500);
      }
    }
  }
  return finance.budgets;
}

function reportStatus(document, direction, today, accounting) {
  if (!document) return "Documento não encontrado";
  if (document.status === "cancelled") return "Cancelado";
  if (document.postingStatus === accounting.DRAFT) return "Rascunho";
  const status = accounting.titleStatus(document, direction, today);
  return ({ open: "Reconhecido · em aberto", overdue: "Reconhecido · vencido", partially_paid: "Parcialmente liquidado", paid: direction === "payable" ? "Pago" : "Recebido", draft: "Rascunho", cancelled: "Cancelado" })[status] || status;
}

// The canonical, read-only projection for saved budget occurrences. Cash-flow
// reports filter by `date` (the projected date); account screens can request
// `dateBasis: "planned"` to filter by the user's original planned due date.
// Overdue estimates roll forward to `today`, matching payable/receivable
// projections and preventing them from reappearing in earlier months.
function buildBudgetForecastEvents(finance, options = {}) {
  const today = options.today || "0001-01-01";
  const dateBasis = options.dateBasis || "projection";
  const fromDate = options.fromDate || null;
  const toDate = options.toDate || null;
  if (!validDate(today)) fail("Informe uma data de referência válida para projetar orçamentos.");
  if (dateBasis !== "projection" && dateBasis !== "planned") fail("A base de datas da projeção de orçamentos é inválida.");
  if (fromDate && !validDate(fromDate) || toDate && !validDate(toDate) || fromDate && toDate && fromDate > toDate) {
    fail("Informe um intervalo válido de vencimentos previstos.");
  }

  const events = [];
  for (const budget of Array.isArray(finance?.budgets) ? finance.budgets : []) {
    if (budget.status !== "active") continue;
    const counterparty = budget.partySnapshotName
      || (budget.partyId ? finance.parties?.find((party) => party.id === budget.partyId)?.name : "")
      || "";
    for (const occurrence of budget.occurrences || []) {
      if (occurrence.status !== "planned") continue;
      const date = occurrence.plannedDueDate < today ? today : occurrence.plannedDueDate;
      const filterDate = dateBasis === "planned" ? occurrence.plannedDueDate : date;
      if (fromDate && filterDate < fromDate || toDate && filterDate > toDate) continue;
      const amountCents = budget.direction === "payable" ? -occurrence.plannedAmountCents : occurrence.plannedAmountCents;
      events.push({
        id: `budget:${budget.id}:${occurrence.id}`,
        sourceId: occurrence.id,
        sourceType: "budget",
        status: "orcado",
        kind: "previsto",
        direction: budget.direction,
        budgetId: budget.id,
        budgetRevision: budget.revision,
        occurrenceId: occurrence.id,
        occurrenceRevision: occurrence.revision,
        title: budget.title,
        description: budget.title,
        counterparty,
        party: counterparty,
        plannedDueDate: occurrence.plannedDueDate,
        plannedAmountCents: occurrence.plannedAmountCents,
        date,
        amountCents,
        signedAmountCents: amountCents,
        accountId: budget.suggestedAccountId,
        classificationAccountId: budget.suggestedAccountId,
        costCenterId: budget.costCenterId,
        costCenterAllocations: budget.costCenterId
          ? [{ costCenterId: budget.costCenterId, amountCents: occurrence.plannedAmountCents }]
          : [],
      });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "pt-BR") || a.occurrenceId.localeCompare(b.occurrenceId));
}

function buildBudgetReport(finance, filters, accounting, today) {
  const fromDate = filters.fromDate || "0001-01-01";
  const toDate = filters.toDate || "9999-12-31";
  if (!validDate(fromDate) || !validDate(toDate) || fromDate > toDate) fail("Informe um intervalo válido de vencimentos previstos.");
  const direction = filters.direction || "all";
  if (!new Set(["all", "payable", "receivable"]).has(direction)) fail("O filtro de tipo do orçamento é inválido.");
  const occurrenceStatus = filters.status || "all";
  if (!new Set(["all", "planned", "converted", "cancelled"]).has(occurrenceStatus)) fail("O filtro de situação do vencimento é inválido.");
  const categoryAccountId = filters.categoryAccountId || "all";
  if (categoryAccountId !== "all" && !finance.planAccounts.some((account) => account.id === categoryAccountId)) fail("A classificação selecionada para o relatório não existe.");
  const costCenterId = filters.costCenterId || "all";
  if (costCenterId !== "all" && costCenterId !== "none" && !finance.costCenters.some((center) => center.id === costCenterId)) fail("O centro de custo selecionado para o relatório não existe.");
  const planStatus = filters.planStatus || "all";
  if (!new Set(["all", "active", "archived"]).has(planStatus)) fail("O filtro de situação do orçamento é inválido.");
  const rawQuery = String(filters.q || "").trim();
  if (rawQuery.length > 160) fail("A busca deve ter até 160 caracteres.");
  const query = normalizeSearchText(rawQuery);
  const rows = [];
  for (const budget of finance.budgets) {
    if (direction !== "all" && budget.direction !== direction) continue;
    if (categoryAccountId !== "all" && budget.suggestedAccountId !== categoryAccountId) continue;
    if (costCenterId === "none" && budget.costCenterId !== null || costCenterId !== "all" && costCenterId !== "none" && budget.costCenterId !== costCenterId) continue;
    if (planStatus !== "all" && budget.status !== planStatus) continue;
    for (const occurrence of budget.occurrences) {
      if (occurrence.plannedDueDate < fromDate || occurrence.plannedDueDate > toDate) continue;
      if (occurrenceStatus !== "all" && occurrence.status !== occurrenceStatus) continue;
      const document = occurrence.status === "converted"
        ? (occurrence.documentType === "payable" ? finance.payables : finance.receivables).find((item) => item.id === occurrence.documentId) || null
        : null;
      const counterparty = budget.partySnapshotName || (budget.partyId ? finance.parties.find((party) => party.id === budget.partyId)?.name : "") || "";
      if (query && !normalizeSearchText(`${budget.title} ${counterparty}`).includes(query)) continue;
      const effectiveAmountCents = document?.originalAmountCents ?? (occurrence.status === "converted" ? occurrence.convertedEffectiveAmountCents : null);
      const effectiveDueDate = document?.dueDate ?? (occurrence.status === "converted" ? occurrence.convertedEffectiveDueDate : null);
      const categoryAccountId = budget.suggestedAccountId;
      rows.push({
        budgetId: budget.id,
        budgetRevision: budget.revision,
        title: budget.title,
        direction: budget.direction,
        planStatus: budget.status,
        partyName: counterparty,
        categoryAccountId,
        costCenterId: budget.costCenterId,
        occurrenceId: occurrence.id,
        occurrenceRevision: occurrence.revision,
        occurrenceStatus: occurrence.status,
        plannedDueDate: occurrence.plannedDueDate,
        plannedAmountCents: occurrence.plannedAmountCents,
        notes: occurrence.notes,
        documentType: occurrence.documentType || null,
        documentId: occurrence.documentId || null,
        documentStatus: occurrence.status === "converted" ? reportStatus(document, budget.direction, today, accounting) : null,
        documentExists: Boolean(document),
        effectiveDueDate,
        effectiveAmountCents,
        amountVarianceCents: effectiveAmountCents == null ? null : effectiveAmountCents - occurrence.plannedAmountCents,
        dueDateVarianceDays: effectiveDueDate == null ? null : daysBetween(occurrence.plannedDueDate, effectiveDueDate),
        month: occurrence.plannedDueDate.slice(0, 7),
      });
    }
  }
  rows.sort((a, b) => a.plannedDueDate.localeCompare(b.plannedDueDate) || a.title.localeCompare(b.title, "pt-BR") || a.occurrenceId.localeCompare(b.occurrenceId));
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.month}|${row.direction}`;
    const group = groups.get(key) || { month: row.month, direction: row.direction, plannedPendingCents: 0, convertedBudgetCents: 0, generatedDocumentCents: 0, plannedCount: 0, convertedCount: 0, cancelledCount: 0 };
    if (row.occurrenceStatus === "planned") {
      if (row.planStatus === "active") group.plannedPendingCents += row.plannedAmountCents;
      group.plannedCount += 1;
    } else if (row.occurrenceStatus === "converted") {
      group.convertedBudgetCents += row.plannedAmountCents;
      if (row.documentExists) group.generatedDocumentCents += row.effectiveAmountCents;
      group.convertedCount += 1;
    } else group.cancelledCount += 1;
    groups.set(key, group);
  }
  const byMonthDirection = [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.direction.localeCompare(b.direction));
  const totals = byMonthDirection.reduce((sum, item) => ({
    plannedPendingCents: sum.plannedPendingCents + item.plannedPendingCents,
    convertedBudgetCents: sum.convertedBudgetCents + item.convertedBudgetCents,
    generatedDocumentCents: sum.generatedDocumentCents + item.generatedDocumentCents,
    plannedCount: sum.plannedCount + item.plannedCount,
    convertedCount: sum.convertedCount + item.convertedCount,
    cancelledCount: sum.cancelledCount + item.cancelledCount,
  }), { plannedPendingCents: 0, convertedBudgetCents: 0, generatedDocumentCents: 0, plannedCount: 0, convertedCount: 0, cancelledCount: 0 });
  return { fromDate, toDate, direction, categoryAccountId, costCenterId, status: occurrenceStatus, planStatus, rows, byMonthDirection, totals };
}

function daysBetween(fromDate, toDate) {
  const ordinal = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    const adjustedYear = year - (month <= 2 ? 1 : 0);
    const era = Math.floor(adjustedYear / 400);
    const yearOfEra = adjustedYear - era * 400;
    const shiftedMonth = month + (month > 2 ? -3 : 9);
    const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
    const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
    return era * 146097 + dayOfEra;
  };
  return ordinal(toDate) - ordinal(fromDate);
}

module.exports = {
  MAX_OCCURRENCES_PER_BUDGET,
  MAX_TOTAL_OCCURRENCES,
  MAX_BUDGETS,
  MAX_OCCURRENCE_AMOUNT_CENTS,
  validDate,
  generateMonthlyDates,
  normalizeCreateInput,
  validatePartyFields,
  validateOptionalReferences,
  normalizeOccurrence,
  validateBudgets,
  buildBudgetForecastEvents,
  buildBudgetReport,
  daysBetween,
  fail,
};
