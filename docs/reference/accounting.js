"use strict";

const { randomUUID } = require("node:crypto");
const budgetPlanning = require("./budget-planning");

const POSTED = "posted";
const DRAFT = "draft";
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PARTY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARTY_ROLES = ["customer", "supplier"];

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validPeriod(value) {
  return typeof value === "string" && PERIOD_RE.test(value);
}

function periodOf(date) {
  return date.slice(0, 7);
}

function normalizeName(value) {
  return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function normalizeTaxId(value, personType) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 24) fail("CPF/CNPJ deve ter um formato válido.");
  const source = value.trim().toUpperCase();
  if (!source) return null;
  if (!/^[A-Z0-9.\-/\s]+$/.test(source)) fail("CPF/CNPJ deve conter somente letras, números e separadores usuais.");
  const normalized = source.replace(/[.\-/\s]/g, "");
  const valid = personType === "individual"
    ? normalized.length === 11 && /^\d{11}$/.test(normalized) && isValidCpf(normalized)
    : normalized.length === 14 && /^[A-Z0-9]{12}\d{2}$/.test(normalized) && isValidCnpj(normalized);
  if (!valid) fail(personType === "individual" ? "Informe um CPF válido." : "Informe um CNPJ válido.");
  return normalized;
}

function isValidCpf(value) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const digit = (length, weight) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(value[i]) * (weight - i);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9, 10) === Number(value[9]) && digit(10, 11) === Number(value[10]);
}

function cnpjCheckDigit(value) {
  let sum = 0;
  let weight = 2;
  for (let i = value.length - 1; i >= 0; i--) {
    sum += (value.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCnpj(value) {
  if (!/^[A-Z0-9]{12}\d{2}$/.test(value)) return false;
  const firstDigit = cnpjCheckDigit(value.slice(0, 12));
  const secondDigit = cnpjCheckDigit(value.slice(0, 12) + firstDigit);
  return value.slice(12) === `${firstDigit}${secondDigit}`;
}

function validatePartyInput(finance, input, excludeId = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Informe os dados da pessoa ou empresa.");
  if (!new Set(["individual", "organization"]).has(input.personType)) fail("Escolha Pessoa Física ou Pessoa Jurídica.");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 160) fail("Informe o nome ou razão social, com até 160 caracteres.");
  if (input.tradeName != null && (typeof input.tradeName !== "string" || input.tradeName.length > 120)) fail("O nome fantasia deve ter até 120 caracteres.");
  if (!Array.isArray(input.roles) || input.roles.length === 0 || input.roles.some((role) => !PARTY_ROLES.includes(role))
    || new Set(input.roles).size !== input.roles.length) fail("Selecione pelo menos um papel válido: cliente, fornecedor ou ambos.");
  const taxId = normalizeTaxId(input.taxId, input.personType);
  if (taxId && finance.parties.some((party) => party.id !== excludeId && party.taxId === taxId)) {
    fail("Este CPF/CNPJ já pertence a outro cadastro. Reutilize o registro existente.", 409);
  }
  if (input.email != null && (typeof input.email !== "string" || input.email.length > 254)) fail("O e-mail deve ter até 254 caracteres.");
  const email = input.email?.trim() || "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Informe um e-mail válido.");
  if (input.phone != null && (typeof input.phone !== "string" || input.phone.length > 32)) fail("O telefone deve ter até 32 caracteres.");
  const phone = input.phone?.trim() || "";
  if (phone && (!/^\+?[0-9 ().-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7 || phone.replace(/\D/g, "").length > 20)) {
    fail("Informe um telefone válido com até 20 dígitos.");
  }
  if (input.notes != null && (typeof input.notes !== "string" || input.notes.length > 1000)) fail("As observações devem ter até 1.000 caracteres.");
  return {
    personType: input.personType,
    name: input.name.trim(),
    tradeName: input.tradeName?.trim() || "",
    taxId,
    roles: PARTY_ROLES.filter((role) => input.roles.includes(role)),
    email,
    phone,
    notes: input.notes?.trim() || "",
  };
}

function validateParties(finance) {
  if (!Array.isArray(finance.parties)) fail("A coleção de contrapartes deve ser uma lista.", 500);
  const ids = new Set();
  const taxIds = new Set();
  const allowedKeys = new Set(["id", "personType", "name", "tradeName", "taxId", "roles", "email", "phone", "notes", "active", "createdAt", "updatedAt"]);
  for (const party of finance.parties) {
    try {
      if (!party || typeof party !== "object" || Array.isArray(party)
        || Object.keys(party).some((key) => !allowedKeys.has(key))
        || typeof party.id !== "string" || !PARTY_ID_RE.test(party.id) || ids.has(party.id)
        || typeof party.active !== "boolean" || !validTimestamp(party.createdAt) || !validTimestamp(party.updatedAt)) {
        fail("Há um cadastro de contraparte inválido.");
      }
      const normalized = validatePartyInput(finance, party, party.id);
      if (party.name !== normalized.name || party.tradeName !== normalized.tradeName || party.taxId !== normalized.taxId
        || party.email !== normalized.email || party.phone !== normalized.phone || party.notes !== normalized.notes
        || JSON.stringify(party.roles) !== JSON.stringify(normalized.roles)) fail("O cadastro de contraparte não está normalizado.");
      if (normalized.taxId) {
        if (taxIds.has(normalized.taxId)) fail("Há CPF/CNPJ duplicado entre contrapartes.");
        taxIds.add(normalized.taxId);
      }
      ids.add(party.id);
    } catch (error) {
      fail(error.message || "Há um cadastro de contraparte inválido.", 500);
    }
  }
}

function createParty(finance, input, now = new Date().toISOString()) {
  if (!Array.isArray(finance.parties)) finance.parties = [];
  const idempotencyKey = input?.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !PARTY_ID_RE.test(idempotencyKey)) fail("A chave de idempotência deve ser um UUID.");
  const priorEvent = finance.auditEvents.find((event) => event.type === "party-created" && event.idempotencyKey === idempotencyKey);
  if (priorEvent) {
    const party = finance.parties.find((item) => item.id === priorEvent.recordId);
    if (!party) fail("A chave de idempotência está vinculada a um cadastro inexistente.", 409);
    return { party, created: false };
  }
  const fields = validatePartyInput(finance, input);
  const party = { id: randomUUID(), ...fields, active: true, createdAt: now, updatedAt: now };
  finance.parties.push(party);
  finance.auditEvents.push({ id: randomUUID(), type: "party-created", recordId: party.id, idempotencyKey, occurredAt: now });
  return { party, created: true };
}

function updateParty(finance, id, input, now = new Date().toISOString()) {
  const party = finance.parties.find((item) => item.id === id);
  if (!party) fail("Contraparte não encontrada.", 404);
  const fields = validatePartyInput(finance, input, id);
  Object.assign(party, fields, { updatedAt: now });
  finance.auditEvents.push({ id: randomUUID(), type: "party-updated", recordId: party.id, occurredAt: now });
  return party;
}

function setPartyActive(finance, id, active, now = new Date().toISOString()) {
  const party = finance.parties.find((item) => item.id === id);
  if (!party) fail("Contraparte não encontrada.", 404);
  if (typeof active !== "boolean") fail("A situação da contraparte deve ser ativa ou inativa.");
  if (party.active === active) return { party, changed: false };
  party.active = active;
  party.updatedAt = now;
  finance.auditEvents.push({
    id: randomUUID(),
    type: active ? "party-reactivated" : "party-deactivated",
    recordId: party.id,
    occurredAt: now,
  });
  return { party, changed: true };
}

function sumSafe(values, label = "A soma ultrapassa o limite seguro de centavos.") {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) fail(label);
  }
  return total;
}

function getDegree(finance, id) {
  return finance.degrees.find((item) => item.id === id) || null;
}

function getSubcategory(finance, id) {
  return finance.subcategories.find((item) => item.id === id) || null;
}

function getPlanAccount(finance, id) {
  return finance.planAccounts.find((item) => item.id === id) || null;
}

function getSubcategoryCode(finance, id, seen = new Set()) {
  const item = getSubcategory(finance, id);
  if (!item || seen.has(item.id)) return "";
  seen.add(item.id);
  const parentCode = item.parentType === "degree"
    ? String(getDegree(finance, item.parentId)?.number || "")
    : getSubcategoryCode(finance, item.parentId, seen);
  seen.delete(item.id);
  return parentCode ? `${parentCode}.${item.number}` : "";
}

function getPlanAccountCode(finance, accountId) {
  const account = getPlanAccount(finance, accountId);
  const parentCode = account ? getSubcategoryCode(finance, account.subcategoryId) : "";
  return parentCode ? `${parentCode}.${account.number}` : "";
}

function getDegreeForSubcategory(finance, id) {
  let item = getSubcategory(finance, id);
  const seen = new Set();
  while (item && !seen.has(item.id)) {
    seen.add(item.id);
    if (item.parentType === "degree") return getDegree(finance, item.parentId);
    item = getSubcategory(finance, item.parentId);
  }
  return null;
}

function getDegreeForAccount(finance, accountId) {
  const account = getPlanAccount(finance, accountId);
  return account ? getDegreeForSubcategory(finance, account.subcategoryId) : null;
}

function getAccountGroup(finance, accountId) {
  const degree = getDegreeForAccount(finance, accountId);
  return degree?.number ?? null;
}

function getAccountName(finance, accountId) {
  return getPlanAccount(finance, accountId)?.name || "Conta removida";
}

function getAccountEligibility(finance, accountId) {
  const account = getPlanAccount(finance, accountId);
  if (!account) return null;
  return {
    account,
    degree: getDegreeForAccount(finance, accountId),
    groupNumber: getAccountGroup(finance, accountId),
    code: getPlanAccountCode(finance, accountId),
    normalBalance: account.normalBalance,
    cashEquivalent: account.cashEquivalent === true,
    postable: account.postable === true,
  };
}

function accountLabel(finance, accountId) {
  const account = getPlanAccount(finance, accountId);
  return account ? `${getPlanAccountCode(finance, accountId)} - ${account.name}` : "Conta removida";
}

function migrateFinanceV2ToV3(source, options = {}) {
  if (source?.schemaVersion === 3) return structuredClone(source);
  if (!source || source.schemaVersion !== 2) fail("Não há migração disponível para esta versão do JSON.", 409);
  const finance = structuredClone(source);
  const now = options.now || new Date().toISOString();
  const snapshot = finance.legacyOpeningSnapshot || {
    schemaVersion: 2,
    referenceDate: finance.referenceDate,
    accounts: structuredClone(finance.accounts || []),
    openingBalanceCents: finance.openingBalanceCents,
    openingBalanceAdjustmentCents: finance.openingBalanceAdjustmentCents,
    openingBalanceUpdatedAt: finance.openingBalanceUpdatedAt ?? null,
    transactions: structuredClone(finance.transactions || []),
  };
  const priorTransactions = Array.isArray(finance.legacyTransactions)
    ? finance.legacyTransactions
    : structuredClone(finance.transactions || []);

  finance.degrees ||= [];
  finance.subcategories ||= [];
  finance.planAccounts ||= [];
  const assetDegree = finance.degrees.find((item) => item.number === 1 && normalizeName(item.name) === "ativo");
  if (!assetDegree) fail("A migração exige o grau 1 - Ativo existente.", 409);
  const currentAssets = finance.subcategories.find((item) => item.parentType === "degree"
    && item.parentId === assetDegree.id && item.number === 1 && normalizeName(item.name) === "ativo circulante");
  if (!currentAssets) fail("A migração não encontrou 1.1 - Ativo Circulante; nenhum código foi criado automaticamente.", 409);

  let receivableGroup = finance.subcategories.find((item) => item.parentType === "subcategory"
    && item.parentId === currentAssets.id && item.number === 3);
  if (receivableGroup && normalizeName(receivableGroup.name) !== "creditos a receber") {
    fail(`O código 1.1.3 já está ocupado por “${receivableGroup.name}”; resolva o conflito antes da migração.`, 409);
  }
  if (!receivableGroup) {
    receivableGroup = {
      id: "subcat-ativo-circulante-creditos-a-receber-v3",
      number: 3,
      name: "Créditos a Receber",
      parentType: "subcategory",
      parentId: currentAssets.id,
      createdAt: now,
      updatedAt: now,
    };
    finance.subcategories.push(receivableGroup);
  }
  let receivableAccount = finance.planAccounts.find((item) => item.subcategoryId === receivableGroup.id && item.number === 1);
  if (receivableAccount && normalizeName(receivableAccount.name) !== "contas a receber") {
    fail(`O código 1.1.3.1 já está ocupado por “${receivableAccount.name}”; resolva o conflito antes da migração.`, 409);
  }
  if (!receivableAccount) {
    receivableAccount = {
      id: "plano-contas-ativo-contas-a-receber-v3",
      number: 1,
      name: "Contas a Receber",
      subcategoryId: receivableGroup.id,
      createdAt: now,
      updatedAt: now,
    };
    finance.planAccounts.push(receivableAccount);
  }

  for (const account of finance.planAccounts) {
    const root = getDegreeForSubcategory(finance, account.subcategoryId);
    account.normalBalance ||= [1, 5, 6].includes(root?.number) ? "debit" : "credit";
    if (typeof account.cashEquivalent !== "boolean") {
      const code = getPlanAccountCode(finance, account.id);
      account.cashEquivalent = code.startsWith("1.1.1.") || code.startsWith("1.1.2.");
    }
    if (typeof account.postable !== "boolean") account.postable = true;
  }

  finance.schemaVersion = 3;
  finance.defaultPeriod = finance.defaultPeriod || String(snapshot.referenceDate || "2026-10-01").slice(0, 7);
  finance.legacyOpeningSnapshot = snapshot;
  finance.legacyTransactions = priorTransactions;
  delete finance.accounts;
  delete finance.transactions;
  delete finance.referenceDate;
  delete finance.openingBalanceCents;
  delete finance.openingBalanceAdjustmentCents;
  delete finance.openingBalanceUpdatedAt;
  finance.costCenters = Array.isArray(finance.costCenters) ? finance.costCenters : [];
  finance.journalEntries = Array.isArray(finance.journalEntries) ? finance.journalEntries : [];
  finance.payables = Array.isArray(finance.payables) ? finance.payables : [];
  finance.receivables = Array.isArray(finance.receivables) ? finance.receivables : [];
  finance.auditEvents = Array.isArray(finance.auditEvents) ? finance.auditEvents : [];
  finance.parties = Array.isArray(finance.parties) ? finance.parties : [];

  const openingEntryId = "journal-opening-migration-v2";
  if (!finance.journalEntries.some((entry) => entry.id === openingEntryId)) {
    const knownBalances = snapshot.accounts || [];
    const knownTotal = sumSafe(knownBalances.map((item) => item.balanceCents || 0));
    const consolidated = Number.isSafeInteger(snapshot.openingBalanceCents) ? snapshot.openingBalanceCents : knownTotal;
    finance.journalEntries.push({
      id: openingEntryId,
      entryNumber: null,
      postingDate: snapshot.referenceDate || null,
      period: validPeriod(String(snapshot.referenceDate || "").slice(0, 7)) ? String(snapshot.referenceDate).slice(0, 7) : null,
      description: "Saldo de abertura legado — alocação contábil pendente",
      originModule: "migracao",
      sourceRecordId: "legacy-opening-balance-v2",
      sourceKey: "migration:opening-balance-v2",
      sourceEventType: "opening-draft",
      status: DRAFT,
      createdAt: now,
      postedAt: null,
      lines: [],
      draftDetails: {
        asOfDate: snapshot.referenceDate || null,
        consolidatedBalanceCents: consolidated,
        knownLegacyAccounts: structuredClone(knownBalances),
        knownAccountsTotalCents: knownTotal,
        unallocatedDifferenceCents: consolidated - knownTotal,
        mappedToChartAccounts: false,
        note: "A distribuição histórica e a identificação das instituições não foram confirmadas. Este rascunho não afeta o Livro-Razão, o Balancete nem o Caixa contábil.",
      },
    });
  }
  return finance;
}

function validateAllocations(finance, line, options = {}) {
  const allocations = line.costCenterAllocations ?? [];
  if (!Array.isArray(allocations)) fail("A alocação por centro de custo deve ser uma lista.");
  if (allocations.length === 0) return [];
  const amount = Math.abs(line.debitCents - line.creditCents);
  const seen = new Set();
  let total = 0;
  const normalized = allocations.map((allocation) => {
    const center = finance.costCenters.find((item) => item.id === allocation.costCenterId);
    if (!center) fail("Uma alocação aponta para um centro de custo inexistente.");
    if (!center.active && !options.allowInactiveCostCenters) fail(`O centro de custo “${center.name}” está inativo.`);
    if (seen.has(center.id)) fail("O mesmo centro de custo não pode aparecer duas vezes na mesma linha.");
    seen.add(center.id);
    if (!Number.isSafeInteger(allocation.amountCents) || allocation.amountCents <= 0) fail("O valor alocado deve ser positivo e informado em centavos.");
    total += allocation.amountCents;
    if (!Number.isSafeInteger(total)) fail("A soma das alocações excede o limite seguro.");
    return { costCenterId: center.id, amountCents: allocation.amountCents };
  });
  if (total !== amount) fail("A soma das alocações por centro de custo deve ser igual ao valor da linha contábil.");
  return normalized;
}

function rawDocumentCostCenterAllocations(document) {
  if (Array.isArray(document?.costCenterAllocations) && document.costCenterAllocations.length) return document.costCenterAllocations;
  if (document?.costCenterId) return [{ costCenterId: document.costCenterId, amountCents: document.originalAmountCents }];
  return [];
}

function documentCostCenterAllocations(document) {
  return rawDocumentCostCenterAllocations(document).map((item) => ({ costCenterId: item.costCenterId, amountCents: item.amountCents }));
}

function normalizeDocumentCostCenterAllocations(finance, input) {
  const allocations = rawDocumentCostCenterAllocations(input);
  return allocations.length
    ? validateAllocations(finance, { debitCents: input.originalAmountCents, creditCents: 0, costCenterAllocations: allocations })
    : [];
}

function distributeCostCenterAmount(amountCents, remainingAllocations) {
  const total = remainingAllocations.reduce((sum, item) => sum + item.amountCents, 0);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > total || total <= 0) fail("O rateio do evento excede o saldo do documento por centro de custo.", 409);
  if (amountCents === total) return remainingAllocations.filter((item) => item.amountCents > 0).map((item) => ({ ...item }));
  const divisor = BigInt(total);
  const parts = remainingAllocations.map((item, index) => {
    const product = BigInt(amountCents) * BigInt(item.amountCents);
    return { costCenterId: item.costCenterId, amountCents: Number(product / divisor), remainder: product % divisor, index };
  });
  let unassigned = amountCents - parts.reduce((sum, item) => sum + item.amountCents, 0);
  for (const part of parts.slice().sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (unassigned <= 0) break;
    part.amountCents += 1;
    unassigned -= 1;
  }
  return parts.filter((item) => item.amountCents > 0).map(({ costCenterId, amountCents: allocated }) => ({ costCenterId, amountCents: allocated }));
}

function documentEventCostCenterAllocations(document, records, amountCents) {
  let remaining = rawDocumentCostCenterAllocations(document).map((item) => ({ ...item }));
  if (!remaining.length) return [];
  for (const record of records || []) {
    if (record.reversedAt) continue;
    const allocations = Array.isArray(record.costCenterAllocations) && record.costCenterAllocations.length
      ? record.costCenterAllocations
      : distributeCostCenterAmount(record.amountCents, remaining);
    for (const allocation of allocations) {
      const item = remaining.find((candidate) => candidate.costCenterId === allocation.costCenterId);
      if (!item || !Number.isSafeInteger(allocation.amountCents) || allocation.amountCents <= 0 || allocation.amountCents > item.amountCents) fail("O histórico de liquidações excede o rateio do documento por centro de custo.", 500);
      item.amountCents -= allocation.amountCents;
    }
  }
  return distributeCostCenterAmount(amountCents, remaining);
}

function normalizeJournalLines(finance, lines, options = {}) {
  if (!Array.isArray(lines) || lines.length < 2) fail("O lançamento deve conter ao menos duas linhas contábeis.");
  const lineIds = new Set();
  let debitTotal = 0;
  let creditTotal = 0;
  let hasDebit = false;
  let hasCredit = false;
  const normalized = lines.map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) fail("Há uma linha contábil inválida.");
    const account = getPlanAccount(finance, line.accountId);
    if (!account) fail("Selecione uma conta analítica cadastrada.");
    if (account.postable !== true) fail(`A conta “${account.name}” é sintética e não aceita lançamentos.`);
    const debitCents = line.debitCents;
    const creditCents = line.creditCents;
    if (!Number.isSafeInteger(debitCents) || debitCents < 0 || !Number.isSafeInteger(creditCents) || creditCents < 0) fail("Débitos e créditos devem ser centavos inteiros não negativos.");
    if ((debitCents > 0) === (creditCents > 0)) fail("Cada linha deve ter valor em somente um lado e não pode ser zero.");
    debitTotal += debitCents;
    creditTotal += creditCents;
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal)) fail("O total do lançamento excede o limite seguro de centavos.");
    hasDebit ||= debitCents > 0;
    hasCredit ||= creditCents > 0;
    const id = line.id || randomUUID();
    if (typeof id !== "string" || !id || lineIds.has(id)) fail("Há um identificador de linha ausente ou duplicado.");
    lineIds.add(id);
    const costCenterAllocations = validateAllocations(finance, { ...line, debitCents, creditCents }, options);
    return { id, accountId: account.id, debitCents, creditCents, costCenterAllocations };
  });
  if (!hasDebit || !hasCredit) fail("O lançamento deve ter pelo menos um débito e um crédito.");
  if (debitTotal !== creditTotal) fail(`Lançamento desbalanceado: débitos ${debitTotal} centavos; créditos ${creditTotal} centavos.`);
  return { lines: normalized, debitTotal, creditTotal };
}

function journalPayloadSignature(entry) {
  return JSON.stringify({
    postingDate: entry.postingDate,
    period: entry.period,
    description: entry.description,
    lines: entry.lines.map((line) => ({
      accountId: line.accountId,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      costCenterAllocations: line.costCenterAllocations || [],
    })),
  });
}

function postJournalEntry(finance, input, options = {}) {
  const now = options.now || new Date().toISOString();
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Informe os dados do lançamento contábil.");
  if (!validDate(input.postingDate)) fail("Informe uma data de contabilização válida.");
  if (!validPeriod(input.period)) fail("O período contábil deve usar o formato AAAA-MM.");
  if (typeof input.description !== "string" || !input.description.trim() || input.description.trim().length > 240) fail("Informe um histórico de até 240 caracteres.");
  if (typeof input.originModule !== "string" || !input.originModule.trim()) fail("Informe a origem do lançamento.");
  if (input.sourceKey) {
    const existing = finance.journalEntries.find((entry) => entry.sourceKey === input.sourceKey && entry.status === POSTED);
    if (existing) {
      const candidate = normalizeJournalLines(finance, input.lines, options);
      const comparison = { ...existing, postingDate: input.postingDate, period: input.period, description: input.description.trim(), lines: candidate.lines };
      if (existing.originModule !== input.originModule.trim()
        || (existing.sourceRecordId || null) !== (input.sourceRecordId || null)
        || (existing.sourceEventType || null) !== (input.sourceEventType || null)
        || journalPayloadSignature(existing) !== journalPayloadSignature(comparison)) fail("A referência de origem já foi usada por outro lançamento.", 409);
      return { entry: existing, created: false };
    }
  }
  if (input.idempotencyKey && finance.journalEntries.some((entry) => entry.idempotencyKey === input.idempotencyKey && entry.status === POSTED)) {
    fail("A chave de idempotência já foi usada em outro lançamento.", 409);
  }
  const result = normalizeJournalLines(finance, input.lines, options);
  const entryNumber = finance.journalEntries.reduce((highest, entry) => Math.max(highest, entry.entryNumber || 0), 0) + 1;
  const entry = {
    id: input.id || randomUUID(),
    entryNumber,
    postingDate: input.postingDate,
    period: input.period,
    description: input.description.trim(),
    originModule: input.originModule.trim(),
    sourceRecordId: input.sourceRecordId || null,
    sourceEventType: input.sourceEventType || null,
    sourceKey: input.sourceKey || null,
    idempotencyKey: input.idempotencyKey || null,
    reversalOfEntryId: input.reversalOfEntryId || null,
    status: POSTED,
    createdAt: now,
    postedAt: now,
    lines: result.lines,
  };
  if (finance.journalEntries.some((item) => item.id === entry.id)) fail("Identificador de lançamento contábil duplicado.", 409);
  finance.journalEntries.push(entry);
  finance.auditEvents.push({ id: randomUUID(), type: "journal-posted", recordId: entry.id, originModule: entry.originModule, sourceRecordId: entry.sourceRecordId, occurredAt: now });
  return { entry, created: true };
}

function reverseJournalEntry(finance, entryId, input, options = {}) {
  const original = finance.journalEntries.find((entry) => entry.id === entryId && entry.status === POSTED);
  if (!original) fail("Lançamento postado não encontrado.", 404);
  if (original.reversalOfEntryId) {
    const source = finance.journalEntries.find((entry) => entry.id === original.reversalOfEntryId);
    if (["contas-a-pagar", "contas-a-receber"].includes(source?.originModule)) fail("Um estorno operacional não pode ser estornado isoladamente; corrija o documento e seus eventos vinculados.", 409);
  }
  const existing = finance.journalEntries.find((entry) => entry.reversalOfEntryId === original.id);
  if (existing) return { entry: existing, created: false };
  let document = null;
  let documentKind = null;
  if (original.originModule === "contas-a-pagar") {
    document = finance.payables.find((item) => item.id === original.sourceRecordId) || null;
    documentKind = "payable";
  } else if (original.originModule === "contas-a-receber") {
    document = finance.receivables.find((item) => item.id === original.sourceRecordId) || null;
    documentKind = "receivable";
  }
  if (document && original.sourceEventType === "recognition") {
    const active = documentKind === "payable" ? outstandingPayable(document) : outstandingReceivable(document);
    if (active !== document.originalAmountCents) fail("Estorne primeiro todos os pagamentos ou recebimentos vinculados antes de reverter o reconhecimento.", 409);
  }
  const settlementRecord = document && ["settlement", "collection"].includes(original.sourceEventType)
    ? (documentKind === "payable" ? document.settlements : document.collections).find((item) => item.journalEntryId === original.id)
    : null;
  if (document && ["settlement", "collection"].includes(original.sourceEventType) && !settlementRecord) fail("A liquidação operacional não possui evento correspondente para reverter.", 409);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 240) fail("Informe o motivo do estorno, com até 240 caracteres.");
  const lines = original.lines.map((line) => ({
    accountId: line.accountId,
    debitCents: line.creditCents,
    creditCents: line.debitCents,
    costCenterAllocations: line.costCenterAllocations || [],
  }));
  const result = postJournalEntry(finance, {
    postingDate: input.postingDate || original.postingDate,
    period: input.period || original.period,
    description: `Estorno do lançamento ${original.entryNumber}: ${reason}`,
    originModule: "estorno",
    sourceRecordId: original.id,
    sourceEventType: "reversal",
    sourceKey: `reversal:${original.id}`,
    reversalOfEntryId: original.id,
    lines,
  }, { ...options, allowInactiveCostCenters: true });
  if (result.created) {
    const now = options.now || new Date().toISOString();
    if (settlementRecord) {
      settlementRecord.reversedAt = now;
      settlementRecord.reversalEntryId = result.entry.id;
      const remaining = documentKind === "payable" ? outstandingPayable(document) : outstandingReceivable(document);
      document.status = remaining === document.originalAmountCents ? "open" : remaining === 0 ? "paid" : "partially_paid";
      document.updatedAt = now;
    } else if (document && original.sourceEventType === "recognition") {
      document.status = "cancelled";
      document.updatedAt = now;
    }
    finance.auditEvents.push({ id: randomUUID(), type: "journal-reversed", recordId: original.id, journalEntryId: result.entry.id, occurredAt: now });
  }
  return result;
}

function validateCostCenter(finance, input, excludeId = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Informe os dados do centro de custo.");
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!code || code.length > 40) fail("Informe um código com até 40 caracteres.");
  if (!name || name.length > 100) fail("Informe um nome com até 100 caracteres.");
  if (typeof input.active !== "boolean") fail("Informe se o centro de custo está ativo.");
  if (input.description != null && (typeof input.description !== "string" || input.description.length > 240)) fail("A descrição deve ter até 240 caracteres.");
  if (input.parentId != null && !finance.costCenters.some((item) => item.id === input.parentId && item.id !== excludeId)) fail("O centro de custo superior não existe.");
  if (finance.costCenters.some((item) => item.id !== excludeId && normalizeName(item.code) === normalizeName(code))) fail("Já existe um centro de custo com esse código.");
  if (finance.costCenters.some((item) => item.id !== excludeId && normalizeName(item.name) === normalizeName(name))) fail("Já existe um centro de custo com esse nome.");
  if (excludeId && input.parentId) {
    let parent = finance.costCenters.find((item) => item.id === input.parentId);
    const seen = new Set();
    while (parent && !seen.has(parent.id)) {
      if (parent.id === excludeId) fail("Um centro de custo não pode ser pai de si mesmo ou de um descendente.");
      seen.add(parent.id);
      parent = parent.parentId ? finance.costCenters.find((item) => item.id === parent.parentId) : null;
    }
  }
  return { code, name, description: input.description?.trim() || "", active: input.active, parentId: input.parentId || null };
}

function validateDocumentBase(finance, input, kind, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Informe os dados do documento.");
  const partyField = kind === "payable" ? "creditor" : "debtor";
  const partyText = typeof input[partyField] === "string" ? input[partyField].trim() : "";
  const partyId = input.partyId == null ? null : input.partyId;
  const partyTextLimit = partyId === null ? 120 : 160;
  let party = partyText;
  if (partyId !== null) {
    if (typeof partyId !== "string" || !PARTY_ID_RE.test(partyId)) fail("A contraparte vinculada tem um identificador inválido.");
    const linkedParty = (finance.parties || []).find((item) => item.id === partyId);
    if (!linkedParty) fail("A contraparte vinculada não existe.", 404);
    const keepingExistingLink = options.existingPartyId === partyId;
    const requiredRole = kind === "payable" ? "supplier" : "customer";
    if (!keepingExistingLink && !linkedParty.roles.includes(requiredRole)) {
      fail(kind === "payable" ? "A contraparte precisa ter o papel fornecedor para uma conta a pagar." : "A contraparte precisa ter o papel cliente para uma conta a receber.");
    }
    if (!keepingExistingLink && !linkedParty.active) fail("Reative a contraparte antes de vinculá-la a um novo documento.");
    if (!partyText || partyText.length > partyTextLimit) fail(`Informe ${kind === "payable" ? "o credor/fornecedor" : "o pagador/devedor"}, com até ${partyTextLimit} caracteres.`);
    const keepingSnapshot = keepingExistingLink && partyText === options.existingPartySnapshot;
    if (!keepingSnapshot && partyText !== linkedParty.name) fail("O nome do documento deve corresponder à contraparte selecionada.");
    party = keepingSnapshot ? partyText : linkedParty.name;
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!party || party.length > partyTextLimit) fail(`Informe ${kind === "payable" ? "o credor/fornecedor" : "o pagador/devedor"}, com até ${partyTextLimit} caracteres.`);
  if (!description || description.length > 160) fail("Informe a descrição do documento, com até 160 caracteres.");
  if (input.documentNumber != null && (typeof input.documentNumber !== "string" || input.documentNumber.length > 80)) fail("O número do documento deve ter até 80 caracteres.");
  if (!validDate(input.issueDate) || !validDate(input.dueDate)) fail("Informe datas válidas de emissão e vencimento.");
  if (!validPeriod(input.competencePeriod)) fail("Informe a competência no formato AAAA-MM.");
  if (!Number.isSafeInteger(input.originalAmountCents) || input.originalAmountCents <= 0) fail("O valor original deve ser positivo e informado em centavos inteiros.");
  if (input.notes != null && (typeof input.notes !== "string" || input.notes.length > 1000)) fail("As observações devem ter até 1.000 caracteres.");
  const costCenterAllocations = normalizeDocumentCostCenterAllocations(finance, input);
  if (kind === "payable") {
    const expense = getAccountEligibility(finance, input.expenseAccountId);
    const liability = getAccountEligibility(finance, input.liabilityAccountId);
    if (!expense?.postable || ![5, 6].includes(expense.groupNumber)) fail("A classificação da conta a pagar deve ser uma conta analítica de Custos ou Despesas.");
    if (!liability?.postable || liability.groupNumber !== 2) fail("A obrigação deve usar uma conta analítica do Passivo.");
  } else {
    const revenue = getAccountEligibility(finance, input.revenueAccountId);
    const receivable = getAccountEligibility(finance, input.receivableAccountId);
    if (!revenue?.postable || revenue.groupNumber !== 4) fail("A receita deve usar uma conta analítica do grau Receitas.");
    if (!receivable?.postable || receivable.groupNumber !== 1 || receivable.cashEquivalent) fail("Contas a Receber deve usar um ativo analítico que não seja caixa ou banco.");
  }
  return { partyField, party, partyId, description, costCenterAllocations };
}

function documentAllocationsForSignature(document) {
  return rawDocumentCostCenterAllocations(document).map((item) => ({ costCenterId: item.costCenterId, amountCents: item.amountCents }));
}

function documentCreationSignature(document, kind) {
  return JSON.stringify({
    party: String((kind === "payable" ? document.creditor : document.debtor) || "").trim(),
    partyId: document.partyId || null,
    description: document.description?.trim(),
    documentNumber: document.documentNumber?.trim() || "",
    issueDate: document.issueDate,
    dueDate: document.dueDate,
    competencePeriod: document.competencePeriod,
    originalAmountCents: document.originalAmountCents,
    classificationAccountId: kind === "payable" ? document.expenseAccountId : document.revenueAccountId,
    controlAccountId: kind === "payable" ? document.liabilityAccountId : document.receivableAccountId,
    costCenterAllocations: documentAllocationsForSignature(document),
    notes: document.notes?.trim() || "",
    recurringIncomeId: kind === "receivable" ? document.recurringIncomeId || null : null,
  });
}

function existingDocumentByIdempotency(finance, collection, kind, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Informe os dados do documento.");
  if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim() || input.idempotencyKey.length > 120) fail("A chave de idempotência do documento é obrigatória.");
  const existing = finance[collection].find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!existing) return null;
  if (documentCreationSignature(existing, kind) !== documentCreationSignature(input, kind)) fail("A chave de idempotência já foi usada em outro documento.", 409);
  return existing;
}

function createPayable(finance, input, now = new Date().toISOString()) {
  const existing = existingDocumentByIdempotency(finance, "payables", "payable", input);
  if (existing) return existing;
  const base = validateDocumentBase(finance, input, "payable");
  const payable = {
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    creditor: base.party,
    partyId: base.partyId,
    description: base.description,
    documentNumber: input.documentNumber?.trim() || "",
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    competencePeriod: input.competencePeriod,
    originalAmountCents: input.originalAmountCents,
    expenseAccountId: input.expenseAccountId,
    liabilityAccountId: input.liabilityAccountId,
    costCenterId: base.costCenterAllocations.length === 1 ? base.costCenterAllocations[0].costCenterId : null,
    costCenterAllocations: base.costCenterAllocations,
    notes: input.notes?.trim() || "",
    status: DRAFT,
    postingStatus: DRAFT,
    recognitionEntryId: null,
    settlements: [],
    createdAt: now,
    updatedAt: now,
  };
  finance.payables.push(payable);
  return payable;
}

function createReceivable(finance, input, now = new Date().toISOString()) {
  const existing = existingDocumentByIdempotency(finance, "receivables", "receivable", input);
  if (existing) return existing;
  const base = validateDocumentBase(finance, input, "receivable");
  if (input.recurringIncomeId && !finance.recurringIncome.some((item) => item.id === input.recurringIncomeId)) fail("A recorrência vinculada não existe.");
  const receivable = {
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    debtor: base.party,
    partyId: base.partyId,
    description: base.description,
    documentNumber: input.documentNumber?.trim() || "",
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    competencePeriod: input.competencePeriod,
    originalAmountCents: input.originalAmountCents,
    revenueAccountId: input.revenueAccountId,
    receivableAccountId: input.receivableAccountId,
    costCenterId: base.costCenterAllocations.length === 1 ? base.costCenterAllocations[0].costCenterId : null,
    costCenterAllocations: base.costCenterAllocations,
    recurringIncomeId: input.recurringIncomeId || null,
    notes: input.notes?.trim() || "",
    status: DRAFT,
    postingStatus: DRAFT,
    recognitionEntryId: null,
    collections: [],
    createdAt: now,
    updatedAt: now,
  };
  finance.receivables.push(receivable);
  return receivable;
}

function outstandingPayable(payable) {
  return payable.originalAmountCents - sumSafe((payable.settlements || []).filter((item) => !item.reversedAt).map((item) => item.amountCents));
}

function outstandingReceivable(receivable) {
  return receivable.originalAmountCents - sumSafe((receivable.collections || []).filter((item) => !item.reversedAt).map((item) => item.amountCents));
}

function titleStatus(title, kind, today = new Date().toISOString().slice(0, 10)) {
  if (title.status === "cancelled" || title.postingStatus === DRAFT) return DRAFT === title.postingStatus ? "draft" : "cancelled";
  const outstanding = kind === "payable" ? outstandingPayable(title) : outstandingReceivable(title);
  if (outstanding === 0) return "paid";
  if (title.dueDate < today) return "overdue";
  return outstanding < title.originalAmountCents ? "partially_paid" : "open";
}

function recognizePayable(finance, payableId, input, now = new Date().toISOString()) {
  const payable = finance.payables.find((item) => item.id === payableId);
  if (!payable) fail("Conta a pagar não encontrada.", 404);
  if (payable.recognitionEntryId) {
    const entry = finance.journalEntries.find((item) => item.id === payable.recognitionEntryId);
    return { payable, entry, created: false };
  }
  if (payable.status === "cancelled") fail("Uma conta cancelada não pode ser reconhecida.", 409);
  if (!validDate(input?.postingDate)) fail("Informe a data de contabilização da competência.");
  const costCenterAllocations = documentCostCenterAllocations(payable);
  const posted = postJournalEntry(finance, {
    postingDate: input.postingDate,
    period: payable.competencePeriod,
    description: `Reconhecimento: ${payable.description}`,
    originModule: "contas-a-pagar",
    sourceRecordId: payable.id,
    sourceEventType: "recognition",
    sourceKey: `payable-recognition:${payable.id}`,
    lines: [
      { accountId: payable.expenseAccountId, debitCents: payable.originalAmountCents, creditCents: 0, costCenterAllocations },
      { accountId: payable.liabilityAccountId, debitCents: 0, creditCents: payable.originalAmountCents, costCenterAllocations: [] },
    ],
  }, { now });
  payable.recognitionEntryId = posted.entry.id;
  payable.postingStatus = POSTED;
  payable.status = "open";
  payable.updatedAt = now;
  finance.auditEvents.push({ id: randomUUID(), type: "payable-recognized", recordId: payable.id, journalEntryId: posted.entry.id, occurredAt: now });
  return { payable, entry: posted.entry, created: posted.created };
}

function settlePayable(finance, payableId, input, now = new Date().toISOString()) {
  const payable = finance.payables.find((item) => item.id === payableId);
  if (!payable) fail("Conta a pagar não encontrada.", 404);
  if (!payable.recognitionEntryId || payable.postingStatus !== POSTED) fail("Reconheça a obrigação antes de registrar o pagamento.", 409);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Informe os dados do pagamento.");
  if (input.discountCents || input.interestCents || input.penaltyCents || input.feeCents) fail("Descontos, juros, multas ou tarifas exigem linhas contábeis próprias e não são aceitos neste formulário.");
  if (!validDate(input.date)) fail("Informe uma data válida para o pagamento.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) fail("Informe um valor pago positivo em centavos inteiros.");
  if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim() || input.idempotencyKey.length > 100) fail("A chave de idempotência do pagamento é obrigatória.");
  if (input.reference != null && (typeof input.reference !== "string" || input.reference.length > 120)) fail("A referência do pagamento deve ter até 120 caracteres.");
  const duplicate = payable.settlements.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (duplicate) {
    if (duplicate.date !== input.date || duplicate.amountCents !== input.amountCents || duplicate.cashAccountId !== input.cashAccountId) fail("A chave de idempotência já foi usada em outro pagamento.", 409);
    return { payable, settlement: duplicate, entry: finance.journalEntries.find((item) => item.id === duplicate.journalEntryId), created: false };
  }
  const cash = getAccountEligibility(finance, input.cashAccountId);
  if (!cash?.postable || !cash.cashEquivalent) fail("Selecione uma conta de caixa ou banco analítica e habilitada.");
  const outstanding = outstandingPayable(payable);
  if (input.amountCents > outstanding) fail("O pagamento excede o saldo em aberto. Diferenças por desconto, juros, multa ou tarifa precisam de classificação contábil explícita.", 409);
  const costCenterAllocations = documentEventCostCenterAllocations(payable, payable.settlements, input.amountCents);
  const settlement = {
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    date: input.date,
    amountCents: input.amountCents,
    cashAccountId: input.cashAccountId,
    costCenterAllocations,
    reference: input.reference?.trim() || "",
    journalEntryId: null,
    createdAt: now,
  };
  const posted = postJournalEntry(finance, {
    postingDate: settlement.date,
    period: periodOf(settlement.date),
    description: `Pagamento: ${payable.description}`,
    originModule: "contas-a-pagar",
    sourceRecordId: payable.id,
    sourceEventType: "settlement",
    sourceKey: `payable-settlement:${payable.id}:${settlement.idempotencyKey}`,
    idempotencyKey: settlement.idempotencyKey,
    lines: [
      { accountId: payable.liabilityAccountId, debitCents: settlement.amountCents, creditCents: 0, costCenterAllocations: [] },
      { accountId: settlement.cashAccountId, debitCents: 0, creditCents: settlement.amountCents, costCenterAllocations },
    ],
  }, { now });
  settlement.journalEntryId = posted.entry.id;
  payable.settlements.push(settlement);
  payable.status = outstandingPayable(payable) === 0 ? "paid" : "partially_paid";
  payable.updatedAt = now;
  finance.auditEvents.push({ id: randomUUID(), type: "payable-settled", recordId: payable.id, settlementId: settlement.id, journalEntryId: posted.entry.id, occurredAt: now });
  return { payable, settlement, entry: posted.entry, created: true };
}

function recognizeReceivable(finance, receivableId, input, now = new Date().toISOString()) {
  const receivable = finance.receivables.find((item) => item.id === receivableId);
  if (!receivable) fail("Conta a receber não encontrada.", 404);
  if (receivable.recognitionEntryId) {
    const entry = finance.journalEntries.find((item) => item.id === receivable.recognitionEntryId);
    return { receivable, entry, created: false };
  }
  if (receivable.status === "cancelled") fail("Uma conta cancelada não pode ser reconhecida.", 409);
  if (!validDate(input?.postingDate)) fail("Informe a data de contabilização da competência.");
  const costCenterAllocations = documentCostCenterAllocations(receivable);
  const posted = postJournalEntry(finance, {
    postingDate: input.postingDate,
    period: receivable.competencePeriod,
    description: `Reconhecimento: ${receivable.description}`,
    originModule: "contas-a-receber",
    sourceRecordId: receivable.id,
    sourceEventType: "recognition",
    sourceKey: `receivable-recognition:${receivable.id}`,
    lines: [
      { accountId: receivable.receivableAccountId, debitCents: receivable.originalAmountCents, creditCents: 0, costCenterAllocations: [] },
      { accountId: receivable.revenueAccountId, debitCents: 0, creditCents: receivable.originalAmountCents, costCenterAllocations },
    ],
  }, { now });
  receivable.recognitionEntryId = posted.entry.id;
  receivable.postingStatus = POSTED;
  receivable.status = "open";
  receivable.updatedAt = now;
  finance.auditEvents.push({ id: randomUUID(), type: "receivable-recognized", recordId: receivable.id, journalEntryId: posted.entry.id, occurredAt: now });
  return { receivable, entry: posted.entry, created: posted.created };
}

function collectReceivable(finance, receivableId, input, now = new Date().toISOString()) {
  const receivable = finance.receivables.find((item) => item.id === receivableId);
  if (!receivable) fail("Conta a receber não encontrada.", 404);
  if (!receivable.recognitionEntryId || receivable.postingStatus !== POSTED) fail("Reconheça o direito antes de registrar o recebimento.", 409);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Informe os dados do recebimento.");
  if (input.discountCents || input.interestCents || input.feeCents) fail("Descontos, juros ou tarifas exigem linhas contábeis próprias e não são aceitos neste formulário.");
  if (!validDate(input.date)) fail("Informe uma data válida para o recebimento.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) fail("Informe um valor recebido positivo em centavos inteiros.");
  if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim() || input.idempotencyKey.length > 100) fail("A chave de idempotência do recebimento é obrigatória.");
  if (input.reference != null && (typeof input.reference !== "string" || input.reference.length > 120)) fail("A referência do recebimento deve ter até 120 caracteres.");
  const duplicate = receivable.collections.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (duplicate) {
    if (duplicate.date !== input.date || duplicate.amountCents !== input.amountCents || duplicate.cashAccountId !== input.cashAccountId) fail("A chave de idempotência já foi usada em outro recebimento.", 409);
    return { receivable, collection: duplicate, entry: finance.journalEntries.find((item) => item.id === duplicate.journalEntryId), created: false };
  }
  const cash = getAccountEligibility(finance, input.cashAccountId);
  if (!cash?.postable || !cash.cashEquivalent) fail("Selecione uma conta de caixa ou banco analítica e habilitada.");
  const outstanding = outstandingReceivable(receivable);
  if (input.amountCents > outstanding) fail("O recebimento excede o saldo em aberto.", 409);
  const costCenterAllocations = documentEventCostCenterAllocations(receivable, receivable.collections, input.amountCents);
  const collection = {
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    date: input.date,
    amountCents: input.amountCents,
    cashAccountId: input.cashAccountId,
    costCenterAllocations,
    reference: input.reference?.trim() || "",
    journalEntryId: null,
    createdAt: now,
  };
  const posted = postJournalEntry(finance, {
    postingDate: collection.date,
    period: periodOf(collection.date),
    description: `Recebimento: ${receivable.description}`,
    originModule: "contas-a-receber",
    sourceRecordId: receivable.id,
    sourceEventType: "collection",
    sourceKey: `receivable-collection:${receivable.id}:${collection.idempotencyKey}`,
    idempotencyKey: collection.idempotencyKey,
    lines: [
      { accountId: collection.cashAccountId, debitCents: collection.amountCents, creditCents: 0, costCenterAllocations },
      { accountId: receivable.receivableAccountId, debitCents: 0, creditCents: collection.amountCents, costCenterAllocations: [] },
    ],
  }, { now });
  collection.journalEntryId = posted.entry.id;
  receivable.collections.push(collection);
  receivable.status = outstandingReceivable(receivable) === 0 ? "paid" : "partially_paid";
  receivable.updatedAt = now;
  finance.auditEvents.push({ id: randomUUID(), type: "receivable-collected", recordId: receivable.id, collectionId: collection.id, journalEntryId: posted.entry.id, occurredAt: now });
  return { receivable, collection, entry: posted.entry, created: true };
}

function updateDraftDocument(finance, collectionName, id, input, now = new Date().toISOString()) {
  const kind = collectionName === "payables" ? "payable" : "receivable";
  const record = finance[collectionName].find((item) => item.id === id);
  if (!record) fail("Documento não encontrado.", 404);
  if (record.postingStatus !== DRAFT || record.status !== DRAFT) fail("Somente documentos em rascunho podem ser editados.", 409);
  const partyField = kind === "payable" ? "creditor" : "debtor";
  const effectiveInput = { ...input };
  if (!Object.hasOwn(input, "partyId") && record.partyId) effectiveInput.partyId = record.partyId;
  const validated = validateDocumentBase(finance, effectiveInput, kind, {
    existingPartyId: record.partyId || null,
    existingPartySnapshot: record[partyField],
  });
  const next = kind === "payable" ? {
    creditor: validated.party,
    partyId: validated.partyId,
    description: validated.description,
    expenseAccountId: input.expenseAccountId,
    liabilityAccountId: input.liabilityAccountId,
  } : {
    debtor: validated.party,
    partyId: validated.partyId,
    description: validated.description,
    revenueAccountId: input.revenueAccountId,
    receivableAccountId: input.receivableAccountId,
    recurringIncomeId: input.recurringIncomeId || null,
  };
  Object.assign(record, next, {
    documentNumber: input.documentNumber?.trim() || "",
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    competencePeriod: input.competencePeriod,
    originalAmountCents: input.originalAmountCents,
    costCenterId: validated.costCenterAllocations.length === 1 ? validated.costCenterAllocations[0].costCenterId : null,
    costCenterAllocations: validated.costCenterAllocations,
    notes: input.notes?.trim() || "",
    updatedAt: now,
  });
  return record;
}

function validateFinance(finance) {
  // Additive v3 compatibility: old files gain an in-memory empty collection and
  // are persisted only by the normal atomic mutate path.
  if (finance && typeof finance === "object" && !Object.hasOwn(finance, "parties")) finance.parties = [];
  if (finance && typeof finance === "object" && !Object.hasOwn(finance, "budgets")) finance.budgets = [];
  if (!finance || finance.schemaVersion !== 3 || !Array.isArray(finance.degrees)
    || !Array.isArray(finance.subcategories) || !Array.isArray(finance.planAccounts)
    || !Array.isArray(finance.costCenters) || !Array.isArray(finance.journalEntries)
    || !Array.isArray(finance.payables) || !Array.isArray(finance.receivables) || !Array.isArray(finance.budgets)
    || !Array.isArray(finance.recurringIncome) || !Array.isArray(finance.auditEvents)) {
    fail("Estrutura ou versão do JSON contábil inválida.", 500);
  }
  if (finance.currency !== "BRL") fail("A moeda do razão deve ser BRL.", 500);
  validateParties(finance);
  const degreeIds = new Set(); const degreeNumbers = new Set(); const degreeNames = new Set();
  for (const degree of finance.degrees) {
    if (!degree || typeof degree.id !== "string" || !degree.id || !Number.isSafeInteger(degree.number) || degree.number < 1 || degree.number > 6 || typeof degree.name !== "string" || !degree.name.trim()) fail("Há um grau inválido no plano de contas. Os graus contábeis válidos vão de 1 a 6.", 500);
    const name = normalizeName(degree.name);
    if (degreeIds.has(degree.id) || degreeNumbers.has(degree.number) || degreeNames.has(name)) fail("Há identificador, número ou nome de grau duplicado.", 500);
    degreeIds.add(degree.id); degreeNumbers.add(degree.number); degreeNames.add(name);
  }
  if (degreeNumbers.size !== 6 || [1, 2, 3, 4, 5, 6].some((number) => !degreeNumbers.has(number))) {
    fail("O plano de contas deve conter exatamente os seis graus contábeis de 1 a 6.", 500);
  }
  const subIds = new Set(); const subNumbers = new Set(); const subNames = new Set();
  for (const item of finance.subcategories) {
    if (!item || typeof item.id !== "string" || !item.id || !Number.isSafeInteger(item.number) || item.number <= 0 || typeof item.name !== "string" || !item.name.trim()) fail("Há uma subcategoria inválida.", 500);
    if (subIds.has(item.id)) fail("Há identificador de subcategoria duplicado.", 500);
    subIds.add(item.id);
  }
  for (const item of finance.subcategories) {
    const validParent = item.parentType === "degree" ? degreeIds.has(item.parentId)
      : item.parentType === "subcategory" && subIds.has(item.parentId);
    if (!validParent) fail(`A subcategoria “${item.name}” tem um pai inexistente.`, 500);
    const numberKey = JSON.stringify([item.parentType, item.parentId, item.number]);
    const nameKey = JSON.stringify([item.parentType, item.parentId, normalizeName(item.name)]);
    if (subNumbers.has(numberKey) || subNames.has(nameKey)) fail("Há código ou nome de subcategoria duplicado no mesmo nível.", 500);
    subNumbers.add(numberKey); subNames.add(nameKey);
  }
  for (const item of finance.subcategories) {
    const seen = new Set([item.id]); let parent = item;
    while (parent.parentType === "subcategory") {
      if (seen.has(parent.parentId)) fail("A hierarquia do plano de contas contém ciclo.", 500);
      seen.add(parent.parentId);
      parent = getSubcategory(finance, parent.parentId);
      if (!parent) fail("A hierarquia do plano de contas contém referência inválida.", 500);
    }
  }
  const accountIds = new Set(); const accountNumbers = new Set(); const accountNames = new Set();
  for (const account of finance.planAccounts) {
    if (!account || typeof account.id !== "string" || !account.id || !Number.isSafeInteger(account.number) || account.number <= 0
      || typeof account.name !== "string" || !account.name.trim() || !subIds.has(account.subcategoryId)
      || !["debit", "credit"].includes(account.normalBalance) || typeof account.cashEquivalent !== "boolean" || typeof account.postable !== "boolean") {
      fail("Há uma conta analítica inválida ou sem subcategoria superior.", 500);
    }
    const liquidityClasses = ["current-asset", "long-term-receivable", "other-noncurrent-asset", "current-liability", "long-term-liability"];
    if (typeof account.liquidityClass !== "undefined" && account.liquidityClass !== null && !liquidityClasses.includes(account.liquidityClass)) fail(`A conta “${account.name}” tem classificação de liquidez inválida.`, 500);
    if (account.liquidityClass) {
      const group = getAccountGroup(finance, account.id);
      const assetClass = ["current-asset", "long-term-receivable", "other-noncurrent-asset"].includes(account.liquidityClass);
      const liabilityClass = ["current-liability", "long-term-liability"].includes(account.liquidityClass);
      if ((group === 1 && !assetClass) || (group === 2 && !liabilityClass) || ![1, 2].includes(group)) fail(`A classificação de liquidez da conta “${account.name}” não corresponde ao Ativo ou Passivo.`, 500);
    }
    if (account.cashEquivalent && getAccountGroup(finance, account.id) !== 1) fail(`A conta “${account.name}” está marcada como caixa fora do Ativo.`, 500);
    if (accountIds.has(account.id)) fail("Há identificador de conta duplicado.", 500);
    const numberKey = JSON.stringify([account.subcategoryId, account.number]);
    const nameKey = JSON.stringify([account.subcategoryId, normalizeName(account.name)]);
    if (accountNumbers.has(numberKey) || accountNames.has(nameKey)) fail("Há número ou nome de conta duplicado na mesma subcategoria.", 500);
    accountIds.add(account.id); accountNumbers.add(numberKey); accountNames.add(nameKey);
  }

  const centers = new Set(); const centerCodes = new Set(); const centerNames = new Set();
  for (const center of finance.costCenters) {
    if (!center || typeof center.id !== "string" || !center.id || typeof center.code !== "string" || !center.code.trim()
      || typeof center.name !== "string" || !center.name.trim() || typeof center.active !== "boolean") fail("Há um centro de custo inválido.", 500);
    if (centers.has(center.id) || centerCodes.has(normalizeName(center.code)) || centerNames.has(normalizeName(center.name))) fail("Há identificador, código ou nome de centro de custo duplicado.", 500);
    centers.add(center.id); centerCodes.add(normalizeName(center.code)); centerNames.add(normalizeName(center.name));
  }
  for (const center of finance.costCenters) {
    if (center.parentId && !centers.has(center.parentId)) fail("Um centro de custo tem pai inexistente.", 500);
    const seen = new Set([center.id]); let parent = center;
    while (parent.parentId) {
      if (seen.has(parent.parentId)) fail("A hierarquia de centros de custo contém ciclo.", 500);
      seen.add(parent.parentId); parent = finance.costCenters.find((item) => item.id === parent.parentId);
      if (!parent) fail("A hierarquia de centros de custo tem referência inválida.", 500);
    }
  }

  const entryIds = new Set(); const entryNumbers = new Set(); const sourceKeys = new Set(); const lineIds = new Set();
  for (const entry of finance.journalEntries) {
    if (!entry || typeof entry.id !== "string" || !entry.id || entryIds.has(entry.id) || ![DRAFT, POSTED].includes(entry.status)) fail("Há cabeçalho de diário inválido ou duplicado.", 500);
    entryIds.add(entry.id);
    if (entry.sourceKey && entry.status === POSTED) {
      if (sourceKeys.has(entry.sourceKey)) fail("Há referência de origem contábil duplicada.", 500);
      sourceKeys.add(entry.sourceKey);
    }
    if (entry.status === DRAFT) {
      if (!Array.isArray(entry.lines)) fail("O rascunho contábil tem linhas inválidas.", 500);
      continue;
    }
    if (!Number.isSafeInteger(entry.entryNumber) || entry.entryNumber <= 0 || entryNumbers.has(entry.entryNumber)
      || !validDate(entry.postingDate) || !validPeriod(entry.period) || typeof entry.description !== "string" || !entry.description.trim()
      || typeof entry.originModule !== "string" || !entry.originModule.trim() || typeof entry.createdAt !== "string" || typeof entry.postedAt !== "string") fail("Há um lançamento postado inválido.", 500);
    entryNumbers.add(entry.entryNumber);
    const checked = normalizeJournalLines(finance, entry.lines, { allowInactiveCostCenters: true });
    for (const line of checked.lines) {
      if (lineIds.has(line.id)) fail("Há identificador de linha contábil duplicado.", 500);
      lineIds.add(line.id);
    }
  }
  for (const entry of finance.journalEntries) {
    if (entry.status === POSTED && entry.reversalOfEntryId) {
      const original = finance.journalEntries.find((item) => item.id === entry.reversalOfEntryId && item.status === POSTED);
      if (!original || original.id === entry.id) fail("Um estorno aponta para lançamento inexistente.", 500);
      const reversals = finance.journalEntries.filter((item) => item.reversalOfEntryId === original.id);
      if (reversals.length > 1) fail("Um lançamento tem mais de um estorno.", 500);
      if (entry.lines.length !== original.lines.length) fail("As linhas do estorno não correspondem ao lançamento original.", 500);
      for (let i = 0; i < entry.lines.length; i++) {
        const a = entry.lines[i]; const b = original.lines[i];
        if (a.accountId !== b.accountId || a.debitCents !== b.creditCents || a.creditCents !== b.debitCents
          || JSON.stringify(a.costCenterAllocations || []) !== JSON.stringify(b.costCenterAllocations || [])) fail("As linhas do estorno não invertem o lançamento original.", 500);
      }
    }
  }

  const postedById = new Map(finance.journalEntries.filter((entry) => entry.status === POSTED).map((entry) => [entry.id, entry]));
  validateDocuments(finance, "payables", "payable", postedById);
  validateDocuments(finance, "receivables", "receivable", postedById);
  const partyCreateKeys = new Set();
  for (const event of finance.auditEvents) {
    if (!event || typeof event.id !== "string" || !event.id || typeof event.type !== "string" || typeof event.occurredAt !== "string") fail("Há evento de auditoria inválido.", 500);
    if (["party-created", "party-updated", "party-deactivated", "party-reactivated"].includes(event.type)) {
      if (typeof event.recordId !== "string" || !finance.parties.some((party) => party.id === event.recordId)) fail("Um evento de contraparte aponta para cadastro inexistente.", 500);
    }
    if (event.type === "party-created") {
      if (typeof event.idempotencyKey !== "string" || !PARTY_ID_RE.test(event.idempotencyKey) || partyCreateKeys.has(event.idempotencyKey)) {
        fail("Há chave de idempotência de contraparte inválida ou duplicada.", 500);
      }
      partyCreateKeys.add(event.idempotencyKey);
    }
  }
  budgetPlanning.validateBudgets(finance, { getAccountEligibility });
  return finance;
}

function validateDocuments(finance, collectionName, kind, postedById) {
  const ids = new Set();
  const creationKeys = new Set();
  for (const doc of finance[collectionName]) {
    if (!doc || typeof doc.id !== "string" || !doc.id || ids.has(doc.id) || !Number.isSafeInteger(doc.originalAmountCents) || doc.originalAmountCents <= 0
      || typeof doc.idempotencyKey !== "string" || !doc.idempotencyKey.trim() || creationKeys.has(doc.idempotencyKey)
      || !validDate(doc.issueDate) || !validDate(doc.dueDate) || !validPeriod(doc.competencePeriod)
      || ![DRAFT, "open", "partially_paid", "paid", "cancelled"].includes(doc.status)
      || ![DRAFT, POSTED].includes(doc.postingStatus)) fail(`Há documento inválido em ${collectionName}.`, 500);
    ids.add(doc.id);
    creationKeys.add(doc.idempotencyKey);
    if (doc.partyId !== undefined && doc.partyId !== null) {
      if (typeof doc.partyId !== "string" || !PARTY_ID_RE.test(doc.partyId)
        || !finance.parties.some((party) => party.id === doc.partyId)) {
        fail(`O documento em ${collectionName} aponta para uma contraparte inexistente ou inválida.`, 500);
      }
    }
    const payable = kind === "payable";
    const classification = getAccountEligibility(finance, payable ? doc.expenseAccountId : doc.revenueAccountId);
    const control = getAccountEligibility(finance, payable ? doc.liabilityAccountId : doc.receivableAccountId);
    if (!classification?.postable || (payable ? ![5, 6].includes(classification.groupNumber) : classification.groupNumber !== 4)) fail("Um documento aponta para conta de classificação inválida.", 500);
    if (!control?.postable || (payable ? control.groupNumber !== 2 : control.groupNumber !== 1 || control.cashEquivalent)) fail("Um documento aponta para conta de controle inválida.", 500);
    let documentAllocations = [];
    try {
      documentAllocations = documentCostCenterAllocations(doc);
      if (documentAllocations.length) documentAllocations = validateAllocations(finance, { debitCents: doc.originalAmountCents, creditCents: 0, costCenterAllocations: documentAllocations }, { allowInactiveCostCenters: true });
    } catch (error) { fail(error.message || "Um documento aponta para rateio por centro de custo inválido.", 500); }
    if (doc.costCenterId && (documentAllocations.length !== 1 || documentAllocations[0].costCenterId !== doc.costCenterId || documentAllocations[0].amountCents !== doc.originalAmountCents)) fail("O centro de custo principal do documento não corresponde ao rateio salvo.", 500);
    const recognized = doc.recognitionEntryId ? postedById.get(doc.recognitionEntryId) : null;
    if (doc.postingStatus === POSTED && (!recognized || recognized.sourceRecordId !== doc.id || recognized.sourceEventType !== "recognition"
      || recognized.originModule !== (payable ? "contas-a-pagar" : "contas-a-receber") || recognized.period !== doc.competencePeriod
      || recognized.lines.length !== 2)) fail("O documento reconhecido não referencia seu lançamento contábil.", 500);
    if (doc.postingStatus === POSTED) {
      const debitAccountId = payable ? doc.expenseAccountId : doc.receivableAccountId;
      const creditAccountId = payable ? doc.liabilityAccountId : doc.revenueAccountId;
      const debitLine = recognized.lines.find((line) => line.accountId === debitAccountId && line.debitCents === doc.originalAmountCents && line.creditCents === 0);
      const creditLine = recognized.lines.find((line) => line.accountId === creditAccountId && line.creditCents === doc.originalAmountCents && line.debitCents === 0);
      if (!debitLine || !creditLine) fail("O lançamento de reconhecimento não corresponde ao documento.", 500);
      const classificationLine = payable ? debitLine : creditLine;
      const controlLine = payable ? creditLine : debitLine;
      if (JSON.stringify(classificationLine.costCenterAllocations || []) !== JSON.stringify(documentAllocations)
        || (controlLine.costCenterAllocations || []).length !== 0) fail("A alocação do documento ao centro de custo não corresponde ao reconhecimento.", 500);
    }
    if (doc.postingStatus === DRAFT && (doc.recognitionEntryId || (doc.settlements || doc.collections || []).length)) fail("Um documento em rascunho não pode ter reconhecimento ou liquidação.", 500);
    const records = kind === "payable" ? doc.settlements || [] : doc.collections || [];
    const idem = new Set();
    const recordIds = new Set();
    let settled = 0;
    const activeCenterTotals = new Map();
    for (const record of records) {
      if (!record || typeof record.id !== "string" || !record.id || typeof record.idempotencyKey !== "string" || !record.idempotencyKey
        || idem.has(record.idempotencyKey) || recordIds.has(record.id) || !validDate(record.date) || !Number.isSafeInteger(record.amountCents) || record.amountCents <= 0
        || !getAccountEligibility(finance, record.cashAccountId)?.cashEquivalent) fail("Há pagamento/recebimento inválido no documento.", 500);
      idem.add(record.idempotencyKey); recordIds.add(record.id);
      const entry = postedById.get(record.journalEntryId);
      if (!entry || entry.sourceRecordId !== doc.id || entry.sourceEventType !== (payable ? "settlement" : "collection")
        || entry.originModule !== (payable ? "contas-a-pagar" : "contas-a-receber") || entry.postingDate !== record.date || entry.lines.length !== 2) fail("Uma liquidação não referencia seu lançamento contábil.", 500);
      const debitAccountId = payable ? doc.liabilityAccountId : record.cashAccountId;
      const creditAccountId = payable ? record.cashAccountId : doc.receivableAccountId;
      const debitLine = entry.lines.find((line) => line.accountId === debitAccountId && line.debitCents === record.amountCents && line.creditCents === 0);
      const creditLine = entry.lines.find((line) => line.accountId === creditAccountId && line.creditCents === record.amountCents && line.debitCents === 0);
      if (!debitLine || !creditLine) fail("O pagamento ou recebimento não corresponde à liquidação registrada.", 500);
      if (record.costCenterAllocations != null) {
        if (!Array.isArray(record.costCenterAllocations) || (documentAllocations.length && !record.costCenterAllocations.length)) fail("A liquidação não preserva o rateio do documento por centro de custo.", 500);
        let normalizedRecordAllocations;
        try {
          normalizedRecordAllocations = validateAllocations(finance, { debitCents: record.amountCents, creditCents: 0, costCenterAllocations: record.costCenterAllocations }, { allowInactiveCostCenters: true });
        } catch (error) { fail(error.message || "Há rateio de liquidação inválido.", 500); }
        const cashLine = payable ? creditLine : debitLine;
        const controlLine = payable ? debitLine : creditLine;
        if (JSON.stringify(cashLine.costCenterAllocations || []) !== JSON.stringify(normalizedRecordAllocations)
          || (controlLine.costCenterAllocations || []).length !== 0) fail("O lançamento da liquidação não corresponde ao rateio por centro de custo.", 500);
        for (const allocation of normalizedRecordAllocations) {
          if (!documentAllocations.some((item) => item.costCenterId === allocation.costCenterId)) fail("A liquidação usa centro de custo fora do rateio do documento.", 500);
          if (!record.reversedAt) activeCenterTotals.set(allocation.costCenterId, (activeCenterTotals.get(allocation.costCenterId) || 0) + allocation.amountCents);
        }
      } else if (!record.reversedAt && documentAllocations.length === 1) {
        activeCenterTotals.set(documentAllocations[0].costCenterId, (activeCenterTotals.get(documentAllocations[0].costCenterId) || 0) + record.amountCents);
      }
      if (record.reversedAt || record.reversalEntryId) {
        const reversal = record.reversalEntryId ? postedById.get(record.reversalEntryId) : null;
        if (typeof record.reversedAt !== "string" || !reversal || reversal.reversalOfEntryId !== entry.id) fail("A liquidação marcada como estornada não referencia seu estorno contábil.", 500);
      } else settled += record.amountCents;
    }
    for (const [centerId, amountCents] of activeCenterTotals) {
      const available = documentAllocations.find((item) => item.costCenterId === centerId)?.amountCents || 0;
      if (amountCents > available) fail("O total liquidado excede o valor alocado ao centro de custo no documento.", 500);
      if (settled === doc.originalAmountCents && amountCents !== available) fail("O rateio das liquidações não fecha com o rateio do documento.", 500);
    }
    if (settled === doc.originalAmountCents && documentAllocations.some((item) => (activeCenterTotals.get(item.costCenterId) || 0) !== item.amountCents)) fail("O rateio das liquidações não fecha com o rateio do documento.", 500);
    if (settled > doc.originalAmountCents) fail("O total liquidado excede o valor original do documento.", 500);
    if (doc.status === "paid" && settled !== doc.originalAmountCents) fail("Documento marcado como pago com saldo pendente.", 500);
    if (doc.status === "partially_paid" && (settled <= 0 || settled >= doc.originalAmountCents)) fail("Situação parcial incompatível com o saldo liquidado.", 500);
    if (doc.status === "open" && settled !== 0) fail("Documento em aberto possui liquidação ativa.", 500);
  }
}

function getLedger(finance, filters) {
  const { accountId, fromDate, toDate } = filters;
  const eligibility = getAccountEligibility(finance, accountId);
  if (!eligibility?.postable) fail("Selecione uma conta analítica válida.");
  if (!validDate(fromDate) || !validDate(toDate) || fromDate > toDate) fail("Informe um intervalo de datas válido.");
  const entries = finance.journalEntries.filter((entry) => entry.status === POSTED).sort((a, b) => a.postingDate.localeCompare(b.postingDate) || a.entryNumber - b.entryNumber);
  let opening = 0;
  for (const entry of entries) if (entry.postingDate < fromDate) {
    for (const line of entry.lines) if (line.accountId === accountId) opening += line.debitCents - line.creditCents;
  }
  let running = opening;
  const rows = [];
  for (const entry of entries) {
    if (entry.postingDate < fromDate || entry.postingDate > toDate) continue;
    for (const line of entry.lines) {
      if (line.accountId !== accountId) continue;
      running += line.debitCents - line.creditCents;
      rows.push({
        postingDate: entry.postingDate,
        period: entry.period,
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        description: entry.description,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        runningBalanceCents: running,
        balanceSide: running >= 0 ? "debit" : "credit",
        lineId: line.id,
      });
    }
  }
  return { account: { id: eligibility.account.id, code: eligibility.code, name: eligibility.account.name, normalBalance: eligibility.normalBalance }, fromDate, toDate, openingBalanceCents: opening, rows, closingBalanceCents: running, closingBalanceSide: running >= 0 ? "debit" : "credit" };
}

function getTrialBalance(finance, filters) {
  const { fromPeriod, toPeriod, degreeNumber = null } = filters;
  if (!validPeriod(fromPeriod) || !validPeriod(toPeriod) || fromPeriod > toPeriod) fail("Informe um intervalo de competências válido.");
  const accounts = finance.planAccounts.filter((account) => account.postable && (!degreeNumber || getAccountGroup(finance, account.id) === Number(degreeNumber)));
  const rows = accounts.map((account) => {
    let opening = 0; let debit = 0; let credit = 0;
    for (const entry of finance.journalEntries) {
      if (entry.status !== POSTED) continue;
      for (const line of entry.lines) {
        if (line.accountId !== account.id) continue;
        if (entry.period < fromPeriod) opening += line.debitCents - line.creditCents;
        else if (entry.period <= toPeriod) { debit += line.debitCents; credit += line.creditCents; }
      }
    }
    const closing = opening + debit - credit;
    return {
      accountId: account.id,
      code: getPlanAccountCode(finance, account.id),
      name: account.name,
      degreeNumber: getAccountGroup(finance, account.id),
      normalBalance: account.normalBalance,
      openingDebitCents: Math.max(opening, 0),
      openingCreditCents: Math.max(-opening, 0),
      debitCents: debit,
      creditCents: credit,
      closingDebitCents: Math.max(closing, 0),
      closingCreditCents: Math.max(-closing, 0),
    };
  }).sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
  const total = (key) => sumSafe(rows.map((row) => row[key]));
  const totals = {
    openingDebitCents: total("openingDebitCents"), openingCreditCents: total("openingCreditCents"),
    debitCents: total("debitCents"), creditCents: total("creditCents"),
    closingDebitCents: total("closingDebitCents"), closingCreditCents: total("closingCreditCents"),
  };
  const fullChart = !degreeNumber;
  const completeRows = finance.planAccounts.filter((account) => account.postable).map((account) => {
    let opening = 0; let debit = 0; let credit = 0;
    for (const entry of finance.journalEntries) {
      if (entry.status !== POSTED) continue;
      for (const line of entry.lines) {
        if (line.accountId !== account.id) continue;
        if (entry.period < fromPeriod) opening += line.debitCents - line.creditCents;
        else if (entry.period <= toPeriod) { debit += line.debitCents; credit += line.creditCents; }
      }
    }
    return { openingDebitCents: Math.max(opening, 0), openingCreditCents: Math.max(-opening, 0), debitCents: debit, creditCents: credit, closingDebitCents: Math.max(opening + debit - credit, 0), closingCreditCents: Math.max(-(opening + debit - credit), 0) };
  });
  const completeTotal = (key) => sumSafe(completeRows.map((row) => row[key]));
  return {
    fromPeriod, toPeriod, degreeNumber: degreeNumber ? Number(degreeNumber) : null, rows, totals,
    isBalanced: completeTotal("debitCents") === completeTotal("creditCents") && completeTotal("closingDebitCents") === completeTotal("closingCreditCents"),
    isCompleteChart: fullChart,
    openingDraftPending: finance.journalEntries.some((entry) => entry.status === DRAFT && entry.sourceEventType === "opening-draft"),
  };
}

function balanceSheetTree(finance, degree, contributionByAccount, virtualResult = null) {
  const subcategoriesByParent = new Map();
  for (const item of finance.subcategories) {
    const key = `${item.parentType}:${item.parentId}`;
    const siblings = subcategoriesByParent.get(key) || [];
    siblings.push(item);
    subcategoriesByParent.set(key, siblings);
  }
  const accountsBySubcategory = new Map();
  for (const account of finance.planAccounts.filter((item) => item.postable === true)) {
    const accounts = accountsBySubcategory.get(account.subcategoryId) || [];
    accounts.push(account);
    accountsBySubcategory.set(account.subcategoryId, accounts);
  }
  const sortItems = (items) => items.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  for (const siblings of subcategoriesByParent.values()) sortItems(siblings);
  for (const accounts of accountsBySubcategory.values()) sortItems(accounts);

  const buildSubcategory = (subcategory, depth) => {
    const children = [
      ...(subcategoriesByParent.get(`subcategory:${subcategory.id}`) || []).map((item) => ({ kind: "subcategory", item })),
      ...(accountsBySubcategory.get(subcategory.id) || []).map((item) => ({ kind: "account", item })),
    ].sort((a, b) => a.item.number - b.item.number || (a.kind === b.kind ? a.item.name.localeCompare(b.item.name, "pt-BR", { sensitivity: "base" }) : a.kind === "subcategory" ? -1 : 1));
    const nodes = children.map((child) => child.kind === "subcategory"
      ? buildSubcategory(child.item, depth + 1)
      : {
        kind: "account", id: child.item.id, code: getPlanAccountCode(finance, child.item.id),
        name: child.item.name, depth: depth + 1,
        amountCents: contributionByAccount.get(child.item.id) || 0, children: [],
      });
    return {
      kind: "subcategory", id: subcategory.id, code: getSubcategoryCode(finance, subcategory.id),
      name: subcategory.name, depth,
      amountCents: sumSafe(nodes.map((node) => node.amountCents)), children: nodes,
    };
  };
  const children = (subcategoriesByParent.get(`degree:${degree.id}`) || []).map((item) => buildSubcategory(item, 1));
  if (virtualResult) {
    children.push({
      kind: "virtual-result", id: null, code: null, name: virtualResult.label,
      depth: 1, amountCents: virtualResult.amountCents, children: [],
    });
  }
  return {
    kind: "degree", id: degree.id, code: String(degree.number), name: degree.name,
    depth: 0, amountCents: sumSafe(children.map((node) => node.amountCents)), children,
  };
}

function getBalanceSheet(finance, { asOfDate = null, today = localDateInCuiaba() } = {}) {
  if (!validDate(today)) fail("Informe uma data local válida para calcular a posição patrimonial.");
  const requestedAsOfDate = asOfDate;
  if (asOfDate !== null && !validDate(asOfDate)) fail("Informe uma data-base válida no formato AAAA-MM-DD.");

  const postedEntries = finance.journalEntries.filter((entry) => entry.status === POSTED && validDate(entry.postingDate));
  const latestPostedDate = postedEntries.reduce((latest, entry) => entry.postingDate > latest ? entry.postingDate : latest, today);
  const effectiveDate = asOfDate || latestPostedDate;
  const entries = postedEntries.filter((entry) => entry.postingDate <= effectiveDate)
    .slice().sort((a, b) => a.postingDate.localeCompare(b.postingDate) || (a.entryNumber || 0) - (b.entryNumber || 0) || a.id.localeCompare(b.id));

  const accountById = new Map(finance.planAccounts.map((account) => [account.id, account]));
  const rawBalanceByAccount = new Map();
  const openSinceByAccount = new Map();
  const activePeriodsByAccount = new Map();
  const warnings = [];
  const classificationProblems = new Set();
  const imbalancedEntries = [];
  let ledgerDebitCents = 0;
  let ledgerCreditCents = 0;
  let ledgerSignedBalanceCents = 0;
  let competencyPostingMismatchCount = 0;
  let futureCompetencyCount = 0;
  let notYetPostedCompetencyCount = 0;

  for (const entry of entries) {
    let entryDebitCents = 0;
    let entryCreditCents = 0;
    const accountMovements = new Map();
    for (const line of entry.lines || []) {
      if (!Number.isSafeInteger(line.debitCents) || line.debitCents < 0 || !Number.isSafeInteger(line.creditCents) || line.creditCents < 0) {
        fail("Uma partida possui valores inválidos em centavos e não pode compor o Balanço.", 500);
      }
      entryDebitCents = sumSafe([entryDebitCents, line.debitCents]);
      entryCreditCents = sumSafe([entryCreditCents, line.creditCents]);
      ledgerDebitCents = sumSafe([ledgerDebitCents, line.debitCents]);
      ledgerCreditCents = sumSafe([ledgerCreditCents, line.creditCents]);
      const rawDelta = line.debitCents - line.creditCents;
      accountMovements.set(line.accountId, sumSafe([accountMovements.get(line.accountId) || 0, rawDelta]));
      const account = accountById.get(line.accountId);
      const groupNumber = getAccountGroup(finance, line.accountId);
      if (!account || account.postable !== true || ![1, 2, 3, 4, 5, 6].includes(groupNumber)) classificationProblems.add(String(line.accountId || "(sem conta)"));
      if (validPeriod(entry.period) && entry.period !== entry.postingDate.slice(0, 7)) competencyPostingMismatchCount += 1;
      if (validPeriod(entry.period) && entry.period > effectiveDate.slice(0, 7)) futureCompetencyCount += 1;
    }
    if (entryDebitCents !== entryCreditCents) imbalancedEntries.push(entry.id);
    for (const [accountId, rawDelta] of accountMovements) {
      const previous = rawBalanceByAccount.get(accountId) || 0;
      const next = sumSafe([previous, rawDelta]);
      rawBalanceByAccount.set(accountId, next);
      if ([4, 5, 6].includes(getAccountGroup(finance, accountId))) {
        if (next === 0) {
          openSinceByAccount.delete(accountId);
          activePeriodsByAccount.delete(accountId);
        } else {
          if (previous === 0) openSinceByAccount.set(accountId, entry.postingDate);
          const periods = activePeriodsByAccount.get(accountId) || new Set();
          if (validPeriod(entry.period)) periods.add(entry.period);
          else periods.add(entry.postingDate.slice(0, 7));
          activePeriodsByAccount.set(accountId, periods);
        }
      }
    }
  }

  ledgerSignedBalanceCents = sumSafe([...rawBalanceByAccount.values()]);
  for (const entry of finance.journalEntries) {
    if (entry.status !== POSTED || !validDate(entry.postingDate)) continue;
    const hasResultLine = (entry.lines || []).some((line) => [4, 5, 6].includes(getAccountGroup(finance, line.accountId)));
    if (!hasResultLine) continue;
    if (entry.postingDate > effectiveDate && validPeriod(entry.period) && entry.period <= effectiveDate.slice(0, 7)) notYetPostedCompetencyCount += 1;
  }

  const contributionByAccount = new Map();
  const resultContributions = new Map();
  // Ledger balances are debit minus credit; report contributions reverse the
  // sign for credit-normal headings, including the virtual result in groups 4–6.
  for (const account of finance.planAccounts) {
    if (account.postable !== true) continue;
    const groupNumber = getAccountGroup(finance, account.id);
    const rawBalance = rawBalanceByAccount.get(account.id) || 0;
    if (groupNumber === 1) contributionByAccount.set(account.id, rawBalance);
    else if (groupNumber === 2 || groupNumber === 3 || [4, 5, 6].includes(groupNumber)) {
      contributionByAccount.set(account.id, -rawBalance);
      if ([4, 5, 6].includes(groupNumber)) resultContributions.set(account.id, -rawBalance);
    }
  }

  const totalForGroup = (groupNumber, byAccount) => sumSafe(finance.planAccounts
    .filter((account) => account.postable === true && getAccountGroup(finance, account.id) === groupNumber)
    .map((account) => byAccount.get(account.id) || 0));
  const assetsCents = totalForGroup(1, contributionByAccount);
  const liabilitiesCents = totalForGroup(2, contributionByAccount);
  const postedEquityCents = totalForGroup(3, contributionByAccount);
  const virtualResultCents = sumSafe([4, 5, 6].map((groupNumber) => totalForGroup(groupNumber, resultContributions)));
  const adjustedEquityCents = sumSafe([postedEquityCents, virtualResultCents]);
  const liabilitiesPlusEquityCents = sumSafe([liabilitiesCents, adjustedEquityCents]);
  const differenceCents = assetsCents - liabilitiesPlusEquityCents;
  if (!Number.isSafeInteger(differenceCents)) fail("A diferença patrimonial ultrapassa o limite seguro de centavos.", 500);

  const resultPeriods = new Set();
  const resultStartDates = [];
  const abnormalResultBalances = [];
  for (const account of finance.planAccounts) {
    if (account.postable !== true || ![4, 5, 6].includes(getAccountGroup(finance, account.id))) continue;
    const rawBalance = rawBalanceByAccount.get(account.id) || 0;
    const groupNumber = getAccountGroup(finance, account.id);
    if ((groupNumber === 4 && rawBalance > 0) || ([5, 6].includes(groupNumber) && rawBalance < 0)) abnormalResultBalances.push(account.id);
    if (rawBalance === 0) continue;
    const openSince = openSinceByAccount.get(account.id);
    if (openSince) resultStartDates.push(openSince);
    for (const period of activePeriodsByAccount.get(account.id) || []) resultPeriods.add(period);
  }
  const sortedResultPeriods = [...resultPeriods].sort();
  const resultStartDate = resultStartDates.sort()[0] || null;
  const resultLabel = sortedResultPeriods.length > 1 ? "Resultado não encerrado acumulado" : "Resultado em apuração";
  const virtualResult = {
    amountCents: virtualResultCents,
    label: resultLabel,
    hasUnclosedBalances: sortedResultPeriods.length > 0,
    scope: {
      fromDate: resultStartDate,
      throughDate: effectiveDate,
      periods: sortedResultPeriods,
      periodCount: sortedResultPeriods.length,
      fiscalYears: [...new Set(sortedResultPeriods.map((period) => period.slice(0, 4)))].sort(),
    },
    explanation: sortedResultPeriods.length > 1
      ? `Saldo virtual remanescente em contas dos grupos 4 a 6, acumulado entre ${sortedResultPeriods[0]} e ${sortedResultPeriods.at(-1)}. A cobertura pode atravessar exercícios sem encerramento formal.`
      : sortedResultPeriods.length === 1
        ? "Saldo virtual remanescente em contas dos grupos 4 a 6 na data-base. O valor é apenas uma apresentação para conciliação e não cria lançamentos contábeis."
        : "Não há saldo remanescente em contas dos grupos 4 a 6 até a data-base; nenhuma transferência virtual adicional ao Patrimônio Líquido é apresentada.",
  };

  const degree = (number) => finance.degrees.find((item) => item.number === number) || { id: `missing-degree-${number}`, number, name: `Grau ${number}` };
  const assetTree = balanceSheetTree(finance, degree(1), contributionByAccount);
  const liabilityTree = balanceSheetTree(finance, degree(2), contributionByAccount);
  const equityTree = balanceSheetTree(finance, degree(3), contributionByAccount, virtualResult);
  const latestFutureEntryDate = postedEntries.reduce((latest, entry) => entry.postingDate > today && entry.postingDate > latest ? entry.postingDate : latest, "");

  const openingDraftPending = finance.journalEntries.some((entry) => entry.status === DRAFT && entry.sourceEventType === "opening-draft");
  if (openingDraftPending) warnings.push("Há um rascunho de saldo de abertura pendente. Como não está contabilizado, ele não compõe esta posição.");
  if (classificationProblems.size) warnings.push(`${classificationProblems.size} conta(s) de partidas postadas até a data-base não têm classificação patrimonial válida; a posição pode estar incompleta.`);
  if (imbalancedEntries.length) warnings.push(`${imbalancedEntries.length} partida(s) postada(s) até a data-base têm débitos diferentes de créditos.`);
  if (ledgerSignedBalanceCents !== 0) warnings.push("A soma assinada das contas do razão na data-base é diferente de zero, como deveria ocorrer em um razão equilibrado.");
  if (competencyPostingMismatchCount) warnings.push(`${competencyPostingMismatchCount} linha(s) estão em lançamento cuja competência difere do mês da data de contabilização; a posição segue postingDate, não period.`);
  if (futureCompetencyCount) warnings.push(`${futureCompetencyCount} linha(s) postada(s) até a data-base têm competência posterior ao mês da data-base e foram incluídas pela data de contabilização.`);
  if (notYetPostedCompetencyCount) warnings.push(`${notYetPostedCompetencyCount} lançamento(s) com competência até o mês da data-base têm data de contabilização posterior e foram excluídos deste corte histórico.`);
  if (latestFutureEntryDate && requestedAsOfDate === null) warnings.push(`A data-base inicial considera o lançamento postado mais recente, em ${latestFutureEntryDate}, embora seja posterior à data local de hoje.`);
  if (abnormalResultBalances.length) warnings.push(`${abnormalResultBalances.length} conta(s) dos grupos 4 a 6 têm saldo contrário à natureza habitual do grupo. Os sinais foram preservados no resultado; revise lançamentos e encerramentos.`);
  if (postedEquityCents !== 0 && virtualResult.scope.fiscalYears.some((year) => year < effectiveDate.slice(0, 4))) warnings.push("Há resultado ainda aberto de exercício anterior junto a saldo de Patrimônio Líquido já postado. Verifique eventuais encerramentos parciais; o cálculo considera apenas os saldos remanescentes e não duplica contas de resultado zeradas.");
  if (differenceCents !== 0) warnings.push("A diferença patrimonial não é zero. Nenhuma conta de compensação foi criada; revise integridade e classificação das partidas.");

  return {
    asOfDate: effectiveDate,
    defaultedAsOfDate: requestedAsOfDate === null,
    signConvention: {
      ledger: "debitCents - creditCents",
      assets: "debit balance minus credit balance",
      liabilitiesAndEquity: "credit balance minus debit balance",
      virtualResult: "credit balance minus debit balance for groups 4, 5 and 6",
      difference: "assets - (liabilities + adjusted equity)",
    },
    sections: {
      assets: { groupNumber: 1, label: degree(1).name, totalCents: assetsCents, tree: assetTree },
      liabilities: { groupNumber: 2, label: degree(2).name, totalCents: liabilitiesCents, tree: liabilityTree },
      equity: { groupNumber: 3, label: degree(3).name, totalCents: adjustedEquityCents, tree: equityTree },
    },
    virtualResult,
    totals: {
      assetsCents, liabilitiesCents, postedEquityCents, virtualResultCents,
      adjustedEquityCents, liabilitiesPlusEquityCents, differenceCents,
      ledgerDebitCents, ledgerCreditCents, ledgerSignedBalanceCents,
    },
    isBalanced: differenceCents === 0 && ledgerSignedBalanceCents === 0 && imbalancedEntries.length === 0 && classificationProblems.size === 0,
    openingDraftPending,
    warnings,
  };
}

function buildIncomeStatement(finance, period, amountsByAccount) {
  const definitions = [
    { groupNumber: 4, name: "Receitas" },
    { groupNumber: 5, name: "Custos" },
    { groupNumber: 6, name: "Despesas" },
  ];
  const groups = definitions.map(({ groupNumber, name }) => {
    const rows = finance.planAccounts
      .filter((account) => account.postable && getAccountGroup(finance, account.id) === groupNumber)
      .map((account) => ({
        accountId: account.id,
        code: getPlanAccountCode(finance, account.id),
        name: account.name,
        amountCents: amountsByAccount.get(account.id) || 0,
      }))
      .filter((row) => row.amountCents !== 0)
      .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
    return { groupNumber, name, rows, totalCents: sumSafe(rows.map((row) => row.amountCents)) };
  });
  const revenueTotalCents = groups.find((group) => group.groupNumber === 4).totalCents;
  const costTotalCents = groups.find((group) => group.groupNumber === 5).totalCents;
  const expenseTotalCents = groups.find((group) => group.groupNumber === 6).totalCents;
  const grossResultCents = revenueTotalCents - costTotalCents;
  return {
    period,
    groups,
    totals: {
      revenueTotalCents,
      costTotalCents,
      grossResultCents,
      expenseTotalCents,
      netResultCents: grossResultCents - expenseTotalCents,
    },
  };
}

function amountForCostCenter(amountCents, allocations, costCenterId) {
  if (costCenterId == null) return amountCents;
  if (costCenterId === "sem-centro") return allocations.length ? 0 : amountCents;
  const allocation = allocations.find((item) => item.costCenterId === costCenterId);
  return allocation ? Math.sign(amountCents) * allocation.amountCents : 0;
}

function getIncomeStatement(finance, period, costCenterId = null) {
  if (!validPeriod(period)) fail("Informe o mÃªs da DRE no formato AAAA-MM.");
  if (costCenterId && costCenterId !== "sem-centro" && !finance.costCenters.some((item) => item.id === costCenterId)) fail("Centro de custo inválido para a DRE.", 404);
  const accrualAmounts = new Map();
  const addAmount = (amounts, accountId, amountCents) => amounts.set(accountId, (amounts.get(accountId) || 0) + amountCents);
  for (const entry of finance.journalEntries) {
    if (entry.status !== POSTED || entry.period !== period) continue;
    for (const line of entry.lines) {
      const groupNumber = getAccountGroup(finance, line.accountId);
      if (groupNumber === 4) {
        const amount = line.creditCents - line.debitCents;
        addAmount(accrualAmounts, line.accountId, amountForCostCenter(amount, line.costCenterAllocations || [], costCenterId));
      } else if ([5, 6].includes(groupNumber)) {
        const amount = line.debitCents - line.creditCents;
        addAmount(accrualAmounts, line.accountId, amountForCostCenter(amount, line.costCenterAllocations || [], costCenterId));
      }
    }
  }

  const cashAmounts = new Map();
  const cashReport = getCashFlow(finance, period, { today: `${period}-01` });
  for (const event of cashReport.actualEvents) {
    if (!event.accountId || ![4, 5, 6].includes(event.groupNumber)) continue;
    const amount = event.groupNumber === 4 ? event.amountCents : -event.amountCents;
    const amountCents = amountForCostCenter(amount, event.costCenterAllocations || [], costCenterId);
    addAmount(cashAmounts, event.accountId, amountCents);
  }
  return {
    period,
    cash: buildIncomeStatement(finance, period, cashAmounts),
    accrual: buildIncomeStatement(finance, period, accrualAmounts),
  };
}

function getTAccount(finance, accountId, fromDate, toDate) {
  const ledger = getLedger(finance, { accountId, fromDate, toDate });
  return { account: ledger.account, fromDate, toDate, debit: ledger.rows.filter((row) => row.debitCents > 0), credit: ledger.rows.filter((row) => row.creditCents > 0), openingBalanceCents: ledger.openingBalanceCents, closingBalanceCents: ledger.closingBalanceCents, closingBalanceSide: ledger.closingBalanceSide };
}

function localDateInCuiaba(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function daysInMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function makeCashEvent(finance, entry, amountCents, classificationAccountId, description, costCenterAllocations = []) {
  const groupNumber = classificationAccountId ? getAccountGroup(finance, classificationAccountId) : null;
  return {
    date: entry.postingDate,
    amountCents,
    accountId: [4, 5, 6].includes(groupNumber) ? classificationAccountId : null,
    groupNumber: [4, 5, 6].includes(groupNumber) ? groupNumber : null,
    description,
    entryId: entry.id,
    entryNumber: entry.entryNumber,
    costCenterAllocations,
    kind: "realizado",
  };
}

function eventCostCenterAllocations(document, record) {
  if (Array.isArray(record?.costCenterAllocations) && record.costCenterAllocations.length) return record.costCenterAllocations;
  const allocations = documentCostCenterAllocations(document);
  return allocations.length === 1 ? [{ costCenterId: allocations[0].costCenterId, amountCents: record.amountCents }] : [];
}

function getCashFlow(finance, period, options = {}) {
  if (!validPeriod(period)) fail("Informe o mês do fluxo no formato AAAA-MM.");
  const start = `${period}-01`;
  const end = `${period}-${String(daysInMonth(period)).padStart(2, "0")}`;
  const today = options.today || localDateInCuiaba();
  const actualEvents = [];
  const posted = finance.journalEntries.filter((entry) => entry.status === POSTED).sort((a, b) => a.postingDate.localeCompare(b.postingDate) || a.entryNumber - b.entryNumber);
  let openingCashCents = 0;
  for (const entry of posted) {
    const cashLines = entry.lines.filter((line) => getAccountEligibility(finance, line.accountId)?.cashEquivalent);
    const cashDelta = sumSafe(cashLines.map((line) => line.debitCents - line.creditCents));
    if (entry.postingDate < start) { openingCashCents += cashDelta; continue; }
    if (entry.postingDate > end || cashDelta === 0) continue;
    const payable = entry.originModule === "contas-a-pagar" && entry.sourceEventType === "settlement"
      ? finance.payables.find((item) => item.id === entry.sourceRecordId) : null;
    const receivable = entry.originModule === "contas-a-receber" && entry.sourceEventType === "collection"
      ? finance.receivables.find((item) => item.id === entry.sourceRecordId) : null;
    if (payable) {
      const settlement = payable.settlements.find((item) => item.journalEntryId === entry.id);
      actualEvents.push(makeCashEvent(finance, entry, cashDelta, payable.expenseAccountId, entry.description, eventCostCenterAllocations(payable, settlement)));
      continue;
    }
    if (receivable) {
      const collection = receivable.collections.find((item) => item.journalEntryId === entry.id);
      actualEvents.push(makeCashEvent(finance, entry, cashDelta, receivable.revenueAccountId, entry.description, eventCostCenterAllocations(receivable, collection)));
      continue;
    }
    if (entry.reversalOfEntryId) {
      const reversedEntry = posted.find((item) => item.id === entry.reversalOfEntryId);
      if (reversedEntry?.sourceEventType === "settlement" && reversedEntry.originModule === "contas-a-pagar") {
        const sourceDocument = finance.payables.find((item) => item.id === reversedEntry.sourceRecordId);
        const sourceRecord = sourceDocument?.settlements.find((item) => item.journalEntryId === reversedEntry.id);
        if (sourceDocument && sourceRecord) {
          actualEvents.push(makeCashEvent(finance, entry, cashDelta, sourceDocument.expenseAccountId, entry.description, eventCostCenterAllocations(sourceDocument, sourceRecord)));
          continue;
        }
      } else if (reversedEntry?.sourceEventType === "collection" && reversedEntry.originModule === "contas-a-receber") {
        const sourceDocument = finance.receivables.find((item) => item.id === reversedEntry.sourceRecordId);
        const sourceRecord = sourceDocument?.collections.find((item) => item.journalEntryId === reversedEntry.id);
        if (sourceDocument && sourceRecord) {
          actualEvents.push(makeCashEvent(finance, entry, cashDelta, sourceDocument.revenueAccountId, entry.description, eventCostCenterAllocations(sourceDocument, sourceRecord)));
          continue;
        }
      }
    }
    const nonCashLines = entry.lines.filter((line) => !getAccountEligibility(finance, line.accountId)?.cashEquivalent);
    const classified = nonCashLines.filter((line) => [4, 5, 6].includes(getAccountGroup(finance, line.accountId)));
    const classificationCash = sumSafe(classified.map((line) => line.creditCents - line.debitCents));
    if (classified.length > 0 && classificationCash === cashDelta) {
      for (const line of classified) {
        const amountCents = line.creditCents - line.debitCents;
        if (amountCents !== 0) actualEvents.push(makeCashEvent(finance, entry, amountCents, line.accountId, entry.description, line.costCenterAllocations || []));
      }
    } else actualEvents.push(makeCashEvent(finance, entry, cashDelta, null, entry.description));
  }

  const forecastEvents = [];
  const projectionDate = (dueDate) => dueDate < today ? today : dueDate;
  for (const payable of finance.payables) {
    if (payable.status === "cancelled") continue;
    const outstanding = outstandingPayable(payable);
    if (outstanding <= 0) continue;
    const date = projectionDate(payable.dueDate);
    if (date < start || date > end) continue;
    forecastEvents.push({ date, amountCents: -outstanding, accountId: payable.expenseAccountId, groupNumber: getAccountGroup(finance, payable.expenseAccountId), description: payable.description, sourceId: payable.id, sourceType: payable.postingStatus === POSTED ? "payable" : "draft-payable", costCenterAllocations: documentEventCostCenterAllocations(payable, payable.settlements, outstanding), status: payable.postingStatus === POSTED ? titleStatus(payable, "payable", today) : "rascunho", kind: "previsto" });
  }
  for (const receivable of finance.receivables) {
    if (receivable.status === "cancelled") continue;
    const outstanding = outstandingReceivable(receivable);
    if (outstanding <= 0) continue;
    const date = projectionDate(receivable.dueDate);
    if (date < start || date > end) continue;
    forecastEvents.push({ date, amountCents: outstanding, accountId: receivable.revenueAccountId, groupNumber: 4, description: receivable.description, sourceId: receivable.id, sourceType: receivable.postingStatus === POSTED ? "receivable" : "draft-receivable", costCenterAllocations: documentEventCostCenterAllocations(receivable, receivable.collections, outstanding), status: receivable.postingStatus === POSTED ? titleStatus(receivable, "receivable", today) : "rascunho", kind: "previsto" });
  }
  forecastEvents.push(...budgetPlanning.buildBudgetForecastEvents(finance, { today, fromDate: start, toDate: end })
    .map((event) => ({ ...event, groupNumber: event.accountId ? getAccountGroup(finance, event.accountId) : null })));
  const monthReceivables = finance.receivables.filter((item) => item.recurringIncomeId && item.dueDate.slice(0, 7) === period).map((item) => item.recurringIncomeId);
  for (const recurring of finance.recurringIncome) {
    if (!recurring.active || recurring.frequency !== "mensal" || monthReceivables.includes(recurring.id)) continue;
    const day = Number(recurring.dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth(period)) continue;
    const date = `${period}-${String(day).padStart(2, "0")}`;
    if (date < today) continue;
    const account = finance.planAccounts.find((item) => getAccountGroup(finance, item.id) === 4 && normalizeName(item.name) === normalizeName(recurring.description));
    forecastEvents.push({ date, amountCents: recurring.amountCents, accountId: account?.id || null, groupNumber: account ? 4 : null, description: recurring.description, sourceId: recurring.id, sourceType: "recorrencia", status: "recorrência", kind: "previsto" });
  }

  const dayList = Array.from({ length: daysInMonth(period) }, (_, index) => `${period}-${String(index + 1).padStart(2, "0")}`);
  const allAccounts = finance.planAccounts.filter((account) => [4, 5, 6].includes(getAccountGroup(finance, account.id))).map((account) => ({ id: account.id, code: getPlanAccountCode(finance, account.id), name: account.name, groupNumber: getAccountGroup(finance, account.id) }));
  const groups = [4, 5, 6].map((groupNumber) => ({
    groupNumber,
    name: ({ 4: "Receitas", 5: "Custos", 6: "Despesas" })[groupNumber],
    accounts: allAccounts.filter((account) => account.groupNumber === groupNumber),
  }));
  const openingDraft = finance.journalEntries.find((entry) => entry.status === DRAFT && entry.sourceEventType === "opening-draft") || null;
  const actualBalances = []; const projectedBalances = [];
  let actualBalance = openingCashCents; let projectedBalance = openingCashCents;
  for (const date of dayList) {
    actualBalance += sumSafe(actualEvents.filter((event) => event.date === date).map((event) => event.amountCents));
    projectedBalance += sumSafe(actualEvents.filter((event) => event.date === date).map((event) => event.amountCents));
    projectedBalance += sumSafe(forecastEvents.filter((event) => event.date === date).map((event) => event.amountCents));
    actualBalances.push(actualBalance); projectedBalances.push(projectedBalance);
  }
  return {
    period, days: dayList, openingCashCents, groups, actualEvents, forecastEvents,
    actualBalances, projectedBalances,
    closingActualCents: actualBalance, closingProjectedCents: projectedBalance,
    openingDraftPending: Boolean(openingDraft), openingDraft,
  };
}

function getCostCenterReport(finance, fromPeriod, toPeriod) {
  if (!validPeriod(fromPeriod) || !validPeriod(toPeriod) || fromPeriod > toPeriod) fail("Informe um intervalo de competências válido.");
  const totals = new Map();
  for (const center of finance.costCenters) totals.set(center.id, { costCenterId: center.id, code: center.code, name: center.name, costsCents: 0, expensesCents: 0 });
  totals.set("", { costCenterId: null, code: "", name: "Sem centro de custo", costsCents: 0, expensesCents: 0 });
  for (const entry of finance.journalEntries) {
    if (entry.status !== POSTED || entry.period < fromPeriod || entry.period > toPeriod) continue;
    for (const line of entry.lines) {
      const group = getAccountGroup(finance, line.accountId);
      if (![5, 6].includes(group)) continue;
      const signed = line.debitCents - line.creditCents;
      const allocations = line.costCenterAllocations || [];
      if (!allocations.length) {
        const item = totals.get("");
        if (group === 5) item.costsCents += signed; else item.expensesCents += signed;
      } else {
        for (const allocation of allocations) {
          const item = totals.get(allocation.costCenterId);
          if (item) {
            const signedAllocation = Math.sign(signed) * allocation.amountCents;
            if (group === 5) item.costsCents += signedAllocation; else item.expensesCents += signedAllocation;
          }
        }
      }
    }
  }
  return { fromPeriod, toPeriod, rows: [...totals.values()].filter((item) => item.costsCents !== 0 || item.expensesCents !== 0 || item.costCenterId === null) };
}

module.exports = {
  DRAFT, POSTED, validDate, validPeriod, periodOf, normalizeName, normalizeTaxId, isValidCpf, isValidCnpj,
  getDegree, getSubcategory, getPlanAccount, getSubcategoryCode, getPlanAccountCode,
  getDegreeForSubcategory, getDegreeForAccount, getAccountGroup, getAccountEligibility, accountLabel,
  migrateFinanceV2ToV3, normalizeJournalLines, postJournalEntry, reverseJournalEntry,
  validateCostCenter, validatePartyInput, createParty, updateParty, setPartyActive, validateDocumentBase, validateFinance,
  createPayable, createReceivable, updateDraftDocument, outstandingPayable, outstandingReceivable,
  titleStatus, recognizePayable, settlePayable, recognizeReceivable, collectReceivable,
  getLedger, getTAccount, getTrialBalance, getBalanceSheet, getIncomeStatement, getCashFlow, getCostCenterReport,
};
