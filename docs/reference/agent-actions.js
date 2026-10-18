"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const accounting = require("./accounting");

const DEFAULT_FILE = path.join(__dirname, "data", "agent-actions.json");
const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ACTIONS = 5000;
const MAX_ACTIONS_PER_CONVERSATION = 200;
const MAX_OPTIONS = 500;
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PARTY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set([
  "collecting_missing_fields", "ready_for_review", "confirming",
  "saved_as_draft", "cancelled", "stale",
]);

const BASE_FIELDS = [
  "description", "documentNumber", "issueDate", "dueDate", "competencePeriod",
  "originalAmountCents", "costCenterId", "notes",
];
const KIND_FIELDS = {
  payable: ["creditor", ...BASE_FIELDS, "expenseAccountId", "liabilityAccountId", "partyId"],
  receivable: ["debtor", ...BASE_FIELDS, "revenueAccountId", "receivableAccountId", "partyId"],
};

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(`${label} deve ser um objeto.`);
  }
}

function validateId(value, field) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw httpError(`${field} deve ser um identificador válido.`);
  }
  return value;
}

function normalizeNow(value) {
  const date = value instanceof Date ? value : value == null ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) throw httpError("A data da operação é inválida.");
  return date.toISOString();
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(sortObject(value));
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function normalizeFields(kind, rawFields, { patch = false, existingPartyId = null } = {}) {
  assertObject(rawFields, "fields");
  const allowed = new Set(KIND_FIELDS[kind]);
  if (Object.keys(rawFields).some((key) => !allowed.has(key))) {
    throw httpError("fields contém campos incompatíveis com o tipo da ação.");
  }
  if (Buffer.byteLength(JSON.stringify(rawFields), "utf8") > 8192) {
    throw httpError("Os dados propostos excedem o limite permitido.", 413);
  }

  const linkedPartyId = Object.hasOwn(rawFields, "partyId") ? rawFields.partyId : existingPartyId;
  const partyTextLimit = typeof linkedPartyId === "string" ? 160 : 120;
  const fields = {};
  for (const key of KIND_FIELDS[kind]) {
    if (!Object.hasOwn(rawFields, key)) continue;
    const value = rawFields[key];
    if (value === null && patch) {
      fields[key] = null;
      continue;
    }
    if (value === null || value === undefined) continue;

    if (["originalAmountCents"].includes(key)) {
      if (!Number.isSafeInteger(value)) throw httpError(`${key} deve ser um valor inteiro seguro em centavos.`);
      fields[key] = value;
      continue;
    }
    if (key === "partyId") {
      if (typeof value !== "string" || !PARTY_ID_RE.test(value)) throw httpError("partyId deve ser um UUID válido.");
      fields[key] = value;
      continue;
    }
    if (typeof value !== "string") throw httpError(`${key} deve ser texto.`);
    const limits = {
      creditor: partyTextLimit, debtor: partyTextLimit, description: 160, documentNumber: 80,
      issueDate: 10, dueDate: 10, competencePeriod: 7, costCenterId: 128,
      expenseAccountId: 128, liabilityAccountId: 128, revenueAccountId: 128,
      receivableAccountId: 128, notes: 1000,
    };
    if (value.length > limits[key]) throw httpError(`${key} excede o limite permitido.`);
    fields[key] = ["issueDate", "dueDate", "competencePeriod"].includes(key) ? value.trim() : value.trim();
  }
  return fields;
}

function mergeFields(current, patch) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

function actionCollection(kind) {
  return kind === "payable" ? "payables" : "receivables";
}

function partyField(kind) {
  return kind === "payable" ? "creditor" : "debtor";
}

function requiredFields(kind) {
  return kind === "payable"
    ? ["creditor", "description", "originalAmountCents", "issueDate", "dueDate", "competencePeriod", "expenseAccountId", "liabilityAccountId"]
    : ["debtor", "description", "originalAmountCents", "issueDate", "dueDate", "competencePeriod", "revenueAccountId", "receivableAccountId"];
}

function accountOptions(finance, kind) {
  const classificationGroups = kind === "payable" ? new Set([5, 6]) : new Set([4]);
  const controlGroups = kind === "payable" ? new Set([2]) : new Set([1]);
  const eligible = (account, groups, excludeCash = false) => {
    const entry = accounting.getAccountEligibility(finance, account.id);
    return entry?.postable && groups.has(entry.groupNumber) && !(excludeCash && entry.cashEquivalent);
  };
  const simplify = (account) => ({
    id: account.id,
    code: accounting.getPlanAccountCode(finance, account.id) || String(account.number || ""),
    name: String(account.name || "").slice(0, 160),
    groupNumber: accounting.getAccountGroup(finance, account.id),
  });
  const orderedAccounts = (groups, excludeCash = false) => (finance.planAccounts || [])
    .filter((account) => eligible(account, groups, excludeCash))
    .map(simplify)
    .sort((a, b) => a.code.localeCompare(b.code, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, MAX_OPTIONS);

  return {
    classificationAccounts: orderedAccounts(classificationGroups),
    controlAccounts: orderedAccounts(controlGroups, kind === "receivable"),
    costCenters: (finance.costCenters || [])
      .filter((center) => center.active === true)
      .map((center) => ({
        id: center.id,
        code: String(center.code || "").slice(0, 80),
        name: String(center.name || "").slice(0, 160),
      }))
      .sort((a, b) => a.code.localeCompare(b.code, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, MAX_OPTIONS),
    parties: (finance.parties || [])
      .filter((party) => party.active === true && party.roles?.includes(kind === "payable" ? "supplier" : "customer"))
      .map((party) => ({
        id: party.id,
        name: String(party.name || "").slice(0, 160),
        tradeName: String(party.tradeName || "").slice(0, 160),
        label: party.tradeName && party.tradeName !== party.name ? `${party.name} · ${party.tradeName}` : party.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }))
      .slice(0, MAX_OPTIONS),
  };
}

function validateActionFinance(finance) {
  assertObject(finance, "finance");
  if (!Array.isArray(finance.planAccounts) || !Array.isArray(finance.costCenters)
    || !Array.isArray(finance.payables) || !Array.isArray(finance.receivables)) {
    throw httpError("Os dados financeiros validados não contêm as estruturas de documentos necessárias.", 500);
  }
}

/** Return the same bounded, current eligibility options used by action previews. */
function getActionOptions(input) {
  assertObject(input, "getActionOptions");
  if (!Object.hasOwn(KIND_FIELDS, input.kind)) throw httpError("kind deve ser payable ou receivable.");
  validateActionFinance(input.finance);
  return accountOptions(input.finance, input.kind);
}

function classificationDigest(finance, kind, fields) {
  const ids = kind === "payable"
    ? [fields.expenseAccountId, fields.liabilityAccountId]
    : [fields.revenueAccountId, fields.receivableAccountId];
  const accounts = ids.filter(Boolean).map((id) => {
    const eligibility = accounting.getAccountEligibility(finance, id);
    if (!eligibility) return { id, missing: true };
    return {
      id,
      code: eligibility.code,
      name: eligibility.account.name,
      groupNumber: eligibility.groupNumber,
      postable: eligibility.postable,
      cashEquivalent: eligibility.cashEquivalent,
      normalBalance: eligibility.normalBalance,
    };
  });
  const center = fields.costCenterId
    ? (finance.costCenters || []).find((item) => item.id === fields.costCenterId)
    : null;
  const linkedParty = fields.partyId
    ? (finance.parties || []).find((item) => item.id === fields.partyId)
    : null;
  const party = fields.partyId
    ? linkedParty
      ? { id: linkedParty.id, name: linkedParty.name, active: linkedParty.active === true, roles: linkedParty.roles }
      : { id: fields.partyId, missing: true }
    : null;
  return {
    kind,
    accounts,
    party,
    costCenter: fields.costCenterId ? center
      ? { id: center.id, code: center.code || "", name: center.name || "", active: center.active === true }
      : { id: fields.costCenterId, missing: true }
      : null,
  };
}

function mapDomainError(kind, message) {
  const lower = String(message || "").toLocaleLowerCase("pt-BR");
  let field = "description";
  if (lower.includes("contraparte") || lower.includes("nome do documento")) field = "partyId";
  else if (lower.includes("credor") || lower.includes("fornecedor") || lower.includes("pagador") || lower.includes("devedor")) field = partyField(kind);
  else if (lower.includes("data") || lower.includes("emissão") || lower.includes("vencimento")) field = "issueDate";
  else if (lower.includes("competência")) field = "competencePeriod";
  else if (lower.includes("valor original") || lower.includes("centavos")) field = "originalAmountCents";
  else if (lower.includes("centro de custo") || lower.includes("alocação")) field = "costCenterId";
  else if (lower.includes("passivo")) field = "liabilityAccountId";
  else if (lower.includes("contas a receber") || lower.includes("caixa ou banco")) field = "receivableAccountId";
  else if (lower.includes("receita")) field = "revenueAccountId";
  else if (lower.includes("custos") || lower.includes("despesas")) field = "expenseAccountId";
  return { field, message: String(message || "Os dados não passaram pela validação contábil.").slice(0, 500) };
}

function evaluateProposal(finance, kind, fields) {
  const missingFields = requiredFields(kind).filter((key) => fields[key] === undefined || fields[key] === "");
  const errors = [];
  if (fields.originalAmountCents !== undefined && fields.originalAmountCents <= 0) {
    errors.push({ field: "originalAmountCents", message: "Informe um valor original positivo em centavos inteiros." });
  }
    if (fields.issueDate !== undefined && fields.issueDate !== "" && !accounting.validDate(fields.issueDate)) {
    errors.push({ field: "issueDate", message: "Informe uma data válida de emissão." });
  }
    if (fields.dueDate !== undefined && fields.dueDate !== "" && !accounting.validDate(fields.dueDate)) {
    errors.push({ field: "dueDate", message: "Informe uma data válida de vencimento." });
  }
    if (fields.competencePeriod !== undefined && fields.competencePeriod !== "" && !accounting.validPeriod(fields.competencePeriod)) {
    errors.push({ field: "competencePeriod", message: "Informe a competência no formato AAAA-MM." });
  }
  if (fields.costCenterId !== undefined && fields.costCenterId !== "") {
    const center = (finance.costCenters || []).find((item) => item.id === fields.costCenterId);
    if (!center) errors.push({ field: "costCenterId", message: "O centro de custo informado não existe." });
    else if (center.active !== true) errors.push({ field: "costCenterId", message: "O centro de custo informado está inativo." });
  }

  const options = accountOptions(finance, kind);
  if (fields.partyId !== undefined && fields.partyId !== null
    && !options.parties.some((party) => party.id === fields.partyId)) {
    errors.push({ field: "partyId", message: `Selecione um cadastro ativo com papel ${kind === "payable" ? "fornecedor" : "cliente"}.` });
  }
  const selectedIds = kind === "payable"
    ? [["expenseAccountId", options.classificationAccounts], ["liabilityAccountId", options.controlAccounts]]
    : [["revenueAccountId", options.classificationAccounts], ["receivableAccountId", options.controlAccounts]];
  for (const [field, candidates] of selectedIds) {
    if (fields[field] !== undefined && fields[field] !== "" && !candidates.some((item) => item.id === fields[field])) {
      errors.push({ field, message: "Selecione uma conta analítica elegível entre as opções atuais." });
    }
  }

  if (!missingFields.length && !errors.length) {
    try {
      accounting.validateDocumentBase(finance, fields, kind);
    } catch (error) {
      const mapped = mapDomainError(kind, error.message);
      if (!errors.some((item) => item.field === mapped.field)) errors.push(mapped);
    }
  }

  const ready = missingFields.length === 0 && errors.length === 0;
  const previewDigest = ready ? digest({ fields, classifications: classificationDigest(finance, kind, fields) }) : null;
  return { missingFields, errors, options, ready, previewDigest };
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, actions: [] };
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.includes("T");
}

function validateReceipt(receipt, action) {
  if (receipt == null) return;
  const expectedType = action.kind;
  const expectedHref = expectedType === "payable" ? "#payables" : "#receivables";
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || Object.keys(receipt).some((key) => !["confirmationEventId", "confirmedAt", "operation", "status", "recordType", "recordId", "journalEntryId", "href"].includes(key))
    || receipt.confirmationEventId !== action.confirmation?.eventId
    || !validTimestamp(receipt.confirmedAt)
    || receipt.operation !== "create_draft" || receipt.status !== "saved_as_draft"
    || receipt.recordType !== expectedType || !SAFE_ID.test(receipt.recordId)
    || receipt.journalEntryId !== null || receipt.href !== expectedHref) {
    throw httpError("O arquivo local de ações contém um recibo inválido.", 500);
  }
}

function validateActionStore(store) {
  if (!store || typeof store !== "object" || Array.isArray(store)
    || Object.keys(store).some((key) => !["schemaVersion", "actions"].includes(key))
    || store.schemaVersion !== SCHEMA_VERSION || !Array.isArray(store.actions)
    || store.actions.length > MAX_ACTIONS) {
    throw httpError("O arquivo local de ações está inválido ou corrompido.", 500);
  }
  const ids = new Set();
  const sources = new Set();
  const perConversation = new Map();
  for (const action of store.actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)
      || Object.keys(action).some((key) => !["id", "conversationId", "source", "kind", "fields", "status", "version", "previewDigest", "expiresAt", "confirmation", "receipt", "createdAt", "updatedAt"].includes(key))
      || typeof action.id !== "string" || !SAFE_ID.test(action.id) || ids.has(action.id)
      || typeof action.conversationId !== "string" || !SAFE_ID.test(action.conversationId)
      || !action.source || typeof action.source !== "object" || Array.isArray(action.source)
      || Object.keys(action.source).some((key) => !["conversationId", "userMessageId"].includes(key))
      || action.source.conversationId !== action.conversationId
      || typeof action.source.userMessageId !== "string" || !SAFE_ID.test(action.source.userMessageId)
      || !Object.hasOwn(KIND_FIELDS, action.kind) || !action.fields || typeof action.fields !== "object" || Array.isArray(action.fields)
      || Object.keys(action.fields).some((key) => !KIND_FIELDS[action.kind].includes(key))
      || !STATUSES.has(action.status) || !Number.isSafeInteger(action.version) || action.version < 1
      || (action.previewDigest !== null && (typeof action.previewDigest !== "string" || !/^[a-f0-9]{64}$/.test(action.previewDigest)))
      || (action.expiresAt !== null && !validTimestamp(action.expiresAt))
      || !validTimestamp(action.createdAt) || !validTimestamp(action.updatedAt)) {
      throw httpError("O arquivo local de ações contém uma proposta inválida.", 500);
    }
    ids.add(action.id);
    const sourceKey = `${action.conversationId}\u0000${action.source.userMessageId}`;
    if (sources.has(sourceKey)) throw httpError("O arquivo local de ações contém propostas duplicadas para a mesma mensagem.", 500);
    sources.add(sourceKey);
    const count = (perConversation.get(action.conversationId) || 0) + 1;
    if (count > MAX_ACTIONS_PER_CONVERSATION) throw httpError("O arquivo local de ações excede o limite por conversa.", 500);
    perConversation.set(action.conversationId, count);
    try {
      const normalizedFields = normalizeFields(action.kind, action.fields);
      if (canonical(normalizedFields) !== canonical(action.fields)) throw new Error("noncanonical fields");
    } catch {
      throw httpError("O arquivo local de ações contém campos inválidos.", 500);
    }

    if (action.confirmation != null) {
      const confirmation = action.confirmation;
      if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)
        || Object.keys(confirmation).some((key) => !["eventId", "confirmedAt", "version", "previewDigest"].includes(key))
        || typeof confirmation.eventId !== "string" || !SAFE_ID.test(confirmation.eventId)
        || !validTimestamp(confirmation.confirmedAt) || !Number.isSafeInteger(confirmation.version)
        || confirmation.version < 1 || typeof confirmation.previewDigest !== "string"
        || !/^[a-f0-9]{64}$/.test(confirmation.previewDigest)
        || confirmation.version !== action.version || confirmation.previewDigest !== action.previewDigest) {
        throw httpError("O arquivo local de ações contém uma confirmação inválida.", 500);
      }
    }
    validateReceipt(action.receipt, action);
    if (action.status === "saved_as_draft" && !action.receipt) {
      throw httpError("O arquivo local de ações contém um rascunho sem recibo.", 500);
    }
  }
  return store;
}

function publicAction(action, finance, nowIso) {
  const evaluation = finance ? evaluateProposal(finance, action.kind, action.fields) : {
    missingFields: [],
    errors: [],
    options: { classificationAccounts: [], controlAccounts: [], costCenters: [], parties: [] },
  };
  return {
    id: action.id,
    conversationId: action.conversationId,
    source: { ...action.source },
    kind: action.kind,
    fields: { ...action.fields },
    status: action.status,
    version: action.version,
    missingFields: action.status === "saved_as_draft" || action.status === "cancelled" ? [] : evaluation.missingFields,
    errors: action.status === "saved_as_draft" || action.status === "cancelled" ? [] : evaluation.errors,
    options: evaluation.options,
    expiresAt: action.expiresAt,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
    ...(action.confirmation ? {
      confirmationEventId: action.confirmation.eventId,
      confirmedAt: action.confirmation.confirmedAt,
    } : {}),
    ...(action.receipt ? { receipt: { ...action.receipt } } : {}),
    ...(action.status === "ready_for_review" && action.expiresAt && Date.parse(action.expiresAt) <= Date.parse(nowIso)
      ? { previewExpired: true } : {}),
  };
}

function documentFields(document, kind) {
  return {
    [partyField(kind)]: String(document[partyField(kind)] || "").trim(),
    partyId: document.partyId || null,
    description: String(document.description || "").trim(),
    documentNumber: String(document.documentNumber || "").trim(),
    issueDate: document.issueDate,
    dueDate: document.dueDate,
    competencePeriod: document.competencePeriod,
    originalAmountCents: document.originalAmountCents,
    costCenterId: document.costCenterId || null,
    ...(kind === "payable"
      ? { expenseAccountId: document.expenseAccountId, liabilityAccountId: document.liabilityAccountId }
      : { revenueAccountId: document.revenueAccountId, receivableAccountId: document.receivableAccountId }),
    notes: String(document.notes || "").trim(),
  };
}

function comparableFields(fields, kind) {
  const normalized = {
    [partyField(kind)]: String(fields[partyField(kind)] || "").trim(),
    partyId: fields.partyId || null,
    description: String(fields.description || "").trim(),
    documentNumber: String(fields.documentNumber || "").trim(),
    issueDate: fields.issueDate,
    dueDate: fields.dueDate,
    competencePeriod: fields.competencePeriod,
    originalAmountCents: fields.originalAmountCents,
    costCenterId: fields.costCenterId || null,
    ...(kind === "payable"
      ? { expenseAccountId: fields.expenseAccountId, liabilityAccountId: fields.liabilityAccountId }
      : { revenueAccountId: fields.revenueAccountId, receivableAccountId: fields.receivableAccountId }),
    notes: String(fields.notes || "").trim(),
  };
  return normalized;
}

function findDocument(finance, action, idempotencyKey) {
  return (finance[actionCollection(action.kind)] || []).find((item) => item.idempotencyKey === idempotencyKey) || null;
}

function matchesProposal(document, action) {
  return canonical(documentFields(document, action.kind)) === canonical(comparableFields(action.fields, action.kind));
}

function makeReceipt(action, record) {
  if (!record || typeof record.id !== "string" || !SAFE_ID.test(record.id)) {
    throw httpError("A criação não retornou um identificador de documento válido.", 500);
  }
  return {
    confirmationEventId: action.confirmation.eventId,
    confirmedAt: action.confirmation.confirmedAt,
    operation: "create_draft",
    status: "saved_as_draft",
    recordType: action.kind,
    recordId: record.id,
    journalEntryId: null,
    href: action.kind === "payable" ? "#payables" : "#receivables",
  };
}

function domainIdempotencyKey(action) {
  return `agent-action:${action.id}:v${action.confirmation.version}`;
}

/**
 * Create a JSON-backed proposal service. `mutate` passed to confirmAction must
 * be the server's existing serialized finance transaction (`mutate(finance => …)`).
 * Confirmation only creates an operational draft; it never recognizes or settles it.
 */
function createAgentActions(options = {}) {
  let writeQueue = Promise.resolve();
  const actionLocks = new Map();

  function getFilePath() {
    return path.resolve(options.filePath || process.env.AGENT_ACTIONS_FILE || DEFAULT_FILE);
  }

  function serializeWrite(operation) {
    const next = writeQueue.then(operation, operation);
    writeQueue = next.catch(() => {});
    return next;
  }

  async function readStore() {
    const target = getFilePath();
    let stats;
    try { stats = await fs.stat(target); }
    catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw httpError("Não foi possível ler o arquivo local de ações.", 500);
    }
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
      throw httpError("O arquivo local de ações excede o limite permitido.", 500);
    }
    try { return validateActionStore(JSON.parse(await fs.readFile(target, "utf8"))); }
    catch (error) {
      if (error.statusCode) throw error;
      throw httpError("O arquivo local de ações está inválido ou corrompido.", 500);
    }
  }

  async function writeStore(store) {
    validateActionStore(store);
    const target = getFilePath();
    const serialized = `${JSON.stringify(store, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_BYTES) {
      throw httpError("O arquivo local de ações excederia o limite permitido.", 413);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tempFile = path.join(path.dirname(target), `agent-actions.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(tempFile, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tempFile, target);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(tempFile).catch(() => {});
      throw httpError("Não foi possível gravar o arquivo local de ações.", 500);
    }
  }

  async function mutateStore(operation) {
    return serializeWrite(async () => {
      const store = await readStore();
      const { result, changed = true } = await operation(store);
      if (changed) await writeStore(store);
      return result;
    });
  }

  function findOwned(store, conversationId, actionId) {
    const action = store.actions.find((item) => item.id === actionId && item.conversationId === conversationId);
    if (!action) throw httpError("A proposta não foi encontrada nesta conversa.", 404);
    return action;
  }

  async function withActionLock(actionId, operation) {
    const previous = actionLocks.get(actionId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    actionLocks.set(actionId, current);
    await previous.catch(() => {});
    try { return await operation(); }
    finally {
      release();
      if (actionLocks.get(actionId) === current) actionLocks.delete(actionId);
    }
  }

  function ensureFinance(finance) {
    validateActionFinance(finance);
  }

  function refreshPreview(action, evaluation, nowIso) {
    action.status = evaluation.ready ? "ready_for_review" : "collecting_missing_fields";
    action.previewDigest = evaluation.previewDigest;
    action.expiresAt = evaluation.ready
      ? new Date(Date.parse(nowIso) + PREVIEW_TTL_MS).toISOString()
      : null;
    action.updatedAt = nowIso;
    action.confirmation = null;
    action.receipt = null;
  }

  async function prepareAction(input) {
    assertObject(input, "prepareAction");
    const conversationId = validateId(input.conversationId, "conversationId");
    const userMessageId = validateId(input.userMessageId, "userMessageId");
    if (!Object.hasOwn(KIND_FIELDS, input.kind)) throw httpError("kind deve ser payable ou receivable.");
    ensureFinance(input.finance);
    const nowIso = normalizeNow(input.now);
    const fields = normalizeFields(input.kind, input.fields);
    const evaluation = evaluateProposal(input.finance, input.kind, fields);

    const result = await mutateStore((store) => {
      if (store.actions.length >= MAX_ACTIONS) throw httpError("O limite de propostas armazenadas foi atingido.", 409);
      const count = store.actions.filter((item) => item.conversationId === conversationId).length;
      const duplicate = store.actions.find((item) => item.conversationId === conversationId && item.source.userMessageId === userMessageId);
      if (duplicate) {
        if (duplicate.kind !== input.kind || canonical(duplicate.fields) !== canonical(fields)) {
          throw httpError("Esta mensagem já originou outra proposta. Use a revisão da ação existente.", 409);
        }
        return { result: duplicate, changed: false };
      }
      if (count >= MAX_ACTIONS_PER_CONVERSATION) throw httpError("O limite de propostas desta conversa foi atingido.", 409);
      const action = {
        id: randomUUID(),
        conversationId,
        source: { conversationId, userMessageId },
        kind: input.kind,
        fields,
        status: evaluation.ready ? "ready_for_review" : "collecting_missing_fields",
        version: 1,
        previewDigest: evaluation.previewDigest,
        expiresAt: evaluation.ready ? new Date(Date.parse(nowIso) + PREVIEW_TTL_MS).toISOString() : null,
        confirmation: null,
        receipt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      store.actions.push(action);
      return { result: action };
    });
    return publicAction(result, input.finance, nowIso);
  }

  async function listActions(input) {
    assertObject(input, "listActions");
    const conversationId = validateId(input.conversationId, "conversationId");
    ensureFinance(input.finance);
    const nowIso = normalizeNow(input.now);
    const nowMs = Date.parse(nowIso);
    const actions = await mutateStore((store) => {
      let changed = false;
      const selected = store.actions.filter((item) => item.conversationId === conversationId);
      for (const action of selected) {
        if (action.status === "confirming" && action.confirmation) {
          const key = domainIdempotencyKey(action);
          const existing = findDocument(input.finance, action, key);
          if (existing && matchesProposal(existing, action)) {
            action.receipt = makeReceipt(action, existing);
            action.status = "saved_as_draft";
            action.updatedAt = nowIso;
            changed = true;
            continue;
          }
        }
        if (action.status !== "ready_for_review") continue;
        const evaluation = evaluateProposal(input.finance, action.kind, action.fields);
        if (Date.parse(action.expiresAt || 0) <= nowMs || !evaluation.ready || evaluation.previewDigest !== action.previewDigest) {
          action.status = "stale";
          action.updatedAt = nowIso;
          changed = true;
        }
      }
      return { result: selected, changed };
    });
    return actions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((action) => publicAction(action, input.finance, nowIso));
  }

  async function reviseAction(input) {
    assertObject(input, "reviseAction");
    const conversationId = validateId(input.conversationId, "conversationId");
    const actionId = validateId(input.actionId, "actionId");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw httpError("expectedVersion deve ser um inteiro positivo.");
    ensureFinance(input.finance);
    const nowIso = normalizeNow(input.now);

    const result = await mutateStore((store) => {
      const action = findOwned(store, conversationId, actionId);
      if (action.version !== input.expectedVersion) throw httpError("A versão da proposta mudou; atualize a conversa e revise novamente.", 409);
      if (!["collecting_missing_fields", "ready_for_review", "stale"].includes(action.status)) {
        throw httpError("Esta proposta não pode mais ser revisada.", 409);
      }
      const patch = normalizeFields(action.kind, input.fields, { patch: true, existingPartyId: action.fields.partyId || null });
      if (!Object.keys(patch).length) throw httpError("Informe ao menos um campo para revisar.");
      const fields = mergeFields(action.fields, patch);
      const evaluation = evaluateProposal(input.finance, action.kind, fields);
      if (canonical(fields) === canonical(action.fields) && action.status !== "stale") {
        return { result: action, changed: false };
      }
      action.fields = fields;
      action.version += 1;
      refreshPreview(action, evaluation, nowIso);
      return { result: action };
    });
    return publicAction(result, input.finance, nowIso);
  }

  async function cancelAction(input) {
    assertObject(input, "cancelAction");
    const conversationId = validateId(input.conversationId, "conversationId");
    const actionId = validateId(input.actionId, "actionId");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw httpError("expectedVersion deve ser um inteiro positivo.");
    ensureFinance(input.finance);
    const nowIso = normalizeNow(input.now);
    const result = await mutateStore((store) => {
      const action = findOwned(store, conversationId, actionId);
      if (action.version !== input.expectedVersion) throw httpError("A versão da proposta mudou; atualize a conversa antes de cancelar.", 409);
      if (action.status === "cancelled") return { result: action, changed: false };
      if (!["collecting_missing_fields", "ready_for_review", "stale"].includes(action.status)) {
        throw httpError("Esta ação não pode ser cancelada neste estado.", 409);
      }
      action.status = "cancelled";
      action.version += 1;
      action.previewDigest = null;
      action.expiresAt = null;
      action.confirmation = null;
      action.updatedAt = nowIso;
      return { result: action };
    });
    return publicAction(result, input.finance, nowIso);
  }

  async function persistVerifiedResult(actionSnapshot, record, finance, nowIso) {
    const { conversationId, id: actionId, confirmation } = actionSnapshot;
    let stored;
    try {
      stored = await mutateStore((store) => {
        const action = findOwned(store, conversationId, actionId);
        if (!action.confirmation || action.confirmation.eventId !== confirmation.eventId) {
          throw httpError("A confirmação não corresponde mais à proposta ativa.", 409);
        }
        action.receipt = makeReceipt(action, record);
        action.status = "saved_as_draft";
        action.updatedAt = nowIso;
        return { result: action };
      });
    } catch {
      const fallback = { ...actionSnapshot, status: "saved_as_draft", updatedAt: nowIso };
      // The finance write is verified even if its separate provenance file is unavailable.
      const receipt = {
        confirmationEventId: confirmation.eventId,
        confirmedAt: confirmation.confirmedAt,
        operation: "create_draft",
        status: "saved_as_draft",
        recordType: actionSnapshot.kind,
        recordId: record.id,
        journalEntryId: null,
        href: actionSnapshot.kind === "payable" ? "#payables" : "#receivables",
      };
      fallback.receipt = receipt;
      return { action: publicAction(fallback, finance, nowIso), receipt, traceWarning: true };
    }
    return { action: publicAction(stored, finance, nowIso), receipt: { ...stored.receipt }, traceWarning: false };
  }

  async function confirmAction(input) {
    assertObject(input, "confirmAction");
    const conversationId = validateId(input.conversationId, "conversationId");
    const actionId = validateId(input.actionId, "actionId");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw httpError("expectedVersion deve ser um inteiro positivo.");
    if (typeof input.readFinance !== "function" || typeof input.mutate !== "function") {
      throw httpError("A confirmação exige os leitores e mutadores financeiros do servidor.", 500);
    }

    return withActionLock(actionId, async () => {
      const nowIso = normalizeNow(input.now);
      const initial = await readStore();
      const found = findOwned(initial, conversationId, actionId);
      if (found.version !== input.expectedVersion) throw httpError("A versão da proposta mudou; atualize a conversa antes de confirmar.", 409);
      if (found.status === "saved_as_draft") {
        try {
          const finance = await input.readFinance();
          ensureFinance(finance);
          return { action: publicAction(found, finance, nowIso), receipt: { ...found.receipt }, traceWarning: false };
        } catch {
          // The persisted receipt already proves the earlier successful commit; do not turn a refresh error into a false failure.
          return { action: publicAction(found, null, nowIso), receipt: { ...found.receipt }, traceWarning: true };
        }
      }
      if (!["ready_for_review", "confirming"].includes(found.status)) {
        throw httpError("A proposta não está pronta para confirmação.", 409);
      }

      const currentFinance = await input.readFinance();
      ensureFinance(currentFinance);
      const reservation = await mutateStore((store) => {
        const action = findOwned(store, conversationId, actionId);
        if (action.version !== input.expectedVersion) throw httpError("A versão da proposta mudou; atualize a conversa antes de confirmar.", 409);
        if (action.status === "saved_as_draft") return { result: { action, done: true }, changed: false };
        if (action.confirmation && action.confirmation.version === action.version
          && action.confirmation.previewDigest === action.previewDigest
          && action.status === "confirming") {
          return { result: { action, done: false }, changed: false };
        }
        if (action.status !== "ready_for_review") throw httpError("A proposta não está pronta para confirmação.", 409);
        const evaluation = evaluateProposal(currentFinance, action.kind, action.fields);
        if (Date.parse(action.expiresAt || 0) <= Date.parse(nowIso)
          || !evaluation.ready || evaluation.previewDigest !== action.previewDigest) {
          action.status = "stale";
          action.updatedAt = nowIso;
          return { result: { action, stale: true }, changed: true };
        }
        if (!action.confirmation || action.confirmation.version !== action.version
          || action.confirmation.previewDigest !== action.previewDigest) {
          action.confirmation = {
            eventId: randomUUID(),
            confirmedAt: nowIso,
            version: action.version,
            previewDigest: action.previewDigest,
          };
        }
        action.status = "confirming";
        action.updatedAt = nowIso;
        return { result: { action, done: false } };
      });

      if (reservation.done) {
        return { action: publicAction(reservation.action, currentFinance, nowIso), receipt: { ...reservation.action.receipt }, traceWarning: false };
      }
      if (reservation.stale) {
        throw httpError("A prévia expirou ou os dados de classificação mudaram. Revise a proposta antes de confirmar.", 409);
      }

      const action = reservation.action;
      const key = domainIdempotencyKey(action);
      let record;
      let financeAfter;
      try {
        const mutationResult = await input.mutate((finance) => {
          ensureFinance(finance);
          const existing = findDocument(finance, action, key);
          if (existing) {
            if (!matchesProposal(existing, action)) throw httpError("A chave de idempotência já está vinculada a outro documento.", 409);
            return existing;
          }

          const latest = evaluateProposal(finance, action.kind, action.fields);
          if (!latest.ready || latest.previewDigest !== action.confirmation.previewDigest) {
            throw httpError("A proposta ficou desatualizada antes da gravação. Revise novamente.", 409);
          }
          const documentInput = { ...action.fields, idempotencyKey: key };
          return action.kind === "payable"
            ? accounting.createPayable(finance, documentInput, nowIso)
            : accounting.createReceivable(finance, documentInput, nowIso);
        });
        const returnedRecord = mutationResult && Object.hasOwn(mutationResult, "result")
          ? mutationResult.result : mutationResult;
        // Verify against a fresh validated finance read after the serialized write completed.
        financeAfter = await input.readFinance();
        record = findDocument(financeAfter, action, key);
        if (!record || !matchesProposal(record, action)
          || (returnedRecord?.id && returnedRecord.id !== record.id)) {
          throw httpError("Não foi possível verificar o rascunho criado no arquivo financeiro.", 500);
        }
      } catch (error) {
        // Recover by the same domain idempotency key before reporting a write failure.
        let recovered = null;
        let recoveryFinance = null;
        try {
          recoveryFinance = await input.readFinance();
          recovered = findDocument(recoveryFinance, action, key);
          if (recovered && !matchesProposal(recovered, action)) recovered = null;
        } catch {
          return {
            action: publicAction(action, currentFinance, nowIso),
            receipt: null,
            traceWarning: true,
            outcome: "confirmation_pending_verification",
          };
        }
        if (recovered) {
          record = recovered;
          financeAfter = recoveryFinance;
        } else {
          const statusCode = error.statusCode || 500;
          if (statusCode === 409) {
            await mutateStore((store) => {
              const current = findOwned(store, conversationId, actionId);
              if (current.status === "confirming" && current.confirmation?.eventId === action.confirmation.eventId) {
                current.status = "stale";
                current.updatedAt = normalizeNow(input.now);
              }
              return { result: current };
            }).catch(() => {});
          } else {
            // A retry keeps the same action version, confirmation event, and idempotency key.
            await mutateStore((store) => {
              const current = findOwned(store, conversationId, actionId);
              if (current.status === "confirming" && current.confirmation?.eventId === action.confirmation.eventId) {
                current.status = "ready_for_review";
                current.updatedAt = normalizeNow(input.now);
              }
              return { result: current };
            }).catch(() => {});
          }
          throw error;
        }
      }

      const verified = await persistVerifiedResult(action, record, financeAfter, normalizeNow(input.now));
      return { action: verified.action, receipt: verified.receipt, traceWarning: verified.traceWarning };
    });
  }

  return { getActionOptions, prepareAction, listActions, reviseAction, cancelAction, confirmAction };
}

const defaultService = createAgentActions();

module.exports = {
  DEFAULT_FILE,
  PREVIEW_TTL_MS,
  STATUSES,
  createAgentActions,
  getActionOptions: (...args) => defaultService.getActionOptions(...args),
  prepareAction: (...args) => defaultService.prepareAction(...args),
  listActions: (...args) => defaultService.listActions(...args),
  reviseAction: (...args) => defaultService.reviseAction(...args),
  cancelAction: (...args) => defaultService.cancelAction(...args),
  confirmAction: (...args) => defaultService.confirmAction(...args),
};
