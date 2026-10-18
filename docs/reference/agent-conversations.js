"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DEFAULT_FILE = path.join(__dirname, "data", "agent-conversations.json");
const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES_PER_CONVERSATION = 500;
const MAX_TITLE_CHARS = 120;
const MAX_USER_MESSAGE_CHARS = 4000;
const MAX_ASSISTANT_MESSAGE_CHARS = 8000;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 30;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_CHARS = 2000;
const RESPONSE_LEVELS = new Set(["iniciante", "intermediario", "avancado"]);
const SOURCE_CODES = new Set(["dashboard", "financial-analysis", "cash-flow", "payables", "receivables", "income-statement", "trial-balance", "ledger"]);
const SOURCE_REFERENCE_TYPES = new Set(["payable", "receivable", "account", "journalEntry"]);
const SAFE_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

let writeQueue = Promise.resolve();
const roomQueues = new Map();

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function filePath() {
  const configured = process.env.AGENT_CONVERSATIONS_FILE;
  return path.resolve(configured || DEFAULT_FILE);
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, conversations: [], messages: [] };
}

function isTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.includes("T");
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeResponseLevel(value, statusCode = 400) {
  if (value === undefined) return "intermediario";
  if (!RESPONSE_LEVELS.has(value)) {
    throw httpError("responseLevel deve ser iniciante, intermediario ou avancado.", statusCode);
  }
  return value;
}

function normalizeSource(source) {
  const sourceKeys = ["code", "period", "fromDate", "toDate", "referenceIds"];
  if (!source || typeof source !== "object" || Array.isArray(source)
    || Object.keys(source).some((key) => !sourceKeys.includes(key))
    || sourceKeys.some((key) => !Object.hasOwn(source, key))
    || !SOURCE_CODES.has(source.code)
    || (source.period !== null && (typeof source.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(source.period)))
    || (source.fromDate !== null && !validDate(source.fromDate))
    || (source.toDate !== null && !validDate(source.toDate))
    || !Array.isArray(source.referenceIds) || source.referenceIds.length > 12) {
    throw httpError("Uma fonte da resposta do agente e invalida.", 502);
  }

  const referenceIds = source.referenceIds.map((reference) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)
      || Object.keys(reference).some((key) => !["type", "id"].includes(key))
      || Object.keys(reference).length !== 2
      || !SOURCE_REFERENCE_TYPES.has(reference.type)
      || typeof reference.id !== "string" || !SAFE_SOURCE_ID.test(reference.id)) {
      throw httpError("Uma referencia da resposta do agente e invalida.", 502);
    }
    return { type: reference.type, id: reference.id };
  });
  return {
    code: source.code,
    period: source.period,
    fromDate: source.fromDate,
    toDate: source.toDate,
    referenceIds,
  };
}

function normalizeResponseMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["referenceDate", "selection", "limitations", "responseLevel", "sources", "whatIfScenario"].includes(key))
    || !validDate(input.referenceDate)
    || !Array.isArray(input.limitations)
    || input.limitations.some((item) => typeof item !== "string")
    || (input.sources !== undefined && (!Array.isArray(input.sources) || input.sources.length > 8))) {
    throw httpError("Os metadados da resposta do agente sao invalidos.", 502);
  }
  const raw = input.selection;
  const selectionKeys = ["topic", "timeWindow", "period", "fromDate", "toDate", "horizonDays", "comparison", "accountIds", "costCenterId"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || Object.keys(raw).some((key) => !selectionKeys.includes(key))
    || typeof raw.topic !== "string" || raw.topic.length > 60
    || typeof raw.timeWindow !== "string" || raw.timeWindow.length > 40
    || (raw.period != null && (typeof raw.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.period)))
    || !validDate(raw.fromDate) || !validDate(raw.toDate)
    || !Number.isSafeInteger(raw.horizonDays) || raw.horizonDays < 1 || raw.horizonDays > 90
    || typeof raw.comparison !== "boolean"
    || !Array.isArray(raw.accountIds)
    || raw.accountIds.some((id) => typeof id !== "string" || !id || id.length > 128)
    || (raw.costCenterId != null && (typeof raw.costCenterId !== "string" || raw.costCenterId.length > 128))) {
    throw httpError("Os metadados de selecao do agente sao invalidos.", 502);
  }
  const result = {
    referenceDate: input.referenceDate,
    selection: {
      topic: raw.topic,
      timeWindow: raw.timeWindow,
      period: raw.period || null,
      fromDate: raw.fromDate,
      toDate: raw.toDate,
      horizonDays: raw.horizonDays,
      comparison: raw.comparison,
      accountIds: raw.accountIds.slice(0, 20),
      costCenterId: raw.costCenterId || null,
    },
    limitations: input.limitations.slice(0, 40).map((item) => item.slice(0, 500)),
    responseLevel: normalizeResponseLevel(input.responseLevel, 502),
    sources: (input.sources || []).map(normalizeSource),
  };
  if (input.whatIfScenario !== undefined) result.whatIfScenario = normalizeWhatIfScenario(input.whatIfScenario);
  return result;
}

function normalizeWhatIfScenario(input) {
  const topLevelKeys = ["hypothetical", "status", "referenceDate", "timeZone", "fromDate", "toDate", "horizonDays", "scenario", "baseline", "simulation", "assumptions", "limitations"];
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !topLevelKeys.includes(key))
    || input.hypothetical !== true
    || !["complete", "unavailable"].includes(input.status)
    || !validDate(input.referenceDate) || input.timeZone !== "America/Cuiaba"
    || !validDate(input.fromDate) || input.fromDate !== input.referenceDate
    || !validDate(input.toDate)
    || !Number.isSafeInteger(input.horizonDays) || input.horizonDays < 1 || input.horizonDays > 30
    || !Array.isArray(input.assumptions) || input.assumptions.length > 8
    || input.assumptions.some((item) => typeof item !== "string" || item.length > 500)
    || !Array.isArray(input.limitations) || input.limitations.length > 8
    || input.limitations.some((item) => typeof item !== "string" || item.length > 500)) {
    throw httpError("Os metadados da simulacao hipotetica sao invalidos.", 502);
  }
  const scenario = input.scenario;
  const scenarioKeys = ["type", "date", "amountCents", "source"];
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)
    || Object.keys(scenario).some((key) => !scenarioKeys.includes(key))
    || !["purchase", "payment", "settle_payable", "collect_receivable"].includes(scenario.type)
    || !validDate(scenario.date) || scenario.date < input.referenceDate || scenario.date > input.toDate
    || (scenario.amountCents !== null && (!Number.isSafeInteger(scenario.amountCents) || scenario.amountCents <= 0))) {
    throw httpError("Os dados da simulacao hipotetica sao invalidos.", 502);
  }
  const expectsSource = ["settle_payable", "collect_receivable"].includes(scenario.type);
  if ((expectsSource && (!scenario.source || typeof scenario.source !== "object" || Array.isArray(scenario.source)))
    || (!expectsSource && scenario.source !== null)) {
    throw httpError("A origem da simulacao hipotetica e invalida.", 502);
  }
  let source = null;
  if (scenario.source) {
    const sourceKeys = ["entityType", "entityId", "dueDate", "baselineDate", "outstandingCents"];
    if (Object.keys(scenario.source).some((key) => !sourceKeys.includes(key))
      || scenario.source.entityType !== (scenario.type === "settle_payable" ? "payable" : "receivable")
      || typeof scenario.source.entityId !== "string" || !scenario.source.entityId || scenario.source.entityId.length > 200
      || (scenario.source.dueDate != null && !validDate(scenario.source.dueDate))
      || (scenario.source.baselineDate != null && !validDate(scenario.source.baselineDate))
      || (scenario.source.outstandingCents != null && (!Number.isSafeInteger(scenario.source.outstandingCents) || scenario.source.outstandingCents <= 0))) {
      throw httpError("A origem da simulacao hipotetica e invalida.", 502);
    }
    source = {
      entityType: scenario.source.entityType,
      entityId: scenario.source.entityId,
      ...(scenario.source.dueDate ? { dueDate: scenario.source.dueDate } : {}),
      ...(scenario.source.baselineDate ? { baselineDate: scenario.source.baselineDate } : {}),
      ...(scenario.source.outstandingCents != null ? { outstandingCents: scenario.source.outstandingCents } : {}),
    };
  }
  const normalizeCurve = (curve) => {
    if (curve === null) return null;
    const keys = ["openingCents", "currentCents", "closingCents", "minimumCents", "minimumDate", "firstNegativeDate", "firstNegativeCents"];
    if (!curve || typeof curve !== "object" || Array.isArray(curve)
      || Object.keys(curve).some((key) => !keys.includes(key))
      || !["openingCents", "currentCents", "closingCents", "minimumCents"].every((key) => Number.isSafeInteger(curve[key]))
      || !validDate(curve.minimumDate)
      || (curve.firstNegativeDate !== null && !validDate(curve.firstNegativeDate))
      || (curve.firstNegativeCents !== null && !Number.isSafeInteger(curve.firstNegativeCents))) {
      throw httpError("A curva da simulacao hipotetica e invalida.", 502);
    }
    return {
      openingCents: curve.openingCents,
      currentCents: curve.currentCents,
      closingCents: curve.closingCents,
      minimumCents: curve.minimumCents,
      minimumDate: curve.minimumDate,
      firstNegativeDate: curve.firstNegativeDate,
      firstNegativeCents: curve.firstNegativeCents,
    };
  };
  const baseline = normalizeCurve(input.baseline);
  const simulation = normalizeCurve(input.simulation);
  if ((input.status === "complete" && (!baseline || !simulation))
    || (input.status === "unavailable" && (baseline || simulation))) {
    throw httpError("O estado da simulacao hipotetica nao corresponde as curvas retornadas.", 502);
  }
  const normalized = {
    hypothetical: true,
    status: input.status,
    referenceDate: input.referenceDate,
    timeZone: input.timeZone,
    fromDate: input.fromDate,
    toDate: input.toDate,
    horizonDays: input.horizonDays,
    scenario: {
      type: scenario.type,
      date: scenario.date,
      amountCents: scenario.amountCents,
      source,
    },
    baseline,
    simulation,
    assumptions: input.assumptions.slice(),
    limitations: input.limitations.slice(),
  };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > 16 * 1024) {
    throw httpError("Os metadados da simulacao hipotetica excedem o limite permitido.", 502);
  }
  return normalized;
}
function validateStore(store) {
  if (!store || typeof store !== "object" || Array.isArray(store)
    || Object.keys(store).some((key) => !["schemaVersion", "conversations", "messages"].includes(key))
    || store.schemaVersion !== SCHEMA_VERSION
    || !Array.isArray(store.conversations) || !Array.isArray(store.messages)) {
    throw httpError("O arquivo local de conversas está inválido ou corrompido.", 500);
  }
  if (store.conversations.length > MAX_CONVERSATIONS) {
    throw httpError("O arquivo local de conversas excede o limite suportado.", 500);
  }

  const conversationsById = new Map();
  const createRequestIds = new Set();
  for (const conversation of store.conversations) {
    if (!conversation || typeof conversation !== "object" || Array.isArray(conversation)
      || Object.keys(conversation).some((key) => !["id", "title", "createdAt", "updatedAt", "lastMessageAt", "createRequestId", "nextSequence"].includes(key))
      || typeof conversation.id !== "string" || !conversation.id
      || typeof conversation.title !== "string" || !conversation.title.trim() || conversation.title.length > MAX_TITLE_CHARS
      || !isTimestamp(conversation.createdAt) || !isTimestamp(conversation.updatedAt) || !isTimestamp(conversation.lastMessageAt)
      || typeof conversation.createRequestId !== "string" || !conversation.createRequestId
      || !Number.isSafeInteger(conversation.nextSequence) || conversation.nextSequence < 1
      || conversationsById.has(conversation.id) || createRequestIds.has(conversation.createRequestId)) {
      throw httpError("O arquivo local de conversas contém uma sala inválida.", 500);
    }
    conversationsById.set(conversation.id, conversation);
    createRequestIds.add(conversation.createRequestId);
  }

  const messageIds = new Set();
  const messagesByRoom = new Map();
  const clientIdsByRoom = new Map();
  const replyCounts = new Map();
  for (const message of store.messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)
      || Object.keys(message).some((key) => !["id", "conversationId", "sequence", "clientMessageId", "replyToMessageId", "role", "content", "status", "createdAt", "responseMetadata", "responseLevel"].includes(key))
      || typeof message.id !== "string" || !message.id || messageIds.has(message.id)
      || typeof message.conversationId !== "string" || !conversationsById.has(message.conversationId)
      || !Number.isSafeInteger(message.sequence) || message.sequence < 1
      || typeof message.content !== "string" || !isTimestamp(message.createdAt)
      || !["user", "assistant"].includes(message.role)
      || !["pending", "completed"].includes(message.status)) {
      throw httpError("O arquivo local de conversas contém uma mensagem inválida.", 500);
    }
    messageIds.add(message.id);
    const roomMessages = messagesByRoom.get(message.conversationId) || [];
    roomMessages.push(message);
    messagesByRoom.set(message.conversationId, roomMessages);

    if (message.role === "user") {
      if (typeof message.clientMessageId !== "string" || !message.clientMessageId
        || message.clientMessageId.length > 128 || message.replyToMessageId !== null
        || message.content.length > MAX_USER_MESSAGE_CHARS || Object.hasOwn(message, "responseMetadata")
        || (message.responseLevel !== undefined && !RESPONSE_LEVELS.has(message.responseLevel))) {
        throw httpError("O arquivo local de conversas contém uma mensagem de usuário inválida.", 500);
      }
      const roomClientIds = clientIdsByRoom.get(message.conversationId) || new Set();
      if (roomClientIds.has(message.clientMessageId)) throw httpError("O arquivo local de conversas contém uma chave de mensagem duplicada.", 500);
      roomClientIds.add(message.clientMessageId);
      clientIdsByRoom.set(message.conversationId, roomClientIds);
    } else if (message.clientMessageId !== null || typeof message.replyToMessageId !== "string"
      || message.content.length > MAX_ASSISTANT_MESSAGE_CHARS || message.status !== "completed"
      || Object.hasOwn(message, "responseLevel") || !Object.hasOwn(message, "responseMetadata")) {
      throw httpError("O arquivo local de conversas contém uma resposta inválida.", 500);
    }
    if (message.role === "assistant") {
      try { normalizeResponseMetadata(message.responseMetadata); }
      catch { throw httpError("O arquivo local de conversas contém metadados inválidos.", 500); }
      const key = `${message.conversationId}\u0000${message.replyToMessageId}`;
      if (replyCounts.has(key)) throw httpError("O arquivo local de conversas contém respostas duplicadas.", 500);
      replyCounts.set(key, message.id);
    }
  }

  for (const [conversationId, conversation] of conversationsById) {
    const roomMessages = (messagesByRoom.get(conversationId) || []).sort((a, b) => a.sequence - b.sequence);
    if (roomMessages.length > MAX_MESSAGES_PER_CONVERSATION) {
      throw httpError("O arquivo local de conversas excede o limite de mensagens por sala.", 500);
    }
    let highestSequence = 0;
    const roomMessageIds = new Map(roomMessages.map((message) => [message.id, message]));
    const sequences = new Set();
    for (const message of roomMessages) {
      if (sequences.has(message.sequence)) throw httpError("O arquivo local de conversas contém uma sequência duplicada.", 500);
      sequences.add(message.sequence);
      highestSequence = Math.max(highestSequence, message.sequence);
      if (message.role === "assistant") {
        const parent = roomMessageIds.get(message.replyToMessageId);
        if (!parent || parent.role !== "user" || parent.status !== "completed") {
          throw httpError("O arquivo local de conversas contém uma resposta sem pergunta correspondente.", 500);
        }
      } else {
        const key = `${conversationId}\u0000${message.id}`;
        const hasAssistant = replyCounts.has(key);
        if ((message.status === "completed") !== hasAssistant) {
          throw httpError("O arquivo local de conversas contém um turno incompleto inválido.", 500);
        }
      }
    }
    if (conversation.nextSequence <= highestSequence) throw httpError("O arquivo local de conversas contém uma sequência inválida.", 500);
  }
  return store;
}

async function readStore() {
  const target = filePath();
  let stats;
  try { stats = await fs.stat(target); }
  catch (error) {
    if (error.code === "ENOENT") return emptyStore();
    throw httpError("Não foi possível ler o arquivo local de conversas.", 500);
  }
  if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
    throw httpError("O arquivo local de conversas está indisponível ou excede o limite permitido.", 500);
  }
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(target, "utf8")); }
  catch { throw httpError("O arquivo local de conversas está inválido ou corrompido.", 500); }
  return validateStore(parsed);
}

async function writeStore(store) {
  validateStore(store);
  const target = filePath();
  const serialized = `${JSON.stringify(store, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_BYTES) {
    throw httpError("O arquivo de conversas atingiria o limite de 16 MiB.", 413);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tempFile = path.join(path.dirname(target), `agent-conversations.${randomUUID()}.tmp`);
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
    throw httpError("Não foi possível gravar o arquivo local de conversas.", 500);
  }
}

function serializeWrite(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => {});
  return next;
}

async function mutateStore(operation) {
  return serializeWrite(async () => {
    const store = await readStore();
    const { result, changed = true } = await operation(store);
    if (changed) await writeStore(store);
    return result;
  });
}

function publicConversation(store, conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt,
    messageCount: store.messages.filter((message) => message.conversationId === conversation.id).length,
  };
}

function publicMessage(message) {
  const result = {
    id: message.id,
    conversationId: message.conversationId,
    sequence: message.sequence,
    clientMessageId: message.clientMessageId,
    replyToMessageId: message.replyToMessageId,
    role: message.role,
    content: message.content,
    status: message.status,
    createdAt: message.createdAt,
  };
  if (message.role === "user") result.responseLevel = normalizeResponseLevel(message.responseLevel);
  if (message.role === "assistant") result.responseMetadata = normalizeResponseMetadata(message.responseMetadata);
  return result;
}

function normalizeLimit(value, fallback, maximum) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw httpError(`O limite deve ser um inteiro entre 1 e ${maximum}.`);
  }
  return number;
}

function validateCreateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["clientRequestId", "title"].includes(key))) {
    throw httpError("A solicitação aceita somente clientRequestId e title.");
  }
  if (typeof input.clientRequestId !== "string" || !input.clientRequestId.trim() || input.clientRequestId.length > 128) {
    throw httpError("Informe um clientRequestId válido de até 128 caracteres.");
  }
  let title = "Nova conversa";
  if (input.title !== undefined) {
    if (typeof input.title !== "string") throw httpError("O título da conversa deve ser texto.");
    title = input.title.trim();
    if (!title || title.length > MAX_TITLE_CHARS) throw httpError(`O título deve conter de 1 a ${MAX_TITLE_CHARS} caracteres.`);
  }
  return { clientRequestId: input.clientRequestId.trim(), title };
}

function validateMessageInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["clientMessageId", "content", "responseLevel"].includes(key))) {
    throw httpError("A solicitação aceita somente clientMessageId, content e responseLevel.");
  }
  const clientMessageId = typeof input.clientMessageId === "string" ? input.clientMessageId.trim() : "";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!clientMessageId || clientMessageId.length > 128) throw httpError("Informe um clientMessageId válido de até 128 caracteres.");
  if (!content || content.length > MAX_USER_MESSAGE_CHARS) throw httpError(`A mensagem deve conter de 1 a ${MAX_USER_MESSAGE_CHARS} caracteres.`);
  return { clientMessageId, content, responseLevel: normalizeResponseLevel(input.responseLevel) };
}

async function listConversations(limitValue) {
  const limit = normalizeLimit(limitValue, MAX_CONVERSATIONS, MAX_CONVERSATIONS);
  const store = await readStore();
  const conversations = [...store.conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((conversation) => publicConversation(store, conversation));
  return { conversations };
}

async function createConversation(input) {
  const { clientRequestId, title } = validateCreateInput(input);
  return mutateStore((store) => {
    const existing = store.conversations.find((conversation) => conversation.createRequestId === clientRequestId);
    if (existing) {
      if (existing.title !== title) throw httpError("O clientRequestId já foi usado para outro conteúdo.", 409);
      return { result: { conversation: publicConversation(store, existing), created: false }, changed: false };
    }
    if (store.conversations.length >= MAX_CONVERSATIONS) throw httpError("O limite de 100 conversas foi atingido.", 409);
    const now = new Date().toISOString();
    const conversation = {
      id: randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      createRequestId: clientRequestId,
      nextSequence: 1,
    };
    store.conversations.push(conversation);
    return { result: { conversation: publicConversation(store, conversation), created: true } };
  });
}

async function getConversation(conversationId, limitValue, beforeSequenceValue) {
  const limit = normalizeLimit(limitValue, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  let beforeSequence = null;
  if (beforeSequenceValue != null && beforeSequenceValue !== "") {
    beforeSequence = Number(beforeSequenceValue);
    if (!Number.isSafeInteger(beforeSequence) || beforeSequence < 1) throw httpError("beforeSequence deve ser um inteiro positivo.");
  }
  const store = await readStore();
  const conversation = store.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw httpError("Conversa não encontrada.", 404);
  const filtered = store.messages
    .filter((message) => message.conversationId === conversationId && (beforeSequence === null || message.sequence < beforeSequence))
    .sort((a, b) => b.sequence - a.sequence);
  const selected = filtered.slice(0, limit);
  const hasMore = filtered.length > selected.length;
  const messages = selected.reverse().map(publicMessage);
  return {
    conversation: publicConversation(store, conversation),
    messages,
    hasMore,
    nextBeforeSequence: hasMore && messages.length ? messages[0].sequence : null,
  };
}

function validateTurnInput({ conversationId, clientMessageId, content, responseLevel, generateResponse }) {
  if (typeof conversationId !== "string" || !conversationId) throw httpError("Conversa não encontrada.", 404);
  if (typeof clientMessageId !== "string" || !clientMessageId.trim() || clientMessageId.length > 128) {
    throw httpError("Informe um clientMessageId válido de até 128 caracteres.");
  }
  if (typeof content !== "string" || !content.trim() || content.trim().length > MAX_USER_MESSAGE_CHARS) {
    throw httpError(`A mensagem deve conter de 1 a ${MAX_USER_MESSAGE_CHARS} caracteres.`);
  }
  normalizeResponseLevel(responseLevel);
  if (typeof generateResponse !== "function") throw new TypeError("generateResponse must be a function");
}

function historyBefore(store, conversationId, sequence) {
  return store.messages
    .filter((message) => message.conversationId === conversationId && message.sequence < sequence && message.status === "completed")
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({ role: message.role, content: message.content.slice(0, MAX_HISTORY_MESSAGE_CHARS) }));
}

async function prepareUserMessage({ conversationId, clientMessageId, content, responseLevel }) {
  return mutateStore((store) => {
    const conversation = store.conversations.find((item) => item.id === conversationId);
    if (!conversation) throw httpError("Conversa não encontrada.", 404);
    const roomMessages = store.messages.filter((message) => message.conversationId === conversationId);
    const existing = roomMessages.find((message) => message.role === "user" && message.clientMessageId === clientMessageId);
    if (existing) {
      if (existing.content !== content) throw httpError("O clientMessageId já foi usado com outra mensagem.", 409);
      const assistantMessage = roomMessages.find((message) => message.role === "assistant" && message.replyToMessageId === existing.id) || null;
      return {
        changed: false,
        result: {
          userMessage: publicMessage(existing),
          assistantMessage: assistantMessage ? publicMessage(assistantMessage) : null,
          history: historyBefore(store, conversationId, existing.sequence),
          existing: true,
        },
      };
    }
    if (roomMessages.some((message) => message.role === "user" && message.status === "pending")) {
      throw httpError("Há uma mensagem pendente nesta conversa. Reenvie-a antes de iniciar outro turno.", 409);
    }
    if (roomMessages.length + 2 > MAX_MESSAGES_PER_CONVERSATION) {
      throw httpError("O limite de mensagens desta conversa foi atingido.", 409);
    }
    const userMessage = {
      id: randomUUID(),
      conversationId,
      sequence: conversation.nextSequence,
      clientMessageId,
      replyToMessageId: null,
      role: "user",
      content,
      status: "pending",
      createdAt: new Date().toISOString(),
      responseLevel: normalizeResponseLevel(responseLevel),
    };
    const history = historyBefore(store, conversationId, userMessage.sequence);
    store.messages.push(userMessage);
    conversation.nextSequence += 1;
    conversation.updatedAt = userMessage.createdAt;
    conversation.lastMessageAt = userMessage.createdAt;
    return {
      result: {
        userMessage: publicMessage(userMessage),
        assistantMessage: null,
        history,
        existing: false,
      },
    };
  });
}

function serializeRoom(conversationId, operation) {
  const previous = roomQueues.get(conversationId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  let tracked;
  tracked = current.finally(() => {
    if (roomQueues.get(conversationId) === tracked) roomQueues.delete(conversationId);
  });
  roomQueues.set(conversationId, tracked);
  return tracked;
}

async function saveAssistantMessage({ conversationId, userMessageId, answer, responseMetadata }) {
  return mutateStore((store) => {
    const conversation = store.conversations.find((item) => item.id === conversationId);
    if (!conversation) throw httpError("Conversa não encontrada.", 404);
    const userMessage = store.messages.find((message) => message.id === userMessageId && message.conversationId === conversationId && message.role === "user");
    if (!userMessage) throw httpError("Mensagem de usuário não encontrada.", 404);
    const existing = store.messages.find((message) => message.role === "assistant" && message.replyToMessageId === userMessage.id);
    if (existing) return { result: publicMessage(existing), changed: false };
    if (userMessage.status !== "pending") throw httpError("A mensagem já foi concluída sem uma resposta recuperável.", 409);
    const roomMessages = store.messages.filter((message) => message.conversationId === conversationId);
    if (roomMessages.length >= MAX_MESSAGES_PER_CONVERSATION) throw httpError("O limite de mensagens desta conversa foi atingido.", 409);
    if (typeof answer !== "string" || !answer.trim() || answer.length > MAX_ASSISTANT_MESSAGE_CHARS) {
      throw httpError("A resposta do agente está vazia ou excede o limite permitido.", 502);
    }
    const now = new Date().toISOString();
    const assistantMessage = {
      id: randomUUID(),
      conversationId,
      sequence: conversation.nextSequence,
      clientMessageId: null,
      replyToMessageId: userMessage.id,
      role: "assistant",
      content: answer,
      status: "completed",
      createdAt: now,
      responseMetadata: normalizeResponseMetadata(responseMetadata),
    };
    userMessage.status = "completed";
    store.messages.push(assistantMessage);
    conversation.nextSequence += 1;
    conversation.updatedAt = now;
    conversation.lastMessageAt = now;
    return { result: publicMessage(assistantMessage) };
  });
}

async function postUserMessage(input) {
  validateTurnInput(input);
  const { conversationId, clientMessageId, content, generateResponse } = input;
  const responseLevel = normalizeResponseLevel(input.responseLevel);
  return serializeRoom(conversationId, async () => {
    const prepared = await prepareUserMessage({ conversationId, clientMessageId: clientMessageId.trim(), content: content.trim(), responseLevel });
    if (prepared.assistantMessage) {
      return { userMessage: prepared.userMessage, assistantMessage: prepared.assistantMessage, ...prepared.assistantMessage.responseMetadata };
    }
    const generated = await generateResponse(
      prepared.userMessage.content,
      prepared.history,
      prepared.userMessage.responseLevel,
      { conversationId, userMessageId: prepared.userMessage.id },
    );
    if (!generated || typeof generated !== "object" || typeof generated.answer !== "string" || !generated.answer.trim()) {
      throw httpError("A resposta do agente veio fora do formato esperado.", 502);
    }
    const assistantMessage = await saveAssistantMessage({
      conversationId,
      userMessageId: prepared.userMessage.id,
      answer: generated.answer.trim().slice(0, MAX_ASSISTANT_MESSAGE_CHARS),
      responseMetadata: {
        referenceDate: generated.referenceDate,
        selection: generated.selection,
        limitations: generated.limitations,
        responseLevel: prepared.userMessage.responseLevel,
        sources: generated.sources,
        ...(generated.whatIfScenario !== undefined ? { whatIfScenario: generated.whatIfScenario } : {}),
      },
    });
    return {
      userMessage: { ...prepared.userMessage, status: "completed" },
      assistantMessage,
      ...assistantMessage.responseMetadata,
    };
  });
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_CONVERSATIONS,
  MAX_MESSAGES_PER_CONVERSATION,
  MAX_USER_MESSAGE_CHARS,
  MAX_ASSISTANT_MESSAGE_CHARS,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  readStore,
  listConversations,
  createConversation,
  getConversation,
  validateMessageInput,
  postUserMessage,
};
