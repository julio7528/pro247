"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactCurrency = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
let finance = null;
let activeScreen = "dashboard";
let registrationType = "degrees";
let selectedMonth = "2026-10";
let editingDocument = null;
let documentIdempotencyKey = null;
let activeDocumentKind = "payable";
let selectedDocumentPartyId = null;
let selectedDocumentPartyText = "";
let documentPartySuggestions = [];
let documentPartyActiveIndex = -1;
let documentPartySearchTimer = null;
let documentPartySearchToken = 0;
let pendingDocumentAction = null;
let settlementIdempotencyKey = null;
let editingCatalog = null;
let editingCostCenterId = null;
let partyList = [];
let partyListRequestToken = 0;
let partyDialogLoadToken = 0;
let partySearchTimer = null;
let editingPartyId = null;
let partyCreateIdempotencyKey = null;
let partyDialogContext = null;
let toastTimer = null;
let assistantHistory = [];
let assistantPendingRequest = null;
let assistantBusy = false;
let agentConfigured = false;
let agentResponseLevel = "intermediario";
let agentConversations = [];
let activeAgentConversationId = null;
let agentConversationCache = new Map();
let agentActionsByConversation = new Map();
let agentActionLoadTokens = new Map();
let agentActionsLoading = new Set();
let agentActionMutationIds = new Set();
let agentActionNotices = new Map();
let agentActionErrors = new Map();
let agentPendingSends = new Map();
let agentDrafts = new Map();
let agentSendingConversations = new Set();
let agentConversationsLoaded = false;
let agentRoomsLoading = false;
let agentConversationLoading = false;
let agentLoadingOlder = false;
let agentConversationLoadToken = 0;
let agentStateEpoch = 0;
let agentHasMoreMessages = false;
let agentNextBeforeSequence = null;
let agentCreateRequestId = null;
let agentCreateTitle = "";
let agentCreateBusy = false;
let agentRoomListRetryMode = "list";
let guardianLoadToken = 0;
let trialBalanceReport = null;
let trialBalanceVisibleDepth = 0;
let trialBalanceMaxDepth = 0;
let balanceSheetReport = null;
let balanceSheetVisibleDepth = 0;
let balanceSheetMaxDepth = 0;
let budgetEditorState = null;
let budgetConversionState = null;
let budgetConversionPreview = null;
let budgetConversionCreatedDocument = null;
let budgetCurrentView = "programacao";
const reportSorts = {
  journal: { key: "date", direction: "asc" },
  payable: { key: null, direction: "asc" },
  receivable: { key: null, direction: "asc" },
};
const reportTextCollator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatMoney(cents) { return currency.format((Number(cents) || 0) / 100); }
function formatSignedMoney(cents) {
  if (!cents) return "";
  return `${cents > 0 ? "+" : "−"}${currency.format(Math.abs(cents) / 100)}`;
}
function formatCompactMoney(cents) {
  const value = Number(cents) || 0;
  const amount = compactCurrency.format(Math.abs(value) / 100);
  return `${value < 0 ? "−" : ""}${amount}`;
}
function cashValue(cents, signed = true) {
  const exact = signed ? formatSignedMoney(cents) : formatMoney(cents);
  return `<span class="compact-value" title="${escapeHtml(exact)}" aria-label="${escapeHtml(exact)}">${escapeHtml(formatCompactMoney(cents))}</span>`;
}
function parseMoney(value) {
  let text = String(value ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!text) throw new Error("Informe um valor.");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Use um valor positivo com até duas casas decimais.");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("O valor excede o limite permitido.");
  return cents;
}
function moneyField(cents) { return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`; }
function datePt(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return dateFormat.format(new Date(Date.UTC(year, month - 1, day)));
}
function monthPt(value) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  return monthFormat.format(new Date(Date.UTC(year, month - 1, 1))).replace(/^./, (char) => char.toLocaleUpperCase("pt-BR"));
}
function todayCuiaba() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function uuid() {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== "/api/login") {
    const message = "Sua sessão expirou. Entre novamente.";
    showLogin(message);
    throw new Error(message);
  }
  if (!response.ok) throw new Error(payload.error || `Falha na solicitação (${response.status}).`);
  return payload;
}

function guardianNode(tagName, className = "", text = undefined) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = guardianText(text);
  return node;
}

function guardianIsRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function guardianText(value, fallback = "—", limit = 400) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function guardianMoney(value) {
  return typeof value === "number" && Number.isFinite(value) ? formatMoney(Math.round(value)) : "Não informado";
}

function guardianCount(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)).toLocaleString("pt-BR") : "Não informado";
}

function guardianDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Não informado";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "Não informado";
  return datePt(value);
}

function guardianDateTime(value, timeZone) {
  if (typeof value !== "string" || !value.trim()) return "Não informado";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Não informado";
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: typeof timeZone === "string" ? timeZone : "America/Cuiaba" }).format(date);
  } catch {
    return date.toLocaleString("pt-BR");
  }
}

function guardianHumanize(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (char) => char.toLocaleUpperCase("pt-BR"));
}

function guardianMetric(label, value, note = "") {
  const card = guardianNode("article", "guardian-metric");
  card.append(guardianNode("span", "guardian-metric-label", label), guardianNode("strong", "guardian-metric-value", value));
  if (note) card.append(guardianNode("small", "guardian-metric-note", note));
  return card;
}

function guardianLinkButton(parent, label, action, id) {
  if (typeof id !== "string" || !id.trim() || id.length > 200) return;
  const button = guardianNode("button", "text-button guardian-evidence-link", label);
  button.type = "button";
  button.dataset.guardianAction = action;
  button.dataset.guardianEntityId = id;
  parent.append(button);
}

function renderGuardianDocuments(parent, bucket, entityType) {
  if (!guardianIsRecord(bucket)) return;
  const items = Array.isArray(bucket.items) ? bucket.items.slice(0, 4) : [];
  if (!items.length) return;
  const list = guardianNode("ul", "guardian-document-list");
  for (const item of items) {
    if (!guardianIsRecord(item)) continue;
    const row = guardianNode("li", "guardian-document");
    const main = guardianNode("div", "guardian-document-main");
    const party = guardianNode("strong", "", guardianText(item.party, "Parte não informada", 140));
    main.append(party, guardianNode("span", "guardian-document-description", guardianText(item.description, "Descrição não informada", 180)));
    const detail = guardianNode("div", "guardian-document-detail");
    detail.append(guardianNode("span", "", "Vencimento " + guardianDate(item.dueDate)), guardianNode("strong", "", guardianMoney(item.outstandingCents)));
    if (item.recognized === false) detail.append(guardianNode("small", "guardian-draft-label", "Não reconhecido"));
    else if (item.recognized === true) detail.append(guardianNode("small", "guardian-recognized-label", "Reconhecido"));
    row.append(main, detail);
    if (typeof item.id === "string") guardianLinkButton(row, entityType === "payable" ? "Abrir conta a pagar" : "Abrir conta a receber", entityType, item.id);
    list.append(row);
  }
  if (list.childElementCount) parent.append(list);
  if (Array.isArray(bucket.items) && bucket.items.length > items.length) {
    parent.append(guardianNode("p", "guardian-muted", `Mais ${bucket.items.length - items.length} títulos não exibidos.`));
  }
}

function renderGuardianBuckets(parent, section, entityType) {
  if (!guardianIsRecord(section)) return;
  const bucketNames = [
    ["overdue", "Vencidas"],
    ["dueToday", "Vencem hoje"],
    ["next7Days", "Próximos 7 dias"],
  ];
  const grid = guardianNode("div", "guardian-bucket-grid");
  for (const [key, label] of bucketNames) {
    if (!guardianIsRecord(section[key])) continue;
    const bucket = section[key];
    const card = guardianNode("section", "guardian-bucket");
    card.append(guardianNode("h4", "", label));
    card.append(guardianNode("strong", "guardian-bucket-total", guardianMoney(bucket.amountCents)));
    card.append(guardianNode("p", "guardian-muted", `${guardianCount(bucket.count)} título(s)`));
    renderGuardianDocuments(card, bucket, entityType);
    grid.append(card);
  }
  if (grid.childElementCount) parent.append(grid);
  const hasDrafts = Object.prototype.hasOwnProperty.call(section, "drafts") || Object.prototype.hasOwnProperty.call(section, "unrecognizedDrafts");
  if (hasDrafts) renderGuardianDrafts(parent, section.drafts ?? section.unrecognizedDrafts, entityType);
}

function renderGuardianDrafts(parent, drafts, entityType) {
  if (drafts == null) return;
  const card = guardianNode("section", "guardian-drafts");
  card.append(guardianNode("h4", "", "Rascunhos não reconhecidos"));
  const knownBuckets = guardianIsRecord(drafts) ? ["overdue", "dueToday", "next7Days"].filter((key) => guardianIsRecord(drafts[key])) : [];
  if (Array.isArray(drafts)) {
    card.append(guardianNode("p", "guardian-muted", `${drafts.length.toLocaleString("pt-BR")} rascunho(s) informado(s), fora dos totais reconhecidos.`));
    renderGuardianDocuments(card, { items: drafts }, entityType);
  } else if (guardianIsRecord(drafts) && knownBuckets.length) {
    for (const key of knownBuckets) {
      const bucket = drafts[key];
      const sub = guardianNode("div", "guardian-draft-bucket");
      sub.append(guardianNode("strong", "", ({ overdue: "Vencidos", dueToday: "Vencem hoje", next7Days: "Próximos 7 dias" })[key]));
      sub.append(guardianNode("span", "", `${guardianCount(bucket.count)} · ${guardianMoney(bucket.amountCents)}`));
      renderGuardianDocuments(sub, bucket, entityType);
      card.append(sub);
    }
  } else if (guardianIsRecord(drafts)) {
    card.append(guardianNode("p", "guardian-muted", `${guardianCount(drafts.count)} rascunho(s) · ${guardianMoney(drafts.amountCents)}. Esses valores ficam separados dos títulos reconhecidos.`));
    renderGuardianDocuments(card, drafts, entityType);
  } else {
    card.append(guardianNode("p", "guardian-muted", "O servidor informou rascunhos em formato não detalhado; eles não foram somados aos títulos reconhecidos."));
  }
  parent.append(card);
}

function renderGuardianCash(parent, cash) {
  if (!guardianIsRecord(cash)) return;
  const section = guardianNode("section", "guardian-summary-card guardian-cash-card");
  section.append(guardianNode("h3", "", "Caixa e projeção"));
  const metrics = guardianNode("div", "guardian-metric-grid");
  metrics.append(
    guardianMetric("Disponível", guardianMoney(cash.availableCents)),
    guardianMetric("Fechamento projetado", guardianMoney(cash.projectedClosingCents)),
    guardianMetric("Menor saldo projetado", guardianMoney(cash.minimumProjectedCents), guardianDate(cash.minimumProjectedDate)),
  );
  metrics.append(guardianMetric("Primeiro saldo negativo", guardianMoney(cash.firstNegativeCents), guardianDate(cash.firstNegativeDate)));
  section.append(metrics);
  if (cash.available === false) {
    section.append(guardianNode("p", "guardian-caveat", "Projeção reconhecida indisponível; a base de caixa não foi considerada confiável neste resumo."));
  } else {
    section.append(guardianNode("p", cash.recognizedOnly === true ? "guardian-muted" : "guardian-caveat", cash.recognizedOnly === true ? "A projeção usa somente compromissos reconhecidos." : "O escopo de reconhecimento desta projeção não foi confirmado pelo resumo."));
  }
  const scenario = cash.uncertainScenario;
  if (guardianIsRecord(scenario)) {
    const uncertain = guardianNode("section", "guardian-uncertain-scenario");
    uncertain.append(guardianNode("h4", "", "Cenário separado e incerto"));
    uncertain.append(guardianNode("p", "guardian-caveat", "Pode incluir rascunhos não reconhecidos, estimativas recorrentes e orçamentos ativos planejados. Este cenário fica fora da projeção reconhecida e não representa uma garantia."));
    const uncertainMetrics = guardianNode("div", "guardian-metric-grid");
    uncertainMetrics.append(
      guardianMetric("Rascunhos a pagar", guardianMoney(scenario.includesDraftPayablesCents)),
      guardianMetric("Rascunhos a receber", guardianMoney(scenario.includesDraftReceivablesCents)),
      guardianMetric("Estimativas recorrentes", guardianMoney(scenario.includesRecurringEstimatesCents)),
      guardianMetric("Orçado a pagar", guardianMoney(scenario.includesBudgetedPaymentsCents)),
      guardianMetric("Orçado a receber", guardianMoney(scenario.includesBudgetedReceiptsCents)),
      guardianMetric("Fechamento neste cenário", guardianMoney(scenario.closingProjectedCents)),
      guardianMetric("Menor saldo neste cenário", guardianMoney(scenario.minimumProjectedCents), "Data: " + guardianDate(scenario.minimumProjectedDate)),
      guardianMetric("Primeiro saldo negativo neste cenário", guardianMoney(scenario.firstNegativeCents), "Data: " + guardianDate(scenario.firstNegativeDate)),
    );
    if (scenario.basis) uncertain.append(guardianNode("p", "guardian-muted", guardianText(scenario.basis, "", 500)));
    uncertain.append(uncertainMetrics);
    section.append(uncertain);
  }
  parent.append(section);
}

function renderGuardianHealth(parent, health, present = false) {
  if (!guardianIsRecord(health) && !present) return;
  if (!guardianIsRecord(health)) health = {};
  const section = guardianNode("section", "guardian-summary-card guardian-health-card");
  section.append(guardianNode("h3", "", "Patrimônio e liquidez"));
  const cutoffDate = health.asOfDate ?? health.cutoffDate;
  section.append(guardianNode("p", "guardian-muted", `Fonte: Análise Financeira · data de corte ${guardianDate(cutoffDate)}`));
  if (health.available === false || !Object.keys(health).length) section.append(guardianNode("p", "guardian-caveat", "Dados insuficientes para os indicadores patrimoniais e de liquidez neste corte."));
  const metrics = guardianNode("div", "guardian-metric-grid");
  metrics.append(
    guardianMetric("Ativos", guardianMoney(health.assetsCents)),
    guardianMetric("Passivos", guardianMoney(health.liabilitiesCents)),
    guardianMetric("Patrimônio líquido", guardianMoney(health.netWorthCents)),
  );
  const ratios = guardianIsRecord(health.ratios) ? health.ratios : {};
  for (const [key, label] of [["current", "Liquidez corrente"], ["immediate", "Liquidez imediata"], ["general", "Liquidez geral"]]) {
    const ratio = guardianIsRecord(ratios[key]) ? ratios[key] : null;
    const displayValue = ratio && ratio.available !== false ? guardianText(ratio.displayValue, "Dados insuficientes", 100) : "Dados insuficientes";
    metrics.append(guardianMetric(label, displayValue));
  }
  section.append(metrics);
  const availability = guardianIsRecord(health.liquidityAvailability) ? health.liquidityAvailability : {};
  const hasUnclassifiedAssets = Object.prototype.hasOwnProperty.call(availability, "unclassifiedAssetCount");
  const hasUnclassifiedLiabilities = Object.prototype.hasOwnProperty.call(availability, "unclassifiedLiabilityCount");
  if (hasUnclassifiedAssets || hasUnclassifiedLiabilities) {
    const missing = [];
    if (hasUnclassifiedAssets) missing.push("ativos: " + guardianCount(availability.unclassifiedAssetCount));
    if (hasUnclassifiedLiabilities) missing.push("passivos: " + guardianCount(availability.unclassifiedLiabilityCount));
    section.append(guardianNode("p", "guardian-caveat", "Classificações ausentes informadas pela Análise Financeira · " + missing.join(" · ") + "."));
  }
  if (health.basis) section.append(guardianNode("p", "guardian-muted", guardianText(health.basis, "", 500)));
  parent.append(section);
}

function renderGuardianCompetence(parent, competence) {
  if (!guardianIsRecord(competence)) return;
  const section = guardianNode("section", "guardian-summary-card");
  section.append(guardianNode("h3", "", "Resultado por competência"));
  const period = [guardianText(competence.period, "Período não informado", 24), competence.cutoffDate ? "até " + guardianDate(competence.cutoffDate) : ""].filter(Boolean).join(" · ");
  section.append(guardianNode("p", "guardian-muted", period));
  if (competence.available === false) {
    section.append(guardianNode("p", "guardian-caveat", "Dados de competência indisponíveis para este resumo."));
  } else {
    const metrics = guardianNode("div", "guardian-metric-grid");
    metrics.append(
      guardianMetric("Receitas reconhecidas", guardianMoney(competence.recognizedRevenueCents)),
      guardianMetric("Custos reconhecidos", guardianMoney(competence.recognizedCostsCents)),
      guardianMetric("Despesas reconhecidas", guardianMoney(competence.recognizedExpensesCents)),
      guardianMetric("Resultado econômico", guardianMoney(competence.economicResultCents)),
      guardianMetric("Receita para equilíbrio", guardianMoney(competence.breakEvenRevenueGapCents)),
    );
    section.append(metrics);
  }
  if (competence.assumption) section.append(guardianNode("p", "guardian-caveat", "Premissa: " + guardianText(competence.assumption, "", 600)));
  parent.append(section);
}

function renderGuardianExpenses(parent, expenses) {
  if (!guardianIsRecord(expenses)) return;
  const section = guardianNode("section", "guardian-summary-card guardian-expenses-card");
  section.append(guardianNode("h3", "", "Despesas por competência"));
  const period = [guardianText(expenses.period, "Período não informado", 24), expenses.cutoffDate ? "até " + guardianDate(expenses.cutoffDate) : ""].filter(Boolean).join(" · ");
  section.append(guardianNode("p", "guardian-muted", `${period} · total ${guardianMoney(expenses.totalCents)}`));
  if (expenses.available === false) {
    section.append(guardianNode("p", "guardian-caveat", "Dados de despesas indisponíveis para este resumo."));
  } else if (Array.isArray(expenses.topAccounts) && expenses.topAccounts.length) {
    const list = guardianNode("ul", "guardian-account-list");
    for (const account of expenses.topAccounts.slice(0, 5)) {
      if (!guardianIsRecord(account)) continue;
      const row = guardianNode("li", "guardian-account-row");
      const name = [guardianText(account.code, ""), guardianText(account.name, "Conta sem classificação", 140)].filter(Boolean).join(" · ");
      row.append(guardianNode("span", "", name), guardianNode("strong", "", `${guardianMoney(account.amountCents)}${typeof account.sharePercent === "number" && Number.isFinite(account.sharePercent) ? ` · ${reportPercent(account.sharePercent)}` : ""}`));
      list.append(row);
    }
    if (list.childElementCount) section.append(list);
  } else {
    section.append(guardianNode("p", "guardian-muted", "Não há contas de despesa classificadas neste resumo."));
  }
  const comparison = expenses.comparison;
  if (guardianIsRecord(comparison)) {
    const periods = `${guardianDate(comparison.fromDate)}–${guardianDate(comparison.toDate)} · anterior ${guardianDate(comparison.previousFromDate)}–${guardianDate(comparison.previousToDate)}`;
    const compare = guardianNode("div", "guardian-comparison");
    compare.append(guardianNode("strong", "", "Comparação de períodos"), guardianNode("span", "", periods));
    compare.append(guardianNode("span", "", `Atual ${guardianMoney(comparison.currentCents)} · anterior ${guardianMoney(comparison.previousCents)}`));
    compare.append(guardianNode("span", "", `Variação ${guardianMoney(comparison.deltaCents)} · ${typeof comparison.variationPercent === "number" && Number.isFinite(comparison.variationPercent) ? reportPercent(comparison.variationPercent) : "percentual não calculável"}`));
    section.append(compare);
  }
  parent.append(section);
}

function guardianFacts(parent, value, className) {
  if (value == null || value === "") return;
  const values = Array.isArray(value) ? value.slice(0, 5).map((item) => ["", item]) : guardianIsRecord(value) ? Object.entries(value).slice(0, 6) : [["", value]];
  if (!values.length) return;
  const list = guardianNode("ul", className);
  for (const [key, item] of values) {
    let display;
    if (Array.isArray(item)) display = item.slice(0, 4).map((part) => guardianText(part, "", 180)).filter(Boolean).join(" · ");
    else if (guardianIsRecord(item)) display = Object.entries(item).slice(0, 4).map(([nestedKey, nestedValue]) => `${guardianHumanize(nestedKey)}: ${guardianText(nestedValue, "", 180)}`).filter((part) => !part.endsWith(": ")).join(" · ");
    else display = guardianText(item, "", 240);
    if (!display) continue;
    const row = guardianNode("li", "");
    if (key) row.append(guardianNode("strong", "", guardianHumanize(key) + ": "));
    row.append(document.createTextNode(display));
    list.append(row);
  }
  if (list.childElementCount) parent.append(list);
}

function guardianEvidenceAction(entityType) {
  if (typeof entityType !== "string") return null;
  const key = entityType.toLocaleLowerCase("pt-BR").replace(/[\s-]+/g, "_");
  if (["payable", "account_payable", "accounts_payable", "conta_a_pagar"].includes(key)) return { action: "payable", label: "Abrir conta a pagar" };
  if (["receivable", "account_receivable", "accounts_receivable", "conta_a_receber"].includes(key)) return { action: "receivable", label: "Abrir conta a receber" };
  if (["journal", "journal_entry", "entry", "lancamento_contabil"].includes(key)) return { action: "journal", label: "Abrir lançamento no Diário" };
  if (["account", "ledger_account", "conta_contabil"].includes(key)) return { action: "account", label: "Abrir conta no Livro-Razão" };
  return null;
}

function renderGuardianAlerts(parent, items) {
  if (!Array.isArray(items) || !items.length) return;
  const section = guardianNode("section", "guardian-alerts");
  section.append(guardianNode("h3", "", "Pontos de atenção"));
  const list = guardianNode("div", "guardian-alert-list");
  const selected = items.slice(0, 8);
  for (const item of selected) {
    if (!guardianIsRecord(item)) continue;
    const severity = typeof item.severity === "string" && ["critical", "high", "warning", "medium", "low", "info"].includes(item.severity.toLowerCase()) ? item.severity.toLowerCase() : "info";
    const article = guardianNode("article", `guardian-alert is-${severity}`);
    const heading = guardianNode("div", "guardian-alert-heading");
    heading.append(guardianNode("strong", "", guardianText(item.title, "Ponto de atenção", 180)), guardianNode("span", "guardian-severity", guardianHumanize(severity)));
    article.append(heading);
    if (item.ruleCode || item.kind) article.append(guardianNode("p", "guardian-alert-meta", [guardianText(item.ruleCode, "", 80), guardianText(item.kind, "", 100)].filter(Boolean).join(" · ")));
    if (item.summary) article.append(guardianNode("p", "guardian-alert-summary", guardianText(item.summary, "", 500)));
    guardianFacts(article, item.facts, "guardian-facts");
    if (item.assumptions) {
      article.append(guardianNode("h4", "guardian-detail-label", "Premissas"));
      guardianFacts(article, item.assumptions, "guardian-facts");
    }
    if (item.limitations) {
      article.append(guardianNode("h4", "guardian-detail-label", "Limitações"));
      guardianFacts(article, item.limitations, "guardian-facts");
    }
    if (Array.isArray(item.evidence) && item.evidence.length) {
      const evidence = guardianNode("div", "guardian-evidence");
      evidence.append(guardianNode("span", "guardian-detail-label", "Evidência"));
      for (const entry of item.evidence.slice(0, 4)) {
        if (!guardianIsRecord(entry)) continue;
        const type = guardianText(entry.entityType, "Entidade", 100);
        const id = guardianText(entry.entityId, "", 200);
        evidence.append(guardianNode("span", "guardian-evidence-id", `${type}${id ? ` · ${id}` : ""}`));
        const target = guardianEvidenceAction(entry.entityType);
        if (target && id) guardianLinkButton(evidence, target.label, target.action, id);
      }
      if (evidence.childElementCount > 1) article.append(evidence);
    }
    list.append(article);
  }
  if (list.childElementCount) section.append(list);
  if (items.length > selected.length) section.append(guardianNode("p", "guardian-muted", `${items.length - selected.length} ponto(s) adicional(is) não exibido(s).`));
  if (section.childElementCount > 1) parent.append(section);
}

function renderGuardianCoverage(parent, coverage) {
  if (coverage == null) return;
  const section = guardianNode("section", "guardian-coverage");
  section.append(guardianNode("h3", "", "Cobertura do resumo"));
  const entries = guardianIsRecord(coverage) ? Object.entries(coverage).slice(0, 8) : [["status", coverage]];
  const list = guardianNode("ul", "guardian-coverage-list");
  for (const [key, value] of entries) {
    let description;
    if (Array.isArray(value)) description = value.slice(0, 4).map((item) => guardianText(item, "", 100)).filter(Boolean).join(" · ");
    else if (guardianIsRecord(value)) description = Object.entries(value).slice(0, 3).map(([childKey, childValue]) => `${guardianHumanize(childKey)}: ${guardianText(childValue, "", 100)}`).filter((part) => !part.endsWith(": ")).join(" · ");
    else description = guardianText(value, "", 160);
    if (!description) continue;
    const row = guardianNode("li", "");
    row.append(guardianNode("strong", "", guardianHumanize(key) + ": "), document.createTextNode(description));
    list.append(row);
  }
  if (list.childElementCount) section.append(list);
  if (section.childElementCount > 1) parent.append(section);
}

function guardianStatusLabel(status) {
  const key = typeof status === "string" ? status.toLowerCase() : "";
  const labels = { ready: "Dados disponíveis", ok: "Dados disponíveis", complete: "Dados disponíveis", partial: "Dados parciais", empty: "Dados financeiros insuficientes", unavailable: "Resumo indisponível", incomplete: "Dados incompletos" };
  return labels[key] || (key ? "Situação: " + guardianText(status, "não informada", 80) : "Situação do resumo não informada");
}

function renderGuardianPanel(panel, dto) {
  const meta = $("[data-guardian-meta]", panel);
  const status = $("[data-guardian-status]", panel);
  const content = $("[data-guardian-content]", panel);
  const reference = guardianDate(dto.referenceDate);
  const generated = guardianDateTime(dto.generatedAt, dto.timeZone);
  const timeZone = guardianText(dto.timeZone, "Fuso não informado", 80);
  meta.textContent = `Referência ${reference} · ${timeZone} · gerado ${generated}`;
  status.classList.remove("is-error", "is-partial", "is-empty");
  status.textContent = guardianStatusLabel(dto.status);
  const statusKey = typeof dto.status === "string" ? dto.status.toLowerCase() : "";
  if (["partial", "incomplete"].includes(statusKey)) status.classList.add("is-partial");
  else if (statusKey === "empty") status.classList.add("is-empty");
  content.replaceChildren();

  const summary = guardianIsRecord(dto.summary) ? dto.summary : {};
  const overview = guardianNode("div", "guardian-summary-grid");
  renderGuardianCash(overview, summary.cash);
  for (const [key, label, type] of [["payables", "Contas a pagar", "payable"], ["receivables", "Contas a receber", "receivable"]]) {
    if (!guardianIsRecord(summary[key])) continue;
    const section = guardianNode("section", "guardian-summary-card guardian-document-summary");
    section.append(guardianNode("h3", "", label));
    renderGuardianBuckets(section, summary[key], type);
    overview.append(section);
  }
  renderGuardianCompetence(overview, summary.competence);
  renderGuardianExpenses(overview, summary.expenses);
  renderGuardianHealth(overview, summary.health, Object.prototype.hasOwnProperty.call(summary, "health"));
  if (overview.childElementCount) content.append(overview);
  renderGuardianAlerts(content, dto.items);
  renderGuardianCoverage(content, dto.coverage);
  if (Array.isArray(dto.limitations) && dto.limitations.length) {
    const limitations = guardianNode("section", "guardian-limitations");
    limitations.append(guardianNode("h3", "", "Limitações informadas"));
    guardianFacts(limitations, dto.limitations.slice(0, 6), "guardian-facts");
    content.append(limitations);
  } else if (typeof dto.limitations === "string" && dto.limitations.trim()) {
    const limitations = guardianNode("section", "guardian-limitations");
    limitations.append(guardianNode("h3", "", "Limitações informadas"));
    guardianFacts(limitations, dto.limitations, "guardian-facts");
    content.append(limitations);
  }
  if (!content.childElementCount) content.append(guardianNode("p", "guardian-empty", "O resumo não trouxe indicadores ou pontos de atenção para exibir."));
  content.hidden = false;
}

async function loadGuardianBriefing() {
  const token = ++guardianLoadToken;
  const panels = $$("[data-guardian-panel]");
  panels.forEach((panel) => {
    panel.setAttribute("aria-busy", "true");
    const status = $("[data-guardian-status]", panel);
    status.classList.remove("is-error");
    status.textContent = "Carregando o resumo mais recente…";
    $("[data-guardian-meta]", panel).textContent = "";
    $("[data-guardian-content]", panel).hidden = true;
    $("[data-guardian-content]", panel).replaceChildren();
    $("[data-guardian-retry]", panel).hidden = true;
    $("[data-guardian-refresh]", panel).disabled = true;
  });
  try {
    const dto = await request("/api/guardian");
    if (token !== guardianLoadToken) return;
    if (!guardianIsRecord(dto)) throw new Error("O servidor retornou um resumo em formato inválido.");
    panels.forEach((panel) => renderGuardianPanel(panel, dto));
  } catch (error) {
    if (token !== guardianLoadToken) return;
    panels.forEach((panel) => {
      const status = $("[data-guardian-status]", panel);
      status.textContent = "Não foi possível carregar o resumo Guardian. " + guardianText(error.message, "Tente novamente.", 300);
      status.classList.add("is-error");
      $("[data-guardian-content]", panel).hidden = true;
      $("[data-guardian-retry]", panel).hidden = false;
    });
  } finally {
    if (token === guardianLoadToken) panels.forEach((panel) => {
      panel.setAttribute("aria-busy", "false");
      $("[data-guardian-refresh]", panel).disabled = false;
    });
  }
}

function showLogin(message = "") {
  finance = null;
  guardianLoadToken += 1;
  $$('[data-guardian-panel]').forEach((panel) => {
    panel.setAttribute("aria-busy", "false");
    $("[data-guardian-status]", panel).classList.remove("is-error", "is-partial", "is-empty");
    $("[data-guardian-status]", panel).textContent = "Resumo disponível após autenticação.";
    $("[data-guardian-meta]", panel).textContent = "";
    $("[data-guardian-content]", panel).replaceChildren();
    $("[data-guardian-content]", panel).hidden = true;
    $("[data-guardian-retry]", panel).hidden = true;
    $("[data-guardian-refresh]", panel).disabled = false;
  });
  assistantHistory = [];
  assistantPendingRequest = null;
  assistantBusy = false;
  clearAgentVolatileState();
  $$("dialog[open]").forEach((dialog) => dialog.close());
  $("#login-screen").hidden = false;
  $(".workspace").hidden = true;
  sendFormError($("#login-error"), message);
}

function showWorkspace() {
  $("#login-screen").hidden = true;
  $(".workspace").hidden = false;
}

async function login(event) {
  event.preventDefault();
  const submit = $("#login-form button[type='submit']");
  submit.disabled = true;
  sendFormError($("#login-error"), "");
  try {
    await request("/api/login", { method: "POST", body: JSON.stringify({ username: $("#login-username").value, password: $("#login-password").value }) });
    $("#login-password").value = "";
    setScreen("dashboard");
    showWorkspace();
    await initializeWorkspace();
  } catch (error) { sendFormError($("#login-error"), error.message); }
  finally { submit.disabled = false; }
}

async function logout() {
  const button = $("#logout-button");
  button.disabled = true;
  try {
    await request("/api/logout", { method: "POST" });
    setScreen("dashboard");
    showLogin();
    $("#login-password").value = "";
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
}

function addAssistantBubble(role, message) {
  const bubble = document.createElement("div");
  bubble.className = `assistant-message ${role}`;
  const label = document.createElement("span");
  label.className = "assistant-message-label";
  label.textContent = role === "user" ? "Você" : "Pro247";
  const text = document.createElement("p");
  text.className = "assistant-message-text";
  text.textContent = message;
  bubble.append(label, text);
  $("#assistant-messages").appendChild(bubble);
  $("#assistant-messages").scrollTop = $("#assistant-messages").scrollHeight;
}

function showAssistantWelcome() {
  const welcome = document.createElement("p");
  welcome.className = "assistant-welcome";
  welcome.textContent = "Pergunte sobre o Pro247 e seus registros financeiros. Para criar uma conta a pagar ou a receber, envie o pedido e você continuará no Agente Pro247.";
  $("#assistant-messages").replaceChildren(welcome);
}

function resetAssistantConversation() {
  assistantHistory = [];
  assistantPendingRequest = null;
  $("#assistant-input").value = "";
  sendFormError($("#assistant-error"), "");
  showAssistantWelcome();
}

async function updateAssistantKeyStatus() {
  try {
    const { configured } = await request("/api/config/deepseek");
    $("#assistant-key-required").hidden = configured;
    $("#assistant-submit").disabled = !configured || assistantBusy;
    return configured;
  } catch (error) {
    $("#assistant-key-required").hidden = false;
    $("#assistant-key-required span").textContent = error.message;
    $("#assistant-submit").disabled = true;
    return false;
  }
}

async function openAssistant() {
  if (!$("#assistant-messages").childElementCount) showAssistantWelcome();
  $("#assistant-dialog").showModal();
  await updateAssistantKeyStatus();
  $("#assistant-input").focus();
}

async function openDeepSeekSettings() {
  $("#deepseek-settings-error").hidden = true;
  $("#deepseek-api-key").value = "";
  $("#deepseek-settings-status").textContent = "Verificando configuração…";
  $("#deepseek-remove-key").hidden = true;
  $("#deepseek-settings-dialog").showModal();
  try {
    const { configured } = await request("/api/config/deepseek");
    $("#deepseek-settings-status").textContent = configured ? "Chave configurada neste computador." : "Nenhuma chave configurada.";
    $("#deepseek-remove-key").hidden = !configured;
  } catch (error) {
    $("#deepseek-settings-status").textContent = error.message;
  }
  $("#deepseek-api-key").focus();
}

async function saveDeepSeekSettings(event) {
  event.preventDefault();
  const button = $("#deepseek-save-key");
  sendFormError($("#deepseek-settings-error"), "");
  button.disabled = true;
  try {
    await apiCall("PUT", "/api/config/deepseek", { apiKey: $("#deepseek-api-key").value });
    $("#deepseek-api-key").value = "";
    $("#deepseek-settings-status").textContent = "Chave configurada neste computador.";
    $("#deepseek-remove-key").hidden = false;
    $("#deepseek-settings-dialog").close();
    await updateAssistantKeyStatus();
    await updateAgentKeyStatus();
    showToast("Chave DeepSeek salva localmente.");
  } catch (error) { sendFormError($("#deepseek-settings-error"), error.message); }
  finally { button.disabled = false; }
}

async function removeDeepSeekSettings() {
  const button = $("#deepseek-remove-key");
  button.disabled = true;
  sendFormError($("#deepseek-settings-error"), "");
  try {
    await apiCall("DELETE", "/api/config/deepseek");
    $("#deepseek-settings-status").textContent = "Nenhuma chave configurada.";
    button.hidden = true;
    $("#deepseek-settings-dialog").close();
    await updateAssistantKeyStatus();
    await updateAgentKeyStatus();
    showToast("Chave DeepSeek removida.");
  } catch (error) { sendFormError($("#deepseek-settings-error"), error.message); }
  finally { button.disabled = false; }
}

async function submitAssistantMessage(event) {
  event.preventDefault();
  if (assistantBusy) return;
  const input = $("#assistant-input");
  const message = input.value.trim();
  if (!message) return;
  const retrying = assistantPendingRequest?.content === message;
  const pendingRequest = retrying
    ? assistantPendingRequest
    : { content: message, clientRequestId: uuid(), clientMessageId: uuid() };
  assistantPendingRequest = pendingRequest;
  sendFormError($("#assistant-error"), "");
  if (!retrying) {
    assistantHistory.push({ role: "user", content: message });
    assistantHistory = assistantHistory.slice(-12);
    addAssistantBubble("user", message);
  }
  input.value = "";
  assistantBusy = true;
  input.disabled = true;
  $("#assistant-new-conversation").disabled = true;
  $("#assistant-submit").disabled = true;
  $("#assistant-submit").textContent = "Aguarde…";
  try {
    const result = await request("/api/assistente", {
      method: "POST",
      body: JSON.stringify({
        messages: assistantHistory,
        clientRequestId: pendingRequest.clientRequestId,
        clientMessageId: pendingRequest.clientMessageId,
      }),
    });
    if (result.tipo === "handoff") {
      if (typeof result.conversationId !== "string" || !result.conversationId) {
        throw new Error("A conversa do Agente não pôde ser identificada.");
      }
      resetAssistantConversation();
      $("#assistant-dialog").close();
      setScreen("agent");
      const conversation = agentConversations.find((item) => item.id === result.conversationId)
        || { id: result.conversationId, title: "Proposta financeira" };
      await openAgentConversation(result.conversationId, { conversation, focus: false });
      return;
    }
    assistantPendingRequest = null;
    assistantHistory.push({ role: "assistant", content: JSON.stringify({ tipo: result.tipo, resposta: result.resposta }) });
    assistantHistory = assistantHistory.slice(-12);
    addAssistantBubble("assistant", result.resposta || "Não consegui responder.");
  } catch (error) {
    if (assistantPendingRequest === pendingRequest && !input.value) input.value = message;
    sendFormError($("#assistant-error"), error.message);
  } finally {
    assistantBusy = false;
    input.disabled = false;
    $("#assistant-new-conversation").disabled = false;
    $("#assistant-submit").textContent = "Enviar";
    await updateAssistantKeyStatus();
  }
}

const AGENT_EMPTY_PROMPTS = [
  "O que vence esta semana?",
  "Como está minha saúde financeira?",
  "Quais contas estão atrasadas?",
  "Quanto tenho disponível?",
  "Se eu comprar um equipamento por R$ 2.000 amanhã, como fica o caixa?",
];

const AGENT_RESPONSE_LEVEL_LABELS = Object.freeze({
  iniciante: "Iniciante",
  intermediario: "Intermediário",
  avancado: "Avançado",
});

const AGENT_SOURCE_SCREENS = Object.freeze({
  dashboard: { label: "Dashboard", screen: "dashboard" },
  "financial-analysis": { label: "Análise financeira", screen: "financial-analysis" },
  "cash-flow": { label: "Fluxo de caixa", screen: "cashflow" },
  payables: { label: "Contas a pagar", screen: "payables" },
  receivables: { label: "Contas a receber", screen: "receivables" },
  "income-statement": { label: "DRE", screen: "dre" },
  "trial-balance": { label: "Balancete", screen: "trial-balance" },
  ledger: { label: "Livro-Razão", screen: "ledger" },
});

const AGENT_FOLLOW_UP_PROMPTS = [
  "E quais dados sustentam essa resposta?",
  "E o que merece atenção?",
  "E na próxima semana?",
];

function normalizeAgentResponseLevel(value) {
  return Object.prototype.hasOwnProperty.call(AGENT_RESPONSE_LEVEL_LABELS, value) ? value : "intermediario";
}

function isAgentIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function agentPeriodDescription(period, fromDate, toDate) {
  const periodLabel = typeof period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? monthPt(period) : "";
  const hasFrom = isAgentIsoDate(fromDate);
  const hasTo = isAgentIsoDate(toDate);
  let rangeLabel = "";
  if (hasFrom && hasTo) rangeLabel = fromDate === toDate ? datePt(fromDate) : `${datePt(fromDate)} a ${datePt(toDate)}`;
  else if (hasFrom) rangeLabel = `a partir de ${datePt(fromDate)}`;
  else if (hasTo) rangeLabel = `até ${datePt(toDate)}`;
  return [periodLabel, rangeLabel].filter(Boolean).join(" · ");
}

function agentConversationHasPendingMessage(conversationId) {
  return agentConversationMessages(conversationId).some((message) => message.role === "user" && message.status === "pending");
}

function clearAgentVolatileState() {
  agentStateEpoch += 1;
  agentConversationLoadToken += 1;
  agentConversations = [];
  activeAgentConversationId = null;
  agentConversationCache.clear();
  agentActionsByConversation.clear();
  agentActionLoadTokens.clear();
  agentActionsLoading.clear();
  agentActionMutationIds.clear();
  agentActionNotices.clear();
  agentActionErrors.clear();
  agentPendingSends.clear();
  agentDrafts.clear();
  agentSendingConversations.clear();
  agentConversationsLoaded = false;
  agentRoomsLoading = false;
  agentConversationLoading = false;
  agentLoadingOlder = false;
  agentHasMoreMessages = false;
  agentNextBeforeSequence = null;
  agentCreateRequestId = null;
  agentCreateTitle = "";
  agentCreateBusy = false;
  agentRoomListRetryMode = "list";
  agentConfigured = false;
  agentResponseLevel = "intermediario";
  const responseLevel = $("#agent-response-level");
  if (responseLevel) responseLevel.value = agentResponseLevel;
  const responseLevelStatus = $("#agent-response-level-status");
  if (responseLevelStatus) responseLevelStatus.textContent = "";
  if (!$("#agent-messages")) return;
  $("#agent-input").value = "";
  $("#agent-messages").replaceChildren();
  $("#agent-room-list").replaceChildren();
  $("#agent-room-list-status").textContent = "";
  $("#agent-room-list-status").hidden = true;
  $("#agent-room-list-retry").hidden = true;
  $("#agent-room-empty").hidden = true;
  $("#agent-conversation-status").textContent = "";
  $("#agent-conversation-status").hidden = true;
  $("#agent-conversation-retry").hidden = true;
  setAgentActionsStatus("");
  $("#agent-conversation-title").textContent = "Nova conversa";
  $("#agent-load-older").hidden = true;
  $("#agent-room-rail").classList.remove("is-open");
  $("#agent-room-list-toggle").setAttribute("aria-expanded", "false");
  sendFormError($("#agent-error"), "");
  updateAgentComposerState();
}

function isAgentMessagesNearBottom() {
  const messages = $("#agent-messages");
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
}

function agentConversationDate(conversation) {
  const value = conversation?.lastMessageAt || conversation?.updatedAt || conversation?.createdAt;
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Cuiaba",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function agentConversationMessages(conversationId = activeAgentConversationId) {
  return agentConversationCache.get(conversationId) || [];
}

function mergeAgentMessages(existing, incoming) {
  const result = [...existing];
  incoming.forEach((message) => {
    const index = result.findIndex((current) => (message.id && current.id === message.id)
      || (message.clientMessageId && current.role === message.role && current.clientMessageId === message.clientMessageId));
    if (index === -1) result.push(message);
    else result[index] = { ...result[index], ...message };
  });
  return result.map((message, index) => ({ message, index })).sort((left, right) => {
    const a = Number.isFinite(left.message.sequence) ? left.message.sequence : null;
    const b = Number.isFinite(right.message.sequence) ? right.message.sequence : null;
    if (a !== null && b !== null && a !== b) return a - b;
    if (a !== null && b === null) return -1;
    if (a === null && b !== null) return 1;
    const aDate = Date.parse(left.message.createdAt || "");
    const bDate = Date.parse(right.message.createdAt || "");
    if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;
    return left.index - right.index;
  }).map(({ message }) => message);
}

function setAgentRoomListStatus(message, { error = false, retryMode = "list" } = {}) {
  const status = $("#agent-room-list-status");
  status.textContent = message;
  status.hidden = !message;
  $("#agent-room-list-retry").hidden = !error;
  agentRoomListRetryMode = retryMode;
}

function setAgentConversationStatus(message, { retry = false } = {}) {
  const status = $("#agent-conversation-status");
  status.textContent = message;
  status.hidden = !message;
  $("#agent-conversation-retry").hidden = !retry;
}

function setAgentActionsStatus(message, { error = false, loading = false } = {}) {
  const status = $("#agent-actions-status");
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("is-error", error);
  status.classList.toggle("is-loading", loading);
  $("#agent-actions-retry").hidden = !error;
}

async function loadAgentActions(conversationId = activeAgentConversationId) {
  if (!conversationId) return;
  const epoch = agentStateEpoch;
  const token = (agentActionLoadTokens.get(conversationId) || 0) + 1;
  agentActionLoadTokens.set(conversationId, token);
  agentActionsLoading.add(conversationId);
  if (conversationId === activeAgentConversationId) {
    setAgentActionsStatus("Carregando propostas desta conversa…", { loading: true });
    renderAgentMessages(conversationId, { preserveScroll: true });
  }
  try {
    const payload = await request(`/api/conversas/${encodeURIComponent(conversationId)}/acoes`);
    if (epoch !== agentStateEpoch || token !== agentActionLoadTokens.get(conversationId)) return;
    if (!payload || !Array.isArray(payload.actions)) throw new Error("A resposta das propostas está fora do formato esperado.");
    agentActionsByConversation.set(conversationId, payload.actions.filter((action) => action && typeof action.id === "string" && action.source && typeof action.source.userMessageId === "string"));
    if (conversationId === activeAgentConversationId) setAgentActionsStatus("");
  } catch (error) {
    if (epoch !== agentStateEpoch || token !== agentActionLoadTokens.get(conversationId)) return;
    if (conversationId === activeAgentConversationId) setAgentActionsStatus(`Não foi possível carregar as propostas. ${error.message}`, { error: true });
  } finally {
    if (epoch === agentStateEpoch && token === agentActionLoadTokens.get(conversationId)) {
      agentActionsLoading.delete(conversationId);
      if (conversationId === activeAgentConversationId) renderAgentMessages(conversationId, { preserveScroll: true });
    }
  }
}

function isAgentActionReceiptValid(receipt) {
  return Boolean(receipt && receipt.status === "saved_as_draft" && receipt.operation === "create_draft" && typeof receipt.recordId === "string" && receipt.recordId);
}

function agentActionStatusLabel(action) {
  if (action.status === "collecting_missing_fields") return "Faltam dados";
  if (action.status === "ready_for_review") return "Pronta para revisão";
  if (action.status === "confirming") return "Confirmação em andamento";
  if (action.status === "saved_as_draft") return isAgentActionReceiptValid(action.receipt) ? "Salvo como rascunho" : "Recibo não confirmado";
  if (action.status === "cancelled") return "Cancelada";
  if (action.status === "stale") return "Precisa de revisão";
  return "Proposta";
}

function agentActionFieldDefinitions(action) {
  const payable = action.kind === "payable";
  const partyField = payable ? "creditor" : "debtor";
  return [
    { key: partyField, label: payable ? "Credor / fornecedor" : "Cliente / devedor", type: "text", required: true, maxLength: action.fields?.partyId ? 160 : 120 },
    { key: "partyId", label: "Vincular cadastro (opcional)", type: "select", options: action.options?.parties || [], hint: "Sem seleção, o nome continua em texto livre. Salve a revisão para atualizar a proposta." },
    { key: "description", label: "Descrição", type: "text", required: true, maxLength: 160 },
    { key: "documentNumber", label: "Número do documento", type: "text", maxLength: 80 },
    { key: "issueDate", label: "Data de emissão", type: "date", required: true },
    { key: "dueDate", label: "Data de vencimento", type: "date", required: true },
    { key: "competencePeriod", label: "Competência", type: "month", required: true },
    { key: "originalAmountCents", label: "Valor (R$)", type: "money", required: true },
    { key: payable ? "expenseAccountId" : "revenueAccountId", label: payable ? "Conta de classificação (despesa)" : "Conta de classificação (receita)", type: "select", required: true, options: action.options?.classificationAccounts || [] },
    { key: payable ? "liabilityAccountId" : "receivableAccountId", label: payable ? "Conta de controle (obrigação)" : "Conta de controle (recebimento)", type: "select", required: true, options: action.options?.controlAccounts || [] },
    { key: "costCenterId", label: "Centro de custo", type: "select", options: action.options?.costCenters || [] },
    { key: "notes", label: "Observações", type: "textarea", maxLength: 1000 },
  ];
}

function agentActionDomToken(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "-");
}

function agentActionFieldErrors(action, key) {
  return (Array.isArray(action.errors) ? action.errors : []).filter((item) => item && item.field === key && typeof item.message === "string");
}

function agentActionFieldLabel(action, key) {
  return agentActionFieldDefinitions(action).find((field) => field.key === key)?.label || key;
}

function makeAgentActionInput(action, definition, { disabled, missing, errors }) {
  const token = agentActionDomToken(action.id);
  const id = `agent-action-${token}-${definition.key}`;
  const errorId = `${id}-error`;
  const field = document.createElement("div");
  field.className = "agent-action-field";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = definition.label + (definition.required ? " *" : "");
  let control;
  const current = action.fields?.[definition.key];
  if (definition.type === "select") {
    control = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = definition.key === "costCenterId" ? "Sem centro de custo"
      : definition.key === "partyId" ? "Manter nome em texto livre" : "Selecione uma opção elegível";
    control.appendChild(placeholder);
    definition.options.forEach((option) => {
      if (!option || typeof option.id !== "string") return;
      const choice = document.createElement("option");
      choice.value = option.id;
      choice.textContent = definition.key === "partyId"
        ? option.label || option.name || option.id
        : `${option.code || ""}${option.code ? " · " : ""}${option.name || option.id}`;
      control.appendChild(choice);
    });
    control.value = typeof current === "string" ? current : "";
  } else if (definition.type === "textarea") {
    control = document.createElement("textarea");
    control.rows = 2;
    control.value = typeof current === "string" ? current : "";
  } else {
    control = document.createElement("input");
    control.type = definition.type === "money" ? "text" : definition.type;
    if (definition.type === "money") control.inputMode = "decimal";
    if (definition.type === "money") control.value = Number.isSafeInteger(current) ? moneyField(current) : "";
    else control.value = typeof current === "string" ? current : "";
  }
  control.id = id;
  control.name = definition.key;
  control.dataset.agentActionField = definition.key;
  control.disabled = disabled;
  if (definition.maxLength) control.maxLength = definition.maxLength;
  if (missing || errors.length) control.setAttribute("aria-invalid", "true");
  if (errors.length) control.setAttribute("aria-describedby", errorId);
  field.append(label, control);
  if (errors.length) {
    const errorText = document.createElement("span");
    errorText.className = "agent-action-field-error";
    errorText.id = errorId;
    errorText.textContent = errors.map((item) => item.message).join(" ");
    field.appendChild(errorText);
  }
  if (definition.hint) {
    const hint = document.createElement("span");
    hint.className = "agent-action-field-hint";
    hint.dataset.agentActionHint = definition.key;
    hint.textContent = definition.hint;
    field.appendChild(hint);
  } else if (missing && !errors.length) {
    const hint = document.createElement("span");
    hint.className = "agent-action-field-hint";
    hint.textContent = "Campo obrigatório";
    field.appendChild(hint);
  }
  return field;
}

function updateAgentActionPartyLink(event) {
  const partySelect = event.target.closest('select[data-agent-action-field="partyId"]');
  const partyNameField = event.target.closest('input[data-agent-action-field="creditor"], input[data-agent-action-field="debtor"]');
  const form = event.target.closest("form[data-agent-action-form]");
  if (!form) return;
  const confirmButton = $(`[data-agent-action-confirm]`, form);
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = "Salve a revisão para confirmar";
    confirmButton.title = "Salve a revisão para habilitar a confirmação.";
  }
  if (!partySelect && !partyNameField) return;
  const action = (agentActionsByConversation.get(activeAgentConversationId) || [])
    .find((item) => item.id === form.dataset.agentActionForm);
  if (!action) return;
  const selector = partySelect || $('[data-agent-action-field="partyId"]', form);
  const nameField = partyNameField || $(`[data-agent-action-field="${action.kind === "payable" ? "creditor" : "debtor"}"]`, form);
  const hint = $('[data-agent-action-hint="partyId"]', form);
  if (!selector || !nameField) return;

  if (partySelect) {
    const party = (action.options?.parties || []).find((item) => item.id === selector.value);
    if (party) {
      nameField.value = party.name;
      nameField.maxLength = 160;
      if (hint) hint.textContent = "Nome preenchido pelo cadastro. Salve a revisão; o vínculo será gravado ao confirmar o rascunho.";
    } else {
      nameField.maxLength = 120;
      if (hint) hint.textContent = nameField.value.length > 120
        ? "Texto livre aceita até 120 caracteres. Reduza o nome ou selecione um cadastro ativo."
        : "Sem seleção, o nome continua em texto livre. Salve a revisão para atualizar a proposta.";
    }
    return;
  }

  if (selector.value) {
    selector.value = "";
    nameField.maxLength = 120;
    if (hint) hint.textContent = nameField.value.length > 120
      ? "Vínculo removido. Texto livre aceita até 120 caracteres; reduza o nome ou selecione um cadastro ativo."
      : "Vínculo removido. Sem seleção, o nome continua em texto livre.";
  }
}

function addAgentActionReceipt(container, action) {
  const receipt = action.receipt;
  if (!isAgentActionReceiptValid(receipt)) return;
  const panel = document.createElement("div");
  panel.className = "agent-action-receipt";
  panel.setAttribute("role", "status");
  const title = document.createElement("strong");
  title.textContent = "Rascunho salvo";
  const detail = document.createElement("p");
  detail.textContent = `Recibo confirmado · ${action.kind === "payable" ? "Conta a pagar" : "Conta a receber"} · ID ${receipt.recordId || "—"}.`;
  const caution = document.createElement("p");
  caution.textContent = "Este rascunho não foi reconhecido, não foi postado no Diário e não foi pago nem recebido.";
  panel.append(title, detail, caution);
  if (receipt.href === "#payables" || receipt.href === "#receivables") {
    const link = document.createElement("a");
    link.className = "inline-link agent-action-receipt-link";
    link.href = receipt.href;
    link.dataset.goScreen = receipt.href.slice(1);
    link.textContent = action.kind === "payable" ? "Abrir contas a pagar" : "Abrir contas a receber";
    panel.appendChild(link);
  }
  container.appendChild(panel);
}

function addAgentActionCard(message, action) {
  const card = document.createElement("section");
  card.className = "agent-action-card";
  card.setAttribute("aria-label", action.kind === "payable" ? "Proposta de conta a pagar" : "Proposta de conta a receber");
  const header = document.createElement("div");
  header.className = "agent-action-card-heading";
  const heading = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "agent-action-eyebrow";
  eyebrow.textContent = "Proposta de rascunho";
  const title = document.createElement("h3");
  title.textContent = action.kind === "payable" ? "Conta a pagar" : "Conta a receber";
  heading.append(eyebrow, title);
  const badge = document.createElement("span");
  badge.className = `agent-action-status status-${agentActionDomToken(action.status)}`;
  badge.textContent = agentActionStatusLabel(action);
  header.append(heading, badge);
  card.appendChild(header);

  const notice = agentActionNotices.get(action.id);
  if (notice) {
    const messageLine = document.createElement("p");
    messageLine.className = "agent-action-feedback";
    messageLine.setAttribute("role", "status");
    messageLine.textContent = notice;
    card.appendChild(messageLine);
  }
  const mutationError = agentActionErrors.get(action.id);
  if (mutationError) {
    const errorLine = document.createElement("p");
    errorLine.className = "agent-action-feedback is-error";
    errorLine.setAttribute("role", "alert");
    errorLine.textContent = mutationError;
    card.appendChild(errorLine);
  }

  const editable = ["collecting_missing_fields", "ready_for_review", "stale"].includes(action.status);
  const busy = agentActionMutationIds.has(action.id);
  const form = document.createElement("form");
  form.className = "agent-action-form";
  form.dataset.agentActionForm = action.id;
  const fieldGrid = document.createElement("div");
  fieldGrid.className = "agent-action-fields";
  const missingFields = new Set(Array.isArray(action.missingFields) ? action.missingFields : []);
  const definitions = agentActionFieldDefinitions(action);
  definitions.forEach((definition) => {
    fieldGrid.appendChild(makeAgentActionInput(action, definition, {
      disabled: !editable || busy,
      missing: missingFields.has(definition.key),
      errors: agentActionFieldErrors(action, definition.key),
    }));
  });
  form.appendChild(fieldGrid);
  const unassignedErrors = (Array.isArray(action.errors) ? action.errors : []).filter((item) => item && !definitions.some((field) => field.key === item.field));
  if (unassignedErrors.length) {
    const list = document.createElement("ul");
    list.className = "agent-action-errors";
    unassignedErrors.forEach((item) => {
      const line = document.createElement("li");
      line.textContent = item.message || "Revise os dados desta proposta.";
      list.appendChild(line);
    });
    form.appendChild(list);
  }
  const actions = document.createElement("div");
  actions.className = "agent-action-buttons";
  if (editable) {
    const save = document.createElement("button");
    save.className = "button button-quiet";
    save.type = "submit";
    save.dataset.agentActionSave = action.id;
    save.disabled = busy;
    save.textContent = busy ? "Salvando…" : "Salvar revisão";
    actions.appendChild(save);
    if (action.status === "ready_for_review") {
      const confirm = document.createElement("button");
      confirm.className = "button button-primary";
      confirm.type = "button";
      confirm.dataset.agentActionConfirm = action.id;
      confirm.disabled = busy;
      confirm.textContent = busy ? "Aguarde…" : "Confirmar rascunho";
      actions.appendChild(confirm);
    }
    const cancel = document.createElement("button");
    cancel.className = "text-button agent-action-cancel";
    cancel.type = "button";
    cancel.dataset.agentActionCancel = action.id;
    cancel.disabled = busy;
    cancel.textContent = "Cancelar proposta";
    actions.appendChild(cancel);
  } else if (action.status === "confirming" || (action.status === "saved_as_draft" && !isAgentActionReceiptValid(action.receipt))) {
    const refresh = document.createElement("button");
    refresh.className = "button button-quiet";
    refresh.type = "button";
    refresh.dataset.agentActionRefresh = action.id;
    refresh.disabled = busy;
    refresh.textContent = "Verificar recibo";
    actions.appendChild(refresh);
  }
  if (editable || action.status === "confirming" || (action.status === "saved_as_draft" && !isAgentActionReceiptValid(action.receipt))) form.appendChild(actions);
  card.appendChild(form);

  const caveat = document.createElement("p");
  caveat.className = "agent-action-caveat";
  caveat.textContent = "Confirmar salva somente um rascunho. A confirmação não reconhece o fato contábil, não posta no Diário e não paga nem recebe.";
  card.appendChild(caveat);
  if (action.status === "saved_as_draft") addAgentActionReceipt(card, action);
  if (agentActionErrors.get(action.id)) {
    const retry = document.createElement("button");
    retry.className = "text-button agent-action-refresh";
    retry.type = "button";
    retry.dataset.agentActionRefresh = action.id;
    retry.textContent = "Atualizar proposta";
    card.appendChild(retry);
  }
  return card;
}

function addAgentActionsForMessage(bubble, message) {
  if (message.role !== "user" || typeof message.id !== "string") return;
  const conversationId = message.conversationId || activeAgentConversationId;
  const actions = agentActionsByConversation.get(conversationId) || [];
  actions.filter((action) => action.source.userMessageId === message.id).forEach((action) => {
    bubble.appendChild(addAgentActionCard(message, action));
  });
}

function setAgentActionInConversation(conversationId, updatedAction) {
  if (!updatedAction || typeof updatedAction.id !== "string") return;
  const actions = agentActionsByConversation.get(conversationId) || [];
  const index = actions.findIndex((action) => action.id === updatedAction.id);
  if (index === -1) actions.push(updatedAction);
  else actions[index] = updatedAction;
  agentActionsByConversation.set(conversationId, actions);
  if (conversationId === activeAgentConversationId) renderAgentMessages(conversationId, { preserveScroll: true });
}

async function submitAgentActionRevision(event) {
  const form = event.target.closest("form[data-agent-action-form]");
  if (!form) return;
  event.preventDefault();
  const conversationId = activeAgentConversationId;
  const actionId = form.dataset.agentActionForm;
  const action = (agentActionsByConversation.get(conversationId) || []).find((item) => item.id === actionId);
  if (!action || agentActionMutationIds.has(actionId)) return;
  const fields = {};
  try {
    agentActionFieldDefinitions(action).forEach((definition) => {
      const control = $(`[data-agent-action-field="${definition.key}"]`, form);
      if (!control) return;
      if (definition.type === "money") fields[definition.key] = control.value.trim() ? parseMoney(control.value) : null;
      else fields[definition.key] = control.value.trim() ? control.value.trim() : (definition.required ? "" : null);
    });
    const partyField = action.kind === "payable" ? "creditor" : "debtor";
    if (!fields.partyId && fields[partyField].length > 120) {
      throw new Error("O texto livre aceita até 120 caracteres. Selecione um cadastro para usar o nome completo.");
    }
  } catch (error) {
    agentActionErrors.set(actionId, error.message);
    renderAgentMessages(conversationId, { preserveScroll: true });
    return;
  }
  agentActionMutationIds.add(actionId);
  agentActionErrors.delete(actionId);
  agentActionNotices.set(actionId, "Salvando revisão…");
  renderAgentMessages(conversationId, { preserveScroll: true });
  try {
    const payload = await apiCall("PUT", `/api/conversas/${encodeURIComponent(conversationId)}/acoes/${encodeURIComponent(actionId)}`, { expectedVersion: action.version, fields });
    if (!payload?.action) throw new Error("A resposta da revisão está fora do formato esperado.");
    setAgentActionInConversation(conversationId, payload.action);
    agentActionNotices.set(actionId, "Revisão salva. Confira os campos e o estado atualizado antes de confirmar.");
    await loadAgentActions(conversationId);
  } catch (error) {
    agentActionErrors.set(actionId, error.message);
    agentActionNotices.delete(actionId);
    if (error.message.includes("versão da proposta mudou")) await loadAgentActions(conversationId);
  } finally {
    agentActionMutationIds.delete(actionId);
    if (conversationId === activeAgentConversationId) renderAgentMessages(conversationId, { preserveScroll: true });
  }
}

async function runAgentActionOperation(actionId, operation) {
  const conversationId = activeAgentConversationId;
  const action = (agentActionsByConversation.get(conversationId) || []).find((item) => item.id === actionId);
  if (!action || agentActionMutationIds.has(actionId)) return;
  agentActionMutationIds.add(actionId);
  agentActionErrors.delete(actionId);
  agentActionNotices.set(actionId, operation === "confirmar" ? "Confirmando proposta…" : operation === "cancelar" ? "Cancelando proposta…" : "Atualizando proposta…");
  renderAgentMessages(conversationId, { preserveScroll: true });
  try {
    if (operation === "refresh") {
      await loadAgentActions(conversationId);
      agentActionNotices.delete(actionId);
      agentActionErrors.delete(actionId);
      const refreshed = (agentActionsByConversation.get(conversationId) || []).find((item) => item.id === actionId);
      if (refreshed?.status === "saved_as_draft" && isAgentActionReceiptValid(refreshed.receipt)) {
        agentActionNotices.set(actionId, "Recibo confirmado: o rascunho foi salvo.");
      } else if (refreshed?.status === "confirming") {
        agentActionNotices.set(actionId, "A confirmação ainda está em andamento; atualize novamente para consultar o recibo.");
      }
      return;
    }
    const url = `/api/conversas/${encodeURIComponent(conversationId)}/acoes/${encodeURIComponent(actionId)}${operation === "confirmar" ? "/confirmar" : "/cancelar"}`;
    const payload = await apiCall("POST", url, { expectedVersion: action.version });
    if (!payload?.action) throw new Error("A resposta da operação está fora do formato esperado.");
    let verifyReceiptAfterRefresh = false;
    if (operation === "confirmar") {
      const receipt = payload.receipt || payload.action.receipt;
      if (payload.action.status !== "saved_as_draft" || !isAgentActionReceiptValid(receipt)) {
        if (payload.action.status !== "saved_as_draft") setAgentActionInConversation(conversationId, payload.action);
        agentActionNotices.delete(actionId);
        agentActionErrors.set(actionId, "A resposta não trouxe um recibo verificável de rascunho. Atualize a proposta para conferir o estado antes de tentar novamente.");
        verifyReceiptAfterRefresh = true;
      } else {
        setAgentActionInConversation(conversationId, { ...payload.action, receipt: payload.action.receipt || receipt });
        agentActionNotices.set(actionId, payload.traceWarning
          ? "Recibo confirmado: o rascunho foi salvo. O estado financeiro atualizado não pôde ser consultado; atualize a proposta para conferir."
          : "Recibo confirmado: o rascunho foi salvo. Ele ainda não representa reconhecimento nem lançamento contábil.");
      }
    } else {
      setAgentActionInConversation(conversationId, payload.action);
      agentActionNotices.set(actionId, "Proposta cancelada.");
    }
    await loadAgentActions(conversationId);
    if (verifyReceiptAfterRefresh) {
      const refreshed = (agentActionsByConversation.get(conversationId) || []).find((item) => item.id === actionId);
      if (refreshed?.status === "saved_as_draft" && isAgentActionReceiptValid(refreshed.receipt)) {
        agentActionErrors.delete(actionId);
        agentActionNotices.set(actionId, "Recibo confirmado: o rascunho foi salvo.");
      } else if (refreshed?.status === "saved_as_draft") {
        agentActionsByConversation.set(conversationId, (agentActionsByConversation.get(conversationId) || []).map((item) => item.id === actionId ? { ...item, status: "confirming" } : item));
      }
    }
  } catch (error) {
    agentActionNotices.delete(actionId);
    agentActionErrors.set(actionId, error.message);
    if (error.message.includes("versão da proposta mudou")) await loadAgentActions(conversationId);
  } finally {
    agentActionMutationIds.delete(actionId);
    if (conversationId === activeAgentConversationId) renderAgentMessages(conversationId, { preserveScroll: true });
  }
}

function renderAgentConversations() {
  const list = $("#agent-room-list");
  list.replaceChildren();
  agentConversations.forEach((conversation) => {
    const item = document.createElement("li");
    item.className = "agent-room-item";
    const button = document.createElement("button");
    button.className = "agent-room-button";
    button.type = "button";
    button.dataset.conversationId = conversation.id;
    button.setAttribute("aria-current", conversation.id === activeAgentConversationId ? "page" : "false");
    button.classList.toggle("is-active", conversation.id === activeAgentConversationId);
    const title = document.createElement("span");
    title.className = "agent-room-title";
    title.textContent = conversation.title || "Nova conversa";
    const metadata = document.createElement("span");
    metadata.className = "agent-room-metadata";
    const date = agentConversationDate(conversation);
    const count = Number.isFinite(conversation.messageCount) ? `${conversation.messageCount} mensagens` : "";
    metadata.textContent = [date, count].filter(Boolean).join(" · ");
    button.append(title, metadata);
    item.appendChild(button);
    list.appendChild(item);
  });
  $("#agent-room-empty").hidden = agentConversations.length > 0 || agentRoomsLoading;
}

function renderAgentWelcome() {
  const welcome = document.createElement("div");
  welcome.className = "agent-empty";
  const mark = document.createElement("span");
  mark.className = "agent-empty-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "F";
  const heading = document.createElement("h2");
  heading.textContent = "Como posso ajudar?";
  const description = document.createElement("p");
  description.textContent = "Faça uma pergunta ou escolha um ponto de partida para consultar seus dados financeiros.";
  const suggestions = document.createElement("div");
  suggestions.className = "agent-suggestions";
  suggestions.setAttribute("aria-label", "Sugestões de perguntas");
  AGENT_EMPTY_PROMPTS.forEach((question) => {
    const button = document.createElement("button");
    button.className = "agent-suggestion";
    button.type = "button";
    button.dataset.agentPrompt = question;
    button.textContent = question;
    suggestions.appendChild(button);
  });
  welcome.append(mark, heading, description, suggestions);
  $("#agent-messages").replaceChildren(welcome);
}

function addAgentMetadataLine(container, text, className = "") {
  if (!text) return;
  const line = document.createElement("p");
  line.className = className || "agent-message-reference-line";
  line.textContent = text;
  container.appendChild(line);
}

function addAgentSourceItem(source, selection) {
  if (!source || typeof source !== "object" || Array.isArray(source) || typeof source.code !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(AGENT_SOURCE_SCREENS, source.code)) return null;
  const definition = AGENT_SOURCE_SCREENS[source.code];
  const item = document.createElement("li");
  item.className = "agent-source-item";

  const title = document.createElement("div");
  title.className = "agent-source-title";
  const navButton = $$(".nav-link").find((button) => button.dataset.screen === definition.screen);
  if (navButton) {
    const link = document.createElement("button");
    link.className = "agent-source-link";
    link.type = "button";
    link.dataset.agentSourceScreen = definition.screen;
    link.setAttribute("aria-label", `Abrir ${definition.label}`);
    link.textContent = definition.label;
    title.appendChild(link);
  } else {
    const label = document.createElement("span");
    label.textContent = definition.label;
    title.appendChild(label);
  }
  item.appendChild(title);

  const sourcePeriod = agentPeriodDescription(source.period, source.fromDate, source.toDate)
    || agentPeriodDescription(selection?.period, selection?.fromDate, selection?.toDate);
  if (sourcePeriod) addAgentMetadataLine(item, `Período: ${sourcePeriod}`, "agent-source-period");

  const references = Array.isArray(source.referenceIds)
    ? source.referenceIds.map((reference) => {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
      const id = typeof reference.id === "string"
        ? reference.id.trim()
        : Number.isSafeInteger(reference.id) ? String(reference.id) : "";
      if (!id || id.length > 128) return null;
      return { ...reference, displayId: id };
    }).filter(Boolean)
    : [];
  if (references.length) {
    const count = document.createElement("p");
    count.className = "agent-source-reference-count";
    count.textContent = `${references.length} ${references.length === 1 ? "referência relacionada" : "referências relacionadas"}`;
    item.appendChild(count);
    const referenceList = document.createElement("ul");
    referenceList.className = "agent-source-reference-list";
    references.slice(0, 8).forEach((reference) => {
      const referenceItem = document.createElement("li");
      const type = typeof reference.type === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(reference.type)
        ? reference.type
        : "Referência";
      referenceItem.textContent = `${type}: ${reference.displayId}`;
      referenceList.appendChild(referenceItem);
    });
    if (references.length > 8) {
      const more = document.createElement("li");
      more.textContent = `Mais ${references.length - 8} referências.`;
      referenceList.appendChild(more);
    }
    item.appendChild(referenceList);
  }
  return item;
}

function addAgentResponseMetadata(bubble, metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return;
  const section = document.createElement("div");
  section.className = "agent-message-reference";
  section.setAttribute("aria-live", "off");

  if (isAgentIsoDate(metadata.referenceDate)) {
    addAgentMetadataLine(section, `Dados consultados em ${datePt(metadata.referenceDate)}.`);
  }
  const selection = metadata.selection && typeof metadata.selection === "object" && !Array.isArray(metadata.selection)
    ? metadata.selection
    : null;
  const selectedPeriod = selection
    ? agentPeriodDescription(selection.period, selection.fromDate, selection.toDate)
    : "";
  if (selectedPeriod) addAgentMetadataLine(section, `Período selecionado: ${selectedPeriod}`);
  if (Object.prototype.hasOwnProperty.call(AGENT_RESPONSE_LEVEL_LABELS, metadata.responseLevel)) {
    addAgentMetadataLine(section, `Nível de explicação: ${AGENT_RESPONSE_LEVEL_LABELS[metadata.responseLevel]}`);
  }

  const sourceItems = Array.isArray(metadata.sources)
    ? metadata.sources.slice(0, 20).map((source) => addAgentSourceItem(source, selection)).filter(Boolean)
    : [];
  if (sourceItems.length) {
    const sourceDetails = document.createElement("details");
    sourceDetails.className = "agent-source-details";
    const summary = document.createElement("summary");
    summary.textContent = `Fontes consultadas (${sourceItems.length})`;
    const sourceList = document.createElement("ul");
    sourceList.className = "agent-source-list";
    sourceItems.forEach((item) => sourceList.appendChild(item));
    sourceDetails.append(summary, sourceList);
    section.appendChild(sourceDetails);
  }

  const limitations = Array.isArray(metadata.limitations)
    ? metadata.limitations.filter((limitation) => typeof limitation === "string" && limitation.trim()).slice(0, 40)
    : [];
  if (limitations.length) {
    const heading = document.createElement("p");
    heading.className = "agent-message-limitations-heading";
    heading.textContent = "Limitações";
    const list = document.createElement("ul");
    list.className = "agent-message-limitations";
    limitations.forEach((limitation) => {
      const item = document.createElement("li");
      item.textContent = limitation;
      list.appendChild(item);
    });
    section.append(heading, list);
  }

  if (section.childElementCount) bubble.appendChild(section);
}

function isAgentRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAgentSafeInteger(value) {
  return Number.isSafeInteger(value);
}

function normalizeAgentWhatIfMetrics(value) {
  if (value === null) return null;
  if (!isAgentRecord(value)
    || !isAgentSafeInteger(value.currentCents)
    || !isAgentSafeInteger(value.closingCents)
    || !isAgentSafeInteger(value.minimumCents)
    || !isAgentIsoDate(value.minimumDate)
    || !(value.firstNegativeDate === null || isAgentIsoDate(value.firstNegativeDate))
    || !(value.firstNegativeCents === null || isAgentSafeInteger(value.firstNegativeCents))) return undefined;
  if ((value.firstNegativeDate === null) !== (value.firstNegativeCents === null)) return undefined;
  return {
    currentCents: value.currentCents,
    closingCents: value.closingCents,
    minimumCents: value.minimumCents,
    minimumDate: value.minimumDate,
    firstNegativeDate: value.firstNegativeDate,
    firstNegativeCents: value.firstNegativeCents,
  };
}

function normalizeAgentWhatIfSource(value) {
  if (value === null) return null;
  if (!isAgentRecord(value)
    || !["payable", "receivable"].includes(value.entityType)
    || !(typeof value.entityId === "string" || isAgentSafeInteger(value.entityId))) return undefined;
  const entityId = typeof value.entityId === "string" ? value.entityId.trim() : String(value.entityId);
  if (!entityId || entityId.length > 128) return undefined;
  return {
    entityType: value.entityType,
    entityId,
    dueDate: isAgentIsoDate(value.dueDate) ? value.dueDate : null,
    baselineDate: isAgentIsoDate(value.baselineDate) ? value.baselineDate : null,
    outstandingCents: isAgentSafeInteger(value.outstandingCents) && value.outstandingCents >= 0 ? value.outstandingCents : null,
  };
}

function normalizeAgentWhatIfStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).slice(0, 40).map((item) => item.trim().slice(0, 2000))
    : [];
}

function normalizeAgentWhatIfScenario(value) {
  if (!isAgentRecord(value)
    || value.hypothetical !== true
    || !["complete", "unavailable"].includes(value.status)
    || !isAgentIsoDate(value.referenceDate)
    || value.timeZone !== "America/Cuiaba"
    || value.timeZone.length > 80
    || !isAgentIsoDate(value.fromDate)
    || !isAgentIsoDate(value.toDate)
    || value.fromDate !== value.referenceDate
    || value.fromDate > value.toDate
    || !Number.isSafeInteger(value.horizonDays)
    || value.horizonDays < 1
    || value.horizonDays > 30
    || !isAgentRecord(value.scenario)
    || !["purchase", "payment", "settle_payable", "collect_receivable"].includes(value.scenario.type)
    || !isAgentIsoDate(value.scenario.date)
    || value.scenario.date < value.fromDate
    || value.scenario.date > value.toDate
    || !isAgentSafeInteger(value.scenario.amountCents)
    || value.scenario.amountCents <= 0) return null;

  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value.timeZone });
  } catch {
    return null;
  }

  const source = normalizeAgentWhatIfSource(value.scenario.source);
  const baseline = normalizeAgentWhatIfMetrics(value.baseline);
  const simulation = normalizeAgentWhatIfMetrics(value.simulation);
  if (source === undefined || baseline === undefined || simulation === undefined) return null;
  const requiresSource = ["settle_payable", "collect_receivable"].includes(value.scenario.type);
  if (requiresSource !== Boolean(source)
    || (source && source.entityType !== (value.scenario.type === "settle_payable" ? "payable" : "receivable"))
    || (value.status === "complete" && (!baseline || !simulation))
    || (value.status === "unavailable" && (baseline || simulation))) return null;

  return {
    status: value.status,
    referenceDate: value.referenceDate,
    timeZone: value.timeZone.trim(),
    fromDate: value.fromDate,
    toDate: value.toDate,
    horizonDays: value.horizonDays,
    scenario: {
      type: value.scenario.type,
      date: value.scenario.date,
      amountCents: value.scenario.amountCents,
      source,
    },
    baseline,
    simulation,
    assumptions: normalizeAgentWhatIfStrings(value.assumptions),
    limitations: normalizeAgentWhatIfStrings(value.limitations),
  };
}

function appendAgentWhatIfMetricCell(cell, metrics, key) {
  if (!metrics) {
    cell.textContent = "Não disponível";
    return;
  }
  if (key === "currentCents") {
    cell.textContent = formatMoney(metrics.currentCents);
    return;
  }
  if (key === "closingCents") {
    cell.textContent = formatMoney(metrics.closingCents);
    return;
  }
  if (key === "minimumCents") {
    const amount = document.createElement("strong");
    amount.textContent = formatMoney(metrics.minimumCents);
    const date = document.createElement("small");
    date.textContent = datePt(metrics.minimumDate);
    cell.append(amount, date);
    return;
  }
  if (metrics.firstNegativeDate === null) {
    cell.textContent = "Nenhuma no horizonte";
    return;
  }
  const date = document.createElement("strong");
  date.textContent = datePt(metrics.firstNegativeDate);
  const amount = document.createElement("small");
  amount.textContent = formatMoney(metrics.firstNegativeCents);
  cell.append(date, amount);
}

function addAgentWhatIfScenario(bubble, rawScenario) {
  const data = normalizeAgentWhatIfScenario(rawScenario);
  if (!data) return;

  const card = document.createElement("section");
  card.className = "agent-whatif-card";
  card.setAttribute("aria-label", "Cenário hipotético do fluxo de caixa");
  const header = document.createElement("div");
  header.className = "agent-whatif-heading";
  const heading = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "agent-action-eyebrow";
  eyebrow.textContent = "SIMULAÇÃO DE FLUXO DE CAIXA";
  const title = document.createElement("h3");
  title.textContent = "Cenário projetado";
  heading.append(eyebrow, title);
  const status = document.createElement("span");
  status.className = `agent-whatif-status${data.status === "unavailable" ? " is-unavailable" : ""}`;
  status.textContent = data.status === "complete" ? "Calculado" : "Indisponível";
  header.append(heading, status);
  card.appendChild(header);

  const warning = document.createElement("p");
  warning.className = "agent-whatif-warning";
  warning.setAttribute("role", "note");
  warning.textContent = "HIPOTÉTICO — não altera registros";
  card.appendChild(warning);

  const context = document.createElement("div");
  context.className = "agent-whatif-context";
  const scenarioTypeLabels = {
    outflow: "Saída de caixa",
    inflow: "Entrada de caixa",
    payable: "Conta a pagar",
    receivable: "Conta a receber",
    expense: "Despesa",
    revenue: "Receita",
    purchase: "Compra",
    payment: "Pagamento",
    settle_payable: "Liquidação de conta a pagar",
    collect_receivable: "Recebimento de conta a receber",
  };
  const typeKey = data.scenario.type.toLowerCase();
  const scenarioType = scenarioTypeLabels[typeKey] || data.scenario.type.replace(/[_-]+/g, " ");
  const scenarioLine = document.createElement("p");
  scenarioLine.textContent = `Cenário: ${scenarioType} · ${datePt(data.scenario.date)} · ${formatMoney(data.scenario.amountCents)}`;
  const periodLine = document.createElement("p");
  periodLine.textContent = `Referência: ${datePt(data.referenceDate)} (${data.timeZone}) · Horizonte: ${datePt(data.fromDate)} a ${datePt(data.toDate)} · ${data.horizonDays} dias`;
  context.append(scenarioLine, periodLine);
  card.appendChild(context);

  const comparisonHeading = document.createElement("h4");
  comparisonHeading.className = "agent-whatif-comparison-title";
  comparisonHeading.textContent = "Baseline e cenário";
  card.appendChild(comparisonHeading);
  const tableWrap = document.createElement("div");
  tableWrap.className = "agent-whatif-table-wrap";
  const table = document.createElement("table");
  table.className = "agent-whatif-table";
  const caption = document.createElement("caption");
  caption.className = "visually-hidden";
  caption.textContent = "Comparação entre o saldo sem o cenário e o saldo com o cenário hipotético";
  table.appendChild(caption);
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Indicador", "Baseline", "Com cenário"].forEach((label) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headerRow.appendChild(cell);
  });
  head.appendChild(headerRow);
  table.appendChild(head);
  const body = document.createElement("tbody");
  [
    ["Saldo atual", "currentCents"],
    ["Saldo no fim do horizonte", "closingCents"],
    ["Menor saldo", "minimumCents"],
    ["Primeira data negativa", "firstNegativeDate"],
  ].forEach(([label, key]) => {
    const row = document.createElement("tr");
    const rowHeading = document.createElement("th");
    rowHeading.scope = "row";
    rowHeading.textContent = label;
    row.appendChild(rowHeading);
    [data.baseline, data.simulation].forEach((metrics) => {
      const cell = document.createElement("td");
      appendAgentWhatIfMetricCell(cell, metrics, key);
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  table.appendChild(body);
  tableWrap.appendChild(table);
  card.appendChild(tableWrap);

  if (data.scenario.source) {
    const source = data.scenario.source;
    const sourceBlock = document.createElement("div");
    sourceBlock.className = "agent-whatif-source";
    const sourceText = document.createElement("p");
    const sourceType = source.entityType === "payable" ? "Conta a pagar" : "Conta a receber";
    const sourceDetails = [`${sourceType} original`];
    if (source.dueDate) sourceDetails.push(`vence ${datePt(source.dueDate)}`);
    if (source.outstandingCents !== null) {
      sourceDetails.push(`saldo em aberto ${formatMoney(source.outstandingCents)}${source.baselineDate ? ` em ${datePt(source.baselineDate)}` : ""}`);
    } else if (source.baselineDate) {
      sourceDetails.push(`referência em ${datePt(source.baselineDate)}`);
    }
    sourceText.textContent = `${sourceDetails.join(" · ")}.`;
    const sourceLink = document.createElement("button");
    sourceLink.className = "text-button";
    sourceLink.type = "button";
    sourceLink.dataset.openTitle = source.entityType;
    sourceLink.dataset.id = source.entityId;
    sourceLink.setAttribute("aria-label", `Abrir ${sourceType.toLowerCase()} original`);
    sourceLink.textContent = "Abrir título original";
    sourceBlock.append(sourceText, sourceLink);
    card.appendChild(sourceBlock);
  }

  if (data.assumptions.length || data.limitations.length) {
    const notes = document.createElement("div");
    notes.className = "agent-whatif-notes";
    if (data.assumptions.length) {
      const assumptionsHeading = document.createElement("h4");
      assumptionsHeading.textContent = "Premissas";
      const assumptions = document.createElement("ul");
      data.assumptions.forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        assumptions.appendChild(item);
      });
      notes.append(assumptionsHeading, assumptions);
    }
    if (data.limitations.length) {
      const limitationsHeading = document.createElement("h4");
      limitationsHeading.textContent = "Avisos e limitações";
      const limitations = document.createElement("ul");
      data.limitations.forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        limitations.appendChild(item);
      });
      notes.append(limitationsHeading, limitations);
    }
    card.appendChild(notes);
  }
  bubble.appendChild(card);
}

function addAgentFollowUps(bubble, conversationId) {
  const group = document.createElement("div");
  group.className = "agent-follow-ups";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Perguntas de acompanhamento");
  group.setAttribute("aria-live", "off");
  const busy = agentSendingConversations.has(conversationId) || agentConversationHasPendingMessage(conversationId);
  AGENT_FOLLOW_UP_PROMPTS.forEach((question) => {
    const button = document.createElement("button");
    button.className = "agent-follow-up";
    button.type = "button";
    button.dataset.agentPrompt = question;
    button.textContent = question;
    button.disabled = busy;
    group.appendChild(button);
  });
  bubble.appendChild(group);
}

function addAgentBubble(message) {
  const role = message.role === "user" ? "user" : "assistant";
  const bubble = document.createElement("article");
  bubble.className = `agent-message ${role}`;
  const label = document.createElement("span");
  label.className = "agent-message-label";
  label.textContent = role === "user" ? "Você" : "Agente Pro247";
  const text = document.createElement("p");
  text.className = "agent-message-text";
  text.textContent = typeof message.content === "string" ? message.content : "";
  bubble.append(label, text);

  const pending = role === "user" && (message.status === "pending" || agentPendingSends.has(message.clientMessageId));
  if (pending) {
    const status = document.createElement("span");
    status.className = "agent-message-status";
    const pendingLevel = normalizeAgentResponseLevel(message.responseLevel || agentPendingSends.get(message.clientMessageId)?.responseLevel);
    status.textContent = `Resposta pendente · nível ${AGENT_RESPONSE_LEVEL_LABELS[pendingLevel]}`;
    bubble.appendChild(status);
    if (message.clientMessageId) {
      const actions = document.createElement("div");
      actions.className = "agent-message-actions";
      const retry = document.createElement("button");
      retry.className = "text-button";
      retry.type = "button";
      retry.dataset.retryAgentMessage = message.clientMessageId;
      retry.textContent = "Tentar novamente";
      retry.disabled = activeAgentConversationId !== message.conversationId || agentSendingConversations.has(message.conversationId);
      actions.appendChild(retry);
      bubble.appendChild(actions);
    }
  }

  if (role === "user") addAgentActionsForMessage(bubble, message);

  if (role === "assistant") {
    addAgentWhatIfScenario(bubble, message.responseMetadata?.whatIfScenario);
    addAgentResponseMetadata(bubble, message.responseMetadata);
    if (message.status === "completed") addAgentFollowUps(bubble, message.conversationId || activeAgentConversationId);
  }
  return bubble;
}

function renderAgentMessages(conversationId = activeAgentConversationId, { preserveScroll = false, forceBottom = false } = {}) {
  if (!conversationId || conversationId !== activeAgentConversationId) return;
  const container = $("#agent-messages");
  const oldTop = container.scrollTop;
  const oldHeight = container.scrollHeight;
  const nearBottom = isAgentMessagesNearBottom();
  const messages = agentConversationMessages(conversationId);
  container.replaceChildren();
  container.setAttribute("aria-busy", String(agentConversationLoading && messages.length === 0));
  if (agentConversationLoading && messages.length === 0) {
    const loading = document.createElement("p");
    loading.className = "agent-history-loading";
    loading.setAttribute("role", "status");
    loading.textContent = "Carregando conversa…";
    container.appendChild(loading);
  } else if (!messages.length) {
    renderAgentWelcome();
  } else {
    messages.forEach((message) => container.appendChild(addAgentBubble(message)));
  }
  if (preserveScroll) {
    container.scrollTop = oldTop + (container.scrollHeight - oldHeight);
  } else if (forceBottom || nearBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

function updateAgentComposerState() {
  const sending = activeAgentConversationId && agentSendingConversations.has(activeAgentConversationId);
  const pending = activeAgentConversationId && agentConversationHasPendingMessage(activeAgentConversationId);
  $("#agent-input").disabled = Boolean(sending || pending);
  $("#agent-submit").disabled = !agentConfigured || Boolean(sending || pending);
  $("#agent-submit").textContent = sending ? "Aguarde…" : "Enviar";
  $("#agent-new-conversation").disabled = agentCreateBusy;
  $("#agent-load-older").disabled = agentLoadingOlder;
  $("#agent-load-older").hidden = !agentHasMoreMessages || !activeAgentConversationId;
}

function upsertAgentConversation(conversation) {
  if (!conversation || typeof conversation.id !== "string") return;
  const index = agentConversations.findIndex((item) => item.id === conversation.id);
  if (index === -1) agentConversations.unshift(conversation);
  else agentConversations[index] = { ...agentConversations[index], ...conversation };
  renderAgentConversations();
}

async function updateAgentKeyStatus() {
  const epoch = agentStateEpoch;
  try {
    const { configured } = await request("/api/config/deepseek");
    if (epoch !== agentStateEpoch) return false;
    agentConfigured = Boolean(configured);
    $("#agent-provider-label").textContent = agentConfigured ? "DeepSeek pronto" : "Configure a chave DeepSeek";
    $("#agent-provider-dot").classList.toggle("is-ready", agentConfigured);
    $("#agent-key-required").hidden = agentConfigured;
    updateAgentComposerState();
    return agentConfigured;
  } catch (error) {
    if (epoch !== agentStateEpoch) return false;
    agentConfigured = false;
    $("#agent-provider-label").textContent = "DeepSeek indisponível";
    $("#agent-provider-dot").classList.remove("is-ready");
    $("#agent-key-required").hidden = false;
    $("#agent-key-required span").textContent = error.message;
    updateAgentComposerState();
    return false;
  }
}

async function initializeAgentWorkspace() {
  updateAgentKeyStatus();
  if (!agentConversationsLoaded && !agentRoomsLoading) await loadAgentConversations();
}

async function loadAgentConversations({ silent = false } = {}) {
  if (agentRoomsLoading) return;
  const epoch = agentStateEpoch;
  agentRoomsLoading = true;
  if (!silent) setAgentRoomListStatus(agentConversationsLoaded ? "Atualizando conversas…" : "Carregando conversas…");
  renderAgentConversations();
  let succeeded = false;
  try {
    const payload = await request("/api/conversas?limit=100");
    if (epoch !== agentStateEpoch) return;
    if (!payload || !Array.isArray(payload.conversations)) throw new Error("A resposta da lista de conversas está fora do formato esperado.");
    const fresh = payload.conversations.filter((item) => item && typeof item.id === "string");
    const freshIds = new Set(fresh.map((item) => item.id));
    const recentLocal = agentConversations.filter((item) => !freshIds.has(item.id));
    agentConversations = [...fresh, ...recentLocal].sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    agentConversationsLoaded = true;
    succeeded = true;
    setAgentRoomListStatus("");
    renderAgentConversations();
    if (!activeAgentConversationId) {
      const latest = agentConversations.slice().sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0];
      if (latest) await openAgentConversation(latest.id, { conversation: latest, focus: false });
      else {
        $("#agent-conversation-title").textContent = "Nova conversa";
        agentHasMoreMessages = false;
        agentNextBeforeSequence = null;
        renderAgentWelcome();
      }
    }
  } catch (error) {
    if (epoch !== agentStateEpoch) return;
    setAgentRoomListStatus(error.message, { error: true, retryMode: "list" });
  } finally {
    if (epoch === agentStateEpoch) {
      agentRoomsLoading = false;
      if (succeeded) setAgentRoomListStatus("");
      renderAgentConversations();
    }
  }
}

async function openAgentConversation(conversationId, { conversation = null, focus = true, skipLoad = false } = {}) {
  if (typeof conversationId !== "string" || !conversationId) return;
  const token = ++agentConversationLoadToken;
  const epoch = agentStateEpoch;
  const previousConversationId = activeAgentConversationId;
  agentDrafts.set(previousConversationId || "__new__", $("#agent-input").value);
  activeAgentConversationId = conversationId;
  $("#agent-input").value = agentDrafts.get(conversationId) || "";
  const current = conversation || agentConversations.find((item) => item.id === conversationId);
  if (current) upsertAgentConversation(current);
  const room = agentConversations.find((item) => item.id === conversationId);
  $("#agent-conversation-title").textContent = room?.title || "Nova conversa";
  agentHasMoreMessages = false;
  agentNextBeforeSequence = null;
  agentLoadingOlder = false;
  setAgentConversationStatus("");
  $("#agent-room-rail").classList.remove("is-open");
  $("#agent-room-list-toggle").setAttribute("aria-expanded", "false");
  renderAgentConversations();
  updateAgentComposerState();
  if (focus) $("#agent-input").focus();
  loadAgentActions(conversationId);

  if (skipLoad) {
    agentConversationLoading = false;
    if (!agentConversationCache.has(conversationId)) agentConversationCache.set(conversationId, []);
    renderAgentMessages(conversationId, { forceBottom: true });
    return;
  }

  agentConversationLoading = true;
  renderAgentMessages(conversationId);
  try {
    const payload = await request(`/api/conversas/${encodeURIComponent(conversationId)}?limit=50`);
    if (epoch !== agentStateEpoch || token !== agentConversationLoadToken || activeAgentConversationId !== conversationId) return;
    if (!payload || !Array.isArray(payload.messages) || !payload.conversation) throw new Error("A resposta da conversa está fora do formato esperado.");
    upsertAgentConversation(payload.conversation);
    $("#agent-conversation-title").textContent = payload.conversation.title || "Nova conversa";
    const cached = agentConversationCache.get(conversationId) || [];
    const merged = mergeAgentMessages(cached, payload.messages);
    agentConversationCache.set(conversationId, merged);
    payload.messages.forEach((message) => {
      if (message.role !== "user" || !message.clientMessageId) return;
      if (message.status === "pending") {
        agentPendingSends.set(message.clientMessageId, {
          conversationId,
          clientMessageId: message.clientMessageId,
          content: message.content,
          responseLevel: normalizeAgentResponseLevel(message.responseLevel),
          error: "",
        });
      } else {
        agentPendingSends.delete(message.clientMessageId);
      }
    });
    agentHasMoreMessages = Boolean(payload.hasMore && payload.nextBeforeSequence !== null && payload.nextBeforeSequence !== undefined);
    agentNextBeforeSequence = agentHasMore ? payload.nextBeforeSequence : null;
    agentConversationLoading = false;
    setAgentConversationStatus("");
    renderAgentConversations();
    updateAgentComposerState();
    renderAgentMessages(conversationId, { forceBottom: true });
  } catch (error) {
    if (epoch !== agentStateEpoch || token !== agentConversationLoadToken || activeAgentConversationId !== conversationId) return;
    agentConversationLoading = false;
    setAgentConversationStatus(error.message, { retry: true });
    renderAgentMessages(conversationId);
  }
}

async function loadOlderAgentMessages() {
  const conversationId = activeAgentConversationId;
  if (!conversationId || !agentHasMoreMessages || agentNextBeforeSequence === null || agentLoadingOlder) return;
  const token = agentConversationLoadToken;
  const epoch = agentStateEpoch;
  agentLoadingOlder = true;
  updateAgentComposerState();
  setAgentConversationStatus("Carregando mensagens anteriores…");
  try {
    const query = new URLSearchParams({ limit: "50", beforeSequence: String(agentNextBeforeSequence) });
    const payload = await request(`/api/conversas/${encodeURIComponent(conversationId)}?${query}`);
    if (epoch !== agentStateEpoch || token !== agentConversationLoadToken || activeAgentConversationId !== conversationId) return;
    if (!payload || !Array.isArray(payload.messages)) throw new Error("A resposta da conversa está fora do formato esperado.");
    const cached = agentConversationCache.get(conversationId) || [];
    agentConversationCache.set(conversationId, mergeAgentMessages(cached, payload.messages));
    payload.messages.forEach((message) => {
      if (message.role === "user" && message.status === "pending" && message.clientMessageId) {
        agentPendingSends.set(message.clientMessageId, {
          conversationId,
          clientMessageId: message.clientMessageId,
          content: message.content,
          responseLevel: normalizeAgentResponseLevel(message.responseLevel),
          error: "",
        });
      }
    });
    agentHasMoreMessages = Boolean(payload.hasMore && payload.nextBeforeSequence !== null && payload.nextBeforeSequence !== undefined);
    agentNextBeforeSequence = agentHasMoreMessages ? payload.nextBeforeSequence : null;
    setAgentConversationStatus("");
    renderAgentMessages(conversationId, { preserveScroll: true });
  } catch (error) {
    if (epoch !== agentStateEpoch || token !== agentConversationLoadToken || activeAgentConversationId !== conversationId) return;
    setAgentConversationStatus(error.message, { retry: true });
  } finally {
    if (epoch === agentStateEpoch && token === agentConversationLoadToken) {
      agentLoadingOlder = false;
      updateAgentComposerState();
    }
  }
}

async function createAgentConversation({ title = "" } = {}) {
  if (agentCreateBusy) return null;
  const epoch = agentStateEpoch;
  if (!agentCreateRequestId) {
    agentCreateRequestId = uuid();
    agentCreateTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  const clientRequestId = agentCreateRequestId;
  const body = { clientRequestId };
  if (agentCreateTitle) body.title = agentCreateTitle;
  agentCreateBusy = true;
  setAgentRoomListStatus("Criando conversa…");
  updateAgentComposerState();
  try {
    const payload = await apiCall("POST", "/api/conversas", body);
    if (epoch !== agentStateEpoch) return null;
    if (!payload?.conversation || typeof payload.conversation.id !== "string") throw new Error("A resposta de criação da conversa está fora do formato esperado.");
    const conversation = payload.conversation;
    agentCreateRequestId = null;
    agentCreateTitle = "";
    setAgentRoomListStatus("");
    upsertAgentConversation(conversation);
    await openAgentConversation(conversation.id, { conversation, focus: true, skipLoad: true });
    return conversation;
  } catch (error) {
    if (epoch === agentStateEpoch) {
      setAgentRoomListStatus(error.message, { error: true, retryMode: "create" });
      throw error;
    }
    return null;
  } finally {
    if (epoch === agentStateEpoch) {
      agentCreateBusy = false;
      updateAgentComposerState();
      renderAgentConversations();
    }
  }
}

async function sendAgentMessage(content, clientMessageId = uuid(), responseLevel = agentResponseLevel) {
  const conversationId = activeAgentConversationId;
  const messageText = String(content || "").trim();
  if (!conversationId || !messageText || agentSendingConversations.has(conversationId)) return;
  const epoch = agentStateEpoch;
  const priorPending = agentPendingSends.get(clientMessageId);
  const messageResponseLevel = normalizeAgentResponseLevel(priorPending?.responseLevel || responseLevel);
  const pending = agentPendingSends.get(clientMessageId) || {
    conversationId,
    clientMessageId,
    content: messageText,
    responseLevel: messageResponseLevel,
    error: "",
  };
  pending.conversationId = conversationId;
  pending.content = messageText;
  pending.responseLevel = normalizeAgentResponseLevel(pending.responseLevel || messageResponseLevel);
  pending.error = "";
  agentPendingSends.set(clientMessageId, pending);
  const before = agentConversationMessages(conversationId);
  const userMessage = before.find((message) => message.role === "user" && message.clientMessageId === clientMessageId) || {
    conversationId,
    clientMessageId,
    role: "user",
    content: messageText,
    status: "pending",
    responseLevel: pending.responseLevel,
    createdAt: new Date().toISOString(),
  };
  agentConversationCache.set(conversationId, mergeAgentMessages(before, [userMessage]));
  agentSendingConversations.add(conversationId);
  sendFormError($("#agent-error"), "");
  updateAgentComposerState();
  renderAgentMessages(conversationId);
  try {
    const payload = await apiCall("POST", `/api/conversas/${encodeURIComponent(conversationId)}/mensagens`, {
      clientMessageId,
      content: messageText,
      responseLevel: pending.responseLevel,
    });
    if (epoch !== agentStateEpoch) return;
    if (!payload?.userMessage || !payload?.assistantMessage) throw new Error("A resposta da mensagem está fora do formato esperado.");
    const cached = agentConversationMessages(conversationId);
    agentConversationCache.set(conversationId, mergeAgentMessages(cached, [payload.userMessage, payload.assistantMessage]));
    if (payload.userMessage.status === "pending") {
      agentPendingSends.set(clientMessageId, {
        ...pending,
        content: payload.userMessage.content || messageText,
        responseLevel: normalizeAgentResponseLevel(payload.userMessage.responseLevel || pending.responseLevel),
      });
    } else {
      agentPendingSends.delete(clientMessageId);
    }
    const roomIndex = agentConversations.findIndex((item) => item.id === conversationId);
    if (roomIndex !== -1) {
      const room = { ...agentConversations[roomIndex] };
      room.updatedAt = payload.assistantMessage.createdAt || payload.userMessage.createdAt || room.updatedAt;
      room.lastMessageAt = payload.assistantMessage.createdAt || payload.userMessage.createdAt || room.lastMessageAt;
      agentConversations[roomIndex] = room;
      renderAgentConversations();
    }
    if (activeAgentConversationId === conversationId) {
      setAgentConversationStatus("");
      renderAgentMessages(conversationId);
    }
    loadAgentActions(conversationId);
    loadAgentConversations({ silent: true });
  } catch (error) {
    if (epoch !== agentStateEpoch) return;
    const current = agentPendingSends.get(clientMessageId) || pending;
    current.error = error.message;
    agentPendingSends.set(clientMessageId, current);
    if (activeAgentConversationId === conversationId) {
      sendFormError($("#agent-error"), `A resposta não foi concluída. A mensagem foi mantida para uma nova tentativa. ${error.message}`);
      renderAgentMessages(conversationId);
    }
  } finally {
    if (epoch === agentStateEpoch) {
      agentSendingConversations.delete(conversationId);
      updateAgentComposerState();
      if (activeAgentConversationId === conversationId) renderAgentMessages(conversationId);
    }
  }
}

async function submitAgentMessage(event) {
  event.preventDefault();
  const input = $("#agent-input");
  const content = input.value.trim();
  if (!content || !agentConfigured || (activeAgentConversationId && agentConversationHasPendingMessage(activeAgentConversationId))) return;
  sendFormError($("#agent-error"), "");
  try {
    if (!activeAgentConversationId) {
      const conversation = await createAgentConversation({ title: content });
      if (!conversation) return;
      agentDrafts.delete("__new__");
    }
    input.value = "";
    agentDrafts.set(activeAgentConversationId, "");
    await sendAgentMessage(content);
  } catch (error) {
    sendFormError($("#agent-error"), error.message);
  }
}

async function submitAgentSuggestion(question) {
  if (activeAgentConversationId && (agentSendingConversations.has(activeAgentConversationId) || agentConversationHasPendingMessage(activeAgentConversationId))) return;
  const input = $("#agent-input");
  input.value = question;
  input.focus();
  if (!agentConfigured) {
    sendFormError($("#agent-error"), "Configure a chave DeepSeek para enviar esta pergunta.");
    return;
  }
  try {
    if (!activeAgentConversationId) {
      const conversation = await createAgentConversation({ title: question });
      if (!conversation) return;
      agentDrafts.delete("__new__");
    }
    input.value = "";
    agentDrafts.set(activeAgentConversationId, "");
    await sendAgentMessage(question);
  } catch (error) {
    sendFormError($("#agent-error"), error.message);
  }
}

async function retryAgentMessage(clientMessageId) {
  const pending = agentPendingSends.get(clientMessageId);
  if (!pending || pending.conversationId !== activeAgentConversationId || agentSendingConversations.has(pending.conversationId)) return;
  sendFormError($("#agent-error"), "");
  await sendAgentMessage(pending.content, clientMessageId, pending.responseLevel);
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function sendFormError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function apiCall(method, url, body) {
  return request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function refreshFinance() {
  const result = await request("/api/financeiro");
  finance = result.financeiro;
  renderAll();
  if (activeScreen === "budgets") {
    if (budgetCurrentView === "programacao") await loadBudgetPlans();
    else await loadBudgetReport().catch((error) => setReportState("budget-report-state", error.message, true));
  }
}

function degreeForSubcategory(id) {
  let current = finance.subcategories.find((item) => item.id === id);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentType === "degree") return finance.degrees.find((item) => item.id === current.parentId) || null;
    current = finance.subcategories.find((item) => item.id === current.parentId) || null;
  }
  return null;
}
function degreeForAccount(id) {
  const account = finance.planAccounts.find((item) => item.id === id);
  return account ? degreeForSubcategory(account.subcategoryId) : null;
}
function accountGroup(id) { return degreeForAccount(id)?.number ?? null; }
function subcategoryCode(id, seen = new Set()) {
  const item = finance.subcategories.find((candidate) => candidate.id === id);
  if (!item || seen.has(item.id)) return "";
  seen.add(item.id);
  const parent = item.parentType === "degree"
    ? String(finance.degrees.find((degree) => degree.id === item.parentId)?.number || "")
    : subcategoryCode(item.parentId, seen);
  seen.delete(item.id);
  return parent ? `${parent}.${item.number}` : "";
}
function accountCode(id) {
  const account = finance.planAccounts.find((candidate) => candidate.id === id);
  return account ? `${subcategoryCode(account.subcategoryId)}.${account.number}` : "";
}
function accountPath(id) {
  const account = finance.planAccounts.find((candidate) => candidate.id === id);
  if (!account) return "Conta removida";
  const path = [account.name];
  let current = finance.subcategories.find((item) => item.id === account.subcategoryId);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parentType === "subcategory" ? finance.subcategories.find((item) => item.id === current.parentId) : null;
  }
  const degree = degreeForAccount(id);
  if (degree) path.unshift(degree.name);
  return `${accountCode(id)} — ${path.join(" › ")}`;
}
function planAccount(id) { return finance.planAccounts.find((item) => item.id === id) || null; }
function accountOptions(accounts = finance.planAccounts.filter((item) => item.postable)) {
  return accounts.slice().sort((a, b) => accountCode(a.id).localeCompare(accountCode(b.id), "pt-BR", { numeric: true }))
    .map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(accountPath(account.id))}</option>`).join("");
}
function fillAccountSelect(select, accounts, placeholder = "Selecione uma conta", selected = "") {
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${accountOptions(accounts)}`;
  if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
}
function activeCostCenterOptions(selected = "", includeInactive = false) {
  const items = finance.costCenters.filter((center) => includeInactive || center.active).slice().sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
  return `<option value="">Sem centro de custo</option>${items.map((center) => `<option value="${escapeHtml(center.id)}" ${center.id === selected ? "selected" : ""}>${escapeHtml(center.code)} — ${escapeHtml(center.name)}${center.active ? "" : " (inativo)"}</option>`).join("")}`;
}
function cashAccounts() { return finance.planAccounts.filter((account) => account.postable && account.cashEquivalent); }
function accountsByGroup(groups) { return finance.planAccounts.filter((account) => account.postable && groups.includes(accountGroup(account.id))); }

function budgetMonthlyDates(firstDueDate, count) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate || "")) throw new Error("Informe um primeiro vencimento válido.");
  const [year, month, day] = firstDueDate.split("-").map(Number);
  const actualFirstDay = new Date(Date.UTC(year, month - 1, day));
  if (actualFirstDay.toISOString().slice(0, 10) !== firstDueDate) throw new Error("Informe um primeiro vencimento válido.");
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error("A quantidade deve estar entre 1 e 1.000 vencimentos.");
  return Array.from({ length: count }, (_, index) => {
    const absoluteMonth = year * 12 + month - 1 + index;
    const nextYear = Math.floor(absoluteMonth / 12);
    const nextMonth = absoluteMonth % 12 + 1;
    if (nextYear > 9999) throw new Error("A programação mensal não pode ultrapassar o ano 9999.");
    const monthDays = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
    const nextDay = Math.min(day, monthDays);
    return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
  });
}

function budgetStatusLabel(status) {
  return ({ planned: "Previsto", converted: "Efetivado", cancelled: "Cancelado", active: "Ativo", archived: "Arquivado" })[status] || status;
}

function budgetPartyOptions(select, direction, selectedId = "") {
  const role = direction === "payable" ? "supplier" : "customer";
  const available = (finance.parties || []).filter((party) => party.roles?.includes(role) && (party.active || party.id === selectedId));
  select.innerHTML = `<option value="">${direction === "payable" ? "Nome livre / sem cadastro" : "Nome livre / sem cadastro"}</option>`
    + available.map((party) => `<option value="${escapeHtml(party.id)}" ${party.id === selectedId ? "selected" : ""} ${party.active ? "" : "disabled"}>${escapeHtml(party.name)}${party.active ? "" : " (inativo)"}</option>`).join("");
  if (selectedId && [...select.options].some((option) => option.value === selectedId)) select.value = selectedId;
}

function budgetAccountOptions(select, direction, selectedId = "", placeholder = "Sem classificação sugerida") {
  fillAccountSelect(select, accountsByGroup(direction === "payable" ? [5, 6] : [4]), placeholder, selectedId);
}

function setBudgetState(message, error = false) {
  const node = $("#budget-list-state");
  node.textContent = message;
  node.classList.toggle("is-error", error);
}

function renderBudgetList(orcamentos) {
  const body = $("#budget-list-body");
  if (!orcamentos.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-table">Nenhuma programação corresponde aos filtros.</td></tr>';
    setBudgetState("Nenhum orçamento encontrado.");
    return;
  }
  let pendingOccurrences = 0;
  body.innerHTML = orcamentos.map((budget) => {
    const pending = budget.occurrences.filter((item) => item.status === "planned");
    const converted = budget.occurrences.filter((item) => item.status === "converted").length;
    const cancelled = budget.occurrences.filter((item) => item.status === "cancelled").length;
    const activePending = budget.status === "active" ? pending : [];
    pendingOccurrences += activePending.length;
    const pendingCents = activePending.reduce((sum, item) => sum + item.plannedAmountCents, 0);
    const next = activePending.map((item) => item.plannedDueDate).sort()[0];
    return `<tr>
      <td><button class="report-row-link" type="button" data-budget-open="${escapeHtml(budget.id)}"><strong>${escapeHtml(budget.title)}</strong><small>${budget.occurrences.length} vencimento(s)${next ? ` · próximo ${datePt(next)}` : ""}</small></button></td>
      <td>${budget.direction === "payable" ? "Despesa" : "Receita"}</td>
      <td>${escapeHtml(budget.partySnapshotName || "—")}</td>
      <td>${pending.length} previsto(s) · ${converted} efetivado(s) · ${cancelled} cancelado(s)</td>
      <td class="number-cell">${formatMoney(pendingCents)}</td>
      <td><span class="status ${budget.status === "active" ? "status-open" : "status-cancelled"}">${budgetStatusLabel(budget.status)}</span></td>
      <td class="actions-cell"><button class="button button-quiet button-small" type="button" data-budget-open="${escapeHtml(budget.id)}">Abrir</button>
        <button class="button button-quiet button-small" type="button" data-budget-action="${budget.status === "active" ? "archive" : "restore"}" data-budget-id="${escapeHtml(budget.id)}">${budget.status === "active" ? "Arquivar" : "Reativar"}</button></td>
    </tr>`;
  }).join("");
  setBudgetState(`${orcamentos.length} orçamento(s) · ${pendingOccurrences} vencimento(s) previsto(s) em planos ativos.`);
}

async function loadBudgetPlans() {
  if (!finance) return;
  setBudgetState("Carregando programações…");
  const params = new URLSearchParams({
    q: $("#budget-list-search").value.trim(),
    direction: $("#budget-list-direction").value,
    planStatus: $("#budget-list-plan-status").value,
    occurrenceStatus: $("#budget-list-occurrence-status").value,
  });
  try {
    const { orcamentos } = await request(`/api/orcamentos?${params}`);
    renderBudgetList(orcamentos);
  } catch (error) { setBudgetState(`Não foi possível carregar os orçamentos: ${error.message}`, true); }
}

function setBudgetView(view) {
  budgetCurrentView = view === "relatorio" ? "relatorio" : "programacao";
  const programming = budgetCurrentView === "programacao";
  $("#budget-programming-view").hidden = !programming;
  $("#budget-report-view").hidden = programming;
  $("#budget-tab-programacao").classList.toggle("is-active", programming);
  $("#budget-tab-relatorio").classList.toggle("is-active", !programming);
  $("#budget-tab-programacao").setAttribute("aria-selected", String(programming));
  $("#budget-tab-relatorio").setAttribute("aria-selected", String(!programming));
  $("#budget-tab-programacao").tabIndex = programming ? 0 : -1;
  $("#budget-tab-relatorio").tabIndex = programming ? -1 : 0;
  if (programming) loadBudgetPlans(); else loadBudgetReport().catch((error) => setReportState("budget-report-state", error.message, true));
}

function renderBudgetOccurrenceRow(occurrence = {}, readonly = false) {
  const id = occurrence.id || "";
  return `<tr data-budget-occurrence-id="${escapeHtml(id)}">
    <td><input class="budget-row-date" type="date" aria-label="Vencimento previsto" value="${escapeHtml(occurrence.plannedDueDate || "")}" required ${readonly ? "disabled" : ""}></td>
    <td class="number-cell"><input class="budget-row-amount" type="text" inputmode="decimal" aria-label="Valor previsto em reais" value="${Number.isSafeInteger(occurrence.plannedAmountCents) ? escapeHtml(moneyField(occurrence.plannedAmountCents)) : ""}" required ${readonly ? "disabled" : ""}></td>
    <td><input class="budget-row-notes" type="text" maxlength="500" aria-label="Observação do vencimento" value="${escapeHtml(occurrence.notes || "")}" ${readonly ? "disabled" : ""}></td>
    <td class="actions-cell">${readonly ? "—" : `<button class="button button-quiet button-small" type="button" data-budget-row-remove>${id ? "Cancelar" : "Remover"}</button>`}</td>
  </tr>`;
}

function updateBudgetOccurrenceCount() {
  const count = $$("#budget-occurrence-rows tr").length;
  $("#budget-occurrence-count-label").textContent = count ? `${count} vencimento(s) na programação.` : "Adicione pelo menos um vencimento previsto.";
}

function renderBudgetHistory(budget) {
  const history = budget.occurrences.filter((item) => item.status !== "planned");
  $("#budget-history").hidden = !history.length;
  $("#budget-history-body").innerHTML = history.map((occurrence) => {
    if (occurrence.status === "cancelled") return `<tr><td>${datePt(occurrence.plannedDueDate)}</td><td class="number-cell">${formatMoney(occurrence.plannedAmountCents)}</td><td><span class="status status-cancelled">Cancelado</span></td><td>—</td></tr>`;
    const kind = occurrence.documentType;
    const document = kind === "payable" ? finance.payables.find((item) => item.id === occurrence.documentId) : finance.receivables.find((item) => item.id === occurrence.documentId);
    const status = document ? statusLabel(documentStatus(document, kind), kind) : "Documento não encontrado";
    const actual = document
      ? `<button class="text-button" type="button" data-open-title="${kind}" data-id="${escapeHtml(document.id)}">${formatMoney(document.originalAmountCents)} · ${datePt(document.dueDate)} · ${escapeHtml(status)}</button>`
      : `${formatMoney(occurrence.convertedEffectiveAmountCents)} · ${datePt(occurrence.convertedEffectiveDueDate)} · ${escapeHtml(status)}`;
    return `<tr><td>${datePt(occurrence.plannedDueDate)}</td><td class="number-cell">${formatMoney(occurrence.plannedAmountCents)}</td><td><span class="status status-open">Efetivado · ${escapeHtml(status)}</span></td><td>${actual}</td></tr>`;
  }).join("");
}

function openNewBudgetDialog() {
  budgetEditorState = { budget: null, cancelledIds: [], scheduleMode: "monthly" };
  const form = $("#budget-form");
  form.reset();
  sendFormError($("#budget-error"), "");
  $("#budget-dialog-title").textContent = "Novo orçamento";
  $("#budget-dialog-eyebrow").textContent = "PROGRAMAÇÃO FINANCEIRA";
  $("#budget-save").textContent = "Salvar programação";
  $("#budget-direction").disabled = false;
  $("#budget-direction").value = "payable";
  $("#budget-party-name").value = "";
  $("#budget-title").value = "";
  $("#budget-notes").value = "";
  $("#budget-schedule-mode").disabled = false;
  $("#budget-schedule-mode").value = "monthly";
  $("#budget-first-due").value = todayCuiaba();
  $("#budget-default-amount").value = "";
  $("#budget-occurrence-count").value = "1";
  $("#budget-monthly-controls").hidden = false;
  $("#budget-occurrence-rows").innerHTML = "";
  $("#budget-history").hidden = true;
  $("#budget-history-body").replaceChildren();
  $("#budget-add-occurrence").hidden = false;
  $("#budget-save").disabled = false;
  updateBudgetEditorFields("payable");
  updateBudgetOccurrenceCount();
  $("#budget-dialog").showModal();
  $("#budget-title").focus();
}

function updateBudgetEditorFields(direction, selectedParty = "", selectedAccount = "", selectedCenter = "") {
  budgetPartyOptions($("#budget-party-select"), direction, selectedParty);
  budgetAccountOptions($("#budget-account"), direction, selectedAccount);
  $("#budget-cost-center").innerHTML = activeCostCenterOptions(selectedCenter);
}

async function openBudgetEditor(id) {
  try {
    const { orcamento } = await request(`/api/orcamentos/${encodeURIComponent(id)}`);
    budgetEditorState = { budget: orcamento, cancelledIds: [], scheduleMode: orcamento.scheduleMode };
    const form = $("#budget-form");
    form.reset();
    sendFormError($("#budget-error"), "");
    $("#budget-dialog-title").textContent = orcamento.title;
    $("#budget-dialog-eyebrow").textContent = orcamento.status === "active" ? "EDITAR PROGRAMAÇÃO" : "ORÇAMENTO ARQUIVADO · CONSULTA";
    $("#budget-save").textContent = "Salvar alterações";
    $("#budget-direction").value = orcamento.direction;
    $("#budget-direction").disabled = true;
    $("#budget-title").value = orcamento.title;
    $("#budget-party-name").value = orcamento.partySnapshotName || "";
    $("#budget-notes").value = orcamento.notes || "";
    $("#budget-schedule-mode").value = orcamento.scheduleMode;
    $("#budget-schedule-mode").disabled = true;
    $("#budget-monthly-controls").hidden = true;
    updateBudgetEditorFields(orcamento.direction, orcamento.partyId || "", orcamento.suggestedAccountId || "", orcamento.costCenterId || "");
    const editable = orcamento.status === "active";
    $("#budget-title").disabled = !editable;
    $("#budget-party-select").disabled = !editable;
    $("#budget-party-name").disabled = !editable;
    $("#budget-account").disabled = !editable;
    $("#budget-cost-center").disabled = !editable;
    $("#budget-notes").disabled = !editable;
    $("#budget-add-occurrence").hidden = !editable;
    $("#budget-save").disabled = !editable;
    $("#budget-occurrence-rows").innerHTML = orcamento.occurrences.filter((item) => item.status === "planned").map((item) => renderBudgetOccurrenceRow(item, !editable)).join("");
    renderBudgetHistory(orcamento);
    updateBudgetOccurrenceCount();
    $("#budget-dialog").showModal();
    $(editable ? "#budget-title" : "#budget-dialog-title").focus();
  } catch (error) { showToast(error.message, true); }
}

function readBudgetOccurrenceRows() {
  return $$("#budget-occurrence-rows tr").map((row) => {
    const amount = parseMoney($(".budget-row-amount", row).value);
    if (amount <= 0) throw new Error("Cada vencimento deve ter um valor previsto positivo.");
    const value = {
      plannedDueDate: $(".budget-row-date", row).value,
      plannedAmountCents: amount,
      notes: $(".budget-row-notes", row).value.trim(),
    };
    if (!value.plannedDueDate) throw new Error("Informe a data prevista de cada vencimento.");
    if (row.dataset.budgetOccurrenceId) value.id = row.dataset.budgetOccurrenceId;
    return value;
  });
}

function getBudgetPartyValues(direction, selectSelector, nameSelector) {
  const partyId = $(selectSelector).value || null;
  const linked = partyId ? finance.parties.find((party) => party.id === partyId) : null;
  const partyName = linked ? linked.name : $(nameSelector).value.trim();
  return { partyId, partyName };
}

async function submitBudgetForm(event) {
  event.preventDefault();
  const error = $("#budget-error");
  sendFormError(error, "");
  try {
    if (!budgetEditorState) throw new Error("A programação não está carregada.");
    const creating = !budgetEditorState.budget;
    const direction = $("#budget-direction").value;
    const party = getBudgetPartyValues(direction, "#budget-party-select", "#budget-party-name");
    const pendingOccurrences = readBudgetOccurrenceRows();
    const common = {
      title: $("#budget-title").value.trim(), direction,
      ...party,
      suggestedAccountId: $("#budget-account").value || null,
      costCenterId: $("#budget-cost-center").value || null,
      notes: $("#budget-notes").value.trim(),
    };
    if (budgetEditorState.budget) {
      const budget = budgetEditorState.budget;
      await apiCall("PUT", `/api/orcamentos/${encodeURIComponent(budget.id)}`, {
        ...common,
        expectedRevision: budget.revision,
        pendingOccurrences,
        cancelledOccurrenceIds: budgetEditorState.cancelledIds,
      });
    } else {
      const scheduleMode = $("#budget-schedule-mode").value;
      const body = { ...common, scheduleMode, occurrences: pendingOccurrences.map(({ id, ...occurrence }) => occurrence) };
      if (scheduleMode === "monthly") {
        body.firstDueDate = $("#budget-first-due").value;
        body.occurrenceCount = body.occurrences.length;
        body.defaultAmountCents = parseMoney($("#budget-default-amount").value);
        if (body.defaultAmountCents <= 0) throw new Error("O valor padrão deve ser positivo.");
        if (body.occurrenceCount < 1 || body.occurrenceCount > 1000) throw new Error("A programação deve conter entre 1 e 1.000 vencimentos.");
      }
      await apiCall("POST", "/api/orcamentos", body);
    }
    $("#budget-dialog").close();
    await refreshFinance();
    await loadBudgetPlans();
    showToast(creating ? "Orçamento salvo." : "Orçamento atualizado.");
  } catch (caught) { sendFormError(error, caught.message); }
}

function generateBudgetOccurrences() {
  const error = $("#budget-error");
  sendFormError(error, "");
  try {
    if ($$("#budget-occurrence-rows tr").length && !window.confirm("Gerar novamente vai substituir as linhas que ainda não foram salvas. Continuar?")) return;
    const count = Number($("#budget-occurrence-count").value);
    const dates = budgetMonthlyDates($("#budget-first-due").value, count);
    const amount = parseMoney($("#budget-default-amount").value);
    if (amount <= 0) throw new Error("O valor padrão deve ser positivo.");
    $("#budget-occurrence-rows").innerHTML = dates.map((plannedDueDate) => renderBudgetOccurrenceRow({ plannedDueDate, plannedAmountCents: amount, notes: "" })).join("");
    updateBudgetOccurrenceCount();
  } catch (caught) { sendFormError(error, caught.message); }
}

function addBudgetOccurrenceRow() {
  $("#budget-occurrence-rows").insertAdjacentHTML("beforeend", renderBudgetOccurrenceRow({ plannedDueDate: "", plannedAmountCents: null, notes: "" }));
  updateBudgetOccurrenceCount();
  $("#budget-occurrence-rows tr:last-child .budget-row-date").focus();
}

function reportVariance(value, unit) {
  if (value === 0) return unit === "money" ? "R$ 0,00" : "0 dias";
  const sign = value > 0 ? "+" : "−";
  return unit === "money" ? `${sign}${formatMoney(Math.abs(value))}` : `${sign}${Math.abs(value)} dia(s)`;
}

function renderBudgetReport(report) {
  const totals = report.totals;
  $("#budget-report-totals").hidden = false;
  $("#budget-report-totals").innerHTML = [
    ["Previsões pendentes", totals.plannedPendingCents, "Somente vencimentos ainda previstos em planos ativos"],
    ["Orçamentos efetivados", totals.convertedBudgetCents, "Valor originalmente previsto; mantém a base de comparação"],
    ["Documentos gerados", totals.generatedDocumentCents, "Valor atual dos documentos vinculados no AP/AR"],
  ].map(([label, value, note]) => `<article><span>${escapeHtml(label)}</span><strong>${formatMoney(value)}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  $("#budget-report-groups").innerHTML = report.byMonthDirection.length
    ? report.byMonthDirection.map((item) => `<tr><td>${escapeHtml(monthPt(item.month))}</td><td>${item.direction === "payable" ? "Despesa" : "Receita"}</td><td class="number-cell">${formatMoney(item.plannedPendingCents)}</td><td class="number-cell">${formatMoney(item.convertedBudgetCents)}</td><td class="number-cell">${formatMoney(item.generatedDocumentCents)}</td></tr>`).join("")
    : '<tr><td colspan="5" class="empty-table">Sem vencimentos no intervalo consultado.</td></tr>';
  $("#budget-report-body").innerHTML = report.rows.length ? report.rows.map((row) => {
    const kindLabel = row.direction === "payable" ? "Despesa" : "Receita";
    const status = row.occurrenceStatus === "converted" ? `Efetivado · ${row.documentStatus}` : budgetStatusLabel(row.occurrenceStatus);
    const effective = row.occurrenceStatus === "converted"
      ? (row.documentExists
        ? `<button class="text-button" type="button" data-open-title="${row.documentType}" data-id="${escapeHtml(row.documentId)}">${formatMoney(row.effectiveAmountCents)} · ${datePt(row.effectiveDueDate)}</button><small>${escapeHtml(row.documentStatus)}</small>`
        : `${formatMoney(row.effectiveAmountCents)} · ${datePt(row.effectiveDueDate)}<small>Documento vinculado indisponível</small>`)
      : "—";
    const variance = row.occurrenceStatus === "converted"
      ? `<strong>${reportVariance(row.amountVarianceCents, "money")}</strong><small>Vencimento real − previsto ${reportVariance(row.dueDateVarianceDays, "days")}</small>` : "—";
    const action = row.occurrenceStatus === "planned" && row.planStatus === "active"
      ? `<button class="button button-primary button-small" type="button" data-budget-action="convert" data-budget-id="${escapeHtml(row.budgetId)}" data-occurrence-id="${escapeHtml(row.occurrenceId)}">Efetivar</button>`
      : "—";
    return `<tr><td><button class="report-row-link" type="button" data-budget-open="${escapeHtml(row.budgetId)}"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.partyName || "Sem contraparte")}</small></button></td><td>${kindLabel}</td><td>${row.categoryAccountId ? escapeHtml(accountPath(row.categoryAccountId)) : "—"}</td><td>${datePt(row.plannedDueDate)}</td><td class="number-cell">${formatMoney(row.plannedAmountCents)}</td><td><span class="status ${row.occurrenceStatus === "cancelled" ? "status-cancelled" : row.occurrenceStatus === "planned" ? "status-open" : "status-draft"}">${escapeHtml(status)}</span></td><td>${effective}</td><td>${variance}</td><td class="actions-cell">${action}</td></tr>`;
  }).join("") : '<tr><td colspan="9" class="empty-table">Sem vencimentos no intervalo consultado.</td></tr>';
  setReportState("budget-report-state", `${report.rows.length} vencimento(s) · ${datePt(report.fromDate)} a ${datePt(report.toDate)}. Os totais são separados por natureza.`);
}

async function loadBudgetReport() {
  const params = new URLSearchParams({
    fromDate: $("#budget-report-from").value,
    toDate: $("#budget-report-to").value,
    direction: $("#budget-report-direction").value,
    categoryAccountId: $("#budget-report-category").value,
    costCenterId: $("#budget-report-cost-center").value,
    status: $("#budget-report-status").value,
    planStatus: $("#budget-report-plan-status").value,
    q: $("#budget-report-search").value.trim(),
  });
  setReportState("budget-report-state", "Consultando relatório de orçamentos…");
  const { relatorio } = await request(`/api/relatorios/orcamentos?${params}`);
  renderBudgetReport(relatorio);
}

function invalidateBudgetConversionPreview() {
  if (budgetConversionCreatedDocument) return;
  budgetConversionPreview = null;
  $("#budget-convert-review").hidden = true;
  $("#budget-convert-confirm").disabled = true;
}

async function openBudgetConversion(budgetId, occurrenceId) {
  try {
    const { orcamento } = await request(`/api/orcamentos/${encodeURIComponent(budgetId)}`);
    const occurrence = orcamento.occurrences.find((item) => item.id === occurrenceId);
    if (!occurrence || occurrence.status !== "planned" || orcamento.status !== "active") throw new Error("Este vencimento não está mais previsto em um orçamento ativo. Atualize o relatório.");
    budgetConversionState = { budget: orcamento, occurrence };
    budgetConversionPreview = null;
    budgetConversionCreatedDocument = null;
    const form = $("#budget-convert-form");
    form.reset();
    sendFormError($("#budget-convert-error"), "");
    const payable = orcamento.direction === "payable";
    $("#budget-convert-eyebrow").textContent = payable ? "EFETIVAÇÃO · CONTA A PAGAR" : "EFETIVAÇÃO · CONTA A RECEBER";
    $("#budget-convert-title").textContent = orcamento.title;
    $("#budget-convert-planned-date").textContent = datePt(occurrence.plannedDueDate);
    $("#budget-convert-planned-amount").textContent = formatMoney(occurrence.plannedAmountCents);
    $("#budget-convert-destination").textContent = payable ? "Criar conta a pagar" : "Criar conta a receber";
    $("#budget-convert-party-label").firstChild.textContent = payable ? "Credor / fornecedor" : "Pagador / devedor";
    $("#budget-convert-classification-label").firstChild.textContent = payable ? "Conta de custo / despesa" : "Conta de receita";
    $("#budget-convert-control-label").firstChild.textContent = payable ? "Conta de obrigação" : "Conta de recebíveis";
    const linkedParty = (finance.parties || []).find((party) => party.id === orcamento.partyId && party.active);
    budgetPartyOptions($("#budget-convert-party-select"), orcamento.direction, linkedParty?.id || "");
    $("#budget-convert-party-name").value = linkedParty?.name || orcamento.partySnapshotName || "";
    $("#budget-convert-description").value = orcamento.title;
    $("#budget-convert-number").value = "";
    $("#budget-convert-issue-date").value = todayCuiaba();
    $("#budget-convert-competence").value = occurrence.plannedDueDate.slice(0, 7);
    $("#budget-convert-due-date").value = occurrence.plannedDueDate;
    $("#budget-convert-amount").value = moneyField(occurrence.plannedAmountCents);
    budgetAccountOptions($("#budget-convert-classification"), orcamento.direction, orcamento.suggestedAccountId || "", "Selecione uma classificação");
    const controlAccounts = payable ? accountsByGroup([2]) : finance.planAccounts.filter((account) => account.postable && accountGroup(account.id) === 1 && !account.cashEquivalent);
    fillAccountSelect($("#budget-convert-control"), controlAccounts, "Selecione uma conta de controle", defaultAccount(payable ? [2] : [1], payable ? "Serviços a Pagar" : "Contas a Receber"));
    $("#budget-convert-cost-center").innerHTML = activeCostCenterOptions(orcamento.costCenterId || "");
    $("#budget-convert-notes").value = orcamento.notes || "";
    $("#budget-convert-review").hidden = true;
    $("#budget-convert-success").hidden = true;
    $("#budget-convert-actions").hidden = false;
    $("#budget-convert-preview").disabled = false;
    $("#budget-convert-confirm").disabled = true;
    $$("#budget-convert-form input, #budget-convert-form select").forEach((field) => { field.disabled = false; });
    $("#budget-convert-dialog").showModal();
    $("#budget-convert-due-date").focus();
  } catch (error) { showToast(error.message, true); }
}

function budgetConversionData() {
  if (!budgetConversionState) throw new Error("A ocorrência não está carregada.");
  const { budget, occurrence } = budgetConversionState;
  const payable = budget.direction === "payable";
  const partyId = $("#budget-convert-party-select").value || null;
  const linkedParty = partyId ? finance.parties.find((party) => party.id === partyId) : null;
  const partyName = linkedParty ? linkedParty.name : $("#budget-convert-party-name").value.trim();
  const amount = parseMoney($("#budget-convert-amount").value);
  if (amount <= 0) throw new Error("O valor real deve ser positivo.");
  return {
    expectedBudgetRevision: budget.revision,
    expectedOccurrenceRevision: occurrence.revision,
    [payable ? "creditor" : "debtor"]: partyName,
    partyId,
    description: $("#budget-convert-description").value.trim(),
    documentNumber: $("#budget-convert-number").value.trim(),
    issueDate: $("#budget-convert-issue-date").value,
    dueDate: $("#budget-convert-due-date").value,
    competencePeriod: $("#budget-convert-competence").value,
    originalAmountCents: amount,
    ...(payable
      ? { expenseAccountId: $("#budget-convert-classification").value, liabilityAccountId: $("#budget-convert-control").value }
      : { revenueAccountId: $("#budget-convert-classification").value, receivableAccountId: $("#budget-convert-control").value }),
    costCenterId: $("#budget-convert-cost-center").value || null,
    notes: $("#budget-convert-notes").value.trim(),
  };
}

async function previewBudgetConversion() {
  sendFormError($("#budget-convert-error"), "");
  $("#budget-convert-preview").disabled = true;
  try {
    const data = budgetConversionData();
    const { budget, occurrence } = budgetConversionState;
    const path = `/api/orcamentos/${encodeURIComponent(budget.id)}/ocorrencias/${encodeURIComponent(occurrence.id)}/previa`;
    const { previa } = await apiCall("POST", path, data);
    budgetConversionPreview = { data: JSON.stringify(data), reviewToken: previa.reviewToken };
    const payable = budget.direction === "payable";
    const dateVariance = reportVariance(previa.dueDateVarianceDays, "days");
    const amountVariance = reportVariance(previa.amountVarianceCents, "money");
    $("#budget-convert-review-summary").textContent = `${payable ? "Criar conta a pagar" : "Criar conta a receber"}: valor ${formatMoney(previa.plannedAmountCents)} previsto → ${formatMoney(previa.effectiveAmountCents)} real (${amountVariance}); vencimento ${datePt(previa.plannedDueDate)} → ${datePt(previa.effectiveDueDate)} (${dateVariance}).`;
    $("#budget-convert-review").hidden = false;
    $("#budget-convert-confirm").disabled = false;
  } catch (error) {
    budgetConversionPreview = null;
    sendFormError($("#budget-convert-error"), error.message);
  } finally { $("#budget-convert-preview").disabled = Boolean(budgetConversionCreatedDocument); }
}

async function submitBudgetConversion(event) {
  event.preventDefault();
  sendFormError($("#budget-convert-error"), "");
  if (!budgetConversionPreview || budgetConversionCreatedDocument) return;
  $("#budget-convert-confirm").disabled = true;
  try {
    const data = budgetConversionData();
    if (JSON.stringify(data) !== budgetConversionPreview.data) throw new Error("Os dados foram alterados. Valide e revise novamente antes de confirmar.");
    const { budget, occurrence } = budgetConversionState;
    const path = `/api/orcamentos/${encodeURIComponent(budget.id)}/ocorrencias/${encodeURIComponent(occurrence.id)}/efetivar`;
    const response = await apiCall("POST", path, { ...data, reviewToken: budgetConversionPreview.reviewToken });
    finance = response.financeiro;
    const result = response.resultado;
    budgetConversionCreatedDocument = { kind: result.documentType || budget.direction, document: result.document };
    $("#budget-convert-review").hidden = true;
    $("#budget-convert-success").hidden = false;
    $("#budget-convert-success-text").textContent = `${result.document.description} foi salvo como rascunho por ${formatMoney(result.document.originalAmountCents)}, com vencimento em ${datePt(result.document.dueDate)}.`;
    $("#budget-open-created-document").textContent = budget.direction === "payable" ? "Abrir em Contas a Pagar" : "Abrir em Contas a Receber";
    $("#budget-convert-actions").hidden = true;
    $$("#budget-convert-form input, #budget-convert-form select").forEach((field) => { field.disabled = true; });
    await refreshFinance();
    if (budgetCurrentView === "programacao") await loadBudgetPlans(); else await loadBudgetReport();
  } catch (error) {
    sendFormError($("#budget-convert-error"), error.message);
    $("#budget-convert-confirm").disabled = false;
  }
}

async function handleBudgetListAction(event) {
  const open = event.target.closest("[data-budget-open]");
  if (open) { openBudgetEditor(open.dataset.budgetOpen); return; }
  const button = event.target.closest("[data-budget-action]");
  if (!button) return;
  const { budgetId, occurrenceId, budgetAction } = button.dataset;
  if (budgetAction === "convert") { openBudgetConversion(budgetId, occurrenceId); return; }
  if (budgetAction === "archive" && !window.confirm("Arquivar este orçamento? A programação e os documentos efetivados serão preservados.")) return;
  try {
    await apiCall("POST", `/api/orcamentos/${encodeURIComponent(budgetId)}/${budgetAction === "archive" ? "arquivar" : "reativar"}`, {});
    await refreshFinance();
    await loadBudgetPlans();
    showToast(budgetAction === "archive" ? "Orçamento arquivado." : "Orçamento reativado.");
  } catch (error) { showToast(error.message, true); }
}

function handleBudgetOccurrenceRowAction(event) {
  const button = event.target.closest("[data-budget-row-remove]");
  if (!button) return;
  const row = button.closest("tr");
  const id = row.dataset.budgetOccurrenceId;
  if (id) {
    if (!window.confirm("Cancelar este vencimento previsto? Ele ficará no histórico e não poderá ser efetivado.")) return;
    budgetEditorState.cancelledIds.push(id);
  }
  row.remove();
  updateBudgetOccurrenceCount();
}

function updatePrimaryAction() {
  const primary = $("#primary-action");
  const degreeCatalog = activeScreen === "registrations" && registrationType === "degrees";
  primary.hidden = activeScreen === "agent" || degreeCatalog;
  primary.innerHTML = activeScreen === "registrations"
    ? (registrationType === "cost-centers" ? "+ Novo centro de custo" : registrationType === "parties" ? "+ Nova pessoa/empresa" : "+ Novo cadastro")
    : activeScreen === "payables" ? "+ Nova conta a pagar"
      : activeScreen === "receivables" ? "+ Nova conta a receber"
        : activeScreen === "budgets" ? "+ Novo orçamento" : "+ Lançamento manual";
  primary.dataset.action = activeScreen === "registrations" ? "registration"
    : activeScreen === "payables" ? "payable"
      : activeScreen === "receivables" ? "receivable"
        : activeScreen === "budgets" ? "budget" : "manual";
}

function setScreen(screen) {
  const previousScreen = activeScreen;
  activeScreen = screen;
  $$(".screen").forEach((item) => {
    const active = item.id === `screen-${screen}`;
    item.hidden = !active;
    item.classList.toggle("is-visible", active);
  });
  $$(".nav-link").forEach((button) => {
    const active = button.dataset.screen === screen;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  updatePrimaryAction();
  if (screen === "registrations" && registrationType === "parties") loadParties();
  if (screen === "agent") {
    initializeAgentWorkspace().catch((error) => showToast(error.message, true));
  }
  if (screen === "budgets") loadBudgetPlans();
  if (finance && screen !== previousScreen && (screen === "dashboard" || screen === "agent")) loadGuardianBriefing();
}

function openNewRegistration() {
  if (registrationType === "parties") openPartyDialog();
  else if (registrationType !== "degrees") openCatalogDialog(registrationType);
}

function renderOpeningNotice() {
  const snapshot = finance.legacyOpeningSnapshot;
  const details = finance.journalEntries.find((entry) => entry.status === "draft" && entry.sourceEventType === "opening-draft")?.draftDetails;
  const nodes = [$("#opening-notice"), $("#journal-opening-notice")];
  if (!snapshot || !details) { nodes.forEach((node) => { node.hidden = true; }); return; }
  const known = details.knownAccountsTotalCents;
  const consolidated = details.consolidatedBalanceCents;
  const difference = details.unallocatedDifferenceCents;
  const text = `<strong>Abertura legada aguardando conciliação.</strong> O arquivo anterior registra ${formatMoney(known)} em duas contas sem banco identificado e saldo consolidado legado de ${formatMoney(consolidated)}. A diferença de ${formatMoney(difference)} não tem conta definida. Esses valores foram preservados em rascunho e não compõem o Livro-Razão, o Balancete nem o caixa contabilizado.`;
  nodes.forEach((node) => { node.innerHTML = text; node.hidden = false; });
}

async function renderCashFlow() {
  const period = $("#cashflow-month").value || selectedMonth;
  const today = todayCuiaba();
  selectedMonth = period;
  $("#cashflow-period-label").textContent = monthPt(period);
  const { relatorio } = await request(`/api/relatorios/fluxo-de-caixa?period=${encodeURIComponent(period)}`);
  const header = `<tr><th class="label-head">Dia · R$</th>${relatorio.days.map((day) => {
    const date = new Date(`${day}T00:00:00Z`);
    const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "");
    return `<th class="day-head" title="${escapeHtml(`${day.slice(8, 10)} · ${weekday}`)}"><span class="weekday">${escapeHtml(weekday)}</span>${day.slice(8, 10)}</th>`;
  }).join("")}</tr>`;
  $("#cash-head").innerHTML = header;

  const actualByCell = new Map();
  const forecastByCell = new Map();
  const unclassifiedBudgetByDay = new Map();
  const otherActual = new Map();
  const addCashGridEvent = (map, key, event) => {
    const cell = map.get(key) || { amountCents: 0, allocations: new Map(), events: [] };
    cell.amountCents += event.amountCents;
    cell.events.push(event);
    const sign = Math.sign(event.amountCents);
    if (event.costCenterAllocations?.length) {
      for (const allocation of event.costCenterAllocations) cell.allocations.set(allocation.costCenterId, (cell.allocations.get(allocation.costCenterId) || 0) + sign * allocation.amountCents);
    } else cell.allocations.set(null, (cell.allocations.get(null) || 0) + event.amountCents);
    map.set(key, cell);
  };
  for (const event of relatorio.actualEvents) {
    if (event.accountId) {
      const key = `${event.accountId}|${event.date}`;
      addCashGridEvent(actualByCell, key, event);
    } else otherActual.set(event.date, (otherActual.get(event.date) || 0) + event.amountCents);
  }
  for (const event of relatorio.forecastEvents) {
    if (!event.accountId) {
      if (event.sourceType === "budget") addCashGridEvent(unclassifiedBudgetByDay, event.date, event);
      continue;
    }
    const key = `${event.accountId}|${event.date}`;
    addCashGridEvent(forecastByCell, key, event);
  }
  const cells = (values, className = "") => values.map((value) => `<td class="${className}">${value ? cashValue(value, false) : ""}</td>`).join("");
  const cashMovement = (cell, day, isForecast = false) => {
    const value = typeof cell === "number" ? cell : cell?.amountCents || 0;
    if (!value) return "";
    const movementClass = day >= today ? "neutral-value" : value > 0 ? "entry-value" : "outflow-value";
    const exact = formatSignedMoney(value);
    const centerDetails = cell?.allocations ? [...cell.allocations].filter(([, amount]) => amount !== 0).map(([id, amount]) => {
      const name = id ? finance.costCenters.find((center) => center.id === id)?.name || "Centro removido" : "Sem centro de custo";
      return `${name}: ${formatMoney(Math.abs(amount))}`;
    }).join(" · ") : "";
    if (!isForecast) {
      const title = centerDetails ? `${exact} · ${centerDetails}` : exact;
      return `<span class="compact-value ${movementClass}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(formatCompactMoney(value))}</span>`;
    }
    const groups = new Map();
    for (const event of cell.events || []) {
      const budget = event.sourceType === "budget";
      const draft = event.status === "rascunho" || String(event.sourceType || "").startsWith("draft-");
      const recurring = event.sourceType === "recorrencia" || event.status === "recorrência";
      const statusLabels = { open: "Reconhecido em aberto", overdue: "Reconhecido vencido", partially_paid: "Reconhecido parcialmente liquidado" };
      const label = budget ? "Orçado" : draft ? "Documento em rascunho" : recurring ? "Recorrência" : statusLabels[event.status] || "Reconhecido";
      const key = budget ? "budget" : draft ? "draft" : recurring ? "recurring" : "recognized";
      const group = groups.get(key) || { label, amountCents: 0, events: [] };
      group.amountCents += event.amountCents;
      group.events.push(event);
      groups.set(key, group);
    }
    return [...groups.entries()].map(([key, group]) => {
      const marker = key === "budget" ? "O" : key === "draft" ? "D" : key === "recurring" ? "Rec" : "R";
      const details = group.events.map((event) => {
        const dueDate = event.plannedDueDate || event.date;
        const projectedDate = event.date !== dueDate ? ` · projetado em ${datePt(event.date)}` : "";
        const center = event.costCenterId
          ? finance.costCenters.find((item) => item.id === event.costCenterId)?.name || "Centro removido"
          : "Sem centro de custo";
        return `${event.title || event.description || "Previsão"} · ${formatSignedMoney(event.amountCents)} · vencimento ${datePt(dueDate)}${projectedDate} · ${center}`;
      }).join(" | ");
      const title = `${group.label} · ${details}`;
      const className = key === "budget" ? "cashflow-budget" : key === "draft" ? "cashflow-draft" : key === "recurring" ? "cashflow-recurring" : "cashflow-recognized";
      return `<span class="compact-value ${movementClass} ${className}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><span class="cashflow-kind-mark">${marker}</span>${escapeHtml(formatCompactMoney(group.amountCents))}</span>`;
    }).join("");
  };
  const rows = [];
  rows.push(`<tr class="balance-row opening-cash-row"><th class="row-label long-row-label">Saldo no início do mês</th>${relatorio.days.map((_, i) => `<td>${i === 0 ? cashValue(relatorio.openingCashCents, false) : ""}</td>`).join("")}</tr>`);
  for (const group of relatorio.groups) {
    rows.push(`<tr class="group-row"><th class="row-label">${group.groupNumber} · ${escapeHtml(group.name)}</th>${relatorio.days.map(() => "<td></td>").join("")}</tr>`);
    for (const account of group.accounts) {
      const actual = relatorio.days.map((day) => actualByCell.get(`${account.id}|${day}`) || null);
      const forecast = relatorio.days.map((day) => forecastByCell.get(`${account.id}|${day}`) || null);
      rows.push(`<tr><th class="row-label"><span class="line-label"><span class="account-code">${escapeHtml(account.code)}</span> ${escapeHtml(account.name)}</span></th>${relatorio.days.map((day, i) => {
        const actualValue = actual[i]; const forecastValue = forecast[i];
        return `<td>${cashMovement(actualValue, day)}${cashMovement(forecastValue, day, true)}</td>`;
      }).join("")}</tr>`);
    }
  }
  if (unclassifiedBudgetByDay.size) rows.push(`<tr class="cashflow-unclassified-budget-row"><th class="row-label long-row-label">Orçamentos sem classificação</th>${relatorio.days.map((day) => `<td>${cashMovement(unclassifiedBudgetByDay.get(day) || null, day, true)}</td>`).join("")}</tr>`);
  rows.push(`<tr class="group-row other-movements"><th class="row-label">Outros movimentos de caixa</th>${relatorio.days.map(() => "<td></td>").join("")}</tr>`);
  rows.push(`<tr><th class="row-label long-row-label">Financiamentos, ativos e ajustes</th>${relatorio.days.map((day) => {
    const value = otherActual.get(day) || 0;
    return `<td>${cashMovement(value, day)}</td>`;
  }).join("")}</tr>`);
  rows.push(`<tr class="balance-row actual-balance-row"><th class="row-label">Saldo realizado</th>${cells(relatorio.actualBalances)}</tr>`);
  rows.push(`<tr class="closing-row"><th class="row-label">Saldo projetado</th>${cells(relatorio.projectedBalances)}</tr>`);
  $("#cash-body").innerHTML = rows.join("");
}

function entryTotals(entry) {
  return entry.lines.reduce((totals, line) => ({ debit: totals.debit + line.debitCents, credit: totals.credit + line.creditCents }), { debit: 0, credit: 0 });
}
function compareReportValues(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return reportTextCollator.compare(String(left ?? ""), String(right ?? ""));
}
function sortReportRows(kind, rows, valueFor) {
  const { key, direction } = reportSorts[kind];
  if (!key) return rows;
  const multiplier = direction === "desc" ? -1 : 1;
  return rows.slice().sort((left, right) => multiplier * compareReportValues(valueFor(left, key), valueFor(right, key)));
}
function updateReportSortHeaders(kind) {
  const state = reportSorts[kind];
  const head = $(`#${kind}-sort-head`);
  head.querySelectorAll(".table-sort").forEach((button) => {
    const active = button.dataset.sortKey === state.key;
    const direction = active ? state.direction : null;
    const column = button.dataset.sortLabel;
    button.closest("th").setAttribute("aria-sort", direction ? (direction === "asc" ? "ascending" : "descending") : "none");
    button.querySelector(".sort-indicator").textContent = direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕";
    button.setAttribute("aria-label", direction
      ? `Ordenar por ${column}. Ordem atual ${direction === "asc" ? "crescente" : "decrescente"}; clique para alternar.`
      : `Ordenar por ${column}.`);
  });
}
function handleReportSort(kind, event) {
  const button = event.target.closest(".table-sort[data-sort-key]");
  if (!button || !event.currentTarget.contains(button)) return;
  const state = reportSorts[kind];
  state.direction = state.key === button.dataset.sortKey && state.direction === "asc" ? "desc" : "asc";
  state.key = button.dataset.sortKey;
  if (kind === "journal") renderJournal();
  else renderDocuments(kind);
}
function journalSortValue(entry, key) {
  switch (key) {
    case "date": return entry.postingDate;
    case "number": return entry.entryNumber;
    case "description": return entry.description;
    case "origin": return entry.originModule;
    case "debit": return entryTotals(entry).debit;
    case "credit": return entryTotals(entry).credit;
    case "status": return "Postado";
    case "details": return entry.lines.length;
    default: return "";
  }
}
function renderJournal() {
  const period = $("#journal-month").value || selectedMonth;
  const entries = sortReportRows("journal", finance.journalEntries.filter((entry) => entry.status === "posted" && entry.period === period).slice().sort((a, b) => a.postingDate.localeCompare(b.postingDate) || a.entryNumber - b.entryNumber), journalSortValue);
  $("#journal-body").innerHTML = entries.map((entry) => {
    const totals = entryTotals(entry);
    const lines = entry.lines.map((line) => `<li><span>${escapeHtml(accountPath(line.accountId))}</span><span>D ${escapeHtml(formatMoney(line.debitCents))} · C ${escapeHtml(formatMoney(line.creditCents))}</span>${line.costCenterAllocations?.length ? `<small>Rateio: ${line.costCenterAllocations.map((item) => `${escapeHtml(finance.costCenters.find((center) => center.id === item.costCenterId)?.name || "Centro removido")} ${escapeHtml(formatMoney(item.amountCents))}`).join(", ")}</small>` : ""}</li>`).join("");
    const alreadyReversed = finance.journalEntries.some((item) => item.reversalOfEntryId === entry.id);
    return `<tr><td>${datePt(entry.postingDate)}</td><td>${entry.entryNumber}</td><td>${escapeHtml(entry.description)}</td><td>${escapeHtml(entry.originModule)}</td><td class="number-cell">${formatMoney(totals.debit)}</td><td class="number-cell">${formatMoney(totals.credit)}</td><td><span class="status status-posted">Postado</span></td><td><details class="entry-details"><summary>Ver ${entry.lines.length} linhas</summary><ul>${lines}</ul>${entry.reversalOfEntryId ? `<small>Estorno do lançamento ${escapeHtml(finance.journalEntries.find((item) => item.id === entry.reversalOfEntryId)?.entryNumber || "")}</small>` : ""}${!entry.reversalOfEntryId && !alreadyReversed ? `<button class="text-button" data-action="reverse-entry" data-id="${escapeHtml(entry.id)}">Estornar</button>` : alreadyReversed ? "<small>Este lançamento já foi estornado.</small>" : ""}</details></td></tr>`;
  }).join("");
  $("#journal-empty").hidden = entries.length > 0;
  updateReportSortHeaders("journal");
}

function documentStatus(document, kind) {
  if (document.status === "cancelled") return "cancelled";
  if (document.postingStatus === "draft") return "draft";
  const remaining = kind === "payable" ? document.originalAmountCents - document.settlements.filter((item) => !item.reversedAt).reduce((sum, item) => sum + item.amountCents, 0)
    : document.originalAmountCents - document.collections.filter((item) => !item.reversedAt).reduce((sum, item) => sum + item.amountCents, 0);
  if (!remaining) return "paid";
  if (document.dueDate < todayCuiaba()) return "overdue";
  return remaining < document.originalAmountCents ? "partially_paid" : "open";
}
function statusLabel(status, kind) {
  return ({ draft: "Rascunho", open: "Em aberto", partially_paid: kind === "payable" ? "Parcialmente paga" : "Parcialmente recebida", paid: kind === "payable" ? "Paga" : "Recebida", overdue: "Vencida", cancelled: "Cancelada" })[status] || status;
}
function documentOutstanding(document, kind) {
  const records = kind === "payable" ? document.settlements : document.collections;
  return document.originalAmountCents - records.filter((item) => !item.reversedAt).reduce((sum, item) => sum + item.amountCents, 0);
}
function documentSortValue(document, key, kind) {
  switch (key) {
    case "party": {
      const party = kind === "payable" ? document.creditor : document.debtor;
      return [party, document.documentNumber, document.description].filter(Boolean).join(" ");
    }
    case "issueDate": return document.issueDate;
    case "dueDate": return document.dueDate;
    case "competence": return document.competencePeriod;
    case "amount": return document.originalAmountCents;
    case "outstanding": return documentOutstanding(document, kind);
    case "status": return statusLabel(documentStatus(document, kind), kind);
    default: return "";
  }
}
function renderDocuments(kind) {
  const isPayable = kind === "payable";
  const prefix = isPayable ? "payable" : "receivable";
  const list = isPayable ? finance.payables : finance.receivables;
  const statusFilter = $(`#${prefix}-status-filter`).value;
  const periodFilter = $(`#${prefix}-period-filter`).value;
  const filtered = sortReportRows(kind, list.filter((document) => (!periodFilter || document.competencePeriod === periodFilter)
    && (statusFilter === "todas" || documentStatus(document, kind) === statusFilter)), (document, key) => documentSortValue(document, key, kind));
  const tbody = $(`#${prefix}-body`);
  tbody.innerHTML = filtered.map((document) => {
    const status = documentStatus(document, kind);
    const party = isPayable ? document.creditor : document.debtor;
    const partyLink = document.partyId
      ? `<small><button class="text-button party-document-link" type="button" data-open-party="${escapeHtml(document.partyId)}" aria-label="Abrir cadastro atual de ${escapeHtml(party)}">Ver cadastro atual</button></small>`
      : "";
    const actions = [];
    if (status === "draft") {
      actions.push(`<button class="text-button" data-action="edit-document" data-kind="${kind}" data-id="${escapeHtml(document.id)}">Editar</button>`);
      actions.push(`<button class="text-button" data-action="recognize-document" data-kind="${kind}" data-id="${escapeHtml(document.id)}">Reconhecer</button>`);
      actions.push(`<button class="text-button delete" data-action="delete-document" data-kind="${kind}" data-id="${escapeHtml(document.id)}">Excluir</button>`);
    } else if (["open", "overdue", "partially_paid"].includes(status)) {
      actions.push(`<button class="text-button" data-action="settle-document" data-kind="${kind}" data-id="${escapeHtml(document.id)}">${isPayable ? "Pagar" : "Receber"}</button>`);
    }
    const settlementInfo = (isPayable ? document.settlements : document.collections).map((item) => {
      const reversal = item.reversalEntryId ? finance.journalEntries.find((entry) => entry.id === item.reversalEntryId) : null;
      const label = item.reversedAt ? "Estornado" : isPayable ? "Pago" : "Recebido";
      return `<small>${label} em ${datePt(item.date)} · ${formatMoney(item.amountCents)} · <a href="#diario" data-journal-entry="${escapeHtml(item.journalEntryId)}">Diário ${escapeHtml(finance.journalEntries.find((entry) => entry.id === item.journalEntryId)?.entryNumber || "")}</a>${reversal ? ` · <a href="#diario" data-journal-entry="${escapeHtml(reversal.id)}">Estorno ${reversal.entryNumber}</a>` : ""}</small>`;
    }).join("");
    const documentAllocations = Array.isArray(document.costCenterAllocations) && document.costCenterAllocations.length
      ? document.costCenterAllocations
      : document.costCenterId ? [{ costCenterId: document.costCenterId, amountCents: document.originalAmountCents }] : [];
    const costCenterInfo = documentAllocations.length
      ? `<small>Centro de custo: ${documentAllocations.map((item) => `${escapeHtml(finance.costCenters.find((center) => center.id === item.costCenterId)?.name || "Centro removido")} · ${formatMoney(item.amountCents)}`).join(", ")}</small>`
      : "";
    const recognitionReversal = document.recognitionEntryId ? finance.journalEntries.find((entry) => entry.reversalOfEntryId === document.recognitionEntryId) : null;
    const recognitionInfo = document.recognitionEntryId ? `<small>${recognitionReversal ? "Reconhecimento estornado" : "Reconhecimento"} · <a href="#diario" data-journal-entry="${escapeHtml(document.recognitionEntryId)}">Diário ${escapeHtml(finance.journalEntries.find((entry) => entry.id === document.recognitionEntryId)?.entryNumber || "")}</a>${recognitionReversal ? ` · <a href="#diario" data-journal-entry="${escapeHtml(recognitionReversal.id)}">Estorno ${recognitionReversal.entryNumber}</a>` : ""}</small>` : "";
    return `<tr data-document-id="${escapeHtml(document.id)}"><td><strong>${escapeHtml(party)}</strong>${partyLink}<small>${escapeHtml(document.description)}${document.documentNumber ? ` · ${escapeHtml(document.documentNumber)}` : ""}</small>${costCenterInfo}${recognitionInfo}${settlementInfo}</td><td>${datePt(document.issueDate)}</td><td>${datePt(document.dueDate)}</td><td>${escapeHtml(document.competencePeriod)}</td><td class="number-cell">${formatMoney(document.originalAmountCents)}</td><td class="number-cell">${formatMoney(documentOutstanding(document, kind))}</td><td><span class="status status-${status}">${statusLabel(status, kind)}</span></td><td class="actions-cell">${actions.join("") || "—"}</td></tr>`;
  }).join("");
  $(`#${prefix}-empty`).hidden = filtered.length > 0;
  const forecastSection = $(`#${prefix}-budget-section`);
  const forecastBody = $(`#${prefix}-budget-body`);
  const forecastEmpty = $(`#${prefix}-budget-empty`);
  const showBudgetForecasts = statusFilter === "todas" || statusFilter === "orcado";
  const budgetForecasts = showBudgetForecasts
    ? (finance.budgetForecastEvents || []).filter((event) => event.direction === kind
      && (!periodFilter || event.plannedDueDate.slice(0, 7) === periodFilter))
    : [];
  forecastSection.hidden = !showBudgetForecasts;
  forecastBody.innerHTML = budgetForecasts.map((event) => {
    const account = event.classificationAccountId ? escapeHtml(accountPath(event.classificationAccountId)) : "Sem classificação";
    const center = event.costCenterId
      ? escapeHtml(finance.costCenters.find((item) => item.id === event.costCenterId)?.name || "Centro removido")
      : "Sem centro de custo";
    return `<tr class="budget-forecast-row"><td><button class="report-row-link" type="button" data-budget-open="${escapeHtml(event.budgetId)}"><strong>${escapeHtml(event.counterparty || "Sem contraparte")}</strong><small>${escapeHtml(event.title)} · Orçado</small></button></td><td>${datePt(event.plannedDueDate)}</td><td>${account}<small>${center}</small></td><td class="number-cell">${formatMoney(event.plannedAmountCents)}</td><td><span class="status status-budget">Orçado</span></td><td class="actions-cell"><button class="button button-primary button-small" type="button" data-budget-action="convert" data-budget-id="${escapeHtml(event.budgetId)}" data-occurrence-id="${escapeHtml(event.occurrenceId)}">Efetivar</button></td></tr>`;
  }).join("");
  forecastEmpty.hidden = !showBudgetForecasts || budgetForecasts.length > 0;
  updateReportSortHeaders(kind);
}

function renderLedgerSelects() {
  const selected = $("#ledger-account").value;
  fillAccountSelect($("#ledger-account"), finance.planAccounts.filter((item) => item.postable), "Selecione uma conta analítica", selected);
  if (!$("#ledger-account").value && finance.planAccounts.length) $("#ledger-account").value = finance.planAccounts.find((item) => item.postable)?.id || "";
}
async function loadLedger(event) {
  event?.preventDefault();
  const accountId = $("#ledger-account").value;
  if (!accountId) return;
  const fromDate = $("#ledger-from").value;
  const toDate = $("#ledger-to").value;
  const params = new URLSearchParams({ accountId, fromDate, toDate });
  const { relatorio } = await request(`/api/relatorios/livro-razao?${params}`);
  const normal = relatorio.account.normalBalance === "debit" ? "devedora" : "credora";
  $("#ledger-summary").innerHTML = `<strong>${escapeHtml(relatorio.account.code)} — ${escapeHtml(relatorio.account.name)}</strong><span>Natureza normal ${normal}</span><span>Saldo anterior: ${escapeHtml(formatSignedMoney(relatorio.openingBalanceCents) || formatMoney(0))}</span><span>Saldo final: ${escapeHtml(formatSignedMoney(relatorio.closingBalanceCents) || formatMoney(0))} (${relatorio.closingBalanceSide === "debit" ? "devedor" : "credor"})</span>`;
  $("#ledger-body").innerHTML = `<tr class="opening-ledger"><td colspan="5">Saldo anterior</td><td class="number-cell">${escapeHtml(formatSignedMoney(relatorio.openingBalanceCents) || formatMoney(0))}</td></tr>${relatorio.rows.map((row) => `<tr><td>${datePt(row.postingDate)}</td><td>${row.entryNumber}</td><td>${escapeHtml(row.description)}</td><td class="number-cell">${row.debitCents ? formatMoney(row.debitCents) : "—"}</td><td class="number-cell">${row.creditCents ? formatMoney(row.creditCents) : "—"}</td><td class="number-cell">${escapeHtml(formatSignedMoney(row.runningBalanceCents) || formatMoney(0))}</td></tr>`).join("")}`;
  const { relatorio: t } = await request(`/api/relatorios/razonete?${params}`);
  const debitItems = t.debit.map((row) => `<li><span>${datePt(row.postingDate)} · ${escapeHtml(row.description)}</span><strong>${formatMoney(row.debitCents)}</strong></li>`).join("");
  const creditItems = t.credit.map((row) => `<li><span>${datePt(row.postingDate)} · ${escapeHtml(row.description)}</span><strong>${formatMoney(row.creditCents)}</strong></li>`).join("");
  $("#t-account").innerHTML = `<div class="t-account-title">${escapeHtml(t.account.code)} — ${escapeHtml(t.account.name)}<small>Saldo inicial: ${escapeHtml(formatSignedMoney(t.openingBalanceCents) || formatMoney(0))}</small></div><div class="t-account-columns"><section><h3>Débitos</h3><ul>${debitItems || "<li><span>Sem movimento</span><strong>—</strong></li>"}</ul></section><section><h3>Créditos</h3><ul>${creditItems || "<li><span>Sem movimento</span><strong>—</strong></li>"}</ul></section></div><p class="t-account-balance">Saldo final ${t.closingBalanceSide === "debit" ? "devedor" : "credor"}: <strong>${formatMoney(Math.abs(t.closingBalanceCents))}</strong></p>`;
}

function renderBankStatementAccounts() {
  const select = $("#bank-statement-account");
  const selected = select.value;
  const accounts = cashAccounts();
  fillAccountSelect(select, accounts, "Selecione uma conta bancária", selected);
  if (!select.value && accounts.length) select.value = accounts[0].id;
  select.disabled = accounts.length === 0;
  if (!accounts.length) {
    $("#bank-statement-content").hidden = true;
    $("#bank-statement-state").hidden = false;
    $("#bank-statement-state").classList.remove("is-error");
    $("#bank-statement-state").textContent = "Cadastre uma conta analítica marcada como caixa ou banco para consultar o extrato.";
  }
}

function formatStatementBalance(cents) {
  return cents < 0 ? `−${formatMoney(Math.abs(cents))}` : formatMoney(cents);
}

async function loadBankStatement(event) {
  event?.preventDefault();
  const accountId = $("#bank-statement-account").value;
  const fromDate = $("#bank-statement-from").value;
  const toDate = $("#bank-statement-to").value;
  const state = $("#bank-statement-state");
  const content = $("#bank-statement-content");
  if (!cashAccounts().length) {
    content.hidden = true;
    state.hidden = false;
    state.classList.remove("is-error");
    state.textContent = "Cadastre uma conta analítica marcada como caixa ou banco para consultar o extrato.";
    return;
  }
  if (!accountId || !fromDate || !toDate || fromDate > toDate) {
    content.hidden = true;
    state.hidden = false;
    state.classList.remove("is-error");
    state.textContent = "Selecione uma conta e informe um período válido.";
    return;
  }

  state.hidden = false;
  state.classList.remove("is-error");
  state.textContent = "Consultando movimentos contabilizados…";
  content.hidden = true;
  try {
    const params = new URLSearchParams({ accountId, fromDate, toDate });
    const { relatorio } = await request(`/api/relatorios/livro-razao?${params}`);
    const rows = relatorio.rows || [];
    const inflows = rows.reduce((sum, row) => sum + row.debitCents, 0);
    const outflows = rows.reduce((sum, row) => sum + row.creditCents, 0);
    $("#bank-statement-opening").textContent = formatStatementBalance(relatorio.openingBalanceCents);
    $("#bank-statement-inflows").textContent = formatMoney(inflows);
    $("#bank-statement-outflows").textContent = formatMoney(outflows);
    $("#bank-statement-closing").textContent = formatStatementBalance(relatorio.closingBalanceCents);
    $("#bank-statement-account-label").textContent = `${relatorio.account.code} · ${relatorio.account.name} · ${datePt(fromDate)} a ${datePt(toDate)}`;
    const openingRow = `<tr class="statement-opening"><td colspan="5">Saldo anterior a ${datePt(fromDate)}</td><td class="number-cell">${escapeHtml(formatStatementBalance(relatorio.openingBalanceCents))}</td></tr>`;
    const movementRows = rows.map((row) => `<tr><td>${datePt(row.postingDate)}</td><td><button type="button" class="text-button" data-journal-entry="${escapeHtml(row.entryId)}" aria-label="Abrir lançamento ${row.entryNumber}">${row.entryNumber}</button></td><td>${escapeHtml(row.description)}</td><td class="number-cell">${row.debitCents ? formatMoney(row.debitCents) : "—"}</td><td class="number-cell">${row.creditCents ? formatMoney(row.creditCents) : "—"}</td><td class="number-cell">${escapeHtml(formatStatementBalance(row.runningBalanceCents))}</td></tr>`).join("");
    const emptyRow = rows.length ? "" : '<tr><td class="empty-table" colspan="6">Nenhum movimento postado nesta conta no período.</td></tr>';
    $("#bank-statement-body").innerHTML = openingRow + (movementRows || emptyRow);
    $("#bank-statement-foot").innerHTML = `<tr><th colspan="5">Saldo final em ${datePt(toDate)}</th><th class="number-cell">${escapeHtml(formatStatementBalance(relatorio.closingBalanceCents))}</th></tr>`;
    content.hidden = false;
    state.hidden = true;
  } catch (error) {
    content.hidden = true;
    state.hidden = false;
    state.classList.add("is-error");
    state.textContent = `Não foi possível carregar o extrato: ${error.message}`;
  }
}

async function loadTrialBalance(event) {
  event?.preventDefault();
  const params = new URLSearchParams({ fromPeriod: $("#trial-from").value, toPeriod: $("#trial-to").value });
  if ($("#trial-degree").value) params.set("degreeNumber", $("#trial-degree").value);
  const { relatorio } = await request(`/api/relatorios/balancete?${params}`);
  trialBalanceReport = relatorio;
  renderTrialBalance(relatorio);
}

async function loadBalanceSheet(event) {
  event?.preventDefault();
  const state = $("#balance-sheet-state");
  const content = $("#balance-sheet-content");
  state.hidden = false;
  state.classList.remove("is-error");
  state.textContent = "Carregando a posição patrimonial…";
  content.hidden = true;
  content.setAttribute("aria-busy", "true");
  $("#balance-sheet-status").textContent = "";
  try {
    const params = new URLSearchParams();
    if ($("#balance-sheet-date").value) params.set("asOfDate", $("#balance-sheet-date").value);
    const { relatorio } = await request(`/api/relatorios/balanco?${params}`);
    balanceSheetReport = relatorio;
    if (!$("#balance-sheet-date").value || relatorio.defaultedAsOfDate) $("#balance-sheet-date").value = relatorio.asOfDate;
    renderBalanceSheet(relatorio);
    state.hidden = true;
    content.hidden = false;
    content.setAttribute("aria-busy", "false");
  } catch (error) {
    state.classList.add("is-error");
    state.textContent = `Não foi possível carregar o Balanço: ${error.message}`;
    content.setAttribute("aria-busy", "false");
  }
}

function balanceSheetTreeDepth(node) {
  return Math.max(node.depth || 0, ...(node.children || []).map(balanceSheetTreeDepth));
}

function formatBalanceSheetMoney(cents) {
  if (!Number.isSafeInteger(cents)) return "Valor indisponível";
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  const reais = (absolute / 100n).toLocaleString("pt-BR");
  const centavos = String(absolute % 100n).padStart(2, "0");
  return `${amount < 0n ? "−" : ""}R$ ${reais},${centavos}`;
}

function renderBalanceSheetTree(node) {
  if (node.depth > balanceSheetVisibleDepth || (node.kind === "virtual-result" && node.amountCents === 0)) return "";
  const code = node.code ? `<span class="balance-sheet-code">${escapeHtml(node.code)}</span>` : "";
  const indentation = 8 + node.depth * 15;
  const amount = formatBalanceSheetMoney(node.amountCents);
  const rowLabel = `${node.name}: ${amount}`;
  const children = (node.children || []).map(renderBalanceSheetTree).join("");
  return `<tr class="balance-sheet-${escapeHtml(node.kind)}-row"><th scope="row"><div class="balance-sheet-account" style="padding-left:${indentation}px">${code}<span>${escapeHtml(node.name)}</span></div></th><td class="number-cell"><span title="Valor integral: ${escapeHtml(amount)}" aria-label="${escapeHtml(rowLabel)}">${escapeHtml(amount)}</span></td></tr>${children}`;
}

function renderBalanceSheet(report) {
  const sections = report.sections;
  const trees = [sections.assets.tree, sections.liabilities.tree, sections.equity.tree];
  balanceSheetMaxDepth = Math.max(0, ...trees.map(balanceSheetTreeDepth));
  balanceSheetVisibleDepth = Math.min(balanceSheetVisibleDepth, balanceSheetMaxDepth);

  $("#balance-sheet-position").textContent = `POSIÇÃO EM ${datePt(report.asOfDate)}`;
  $("#balance-sheet-assets-title").textContent = sections.assets.label.toLocaleUpperCase("pt-BR");
  $("#balance-sheet-liabilities-title").textContent = sections.liabilities.label.toLocaleUpperCase("pt-BR");
  $("#balance-sheet-equity-title").textContent = sections.equity.label.toLocaleUpperCase("pt-BR");
  $("#balance-sheet-assets-body").innerHTML = renderBalanceSheetTree(sections.assets.tree);
  $("#balance-sheet-liabilities-body").innerHTML = renderBalanceSheetTree(sections.liabilities.tree);
  $("#balance-sheet-equity-body").innerHTML = renderBalanceSheetTree(sections.equity.tree);
  $("#balance-sheet-level-label").textContent = `Nível exibido: ${balanceSheetVisibleDepth + 1} de ${balanceSheetMaxDepth + 1}`;
  $("#balance-sheet-level-up").disabled = balanceSheetVisibleDepth === 0;
  $("#balance-sheet-level-down").disabled = balanceSheetVisibleDepth >= balanceSheetMaxDepth;

  const resultAmount = formatBalanceSheetMoney(report.virtualResult.amountCents);
  const resultScope = report.virtualResult.scope.fromDate
    ? `Escopo do saldo remanescente: ${datePt(report.virtualResult.scope.fromDate)} a ${datePt(report.asOfDate)}.`
    : "Não há saldo remanescente em contas de resultado até a data-base.";
  $("#balance-sheet-result-note").textContent = `${report.virtualResult.label}: ${resultAmount}. ${report.virtualResult.explanation} ${resultScope} Ajuste virtual de apresentação, sem lançamento contábil.`;

  const totals = report.totals;
  const totalsNode = $("#balance-sheet-totals");
  totalsNode.classList.toggle("is-unbalanced", !report.isBalanced);
  totalsNode.classList.toggle("is-incomplete", Boolean(report.openingDraftPending));
  totalsNode.innerHTML = [
    ["TOTAL DO ATIVO", totals.assetsCents],
    ["TOTAL DO PASSIVO + PATRIMÔNIO LÍQUIDO", totals.liabilitiesPlusEquityCents],
    ["Diferença patrimonial (Ativo − (Passivo + PL))", totals.differenceCents],
  ].map(([label, cents], index) => `<div class="balance-sheet-total${index === 2 ? " balance-sheet-difference" : ""}"><span>${escapeHtml(label)}</span><strong aria-label="${escapeHtml(label)}: ${escapeHtml(formatBalanceSheetMoney(cents))}">${escapeHtml(formatBalanceSheetMoney(cents))}</strong></div>`).join("");

  const status = $("#balance-sheet-status");
  status.classList.toggle("error-text", !report.isBalanced);
  status.classList.toggle("warning-text", Boolean(report.openingDraftPending && report.isBalanced));
  if (!report.totals.ledgerDebitCents && !report.totals.ledgerCreditCents) {
    status.textContent = report.openingDraftPending
      ? `Não há partidas postadas até ${datePt(report.asOfDate)} e a abertura legada está pendente. Os saldos zerados não representam uma posição completa.`
      : `Não há partidas postadas até ${datePt(report.asOfDate)}. A estrutura do plano de contas é exibida com saldos zerados.`;
  } else if (report.isBalanced && report.openingDraftPending) {
    status.textContent = `A equação das partidas postadas está conciliada em ${datePt(report.asOfDate)}, mas a posição está incompleta: a abertura legada pendente não compõe os saldos.`;
  } else if (report.isBalanced) {
    status.textContent = `Posição conciliada em ${datePt(report.asOfDate)}. A apuração inclui somente partidas postadas até essa data.`;
  } else if (report.totals.differenceCents !== 0) {
    const openingNotice = report.openingDraftPending ? " A abertura legada também está pendente." : "";
    status.textContent = `Atenção: diferença patrimonial de ${formatBalanceSheetMoney(report.totals.differenceCents)}; confira os avisos antes de usar esta posição.${openingNotice}`;
  } else {
    status.textContent = "Atenção: o razão completo ou as classificações têm inconsistências, embora a diferença patrimonial calculada seja zero. Confira os avisos.";
  }
  const warningList = $("#balance-sheet-warnings");
  warningList.innerHTML = report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  warningList.hidden = report.warnings.length === 0;
}

function changeBalanceSheetLevel(direction) {
  if (!balanceSheetReport) return;
  balanceSheetVisibleDepth = Math.max(0, Math.min(balanceSheetMaxDepth, balanceSheetVisibleDepth + direction));
  renderBalanceSheet(balanceSheetReport);
}

function trialBalanceSummary(rows) {
  const opening = rows.reduce((sum, row) => sum + row.openingDebitCents - row.openingCreditCents, 0);
  const closing = rows.reduce((sum, row) => sum + row.closingDebitCents - row.closingCreditCents, 0);
  return {
    openingDebitCents: Math.max(opening, 0),
    openingCreditCents: Math.max(-opening, 0),
    debitCents: rows.reduce((sum, row) => sum + row.debitCents, 0),
    creditCents: rows.reduce((sum, row) => sum + row.creditCents, 0),
    closingDebitCents: Math.max(closing, 0),
    closingCreditCents: Math.max(-closing, 0),
  };
}

function renderTrialBalance(relatorio) {
  const sides = (item, prefix) => {
    const debitKey = `${prefix}DebitCents`; const creditKey = `${prefix}CreditCents`;
    if (Object.hasOwn(item, debitKey) || Object.hasOwn(item, creditKey)) return [item[debitKey] || 0, item[creditKey] || 0];
    const signed = item[`${prefix}BalanceCents`] || 0;
    return signed >= 0 ? [signed, 0] : [0, Math.abs(signed)];
  };
  const balanceCell = (debitCents, creditCents, totals = false) => {
    if (totals) return `<span class="trial-total-side" aria-label="Total devedor ${escapeHtml(formatMoney(debitCents))}">D: ${formatMoney(debitCents)}</span><span class="trial-total-side" aria-label="Total credor ${escapeHtml(formatMoney(creditCents))}">C: ${formatMoney(creditCents)}</span>`;
    if (!debitCents && !creditCents) return "—";
    if (debitCents && creditCents) return `<span class="trial-balance-side" aria-label="Saldo devedor ${escapeHtml(formatMoney(debitCents))}">${formatMoney(debitCents)} D</span><span class="trial-balance-side" aria-label="Saldo credor ${escapeHtml(formatMoney(creditCents))}">${formatMoney(creditCents)} C</span>`;
    const isDebit = Boolean(debitCents);
    return `<span class="trial-balance-side" aria-label="Saldo ${isDebit ? "devedor" : "credor"} ${escapeHtml(formatMoney(debitCents || creditCents))}">${formatMoney(debitCents || creditCents)} ${isDebit ? "D" : "C"}</span>`;
  };
  const accountRows = new Map(relatorio.rows.map((row) => [row.accountId, row]));
  const subcategoriesByParent = new Map();
  for (const item of finance.subcategories) {
    const parentKey = `${item.parentType}:${item.parentId}`;
    const siblings = subcategoriesByParent.get(parentKey) || [];
    siblings.push(item);
    subcategoriesByParent.set(parentKey, siblings);
  }
  for (const siblings of subcategoriesByParent.values()) siblings.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, "pt-BR"));
  const accountsBySubcategory = new Map();
  for (const account of finance.planAccounts) {
    if (!accountRows.has(account.id)) continue;
    const accounts = accountsBySubcategory.get(account.subcategoryId) || [];
    accounts.push(account);
    accountsBySubcategory.set(account.subcategoryId, accounts);
  }
  for (const accounts of accountsBySubcategory.values()) accounts.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, "pt-BR"));

  const nodes = [];
  const appendAccount = (account, depth) => {
    const row = accountRows.get(account.id);
    nodes.push({
      depth, kind: "account",
      code: accountCode(account.id), name: account.name, values: row,
    });
  };
  const appendSubcategory = (subcategory, depth) => {
    const position = nodes.length;
    const children = [];
    const childItems = [
      ...(subcategoriesByParent.get(`subcategory:${subcategory.id}`) || []).map((item) => ({ kind: "subcategory", item })),
      ...(accountsBySubcategory.get(subcategory.id) || []).map((item) => ({ kind: "account", item })),
    ].sort((a, b) => a.item.number - b.item.number || (a.kind === b.kind ? 0 : a.kind === "subcategory" ? -1 : 1));
    for (const child of childItems) {
      if (child.kind === "subcategory") children.push(...appendSubcategory(child.item, depth + 1));
      else {
        appendAccount(child.item, depth + 1);
        children.push(accountRows.get(child.item.id));
      }
    }
    if (!children.length) return children;
    const values = trialBalanceSummary(children);
    nodes.splice(position, 0, { depth, kind: "subcategory", code: subcategoryCode(subcategory.id), name: subcategory.name, values });
    return children;
  };

  const selectedDegree = relatorio.degreeNumber == null ? null : Number(relatorio.degreeNumber);
  const degrees = finance.degrees.filter((degree) => selectedDegree == null || degree.number === selectedDegree).slice().sort((a, b) => a.number - b.number);
  for (const degree of degrees) {
    const position = nodes.length;
    const children = [];
    for (const subcategory of subcategoriesByParent.get(`degree:${degree.id}`) || []) {
      children.push(...appendSubcategory(subcategory, 1));
    }
    const values = trialBalanceSummary(children);
    nodes.splice(position, 0, { depth: 0, kind: "degree", code: String(degree.number), name: degree.name, values });
  }

  trialBalanceMaxDepth = nodes.reduce((maximum, node) => Math.max(maximum, node.depth), 0);
  trialBalanceVisibleDepth = Math.min(trialBalanceVisibleDepth, trialBalanceMaxDepth);
  const rowHtml = nodes.map((node) => {
    const hidden = node.depth > trialBalanceVisibleDepth;
    const [openingDebit, openingCredit] = sides(node.values, "opening");
    const [closingDebit, closingCredit] = sides(node.values, "closing");
    return `<tr class="trial-${node.kind}-row"${hidden ? " hidden" : ""}><td><div class="trial-tree-code" style="padding-left:${8 + node.depth * 20}px"><span>${escapeHtml(node.code)}</span></div></td><td>${escapeHtml(node.name)}</td><td class="number-cell">${balanceCell(openingDebit, openingCredit)}</td><td class="number-cell">${formatMoney(node.values.debitCents)}</td><td class="number-cell">${formatMoney(node.values.creditCents)}</td><td class="number-cell">${balanceCell(closingDebit, closingCredit)}</td></tr>`;
  }).join("");
  $("#trial-body").innerHTML = rowHtml;
  $("#trial-level-label").textContent = `Nível exibido: ${trialBalanceVisibleDepth + 1} de ${trialBalanceMaxDepth + 1}`;
  $("#trial-level-up").disabled = trialBalanceVisibleDepth === 0;
  $("#trial-level-down").disabled = trialBalanceVisibleDepth >= trialBalanceMaxDepth;
  const t = relatorio.totals;
  const [openingDebit, openingCredit] = sides(t, "opening");
  const [closingDebit, closingCredit] = sides(t, "closing");
  $("#trial-foot").innerHTML = `<tr><th colspan="2">Totais das contas analíticas</th><th class="number-cell">${balanceCell(openingDebit, openingCredit, true)}</th><th class="number-cell">${formatMoney(t.debitCents)}</th><th class="number-cell">${formatMoney(t.creditCents)}</th><th class="number-cell">${balanceCell(closingDebit, closingCredit, true)}</th></tr>`;
  const openingMessage = relatorio.openingDraftPending ? " A abertura legada permanece pendente e não foi contabilizada." : "";
  const scopeMessage = relatorio.isCompleteChart ? "" : " A conferência abaixo está filtrada por grau; o equilíbrio foi verificado no razão completo.";
  $("#trial-status").textContent = `${relatorio.isBalanced ? "Balancete balanceado." : "Atenção: os totais do período ou os saldos finais não estão balanceados."}${scopeMessage}${openingMessage}`;
  $("#trial-status").classList.toggle("error-text", !relatorio.isBalanced);
}

function changeTrialBalanceLevel(direction) {
  if (!trialBalanceReport) return;
  trialBalanceVisibleDepth = Math.max(0, Math.min(trialBalanceMaxDepth, trialBalanceVisibleDepth + direction));
  renderTrialBalance(trialBalanceReport);
}

function formatDreAmount(cents) {
  return cents < 0 ? `−${formatMoney(Math.abs(cents))}` : formatMoney(cents);
}

function renderIncomeStatement(target, statement, periodLabel) {
  const groups = new Map(statement.groups.map((group) => [group.groupNumber, group]));
  const rows = [];
  const appendGroup = (groupNumber, subtotalLabel, subtract = false) => {
    const group = groups.get(groupNumber);
    rows.push(`<tr class="dre-section-row"><th colspan="2">${escapeHtml(group.name)}</th></tr>`);
    if (group.rows.length) {
      rows.push(...group.rows.map((row) => `<tr><td class="dre-account"><span>${escapeHtml(row.code)}</span> ${escapeHtml(row.name)}</td><td class="number-cell">${formatDreAmount(row.amountCents)}</td></tr>`));
    } else {
      rows.push(`<tr><td colspan="2" class="dre-empty">Sem movimento no mês</td></tr>`);
    }
    rows.push(`<tr class="dre-subtotal"><th>${subtract ? "(−) " : ""}${escapeHtml(subtotalLabel)}</th><td class="number-cell">${formatDreAmount(group.totalCents)}</td></tr>`);
  };
  appendGroup(4, "Total de receitas");
  appendGroup(5, "Total de custos", true);
  rows.push(`<tr class="dre-result"><th>Resultado bruto</th><td class="number-cell">${formatDreAmount(statement.totals.grossResultCents)}</td></tr>`);
  appendGroup(6, "Total de despesas", true);
  rows.push(`<tr class="dre-result dre-final-result"><th>Resultado líquido do mês</th><td class="number-cell">${formatDreAmount(statement.totals.netResultCents)}</td></tr>`);
  $(target).innerHTML = rows.join("");
  return periodLabel;
}

function renderDreCostCenterOptions() {
  const select = $("#dre-cost-center");
  if (!select || !finance) return;
  const selected = select.value;
  const centers = finance.costCenters.slice().sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
  select.innerHTML = `<option value="">Todos</option><option value="sem-centro">Sem centro de custo</option>${centers.map((center) => `<option value="${escapeHtml(center.id)}">${escapeHtml(center.code)} — ${escapeHtml(center.name)}${center.active ? "" : " (inativo)"}</option>`).join("")}`;
  select.value = selected && (selected === "sem-centro" || centers.some((center) => center.id === selected)) ? selected : "";
}

async function loadIncomeStatement() {
  const period = $("#dre-period").value || selectedMonth;
  const params = new URLSearchParams({ period });
  const costCenterId = $("#dre-cost-center").value;
  if (costCenterId) params.set("costCenterId", costCenterId);
  const { relatorio } = await request(`/api/relatorios/dre?${params}`);
  const label = monthPt(period);
  const regime = $("#dre-regime").value || "cash";
  const statement = relatorio[regime];
  if (!statement) throw new Error("A DRE não retornou dados para o regime selecionado.");
  renderIncomeStatement("#dre-body", statement, label);
  $("#dre-regime-title").textContent = `DRE por regime de ${regime === "cash" ? "caixa" : "competência"}`;
  $("#dre-period-label").textContent = label;
  const centerLabel = $("#dre-cost-center").selectedOptions[0]?.textContent.trim() || "Todos";
  $("#dre-status").textContent = `Somatório de ${label} · Regime ${regime === "cash" ? "caixa" : "competência"} · Centro de custo: ${centerLabel}. Custos e despesas são exibidos pelo valor natural e subtraídos no resultado.`;
  $("#dre-status").classList.remove("error-text");
}

async function renderCostCenterReport() {
  const fromPeriod = $("#cost-report-from").value; const toPeriod = $("#cost-report-to").value;
  const { relatorio } = await request(`/api/relatorios/centros-de-custo?${new URLSearchParams({ fromPeriod, toPeriod })}`);
  $("#cost-report-body").innerHTML = relatorio.rows.map((row) => `<tr><td>${escapeHtml(row.code ? `${row.code} — ` : "")}${escapeHtml(row.name)}</td><td class="number-cell">${formatMoney(row.costsCents)}</td><td class="number-cell">${formatMoney(row.expensesCents)}</td></tr>`).join("");
}

function createAllocationRow(wrapper) {
  const row = document.createElement("div");
  row.className = "allocation-row";
  row.innerHTML = `<select aria-label="Centro de custo">${activeCostCenterOptions()}</select><input type="text" inputmode="decimal" aria-label="Valor alocado" placeholder="Valor (R$)"><button class="text-button delete" type="button" aria-label="Remover rateio">×</button>`;
  row.querySelector("button").addEventListener("click", () => { row.remove(); updateManualTotals(); });
  row.querySelectorAll("input,select").forEach((field) => field.addEventListener("input", updateManualTotals));
  wrapper.querySelector(".allocation-rows").append(row);
}

function createManualLine() {
  const wrapper = document.createElement("div");
  wrapper.className = "manual-line";
  wrapper.innerHTML = `<div class="manual-line-fields"><select class="manual-account" required aria-label="Conta contábil"><option value="">Conta analítica</option>${accountOptions()}</select><input class="manual-debit" type="text" inputmode="decimal" aria-label="Débito em reais" placeholder="Débito (R$)"><input class="manual-credit" type="text" inputmode="decimal" aria-label="Crédito em reais" placeholder="Crédito (R$)"><button class="text-button delete remove-manual-line" type="button" aria-label="Remover linha">×</button></div><details class="allocation-details"><summary>Rateio por centro de custo</summary><div class="allocation-rows"></div><button class="text-button add-allocation" type="button">+ Adicionar centro</button></details>`;
  wrapper.querySelector(".remove-manual-line").addEventListener("click", () => { if ($$(".manual-line", $("#manual-lines")).length > 2) wrapper.remove(); updateManualTotals(); });
  wrapper.querySelector(".add-allocation").addEventListener("click", () => createAllocationRow(wrapper));
  wrapper.querySelectorAll("input,select").forEach((field) => field.addEventListener("input", updateManualTotals));
  $("#manual-lines").append(wrapper);
  return wrapper;
}

function manualLinesData() {
  return $$(".manual-line", $("#manual-lines")).map((wrapper) => {
    const debitValue = wrapper.querySelector(".manual-debit").value;
    const creditValue = wrapper.querySelector(".manual-credit").value;
    const debitCents = debitValue.trim() ? parseMoney(debitValue) : 0;
    const creditCents = creditValue.trim() ? parseMoney(creditValue) : 0;
    const allocations = $$(".allocation-row", wrapper).map((row) => ({
      costCenterId: row.querySelector("select").value,
      amountCents: parseMoney(row.querySelector("input").value),
    }));
    if (allocations.some((item) => !item.costCenterId)) throw new Error("Selecione o centro de custo em cada rateio.");
    const amount = debitCents || creditCents;
    if (allocations.length && allocations.reduce((sum, item) => sum + item.amountCents, 0) !== amount) throw new Error("A soma do rateio deve corresponder ao valor da linha contábil.");
    return { accountId: wrapper.querySelector(".manual-account").value, debitCents, creditCents, costCenterAllocations: allocations };
  });
}

function updateManualTotals() {
  let debit = 0; let credit = 0;
  $$(".manual-line", $("#manual-lines")).forEach((wrapper) => {
    try { debit += wrapper.querySelector(".manual-debit").value.trim() ? parseMoney(wrapper.querySelector(".manual-debit").value) : 0; } catch {}
    try { credit += wrapper.querySelector(".manual-credit").value.trim() ? parseMoney(wrapper.querySelector(".manual-credit").value) : 0; } catch {}
  });
  $("#manual-debit-total").textContent = formatMoney(debit);
  $("#manual-credit-total").textContent = formatMoney(credit);
  const equal = debit > 0 && debit === credit;
  $("#manual-debit-total").classList.toggle("is-balanced", equal);
  $("#manual-credit-total").classList.toggle("is-balanced", equal);
}

function openManualDialog() {
  const form = $("#manual-form");
  form.reset();
  $("#manual-lines").replaceChildren();
  sendFormError($("#manual-error"), "");
  const today = todayCuiaba();
  $("#manual-date").value = today;
  $("#manual-period").value = today.slice(0, 7);
  $("#manual-description").value = "";
  createManualLine(); createManualLine();
  updateManualTotals();
  $("#manual-dialog").showModal();
  $("#manual-description").focus();
}

async function submitManualEntry(event) {
  event.preventDefault();
  const error = $("#manual-error");
  sendFormError(error, "");
  try {
    const lines = manualLinesData();
    const debit = lines.reduce((sum, line) => sum + line.debitCents, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditCents, 0);
    if (lines.some((line) => !line.accountId)) throw new Error("Selecione uma conta analítica em cada linha.");
    if (debit <= 0 || debit !== credit) throw new Error("O total de débitos precisa ser igual ao total de créditos e maior que zero.");
    await apiCall("POST", "/api/livro-diario", {
      postingDate: $("#manual-date").value,
      period: $("#manual-period").value,
      description: $("#manual-description").value.trim(),
      sourceKey: `manual:${uuid()}`,
      lines,
    });
    $("#manual-dialog").close();
    await refreshFinance();
    showToast("Lançamento balanceado postado no Livro Diário.");
  } catch (caught) { sendFormError(error, caught.message); }
}

function defaultAccount(groups, accountName) {
  return accountsByGroup(groups).find((account) => account.name.toLocaleLowerCase("pt-BR") === accountName.toLocaleLowerCase("pt-BR"))?.id
    || accountsByGroup(groups)[0]?.id || "";
}

function setDocumentPartyStatus(message) {
  $("#document-party-status").textContent = message;
}

function closeDocumentPartySuggestions() {
  const list = $("#document-party-options");
  if (!list) return;
  list.hidden = true;
  list.replaceChildren();
  $("#document-party").setAttribute("aria-expanded", "false");
  $("#document-party").removeAttribute("aria-activedescendant");
  documentPartySuggestions = [];
  documentPartyActiveIndex = -1;
}

function setDocumentPartyActiveIndex(index) {
  const input = $("#document-party");
  if (!documentPartySuggestions.length) return;
  documentPartyActiveIndex = (index + documentPartySuggestions.length) % documentPartySuggestions.length;
  [...$("#document-party-options").children].forEach((option, optionIndex) => {
    const active = optionIndex === documentPartyActiveIndex;
    option.setAttribute("aria-selected", String(active));
    option.classList.toggle("is-active", active);
  });
  input.setAttribute("aria-activedescendant", `document-party-option-${documentPartyActiveIndex}`);
}

async function searchDocumentParties() {
  const input = $("#document-party");
  const query = input.value.trim();
  if (!$("#document-dialog").open || selectedDocumentPartyId || !query) {
    closeDocumentPartySuggestions();
    return;
  }
  const token = ++documentPartySearchToken;
  const params = new URLSearchParams({ q: query, role: activeDocumentKind === "payable" ? "supplier" : "customer", status: "active" });
  setDocumentPartyStatus("Buscando cadastros ativos…");
  try {
    const { contrapartes } = await request(`/api/contrapartes?${params.toString()}`);
    if (token !== documentPartySearchToken || !$("#document-dialog").open || selectedDocumentPartyId) return;
    documentPartySuggestions = contrapartes.slice(0, 8);
    documentPartyActiveIndex = -1;
    const list = $("#document-party-options");
    list.innerHTML = documentPartySuggestions.map((party, index) => {
      const details = [party.tradeName, party.taxIdMasked].filter(Boolean).join(" · ");
      return `<li id="document-party-option-${index}" role="option" aria-selected="false" data-party-option="${index}"><strong>${escapeHtml(party.name)}</strong>${details ? `<small>${escapeHtml(details)}</small>` : ""}</li>`;
    }).join("");
    list.hidden = !documentPartySuggestions.length;
    $("#document-party").setAttribute("aria-expanded", String(documentPartySuggestions.length > 0));
    $("#document-party").removeAttribute("aria-activedescendant");
    if (documentPartySuggestions.length) {
      setDocumentPartyStatus(`${documentPartySuggestions.length} cadastro(s) ativo(s) encontrado(s). Use as setas para selecionar.`);
    } else {
      setDocumentPartyStatus("Nenhum cadastro ativo encontrado. Você pode informar o nome em texto livre.");
    }
  } catch (error) {
    if (token !== documentPartySearchToken || !$("#document-dialog").open) return;
    closeDocumentPartySuggestions();
    setDocumentPartyStatus(`Não foi possível buscar cadastros: ${error.message}`);
  }
}

function scheduleDocumentPartySearch(immediate = false) {
  clearTimeout(documentPartySearchTimer);
  if (selectedDocumentPartyId) {
    closeDocumentPartySuggestions();
    return;
  }
  const query = $("#document-party").value.trim();
  if (!query) {
    documentPartySearchToken += 1;
    closeDocumentPartySuggestions();
    setDocumentPartyStatus("Informe um nome livre (até 120 caracteres) ou selecione um cadastro ativo.");
    return;
  }
  if (query.length > 120) setDocumentPartyStatus("Nomes livres aceitam até 120 caracteres. Selecione um cadastro para usar um nome maior.");
  documentPartySearchTimer = setTimeout(searchDocumentParties, immediate ? 0 : 180);
}

function selectDocumentParty(party) {
  selectedDocumentPartyId = party.id;
  selectedDocumentPartyText = party.name;
  const input = $("#document-party");
  input.value = party.name;
  closeDocumentPartySuggestions();
  setDocumentPartyStatus(`Cadastro vinculado: ${party.name}. O nome do documento fica salvo como snapshot histórico.`);
}

function openDocumentDialog(kind, document = null, suggestedValues = null) {
  activeDocumentKind = kind;
  documentPartySearchToken += 1;
  clearTimeout(documentPartySearchTimer);
  closeDocumentPartySuggestions();
  editingDocument = document ? { kind, id: document.id } : null;
  documentIdempotencyKey = document ? null : `${kind}:${uuid()}`;
  const form = $("#document-form");
  form.reset();
  sendFormError($("#document-error"), "");
  const payable = kind === "payable";
  const values = document || suggestedValues || {};
  $("#document-eyebrow").textContent = payable ? "OBRIGAÇÃO" : "DIREITO A RECEBER";
  $("#document-title").textContent = document ? "Editar rascunho" : payable ? "Nova conta a pagar" : "Nova conta a receber";
  $("#party-label").textContent = payable ? "Credor / fornecedor" : "Pagador / devedor";
  $("#classification-label").firstChild.textContent = payable ? "Conta de custo / despesa" : "Conta de receita";
  $("#control-label").firstChild.textContent = payable ? "Conta de obrigação" : "Conta de recebíveis";
  fillAccountSelect($("#document-classification"), accountsByGroup(payable ? [5, 6] : [4]), "Selecione uma conta");
  fillAccountSelect($("#document-control"), payable ? accountsByGroup([2]) : finance.planAccounts.filter((account) => account.postable && accountGroup(account.id) === 1 && !account.cashEquivalent), "Selecione uma conta de controle");
  $("#document-cost-center").innerHTML = activeCostCenterOptions();
  $("#document-party").value = values ? (payable ? values.creditor : values.debtor) || "" : "";
  selectedDocumentPartyId = values.partyId || null;
  selectedDocumentPartyText = selectedDocumentPartyId ? $("#document-party").value.trim() : "";
  if (selectedDocumentPartyId) {
    const linkedSummary = finance.parties?.find((party) => party.id === selectedDocumentPartyId);
    setDocumentPartyStatus(linkedSummary?.active === false
      ? `Vínculo histórico com ${linkedSummary.name} (cadastro inativo). O documento mantém seu snapshot salvo.`
      : linkedSummary && linkedSummary.name !== selectedDocumentPartyText
        ? `Vínculo com ${linkedSummary.name}. O documento mantém o snapshot histórico ${selectedDocumentPartyText}.`
        : `Cadastro vinculado: ${selectedDocumentPartyText}. O nome do documento fica salvo como snapshot histórico.`);
  } else {
    setDocumentPartyStatus("Informe um nome livre (até 120 caracteres) ou selecione um cadastro ativo.");
  }
  $("#document-description").value = values.description || "";
  $("#document-number").value = values.documentNumber || "";
  $("#document-amount").value = Number.isSafeInteger(values.originalAmountCents) ? moneyField(values.originalAmountCents) : "";
  const today = todayCuiaba();
  $("#document-issue-date").value = values.issueDate || today;
  $("#document-due-date").value = values.dueDate || today;
  $("#document-competence").value = values.competencePeriod || today.slice(0, 7);
  $("#document-cost-center").value = values.costCenterId || "";
  const classificationId = payable ? values.expenseAccountId : values.revenueAccountId;
  const controlId = payable ? values.liabilityAccountId : values.receivableAccountId;
  $("#document-classification").value = classificationId || defaultAccount(payable ? [6, 5] : [4], payable ? "Energia" : "Pagamento Salarial");
  $("#document-control").value = controlId || (payable ? defaultAccount([2], "Serviços a Pagar") : defaultAccount([1], "Contas a Receber"));
  $("#document-notes").value = values.notes || "";
  $("#document-dialog").showModal();
  $("#document-party").focus();
}

function documentFormData(kind) {
  const amountCents = parseMoney($("#document-amount").value);
  const data = {
    description: $("#document-description").value.trim(),
    documentNumber: $("#document-number").value.trim(),
    issueDate: $("#document-issue-date").value,
    dueDate: $("#document-due-date").value,
    competencePeriod: $("#document-competence").value,
    originalAmountCents: amountCents,
    costCenterId: $("#document-cost-center").value || null,
    notes: $("#document-notes").value.trim(),
  };
  data.partyId = selectedDocumentPartyId || null;
  if (kind === "payable") {
    data.creditor = $("#document-party").value.trim();
    data.expenseAccountId = $("#document-classification").value;
    data.liabilityAccountId = $("#document-control").value;
  } else {
    data.debtor = $("#document-party").value.trim();
    data.revenueAccountId = $("#document-classification").value;
    data.receivableAccountId = $("#document-control").value;
  }
  return data;
}

async function submitDocument(event) {
  event.preventDefault();
  const error = $("#document-error");
  sendFormError(error, "");
  const kind = editingDocument?.kind || (activeScreen === "receivables" ? "receivable" : "payable");
  try {
    const body = documentFormData(kind);
    const partyField = kind === "payable" ? "creditor" : "debtor";
    body[partyField] ||= $("#document-party").value.trim();
    if (!body.partyId && body[partyField].length > 120) throw new Error("O texto livre aceita até 120 caracteres. Selecione um cadastro para usar o nome completo.");
    if (!editingDocument) body.idempotencyKey = documentIdempotencyKey;
    const base = kind === "payable" ? "/api/contas-a-pagar" : "/api/contas-a-receber";
    await apiCall(editingDocument ? "PUT" : "POST", editingDocument ? `${base}/${editingDocument.id}` : base, body);
    $("#document-dialog").close();
    documentIdempotencyKey = null;
    await refreshFinance();
    showToast(editingDocument ? "Rascunho atualizado." : "Documento salvo como rascunho.");
  } catch (caught) { sendFormError(error, caught.message); }
}

function openRecognition(kind, document) {
  pendingDocumentAction = { kind, id: document.id };
  $("#recognition-description").textContent = `${kind === "payable" ? document.creditor : document.debtor} · ${document.description} · ${formatMoney(document.originalAmountCents)} · competência ${document.competencePeriod}`;
  $("#recognition-date").value = todayCuiaba();
  sendFormError($("#recognition-error"), "");
  $("#recognition-dialog").showModal();
}

async function submitRecognition(event) {
  event.preventDefault();
  if (!pendingDocumentAction) return;
  const { kind, id } = pendingDocumentAction;
  const error = $("#recognition-error");
  sendFormError(error, "");
  try {
    const base = kind === "payable" ? "/api/contas-a-pagar" : "/api/contas-a-receber";
    await apiCall("POST", `${base}/${id}/reconhecer`, { postingDate: $("#recognition-date").value });
    $("#recognition-dialog").close();
    await refreshFinance();
    showToast("Reconhecimento contabilizado no Livro Diário.");
  } catch (caught) { sendFormError(error, caught.message); }
}

function openSettlement(kind, document) {
  pendingDocumentAction = { kind, id: document.id };
  settlementIdempotencyKey = `${kind}:${document.id}:${uuid()}`;
  const outstanding = documentOutstanding(document, kind);
  $("#settlement-eyebrow").textContent = kind === "payable" ? "PAGAMENTO" : "RECEBIMENTO";
  $("#settlement-title").textContent = kind === "payable" ? "Registrar pagamento" : "Registrar recebimento";
  $("#settlement-description").textContent = `${kind === "payable" ? document.creditor : document.debtor} · ${document.description} · saldo ${formatMoney(outstanding)}`;
  fillAccountSelect($("#settlement-cash-account"), cashAccounts(), "Selecione caixa ou banco");
  $("#settlement-cash-account").value = cashAccounts().find((account) => account.name.toLocaleLowerCase("pt-BR") === "nubank")?.id || cashAccounts()[0]?.id || "";
  $("#settlement-date").value = todayCuiaba();
  $("#settlement-amount").value = moneyField(outstanding);
  $("#settlement-reference").value = "";
  sendFormError($("#settlement-error"), "");
  $("#settlement-dialog").showModal();
}

async function submitSettlement(event) {
  event.preventDefault();
  if (!pendingDocumentAction) return;
  const { kind, id } = pendingDocumentAction;
  const error = $("#settlement-error");
  sendFormError(error, "");
  try {
    const amountCents = parseMoney($("#settlement-amount").value);
    const body = {
      date: $("#settlement-date").value,
      cashAccountId: $("#settlement-cash-account").value,
      amountCents,
      reference: $("#settlement-reference").value.trim(),
      idempotencyKey: settlementIdempotencyKey,
    };
    const base = kind === "payable" ? "/api/contas-a-pagar" : "/api/contas-a-receber";
    await apiCall("POST", `${base}/${id}/liquidar`, body);
    $("#settlement-dialog").close();
    settlementIdempotencyKey = null;
    await refreshFinance();
    showToast(kind === "payable" ? "Pagamento contabilizado; a despesa não foi reconhecida novamente." : "Recebimento contabilizado; a receita não foi reconhecida novamente.");
  } catch (caught) { sendFormError(error, caught.message); }
}

function subcategoryPath(item) {
  const parts = [item.name];
  let current = item;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentType === "degree") {
      const degree = finance.degrees.find((candidate) => candidate.id === current.parentId);
      if (degree) parts.unshift(`${degree.number} ${degree.name}`);
      break;
    }
    current = finance.subcategories.find((candidate) => candidate.id === current.parentId);
    if (current) parts.unshift(current.name);
  }
  return parts.join(" › ");
}
function parentLabel(item) {
  if (item.parentType === "degree") {
    const degree = finance.degrees.find((candidate) => candidate.id === item.parentId);
    return degree ? `${degree.number} — ${degree.name}` : "Grau removido";
  }
  const parent = finance.subcategories.find((candidate) => candidate.id === item.parentId);
  return parent ? `${subcategoryCode(parent.id)} — ${parent.name}` : "Subcategoria removida";
}
function postableReferences(accountId) {
  return finance.journalEntries.filter((entry) => entry.status === "posted" && entry.lines.some((line) => line.accountId === accountId)).length;
}

function liquidityClassLabel(account) {
  const labels = {
    "current-asset": "Ativo circulante",
    "long-term-receivable": "Realizável a longo prazo",
    "other-noncurrent-asset": "Outro ativo não circulante",
    "current-liability": "Passivo circulante",
    "long-term-liability": "Passivo não circulante",
  };
  if (account.liquidityClass) return labels[account.liquidityClass] || "Classificação inválida";
  const group = accountGroup(account.id);
  const code = accountCode(account.id);
  if (group === 1 && (code.startsWith("1.1.") || code === "1.1")) return "Circulante pela hierarquia";
  if (group === 2 && (code.startsWith("2.1.") || code === "2.1")) return "Circulante pela hierarquia";
  return [1, 2].includes(group) ? "Prazo não classificado" : "Não se aplica";
}

function renderCatalog() {
  const head = $("#registration-head");
  const body = $("#registration-body");
  $("#cost-report").hidden = registrationType !== "cost-centers";
  $("#party-list-filters").hidden = registrationType !== "parties";
  $("#party-list-status").hidden = registrationType !== "parties";
  $("#registration-table").classList.toggle("party-table", registrationType === "parties");
  $("#add-registration").textContent = registrationType === "cost-centers" ? "+ Novo centro de custo" : registrationType === "parties" ? "+ Nova pessoa/empresa" : "+ Novo cadastro";
  $("#add-registration").hidden = registrationType === "degrees";
  if (registrationType === "degrees") {
    $("#registration-hint").textContent = "Os seis graus contábeis (1 a 6) são fixos para manter os relatórios consistentes. Você pode ajustar os nomes.";
    head.innerHTML = "<tr><th>Grau</th><th>Nome</th><th>Subcategorias diretas</th><th>Ações</th></tr>";
    body.innerHTML = finance.degrees.slice().sort((a, b) => a.number - b.number).map((item) => `<tr><td>${item.number}</td><td>${escapeHtml(item.name)}</td><td>${finance.subcategories.filter((child) => child.parentType === "degree" && child.parentId === item.id).length}</td><td class="actions-cell"><button class="text-button" data-action="edit-catalog" data-type="degrees" data-id="${escapeHtml(item.id)}">Editar nome</button></td></tr>`).join("");
  } else if (registrationType === "subcategories") {
    $("#registration-hint").textContent = "As subcategorias podem conter outras subcategorias sem limite fixo de profundidade.";
    head.innerHTML = "<tr><th>Código</th><th>Subcategoria</th><th>Superior</th><th>Subcategorias filhas</th><th>Contas</th><th>Ações</th></tr>";
    body.innerHTML = finance.subcategories.slice().sort((a, b) => subcategoryCode(a.id).localeCompare(subcategoryCode(b.id), "pt-BR", { numeric: true })).map((item) => `<tr><td>${escapeHtml(subcategoryCode(item.id))}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(parentLabel(item))}</td><td>${finance.subcategories.filter((child) => child.parentType === "subcategory" && child.parentId === item.id).length}</td><td>${finance.planAccounts.filter((account) => account.subcategoryId === item.id).length}</td><td class="actions-cell"><button class="text-button" data-action="edit-catalog" data-type="subcategories" data-id="${escapeHtml(item.id)}">Editar</button><button class="text-button delete" data-action="delete-catalog" data-type="subcategories" data-id="${escapeHtml(item.id)}">Excluir</button></td></tr>`).join("");
  } else if (registrationType === "accounts") {
    $("#registration-hint").textContent = "Contas analíticas são os destinos dos lançamentos contábeis. Caixa e banco são identificados separadamente no Ativo.";
    head.innerHTML = "<tr><th>Código</th><th>Conta</th><th>Subcategoria superior</th><th>Natureza normal</th><th>Caixa / banco</th><th>Prazo patrimonial</th><th>Movimentos</th><th>Ações</th></tr>";
    body.innerHTML = finance.planAccounts.slice().sort((a, b) => accountCode(a.id).localeCompare(accountCode(b.id), "pt-BR", { numeric: true })).map((item) => `<tr><td>${escapeHtml(accountCode(item.id))}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(subcategoryPath(finance.subcategories.find((child) => child.id === item.subcategoryId) || { name: "Subcategoria removida", parentType: "degree", parentId: "" }))}</td><td>${item.normalBalance === "debit" ? "Devedora" : "Credora"}</td><td>${item.cashEquivalent ? "Sim" : "Não"}</td><td>${escapeHtml(liquidityClassLabel(item))}</td><td>${postableReferences(item.id)}</td><td class="actions-cell"><button class="text-button" data-action="edit-catalog" data-type="accounts" data-id="${escapeHtml(item.id)}">Editar</button><button class="text-button delete" data-action="delete-catalog" data-type="accounts" data-id="${escapeHtml(item.id)}">Excluir</button></td></tr>`).join("");
  } else if (registrationType === "parties") {
    $("#registration-hint").textContent = "Um mesmo cadastro pode ser cliente, fornecedor ou ambos. CPF/CNPJ aparece mascarado nesta lista.";
    head.innerHTML = "<tr><th>Nome / razão social</th><th>Papel</th><th>CPF/CNPJ</th><th>Situação</th><th>Ações</th></tr>";
    loadParties();
    return;
  } else if (registrationType === "cost-centers") {
    $("#registration-hint").textContent = "Centros de custo são dimensões gerenciais opcionais; não alteram débitos e créditos. Inative um centro já usado para preservar seu histórico.";
    head.innerHTML = "<tr><th>Código</th><th>Centro de custo</th><th>Superior</th><th>Situação</th><th>Ações</th></tr>";
    body.innerHTML = finance.costCenters.slice().sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true })).map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}</td><td>${escapeHtml(finance.costCenters.find((candidate) => candidate.id === item.parentId)?.name || "—")}</td><td><span class="status ${item.active ? "status-open" : "status-cancelled"}">${item.active ? "Ativo" : "Inativo"}</span></td><td class="actions-cell"><button class="text-button" data-action="edit-center" data-id="${escapeHtml(item.id)}">Editar</button><button class="text-button delete" data-action="delete-center" data-id="${escapeHtml(item.id)}">Excluir</button></td></tr>`).join("");
    $("#cost-report-from").value ||= finance.defaultPeriod;
    $("#cost-report-to").value ||= finance.defaultPeriod;
    renderCostCenterReport().catch((error) => showToast(error.message, true));
  }
  if (!body.innerHTML) body.innerHTML = `<tr><td class="empty-table" colspan="8">Nenhum cadastro disponível.</td></tr>`;
}

function renderPartyList(items) {
  const body = $("#registration-body");
  if (!items.length) {
    body.innerHTML = '<tr><td class="empty-table" colspan="5">Nenhum cadastro encontrado. Ajuste os filtros ou crie uma nova pessoa/empresa.</td></tr>';
    $("#party-list-status").textContent = "Nenhum cadastro encontrado.";
    return;
  }
  const roleNames = { customer: "Cliente", supplier: "Fornecedor" };
  body.innerHTML = items.map((party) => {
    const name = escapeHtml(party.name);
    const roles = party.roles.map((role) => `<span class="party-role-tag">${escapeHtml(roleNames[role] || role)}</span>`).join("");
    const toggleLabel = party.active ? "Desativar" : "Reativar";
    const accessibleName = escapeHtml(party.name);
    return `<tr>
      <td class="party-name-cell"><strong>${name}</strong>${party.tradeName ? `<small>${escapeHtml(party.tradeName)}</small>` : ""}</td>
      <td><div class="party-role-tags">${roles}</div></td>
      <td>${party.taxIdMasked ? escapeHtml(party.taxIdMasked) : "—"}</td>
      <td><span class="status ${party.active ? "status-open" : "status-cancelled"}">${party.active ? "Ativo" : "Inativo"}</span></td>
      <td><div class="party-actions"><button class="text-button" type="button" data-action="edit-party" data-id="${escapeHtml(party.id)}" aria-label="Editar cadastro de ${accessibleName}">Editar</button><button class="text-button" type="button" data-action="toggle-party" data-id="${escapeHtml(party.id)}" data-active="${party.active}" aria-label="${toggleLabel} cadastro de ${accessibleName}">${toggleLabel}</button></div></td>
    </tr>`;
  }).join("");
  $("#party-list-status").textContent = `${items.length} ${items.length === 1 ? "cadastro encontrado" : "cadastros encontrados"}.`;
}

async function loadParties() {
  if (registrationType !== "parties") return;
  const token = ++partyListRequestToken;
  const params = new URLSearchParams({
    q: $("#party-search").value.trim(),
    role: $("#party-role-filter").value,
    status: $("#party-status-filter").value,
  });
  $("#party-list-status").textContent = "Carregando cadastros…";
  $("#registration-body").innerHTML = '<tr><td class="empty-table" colspan="5">Carregando…</td></tr>';
  try {
    const { contrapartes } = await request(`/api/contrapartes?${params.toString()}`);
    if (token !== partyListRequestToken || registrationType !== "parties") return false;
    partyList = contrapartes;
    renderPartyList(partyList);
    return true;
  } catch (error) {
    if (token !== partyListRequestToken || registrationType !== "parties") return false;
    $("#party-list-status").textContent = "Não foi possível carregar os cadastros.";
    $("#registration-body").innerHTML = `<tr><td class="empty-table" colspan="5">${escapeHtml(error.message)} <button class="text-button" data-action="retry-parties" type="button">Tentar novamente</button></td></tr>`;
    return false;
  }
}

function updatePartyTaxIdLabel() {
  const isOrganization = $("#party-person-type").value === "organization";
  $("#party-tax-id-label").childNodes[0].textContent = isOrganization ? "CNPJ" : "CPF";
}

function setRegistrationType(type) {
  registrationType = type;
  $$(".registration-tab").forEach((button) => {
    const active = button.dataset.register === type;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  renderCatalog();
  if (activeScreen === "registrations") updatePrimaryAction();
}

function nextChildNumber(type, parentType, parentId) {
  const items = type === "subcategories"
    ? finance.subcategories.filter((item) => item.parentType === parentType && item.parentId === parentId)
    : finance.planAccounts.filter((item) => item.subcategoryId === parentId);
  return items.reduce((max, item) => Math.max(max, item.number), 0) + 1;
}

function openCatalogDialog(type = registrationType, record = null) {
  if (type === "cost-centers") { openCostCenterDialog(record); return; }
  editingCatalog = record ? { type, id: record.id } : { type, id: null };
  const fields = $("#catalog-fields");
  fields.replaceChildren();
  $("#catalog-title").textContent = record ? "Editar cadastro" : ({ degrees: "Novo grau", subcategories: "Nova subcategoria", accounts: "Nova conta" })[type];
  sendFormError($("#catalog-error"), "");
  if (type === "degrees") {
    fields.innerHTML = `<label>Número do grau<input id="catalog-number" type="number" min="1" max="6" step="1" required readonly></label><label>Nome do grau<input id="catalog-name" maxlength="80" required></label>`;
    $("#catalog-number").value = record?.number ?? (finance.degrees.reduce((max, item) => Math.max(max, item.number), 0) + 1);
    $("#catalog-name").value = record?.name || "";
  } else if (type === "subcategories") {
    const options = [
      ...finance.degrees.slice().sort((a, b) => a.number - b.number).map((item) => ({ value: `degree:${item.id}`, label: `${item.number} — ${item.name}` })),
      ...finance.subcategories.slice().sort((a, b) => subcategoryCode(a.id).localeCompare(subcategoryCode(b.id), "pt-BR", { numeric: true })).map((item) => ({ value: `subcategory:${item.id}`, label: `${subcategoryCode(item.id)} — ${item.name}` })),
    ];
    fields.innerHTML = `<label>Grau ou subcategoria superior<select id="catalog-parent" required>${options.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")}</select></label><label>Código sugerido<input id="catalog-code-preview" readonly></label><label>Número neste nível<input id="catalog-number" type="number" min="1" step="1" required></label><label>Nome da subcategoria<input id="catalog-name" maxlength="80" required></label>`;
    let parentValue = record ? `${record.parentType}:${record.parentId}` : options[0]?.value || "";
    $("#catalog-parent").value = parentValue;
    $("#catalog-number").value = record?.number ?? 1;
    $("#catalog-name").value = record?.name || "";
    const update = (suggest) => {
      const [parentType, parentId] = $("#catalog-parent").value.split(":");
      if (suggest) $("#catalog-number").value = nextChildNumber("subcategories", parentType, parentId);
      const parentCode = parentType === "degree" ? String(finance.degrees.find((item) => item.id === parentId)?.number || "") : subcategoryCode(parentId);
      $("#catalog-code-preview").value = `${parentCode}.${$("#catalog-number").value || "…"}`;
    };
    $("#catalog-parent").addEventListener("change", () => update(true));
    $("#catalog-number").addEventListener("input", () => update(false));
    update(false);
  } else {
    const options = finance.subcategories.slice().sort((a, b) => subcategoryCode(a.id).localeCompare(subcategoryCode(b.id), "pt-BR", { numeric: true }));
    fields.innerHTML = `<label>Subcategoria superior<select id="catalog-parent" required>${options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(subcategoryCode(item.id))} — ${escapeHtml(item.name)}</option>`).join("")}</select></label><label>Código sugerido<input id="catalog-code-preview" readonly></label><label>Número da conta<input id="catalog-number" type="number" min="1" step="1" required></label><label>Nome da conta<input id="catalog-name" maxlength="80" required></label><div class="form-grid"><label>Natureza normal<select id="catalog-normal"><option value="debit">Devedora</option><option value="credit">Credora</option></select></label><label class="check-label"><input id="catalog-cash" type="checkbox"> Caixa ou banco</label></div><label>Classificação de prazo<select id="catalog-liquidity-class"><option value="">Automática pela hierarquia / sem prazo definido</option></select></label><p class="field-hint">Classifique prazos apenas quando conhecidos. A hierarquia identifica automaticamente o Ativo Circulante (1.1) e as Obrigações de Curto Prazo (2.1).</p>`;
    $("#catalog-parent").value = record?.subcategoryId || options[0]?.id || "";
    $("#catalog-number").value = record?.number ?? nextChildNumber("accounts", null, $("#catalog-parent").value);
    $("#catalog-name").value = record?.name || "";
    $("#catalog-normal").value = record?.normalBalance || ([1, 5, 6].includes(degreeForSubcategory($("#catalog-parent").value)?.number) ? "debit" : "credit");
    $("#catalog-cash").checked = record?.cashEquivalent === true;
    const liquidityOptions = (group) => group === 1
      ? [["current-asset", "Ativo circulante"], ["long-term-receivable", "Realizável a longo prazo"], ["other-noncurrent-asset", "Outro ativo não circulante"]]
      : group === 2 ? [["current-liability", "Passivo circulante"], ["long-term-liability", "Passivo não circulante"]] : [];
    const updateLiquidityOptions = () => {
      const group = degreeForSubcategory($("#catalog-parent").value)?.number;
      const select = $("#catalog-liquidity-class");
      const current = select.value || record?.liquidityClass || "";
      select.innerHTML = `<option value="">Automática pela hierarquia / sem prazo definido</option>${liquidityOptions(group).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}`;
      select.disabled = ![1, 2].includes(group);
      select.value = liquidityOptions(group).some(([value]) => value === current) ? current : "";
    };
    updateLiquidityOptions();
    const update = (suggest) => {
      const parentId = $("#catalog-parent").value;
      if (suggest) $("#catalog-number").value = nextChildNumber("accounts", null, parentId);
      $("#catalog-code-preview").value = `${subcategoryCode(parentId)}.${$("#catalog-number").value || "…"}`;
      const group = degreeForSubcategory(parentId)?.number;
      if (!record) $("#catalog-normal").value = [1, 5, 6].includes(group) ? "debit" : "credit";
      if (group !== 1) $("#catalog-cash").checked = false;
      $("#catalog-cash").disabled = group !== 1;
      updateLiquidityOptions();
    };
    $("#catalog-parent").addEventListener("change", () => update(true));
    $("#catalog-number").addEventListener("input", () => update(false));
    update(false);
  }
  $("#catalog-dialog").showModal();
  $("#catalog-fields input:not([readonly]), #catalog-fields select")?.focus();
}

async function submitCatalog(event) {
  event.preventDefault();
  if (!editingCatalog) return;
  const { type, id } = editingCatalog;
  const base = ({ degrees: "/api/graus", subcategories: "/api/subcategorias", accounts: "/api/contas" })[type];
  const body = type === "degrees"
    ? { number: Number($("#catalog-number").value), name: $("#catalog-name").value.trim() }
    : type === "subcategories"
      ? { number: Number($("#catalog-number").value), name: $("#catalog-name").value.trim(), parentType: $("#catalog-parent").value.split(":")[0], parentId: $("#catalog-parent").value.split(":")[1] }
      : { number: Number($("#catalog-number").value), name: $("#catalog-name").value.trim(), subcategoryId: $("#catalog-parent").value, normalBalance: $("#catalog-normal").value, cashEquivalent: $("#catalog-cash").checked, liquidityClass: $("#catalog-liquidity-class").value || null };
  try {
    await apiCall(id ? "PUT" : "POST", id ? `${base}/${id}` : base, body);
    $("#catalog-dialog").close();
    await refreshFinance();
    showToast(id ? "Cadastro atualizado." : "Cadastro criado.");
  } catch (error) { sendFormError($("#catalog-error"), error.message); }
}

function openCostCenterDialog(center = null) {
  editingCostCenterId = center?.id || null;
  $("#cost-center-title").textContent = center ? "Editar centro de custo" : "Novo centro de custo";
  $("#center-code").value = center?.code || "";
  $("#center-name").value = center?.name || "";
  $("#center-description").value = center?.description || "";
  $("#center-active").checked = center?.active ?? true;
  const parents = finance.costCenters.filter((item) => item.id !== center?.id);
  $("#center-parent").innerHTML = `<option value="">Sem superior</option>${parents.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`).join("")}`;
  $("#center-parent").value = center?.parentId || "";
  sendFormError($("#center-error"), "");
  $("#cost-center-dialog").showModal();
}

async function submitCostCenter(event) {
  event.preventDefault();
  const body = { code: $("#center-code").value.trim(), name: $("#center-name").value.trim(), description: $("#center-description").value.trim(), active: $("#center-active").checked, parentId: $("#center-parent").value || null };
  const base = "/api/centros-de-custo";
  try {
    await apiCall(editingCostCenterId ? "PUT" : "POST", editingCostCenterId ? `${base}/${editingCostCenterId}` : base, body);
    $("#cost-center-dialog").close();
    await refreshFinance();
    showToast(editingCostCenterId ? "Centro de custo atualizado." : "Centro de custo criado.");
  } catch (error) { sendFormError($("#center-error"), error.message); }
}

function setPartyDialogLoading(loading, message = "") {
  $("#party-fields").disabled = loading;
  $("#party-save").disabled = loading;
  $("#party-dialog-status").hidden = !loading && !message;
  $("#party-dialog-status").textContent = message || (loading ? "Carregando cadastro…" : "");
}

function fillPartyDialog(party) {
  $("#party-person-type").value = party.personType;
  $("#party-name").value = party.name || "";
  $("#party-trade-name").value = party.tradeName || "";
  $("#party-tax-id").value = party.taxId || "";
  $("#party-role-customer").checked = party.roles.includes("customer");
  $("#party-role-supplier").checked = party.roles.includes("supplier");
  $("#party-email").value = party.email || "";
  $("#party-phone").value = party.phone || "";
  $("#party-notes").value = party.notes || "";
  updatePartyTaxIdLabel();
}

async function openPartyDialog(partyId = null, options = {}) {
  const loadToken = ++partyDialogLoadToken;
  partyDialogContext = !partyId && options.documentKind ? { documentKind: options.documentKind } : null;
  editingPartyId = partyId;
  partyCreateIdempotencyKey = partyId ? null : uuid();
  $("#party-form").reset();
  $("#party-extra-fields").open = false;
  $("#party-dialog-title").textContent = partyId ? "Editar pessoa/empresa" : "Nova pessoa/empresa";
  sendFormError($("#party-error"), "");
  setPartyDialogLoading(Boolean(partyId));
  updatePartyTaxIdLabel();
  $("#party-dialog").showModal();

  if (!partyId) {
    if (partyDialogContext) {
      const requiredRole = partyDialogContext.documentKind === "payable" ? "supplier" : "customer";
      $(`#party-role-${requiredRole}`).checked = true;
      setPartyDialogLoading(false, `Marque ${requiredRole === "supplier" ? "Fornecedor" : "Cliente"} para vincular este cadastro ao documento.`);
    }
    $("#party-name").focus();
    return;
  }
  try {
    const { contraparte } = await request(`/api/contrapartes/${encodeURIComponent(partyId)}`);
    if (loadToken !== partyDialogLoadToken || !$("#party-dialog").open) return;
    fillPartyDialog(contraparte);
    setPartyDialogLoading(false);
    $("#party-name").focus();
  } catch (error) {
    if (loadToken !== partyDialogLoadToken || !$("#party-dialog").open) return;
    $("#party-dialog").close();
    showToast(error.message, true);
  }
}

async function submitPartyForm(event) {
  event.preventDefault();
  sendFormError($("#party-error"), "");
  const roles = [
    $("#party-role-customer").checked ? "customer" : null,
    $("#party-role-supplier").checked ? "supplier" : null,
  ].filter(Boolean);
  if (!roles.length) {
    sendFormError($("#party-error"), "Selecione Cliente, Fornecedor ou ambos.");
    $("#party-role-customer").focus();
    return;
  }
  const body = {
    personType: $("#party-person-type").value,
    name: $("#party-name").value.trim(),
    tradeName: $("#party-trade-name").value.trim(),
    taxId: $("#party-tax-id").value.trim(),
    roles,
    email: $("#party-email").value.trim(),
    phone: $("#party-phone").value.trim(),
    notes: $("#party-notes").value.trim(),
  };
  const editing = Boolean(editingPartyId);
  const returnContext = partyDialogContext;
  let createdParty = null;
  const saveButton = $("#party-save");
  saveButton.disabled = true;
  saveButton.textContent = "Salvando…";
  try {
    if (editing) {
      await apiCall("PUT", `/api/contrapartes/${encodeURIComponent(editingPartyId)}`, body);
    } else {
      partyCreateIdempotencyKey ||= uuid();
      createdParty = (await apiCall("POST", "/api/contrapartes", { ...body, idempotencyKey: partyCreateIdempotencyKey })).resultado;
    }
    $("#party-dialog").close();
    let refreshed;
    if (returnContext) {
      try {
        await refreshFinance();
        refreshed = true;
      } catch (error) {
        refreshed = false;
        showToast(`Cadastro salvo, mas os dados financeiros não puderam ser atualizados: ${error.message}`, true);
      }
      if (createdParty && refreshed) {
        const requiredRole = returnContext.documentKind === "payable" ? "supplier" : "customer";
        if (createdParty.active && createdParty.roles.includes(requiredRole)) {
          activeDocumentKind = returnContext.documentKind;
          selectDocumentParty(createdParty);
          $("#document-party").focus();
        } else {
          const partyInput = $("#document-party");
          partyInput.value = createdParty.name.length <= 120 ? createdParty.name : "";
          selectedDocumentPartyId = null;
          selectedDocumentPartyText = "";
          setDocumentPartyStatus(`Cadastro salvo. Inclua o papel ${requiredRole === "supplier" ? "Fornecedor" : "Cliente"} para vinculá-lo ao documento.`);
          partyInput.focus();
        }
      }
      if (refreshed) showToast("Cadastro criado.");
    } else {
      refreshed = await loadParties();
      if (refreshed) showToast(editing ? "Cadastro atualizado." : "Cadastro criado.");
      else showToast("Cadastro salvo, mas a lista não pôde ser atualizada.", true);
    }
  } catch (error) {
    sendFormError($("#party-error"), error.message);
    $("#party-error").focus();
  } finally {
    if ($("#party-dialog").open) {
      saveButton.disabled = false;
      saveButton.textContent = "Salvar cadastro";
    }
  }
}

async function togglePartyActive(id, currentlyActive) {
  const party = partyList.find((item) => item.id === id);
  if (!party) return;
  const action = currentlyActive ? "desativar" : "reativar";
  const question = currentlyActive
    ? `Desativar ${party.name}? O cadastro continuará disponível para consulta do histórico.`
    : `Reativar ${party.name}? O cadastro voltará a aparecer nas seleções.`;
  if (!window.confirm(question)) return;
  try {
    await apiCall("POST", `/api/contrapartes/${encodeURIComponent(id)}/${currentlyActive ? "desativar" : "ativar"}`, {});
    const refreshed = await loadParties();
    if (refreshed) showToast(currentlyActive ? "Cadastro desativado." : "Cadastro reativado.");
    else showToast("Situação salva, mas a lista não pôde ser atualizada.", true);
  } catch (error) { showToast(error.message, true); }
}

function reportNumber(value, digits = 1) {
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function reportPercent(value) {
  return value == null || !Number.isFinite(value) ? "Não calculável" : reportNumber(value, 1) + "%";
}

function setReportState(id, message, error = false) {
  const element = $("#" + id);
  element.textContent = message;
  element.classList.toggle("is-error", error);
  element.hidden = false;
}

function dashboardRangeForPreset(preset) {
  const today = todayCuiaba();
  const currentPeriod = today.slice(0, 7);
  if (preset === "previous-month") {
    const previous = shiftMonth(currentPeriod, -1);
    return { fromDate: previous + "-01", toDate: previous + "-" + String(daysInMonth(previous)).padStart(2, "0") };
  }
  if (preset === "last-30-days") return { fromDate: shiftDate(today, -29), toDate: today };
  return { fromDate: currentPeriod + "-01", toDate: today };
}

function shiftDate(date, amount) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function setDashboardPreset(preset) {
  const custom = preset === "custom";
  $("#dashboard-from").disabled = !custom;
  $("#dashboard-to").disabled = !custom;
  if (custom) return;
  const range = dashboardRangeForPreset(preset);
  $("#dashboard-from").value = range.fromDate;
  $("#dashboard-to").value = range.toDate;
  renderDashboard().catch((error) => setReportState("dashboard-state", error.message, true));
}

function renderBarList(target, rows, labelKey, valueKey, formatter = formatMoney) {
  if (!rows.length) {
    target.innerHTML = '<p class="empty-state">Sem dados para o período selecionado.</p>';
    return;
  }
  const maximum = Math.max(1, ...rows.map((item) => Math.abs(Number(item[valueKey]) || 0)));
  target.innerHTML = rows.map((item) => {
    const value = Number(item[valueKey]) || 0;
    const width = Math.max(0, Math.min(100, Math.abs(value) / maximum * 100));
    return '<div class="bar-row"><div class="bar-row-label"><span>' + escapeHtml(item[labelKey] || "Sem classificação") + '</span><strong>' + escapeHtml(formatter(value)) + '</strong></div><div class="bar-track"><i style="width:' + width.toFixed(1) + '%" class="' + (value < 0 ? "bar-negative" : "") + '"></i></div></div>';
  }).join("");
}

function drawReportLineChart(svg, points, definitions, options = {}) {
  const width = 920;
  const height = 240;
  const left = 62;
  const right = 14;
  const top = 14;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const values = [];
  for (const definition of definitions) for (const point of definition.points) if (Number.isFinite(point.value)) values.push(point.value);
  if (!values.length) {
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.innerHTML = '<text x="20" y="42" class="chart-empty">Sem movimentos para o período selecionado.</text>';
    return;
  }
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) { min -= 100; max += 100; }
  const y = (value) => top + (max - value) / (max - min) * chartHeight;
  const x = (index) => left + (points.length < 2 ? chartWidth / 2 : index / (points.length - 1) * chartWidth);
  const moneyAxis = (value) => {
    const abs = Math.abs(value / 100);
    if (abs >= 1000000) return (value < 0 ? "−" : "") + (abs / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
    if (abs >= 1000) return (value < 0 ? "−" : "") + (abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " mil";
    return (value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  };
  let content = '';
  for (let i = 0; i <= 4; i++) {
    const value = max - (max - min) * i / 4;
    const yValue = y(value);
    content += '<line x1="' + left + '" y1="' + yValue.toFixed(1) + '" x2="' + (width - right) + '" y2="' + yValue.toFixed(1) + '" class="chart-gridline" />';
    content += '<text x="' + (left - 8) + '" y="' + (yValue + 4).toFixed(1) + '" text-anchor="end" class="chart-axis-label">' + escapeHtml(moneyAxis(value)) + '</text>';
  }
  const zeroY = y(0);
  content += '<line x1="' + left + '" y1="' + zeroY.toFixed(1) + '" x2="' + (width - right) + '" y2="' + zeroY.toFixed(1) + '" class="chart-zero" />';
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  for (const index of labelIndexes) {
    const point = points[index];
    if (!point) continue;
    const label = options.months ? point.period.slice(5) + "/" + point.period.slice(2, 4) : point.date.slice(8, 10) + "/" + point.date.slice(5, 7);
    content += '<text x="' + x(index).toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle" class="chart-axis-label">' + escapeHtml(label) + '</text>';
  }
  for (const definition of definitions) {
    const segments = [];
    let current = [];
    definition.points.forEach((point, index) => {
      if (!Number.isFinite(point.value)) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      current.push([x(index), y(point.value), point]);
    });
    if (current.length) segments.push(current);
    for (const segment of segments) {
      const path = segment.map((item, index) => (index ? "L" : "M") + item[0].toFixed(1) + " " + item[1].toFixed(1)).join(" ");
      content += '<path d="' + path + '" class="' + definition.className + ' chart-line" />';
      for (const item of segment) {
        const dateKey = options.months ? item[2].period : item[2].date;
        content += '<circle cx="' + item[0].toFixed(1) + '" cy="' + item[1].toFixed(1) + '" r="3.3" class="' + definition.className + ' chart-dot" tabindex="0" role="button" data-chart-date="' + escapeHtml(dateKey) + '" aria-label="' + escapeHtml(dateKey + ": " + formatMoney(item[2].value)) + '"><title>' + escapeHtml(dateKey + " · " + formatMoney(item[2].value)) + '</title></circle>';
      }
    }
  }
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.innerHTML = content;
}

function renderDashboardChart(report) {
  const svg = $("#dashboard-cash-chart");
  const points = report.cash.chart;
  const draw = () => {
    const box = svg.getBoundingClientRect();
    const width = Math.max(300, Math.round(box.width || 920));
    const height = Math.max(230, Math.round(box.height || 286));
    const compact = width < 520;
    const left = compact ? 62 : 78;
    const right = 16;
    const top = 25;
    const bottom = 37;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const x = (index) => left + (points.length < 2 ? plotWidth / 2 : index / (points.length - 1) * plotWidth);
    const projectionStart = points.findIndex((point) => point.projectedCents != null);
    const cutoffIndex = projectionStart > 0 ? projectionStart - 1 : 0;
    const cutoffX = x(cutoffIndex);
    const actual = points.map((point) => point.actualCents);
    const projected = points.map((point) => point.projectedCents);
    const scenario = points.map((point) => point.scenarioCents);
    if (projectionStart > 0 && Number.isFinite(actual[cutoffIndex])) {
      projected[cutoffIndex] = actual[cutoffIndex];
      scenario[cutoffIndex] = actual[cutoffIndex];
    }
    const values = actual.concat(projected, scenario).filter(Number.isFinite);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", "Saldo diário de caixa realizado e projetado. Selecione uma data para consultar os movimentos.");

    if (!points.length || !values.length) {
      svg.innerHTML = '<title>Saldo diário de caixa</title><text x="' + (width / 2) + '" y="' + (height / 2) + '" text-anchor="middle" class="chart-empty">Sem saldo para o período selecionado.</text>';
      return;
    }

    let minValue = Math.min(...values);
    let maxValue = Math.max(...values);
    const spread = maxValue - minValue;
    const padding = spread > 0 ? spread * 0.12 : Math.max(Math.abs(maxValue) * 0.08, 10000);
    minValue -= padding;
    maxValue += padding;
    const rawStep = (maxValue - minValue) / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStep))));
    const normalizedStep = rawStep / magnitude;
    const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
    const axisMin = Math.floor(minValue / step) * step;
    const axisMax = Math.ceil(maxValue / step) * step;
    const y = (value) => top + (axisMax - value) / (axisMax - axisMin || 1) * plotHeight;
    const axisMoney = (value) => {
      const amount = value / 100;
      const abs = Math.abs(amount);
      if (abs >= 1000000) return (amount < 0 ? "−" : "") + "R$ " + (abs / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
      if (abs >= 10000) return (amount < 0 ? "−" : "") + "R$ " + (abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " mil";
      return (amount < 0 ? "−" : "") + "R$ " + abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    };
    const pathFor = (series, startIndex = 0) => {
      const path = [];
      for (let index = startIndex; index < series.length; index++) {
        const value = series[index];
        if (!Number.isFinite(value)) continue;
        path.push((path.length ? "L" : "M") + x(index).toFixed(1) + " " + y(value).toFixed(1));
      }
      return path.join(" ");
    };
    const tickIndexes = new Set();
    const tickCount = Math.max(4, Math.min(compact ? 5 : 9, Math.floor(plotWidth / (compact ? 68 : 82))));
    for (let tick = 0; tick < tickCount; tick++) tickIndexes.add(Math.round(tick / Math.max(1, tickCount - 1) * (points.length - 1)));
    tickIndexes.add(cutoffIndex);
    const sortedTicks = [...tickIndexes].sort((a, b) => a - b);
    const pointDate = (index) => points[index]?.date || "";
    const dateLabel = (date) => date ? date.slice(8, 10) + "/" + date.slice(5, 7) : "";
    let content = '<title>Saldo diário de caixa realizado e projetado</title><desc>Saldo realizado até ' + escapeHtml(datePt(report.cutoffDate)) + ', projeção com títulos reconhecidos e cenário adicional com estimativas. Cada faixa diária consulta os movimentos da data.</desc>';

    if (projectionStart > 0) {
      content += '<rect x="' + left + '" y="' + top + '" width="' + Math.max(0, cutoffX - left) + '" height="' + plotHeight + '" class="cash-chart-history" />';
      content += '<rect x="' + cutoffX + '" y="' + top + '" width="' + Math.max(0, width - right - cutoffX) + '" height="' + plotHeight + '" class="cash-chart-forecast" />';
    }

    for (let value = axisMin; value <= axisMax + step * 0.01; value += step) {
      const yValue = y(value);
      const isZero = Math.abs(value) < step * 0.01;
      content += '<line x1="' + left + '" y1="' + yValue.toFixed(1) + '" x2="' + (width - right) + '" y2="' + yValue.toFixed(1) + '" class="' + (isZero ? "cash-chart-zero" : "cash-chart-grid") + '" />';
      content += '<text x="' + (left - 9) + '" y="' + (yValue + 4).toFixed(1) + '" text-anchor="end" class="cash-chart-y-label">' + escapeHtml(axisMoney(value)) + '</text>';
    }
    for (const index of sortedTicks) {
      const tickX = x(index);
      content += '<line x1="' + tickX.toFixed(1) + '" y1="' + top + '" x2="' + tickX.toFixed(1) + '" y2="' + (top + plotHeight) + '" class="cash-chart-x-grid" />';
      content += '<text x="' + tickX.toFixed(1) + '" y="' + (height - 10) + '" text-anchor="middle" class="cash-chart-x-label">' + escapeHtml(dateLabel(pointDate(index))) + '</text>';
    }

    if (projectionStart > 0) {
      const anchor = cutoffIndex;
      const anchorTextX = Math.min(width - right - 48, Math.max(left + 8, cutoffX + (cutoffX < width * 0.65 ? 7 : -51)));
      content += '<line x1="' + cutoffX.toFixed(1) + '" y1="' + (top - 3) + '" x2="' + cutoffX.toFixed(1) + '" y2="' + (top + plotHeight) + '" class="cash-chart-cutoff" />';
      content += '<text x="' + anchorTextX.toFixed(1) + '" y="12" class="cash-chart-cutoff-label">CORTE · ' + escapeHtml(dateLabel(pointDate(anchor))) + '</text>';
    }

    if (projectionStart >= 0) {
      const bandPoints = [];
      for (let index = Math.max(0, projectionStart - 1); index < points.length; index++) {
        if (Number.isFinite(projected[index]) && Number.isFinite(scenario[index])) bandPoints.push({ index, base: projected[index], scenario: scenario[index] });
      }
      if (bandPoints.length > 1 && bandPoints.some((item) => item.base !== item.scenario)) {
        const topEdge = bandPoints.map((item) => x(item.index).toFixed(1) + " " + y(item.base).toFixed(1));
        const bottomEdge = bandPoints.slice().reverse().map((item) => x(item.index).toFixed(1) + " " + y(item.scenario).toFixed(1));
        content += '<path d="M' + topEdge.join(" L") + " L" + bottomEdge.join(" L") + ' Z" class="cash-chart-estimate-band" />';
      }
    }

    const actualPath = pathFor(actual);
    const projectedPath = pathFor(projected, Math.max(0, projectionStart - 1));
    const scenarioSegments = [];
    let scenarioSegment = [];
    const flushScenarioSegment = () => {
      if (scenarioSegment.length > 1) scenarioSegments.push(scenarioSegment.map((item, index) => (index ? "L" : "M") + item[0].toFixed(1) + " " + item[1].toFixed(1)).join(" "));
      scenarioSegment = [];
    };
    for (let index = Math.max(0, projectionStart - 1); index < points.length; index++) {
      const differs = Number.isFinite(scenario[index]) && Number.isFinite(projected[index]) && scenario[index] !== projected[index];
      if (!differs) {
        flushScenarioSegment();
        continue;
      }
      if (!scenarioSegment.length && index > 0 && Number.isFinite(scenario[index - 1])) scenarioSegment.push([x(index - 1), y(scenario[index - 1])]);
      scenarioSegment.push([x(index), y(scenario[index])]);
    }
    flushScenarioSegment();
    const scenarioPath = scenarioSegments.join(" ");
    if (actualPath) content += '<path d="' + actualPath + '" class="cash-chart-line cash-chart-line-actual" />';
    if (projectedPath) content += '<path d="' + projectedPath + '" class="cash-chart-line cash-chart-line-projected" />';
    if (scenarioPath) content += '<path d="' + scenarioPath + '" class="cash-chart-line cash-chart-line-scenario" />';

    for (let index = 0; index < points.length; index++) {
      const cellLeft = index === 0 ? left : (x(index - 1) + x(index)) / 2;
      const cellRight = index === points.length - 1 ? width - right : (x(index) + x(index + 1)) / 2;
      content += '<rect x="' + cellLeft.toFixed(1) + '" y="' + top + '" width="' + Math.max(1, cellRight - cellLeft).toFixed(1) + '" height="' + plotHeight + '" class="cash-chart-hit-area" data-chart-date="' + escapeHtml(points[index].date) + '" tabindex="-1" aria-label="Consultar movimentos de ' + escapeHtml(datePt(points[index].date)) + '"><title>' + escapeHtml(datePt(points[index].date) + " · consultar movimentos") + '</title></rect>';
    }

    const markerIndexes = new Set([0, points.length - 1, cutoffIndex]);
    for (let index = 6; index < points.length; index += 7) markerIndexes.add(index);
    const addMarker = (index, value, className, label) => {
      if (!Number.isFinite(value)) return;
      const date = points[index].date;
      content += '<circle cx="' + x(index).toFixed(1) + '" cy="' + y(value).toFixed(1) + '" r="3.1" class="cash-chart-marker ' + className + '" data-chart-date="' + escapeHtml(date) + '" tabindex="0" role="button" aria-label="' + escapeHtml(label + " em " + datePt(date) + ": " + formatMoney(value)) + '"><title>' + escapeHtml(label + " · " + datePt(date) + " · " + formatMoney(value)) + '</title></circle>';
    };
    for (const index of markerIndexes) {
      addMarker(index, actual[index], "cash-chart-marker-actual", "Saldo realizado");
      if (index >= projectionStart) {
        addMarker(index, projected[index], "cash-chart-marker-projected", "Saldo projetado");
        if (Number.isFinite(scenario[index]) && scenario[index] !== projected[index]) addMarker(index, scenario[index], "cash-chart-marker-scenario", "Saldo com estimativas");
      }
    }

    const addHighlight = (date, value, className, label) => {
      const index = points.findIndex((point) => point.date === date);
      if (index < 0 || !Number.isFinite(value)) return;
      content += '<circle cx="' + x(index).toFixed(1) + '" cy="' + y(value).toFixed(1) + '" r="6" class="cash-chart-highlight ' + className + '" data-chart-date="' + escapeHtml(date) + '" tabindex="0" role="button" aria-label="' + escapeHtml(label + " em " + datePt(date) + ": " + formatMoney(value)) + '"><title>' + escapeHtml(label + " · " + datePt(date) + " · " + formatMoney(value)) + '</title></circle>';
    };
    addHighlight(report.cash.minimumProjectedDate, report.cash.minimumProjectedCents, "cash-chart-minimum", "Menor saldo projetado");
    if (report.cash.firstNegativeDate) {
      const negativeIndex = points.findIndex((point) => point.date === report.cash.firstNegativeDate);
      if (negativeIndex >= 0) addHighlight(report.cash.firstNegativeDate, projected[negativeIndex], "cash-chart-negative", "Primeiro saldo projetado negativo");
    }
    svg.innerHTML = content;
  };

  svg._drawDashboardCashChart = draw;
  draw();
  if (!svg._dashboardCashChartKeyboardBound) {
    svg.addEventListener("keydown", (event) => {
      const point = event.target.closest?.("[data-chart-date]");
      if (point && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        showDashboardDayDetails(point.dataset.chartDate);
      }
    });
    svg._dashboardCashChartKeyboardBound = true;
  }
  if (!svg._dashboardCashChartObserver && typeof ResizeObserver === "function") {
    svg._dashboardCashChartObserver = new ResizeObserver(() => svg._drawDashboardCashChart?.());
    svg._dashboardCashChartObserver.observe(svg);
  }
}

function renderDashboardDayCash(day) {
  $("#dash-cash-day-label").textContent = "Dia considerado: " + datePt(day.date) + " · data de corte selecionada.";
  $("#dash-cash-day-in").textContent = formatMoney(day.realizedInflowsCents);
  $("#dash-cash-day-out").textContent = formatMoney(day.realizedOutflowsCents);
  $("#dash-cash-day-net").textContent = formatMoney(day.realizedNetCents);
  $("#dash-cash-day-projected-in").textContent = formatMoney(day.projectedReceiptsCents);
  $("#dash-cash-day-projected-out").textContent = formatMoney(day.projectedPaymentsCents);
  $("#dash-cash-day-projected-net").textContent = formatMoney(day.projectedReceiptsCents - day.projectedPaymentsCents);

  const actualRows = day.realizedEvents.map((item) => {
    const movementDirection = item.amountCents < 0 ? "saída" : "entrada";
    const direction = item.kind === "other" ? "Outro movimento · " + movementDirection : item.amountCents < 0 ? "Saída" : "Entrada";
    const titleType = item.kind === "payable-settlement" ? "payable" : item.kind === "receivable-collection" ? "receivable" : "";
    const titleLink = titleType && item.sourceId
      ? ' · <button class="text-button" data-open-title="' + titleType + '" data-id="' + escapeHtml(item.sourceId) + '">Título</button>'
      : "";
    return '<div class="compact-summary-row"><span>' + direction + ' · <button class="text-button" data-journal-entry="' + escapeHtml(item.entryId) + '">Diário ' + escapeHtml(item.entryNumber || "") + '</button>' + titleLink + ' · ' + escapeHtml(item.description || "Movimento contábil") + '</span><strong>' + escapeHtml(formatMoney(Math.abs(item.amountCents))) + '</strong></div>';
  });
  const forecastRows = day.forecastEvents.map((item) => {
    if (item.sourceType === "budget") {
      const direction = item.amountCents < 0 ? "Pagamento orçado" : "Recebimento orçado";
      return '<div class="compact-summary-row"><span>' + direction + ' · <button class="text-button" data-budget-open="' + escapeHtml(item.budgetId) + '">' + escapeHtml(item.title || item.description || "Orçamento") + '</button> · vencimento ' + escapeHtml(datePt(item.plannedDueDate || item.date)) + '</span><strong>' + escapeHtml(formatMoney(Math.abs(item.amountCents))) + '</strong></div>';
    }
    const kind = item.sourceType.indexOf("payable") >= 0 ? "payable" : "receivable";
    const recognition = item.sourceType.indexOf("draft") >= 0 ? "Não reconhecido" : "Reconhecido";
    const direction = kind === "payable" ? "Pagamento" : "Recebimento";
    return '<div class="compact-summary-row"><span>' + direction + ' previsto · <button class="text-button" data-open-title="' + kind + '" data-id="' + escapeHtml(item.sourceId) + '">' + escapeHtml(item.party || item.description || "Título") + '</button> · ' + recognition + '</span><strong>' + escapeHtml(formatMoney(Math.abs(item.amountCents))) + '</strong></div>';
  });
  const recurringRows = day.recurringEstimates.map((item) => '<div class="compact-summary-row"><span>Estimativa recorrente · ' + escapeHtml(item.description || "Receita prevista") + '</span><strong>' + escapeHtml(formatMoney(item.amountCents)) + '</strong></div>');
  const rows = actualRows.concat(forecastRows, recurringRows);
  $("#dash-cash-day-details").innerHTML = rows.length ? rows.join("") : '<p class="small-note">Nenhum lançamento ou previsão registrado para este dia.</p>';
  $("#dash-cash-day-estimates").textContent = "O movimento líquido inclui operações e outros movimentos de caixa; transferências internas têm efeito consolidado zero. Não reconhecidos: recebimentos " + formatMoney(day.unrecognizedExpectedReceiptsCents)
    + " · pagamentos " + formatMoney(day.unrecognizedExpectedPaymentsCents)
    + " · estimativas recorrentes " + formatMoney(day.recurringEstimateCents)
    + " · orçado: recebimentos " + formatMoney(day.budgetedReceiptsCents) + " e pagamentos " + formatMoney(day.budgetedPaymentsCents)
    + ". Não compõem o previsto reconhecido.";
}

function renderTitleRows(items, kind, targetId) {
  const target = $("#" + targetId);
  if (!items.length) {
    target.innerHTML = '<tr><td colspan="2" class="empty-table">Nenhum título em aberto.</td></tr>';
    return;
  }
  target.innerHTML = items.map((item) => '<tr><td><button class="report-row-link" data-open-title="' + kind + '" data-id="' + escapeHtml(item.id) + '"><strong>' + escapeHtml(datePt(item.dueDate)) + ' · ' + escapeHtml(item.party || "Sem identificação") + '</strong><small>' + escapeHtml(item.description) + ' · ' + escapeHtml(item.recognized ? "Reconhecido" : "Não reconhecido") + '</small></button></td><td class="number-cell">' + escapeHtml(formatMoney(item.outstandingCents)) + '</td></tr>').join("");
}

async function renderDashboard() {
  if (!finance) return;
  const fromDate = $("#dashboard-from").value;
  const toDate = $("#dashboard-to").value;
  const horizonDays = $("#dashboard-horizon").value || 30;
  setReportState("dashboard-state", "Atualizando visão consolidada…");
  const query = new URLSearchParams({ fromDate, toDate, horizonDays });
  const { relatorio: report } = await request("/api/relatorios/dashboard?" + query.toString());
  if (!report.available) {
    $("#dashboard-content").hidden = true;
    const details = report.integrity?.issues?.map((item) => item.message).join(" ") || "Os dados contábeis não passaram pela validação.";
    return setReportState("dashboard-state", "Indicadores indisponíveis. " + details, true);
  }
  $("#dashboard-content").hidden = false;
  $("#dashboard-state").hidden = true;
  $("#dashboard-period-label").textContent = datePt(report.fromDate) + " a " + datePt(report.toDate) + " · posição em " + datePt(report.cutoffDate);
  $("#dash-cash-available").textContent = formatMoney(report.cash.availableCents);
  $("#dash-cash-projected").textContent = formatMoney(report.cash.projectedClosingCents);
  $("#dash-realized-receipts").textContent = formatMoney(report.cash.realizedOperatingReceiptsCents);
  $("#dash-realized-payments").textContent = formatMoney(report.cash.realizedOperatingPaymentsCents);
  $("#dash-projected-receipts").textContent = formatMoney(report.cash.projectedReceiptsCents);
  $("#dash-projected-payments").textContent = formatMoney(report.cash.projectedPaymentsCents);
  $("#dash-minimum").textContent = formatMoney(report.cash.minimumProjectedCents) + " · " + datePt(report.cash.minimumProjectedDate);
  $("#dash-negative-date").textContent = report.cash.firstNegativeDate ? datePt(report.cash.firstNegativeDate) : "Nenhum no horizonte";
  $("#dash-draft-payments").textContent = formatMoney(report.cash.unrecognizedExpectedPaymentsCents);
  $("#dash-draft-receipts").textContent = formatMoney(report.cash.unrecognizedExpectedReceiptsCents);
  $("#dash-recurring-estimates").textContent = formatMoney(report.cash.recurringEstimateCents);
  $("#dash-budget-payments").textContent = formatMoney(report.cash.budgetedPaymentsCents);
  $("#dash-budget-receipts").textContent = formatMoney(report.cash.budgetedReceiptsCents);
  $("#dash-cash-accounts").innerHTML = report.cash.accounts.length ? report.cash.accounts.map((item) => '<tr><td><button class="report-row-link" data-open-account="' + escapeHtml(item.accountId) + '">' + escapeHtml(item.code + " · " + item.name) + '</button></td><td class="number-cell">' + escapeHtml(formatMoney(item.balanceCents)) + '</td></tr>').join("") : '<tr><td colspan="2" class="empty-table">Nenhuma conta de caixa ou banco cadastrada.</td></tr>';
  const otherRows = report.cash.otherMovements.slice(0, 5).map((item) => '<div class="chart-detail-row"><span><button class="text-button" data-journal-entry="' + escapeHtml(item.entryId) + '">Diário ' + escapeHtml(item.entryNumber || "") + '</button> ' + escapeHtml(item.description || "Outro movimento") + '</span><strong>' + escapeHtml(formatMoney(item.amountCents)) + '</strong></div>').join("");
  $("#dash-other-cash").innerHTML = '<div class="compact-summary-row"><span>Entradas não operacionais</span><strong>' + escapeHtml(formatMoney(report.cash.otherCashInflowCents)) + '</strong></div><div class="compact-summary-row"><span>Saídas não operacionais</span><strong>' + escapeHtml(formatMoney(report.cash.otherCashOutflowCents)) + '</strong></div>' + (otherRows || '<p class="small-note">Não há outros movimentos no período.</p>');
  $("#dash-cash-breakdown").innerHTML = '<span>Receita: <strong>' + escapeHtml(formatMoney(report.cash.realizedRevenueCents)) + '</strong></span><span>Custos: <strong>' + escapeHtml(formatMoney(report.cash.realizedCostsCents)) + '</strong></span><span>Despesas: <strong>' + escapeHtml(formatMoney(report.cash.realizedExpensesCents)) + '</strong></span>';
  renderDashboardDayCash(report.cash.day);
  renderDashboardChart(report);
  $("#dash-payable-open").textContent = formatMoney(report.payables.outstandingCents);
  $("#dash-payable-overdue").textContent = formatMoney(report.payables.overdueCents);
  $("#dash-payable-7").textContent = formatMoney(report.payables.next7DaysCents);
  $("#dash-payable-30").textContent = formatMoney(report.payables.next30DaysCents);
  $("#dash-payable-paid").textContent = formatMoney(report.payables.paidInPeriodCents);
  $("#dash-commitment-ratio").textContent = report.payables.commitmentRatio == null ? "Não calculável" : reportNumber(report.payables.commitmentRatio, 2) + "×";
  $("#dash-payable-recognition").textContent = "Reconhecidos: " + formatMoney(report.payables.recognizedOutstandingCents) + " · Rascunhos: " + formatMoney(report.payables.draftsCents) + ". A projeção base usa títulos reconhecidos; a distribuição inclui todos os títulos em aberto.";
  renderBarList($("#dash-payable-distribution"), report.payables.dueDistribution, "label", "amountCents");
  renderTitleRows(report.payables.upcoming, "payable", "dash-payable-upcoming");
  renderBarList($("#dash-payable-centers"), report.payables.costCenters.map((item) => ({ label: "Centro de custo · " + item.name, amountCents: item.amountCents })), "label", "amountCents");
  $("#dash-receivable-open").textContent = formatMoney(report.receivables.outstandingCents);
  $("#dash-receivable-overdue").textContent = formatMoney(report.receivables.overdueCents);
  $("#dash-receivable-30").textContent = formatMoney(report.receivables.expectedNext30DaysCents);
  $("#dash-receivable-collected").textContent = formatMoney(report.receivables.receivedInPeriodCents);
  $("#dash-on-time-collection").textContent = report.receivables.onTimeCollectionRate == null ? "Dados insuficientes" : reportPercent(report.receivables.onTimeCollectionRate * 100);
  renderBarList($("#dash-receivable-comparison"), [
    { label: "Vencimento no período · reconhecido", amountCents: report.receivables.scheduledInPeriodCents },
    { label: "Recebido no período selecionado", amountCents: report.receivables.receivedInPeriodCents },
    { label: "Rascunhos em aberto", amountCents: report.receivables.unrecognizedCents },
  ], "label", "amountCents");
  renderBarList($("#dash-receivable-sources"), report.receivables.byRevenueAccount.map((item) => ({ label: item.code + " · " + item.name, amountCents: item.amountCents })), "label", "amountCents");
  renderTitleRows(report.receivables.upcoming, "receivable", "dash-receivable-upcoming");
  const integrity = report.accounting.integrity;
  $("#dash-integrity").innerHTML = integrity.isValid
    ? '<span class="integrity-mark is-valid" aria-hidden="true">✓</span><span><strong>Integridade contábil conferida</strong><small>Lançamentos postados validados no período.</small></span>'
    : '<span class="integrity-mark is-invalid" aria-hidden="true">!</span><span><strong>Há inconsistências no razão</strong><small>' + escapeHtml(integrity.issues.map((item) => item.message).join(" ")) + '</small></span>';
  $("#dash-debits").textContent = formatMoney(report.accounting.debitCents);
  $("#dash-credits").textContent = formatMoney(report.accounting.creditCents);
  $("#dash-difference").textContent = formatMoney(report.accounting.differenceCents);
  $("#dash-accounting-groups").innerHTML = report.accounting.groups.map((item) => '<tr><td><button class="report-row-link" data-open-degree="' + item.groupNumber + '">' + item.groupNumber + " · " + escapeHtml(item.name) + '</button></td><td>' + escapeHtml(item.basis) + '</td><td class="number-cell">' + escapeHtml(formatMoney(item.amountCents)) + '</td></tr>').join("");
  $("#dash-chart-details").textContent = "Selecione um ponto para consultar os movimentos daquele dia.";
  $("#dashboard-content").dataset.report = JSON.stringify(report);
}

function analysisTrendOptions() {
  const selected = $("#analysis-trend-selector").value;
  let html = '<optgroup label="Grupos contábeis">';
  for (const degree of finance.degrees.slice().sort((a, b) => a.number - b.number)) html += '<option value="degree:' + degree.number + '">' + degree.number + " · " + escapeHtml(degree.name) + "</option>";
  html += '</optgroup><option value="revenue">Receitas totais</option><option value="cost">Custos totais</option><option value="expense">Despesas totais</option><option value="result">Resultado econômico</option><option value="cash">Movimento líquido de caixa</option><optgroup label="Subcategorias">';
  for (const item of finance.subcategories.slice().sort((a, b) => subcategoryCode(a.id).localeCompare(subcategoryCode(b.id), "pt-BR", { numeric: true }))) html += '<option value="subcategory:' + escapeHtml(item.id) + '">' + escapeHtml(subcategoryCode(item.id) + " · " + item.name) + "</option>";
  html += '</optgroup><optgroup label="Contas analíticas">';
  for (const account of finance.planAccounts.slice().sort((a, b) => accountCode(a.id).localeCompare(accountCode(b.id), "pt-BR", { numeric: true }))) html += '<option value="account:' + escapeHtml(account.id) + '">' + escapeHtml(accountCode(account.id) + " · " + account.name) + "</option>";
  html += '</optgroup>';
  $("#analysis-trend-selector").innerHTML = html;
  if ([...$("#analysis-trend-selector").options].some((option) => option.value === selected)) $("#analysis-trend-selector").value = selected;
  else $("#analysis-trend-selector").value = "expense";
}

function ratioDisplay(metric) {
  if (metric.value == null) return metric.displayValue;
  if (metric.unit === "R$") return formatMoney(metric.value);
  return metric.unit === "%" ? reportPercent(metric.value) : reportNumber(metric.value, 2) + "×";
}

function ratioCard(title, metric, periodLabel) {
  const prior = metric.previousValue == null ? "Sem comparação disponível" : "Anterior: " + (metric.unit === "R$" ? formatMoney(metric.previousValue) : metric.unit === "%" ? reportPercent(metric.previousValue) : reportNumber(metric.previousValue, 2) + "×");
  return '<article class="analysis-card"><div class="analysis-card-heading"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(periodLabel) + '</span></div><div class="analysis-card-value">' + escapeHtml(ratioDisplay(metric)) + '</div><p>' + escapeHtml(metric.formula) + '</p><small>' + escapeHtml(metric.numeratorLabel + ": " + formatMoney(metric.numeratorCents) + " ÷ " + metric.denominatorLabel + ": " + formatMoney(metric.denominatorCents)) + '</small><small>' + escapeHtml(prior) + '</small><small>' + escapeHtml(metric.explanation) + '</small></article>';
}

function renderAnalysisCostCenters(report) {
  const rows = report.performance.costCenters;
  $("#analysis-cost-centers").innerHTML = rows.length ? rows.map((item) => '<tr><td>' + escapeHtml(item.name) + '</td><td class="number-cell">' + escapeHtml(formatMoney(item.revenueCents)) + '</td><td class="number-cell">' + escapeHtml(formatMoney(item.costsCents)) + '</td><td class="number-cell">' + escapeHtml(formatMoney(item.expensesCents)) + '</td><td class="number-cell">' + escapeHtml(formatMoney(item.revenueCents - item.costsCents - item.expensesCents)) + '</td></tr>').join("") : '<tr><td colspan="5" class="empty-table">Não há rateios contábeis por centro de custo nesta competência.</td></tr>';
}

function renderAnalysisVertical(report) {
  const key = $("#analysis-vertical-selector").value || "expenses";
  const rows = report.comparative.vertical[key] || [];
  renderBarList($("#analysis-vertical-bars"), rows.slice(0, 8).map((item) => ({ label: item.code + " · " + item.name, amountCents: item.amountCents })), "label", "amountCents");
  $("#analysis-vertical-table").innerHTML = rows.length ? rows.map((item) => '<tr><td><button class="report-row-link" data-open-account="' + escapeHtml(item.accountId) + '">' + escapeHtml(item.code + " · " + item.name) + '</button></td><td class="number-cell">' + escapeHtml(formatMoney(item.amountCents)) + '</td><td class="number-cell">' + escapeHtml(reportPercent(item.percentage)) + '</td></tr>').join("") : '<tr><td colspan="3" class="empty-table">Sem composição para esta base no período.</td></tr>';
}

async function renderFinancialAnalysis() {
  if (!finance) return;
  const period = $("#analysis-period").value || selectedMonth;
  const costCenterId = $("#analysis-cost-center").value;
  const trendSelector = $("#analysis-trend-selector").value || "expense";
  const query = new URLSearchParams({ period, costCenterId, trendCount: $("#analysis-trend-count").value || "6", runwayDays: $("#analysis-runway-days").value || "30", trendSelector, expenseAccountId: $("#analysis-expense-account")?.value || "" });
  setReportState("analysis-state", "Calculando indicadores…");
  const { relatorio: report } = await request("/api/relatorios/analise-financeira?" + query.toString());
  if (!report.available) {
    $("#analysis-content").hidden = true;
    return setReportState("analysis-state", "Análise indisponível. " + (report.integrity?.issues?.map((item) => item.message).join(" ") || "Os dados contábeis não passaram pela validação."), true);
  }
  $("#analysis-content").hidden = false;
  $("#analysis-state").hidden = true;
  $("#analysis-period-label").textContent = monthPt(report.period) + " · posição patrimonial em " + datePt(report.cutoffDate);
  $("#analysis-cutoff").textContent = datePt(report.cutoffDate);
  const liquidity = report.balance.ratios;
  $("#analysis-liquidity-cards").innerHTML = ratioCard("Liquidez Corrente", liquidity.current, report.period)
    + ratioCard("Liquidez Imediata", liquidity.immediate, report.period)
    + ratioCard("Capital Circulante Líquido", liquidity.workingCapital, report.period)
    + ratioCard("Liquidez Geral", liquidity.general, report.period);
  const missing = report.balance.liquidityAvailability.unclassifiedLiabilities.concat(report.balance.liquidityAvailability.unclassifiedAssets);
  $("#analysis-liquidity-note").textContent = missing.length ? "Dados de prazo ainda não classificados: " + missing.map((item) => item.code + " · " + item.name).join("; ") + ". Classifique a conta em Cadastros para liberar os índices que dependem desse prazo." : "Classificações disponíveis conforme a hierarquia e os metadados opcionais do plano de contas.";
  $("#analysis-debt-cards").innerHTML = ratioCard("Passivo sobre ativos", liquidity.debtAssets, report.period)
    + ratioCard("Capital de terceiros sobre patrimônio", liquidity.thirdPartyToEquity, report.period)
    + ratioCard("Composição de curto prazo", liquidity.shortTermDebtComposition, report.period)
    + '<article class="analysis-card"><div class="analysis-card-heading"><strong>Patrimônio líquido estimado</strong><span>Posição patrimonial</span></div><div class="analysis-card-value">' + escapeHtml(formatMoney(report.balance.netWorthCents)) + '</div><p>Ativo − passivo reconhecido</p><small>Patrimônio Líquido contabilizado: ' + escapeHtml(formatMoney(report.balance.bookedEquityCents)) + '</small><small>Resultado acumulado não encerrado: ' + escapeHtml(formatMoney(report.balance.unclosedAccumulatedResultCents)) + '</small></article>';
  renderBarList($("#analysis-balance-bars"), [
    { label: "Ativo", amountCents: report.balance.assetsCents },
    { label: "Passivo reconhecido", amountCents: report.balance.liabilitiesCents },
    { label: "Patrimônio Líquido ajustado", amountCents: report.balance.adjustedEquityCents },
  ], "label", "amountCents");
  renderBarList($("#analysis-debt-composition"), [
    { label: "Passivo circulante", amountCents: report.debtComposition.currentLiabilitiesCents },
    { label: "Passivo não circulante classificado", amountCents: report.debtComposition.longTermLiabilitiesCents },
    { label: "Prazo não classificado", amountCents: report.debtComposition.unclassifiedLiabilitiesCents },
  ], "label", "amountCents");
  $("#analysis-equity-note").textContent = "Patrimônio líquido estimado = contas de Patrimônio Líquido + resultados por competência ainda não encerrados. Diferença para Ativo menos Passivo reconhecido: " + formatMoney(report.balance.reconciliationDifferenceCents) + ". O patrimônio líquido é uma posição, não o resultado do mês.";
  $("#analysis-performance-cards").innerHTML = '<div class="metric"><span>Receitas</span><strong>' + escapeHtml(formatMoney(report.performance.revenueCents)) + '</strong><small>Anterior: ' + escapeHtml(formatMoney(report.performance.previous.revenueCents)) + '</small></div><div class="metric"><span>Custos</span><strong>' + escapeHtml(formatMoney(report.performance.costsCents)) + '</strong><small>Anterior: ' + escapeHtml(formatMoney(report.performance.previous.costsCents)) + '</small></div><div class="metric"><span>Despesas</span><strong>' + escapeHtml(formatMoney(report.performance.expensesCents)) + '</strong><small>Anterior: ' + escapeHtml(formatMoney(report.performance.previous.expensesCents)) + '</small></div><div class="metric"><span>Resultado econômico</span><strong>' + escapeHtml(formatMoney(report.performance.economicResultCents)) + '</strong><small>Anterior: ' + escapeHtml(formatMoney(report.performance.previous.economicResultCents)) + '</small></div><div class="metric"><span>Margem do resultado</span><strong>' + escapeHtml(reportPercent(report.performance.resultMargin)) + '</strong><small>Resultado ÷ receita</small></div><div class="metric"><span>Comprometimento da receita</span><strong>' + escapeHtml(reportPercent(report.performance.revenueCommitmentRatio)) + '</strong><small>(custos + despesas) ÷ receita</small></div>';
  $("#analysis-performance-table").innerHTML = report.performance.accounts.map((group) => group.rows.length ? group.rows.map((item) => '<tr><td>' + escapeHtml(group.name) + '</td><td><button class="report-row-link" data-open-account="' + escapeHtml(item.accountId) + '">' + escapeHtml(item.code + " · " + item.name) + '</button></td><td class="number-cell">' + escapeHtml(formatMoney(item.amountCents)) + '</td></tr>').join("") : '<tr><td>' + escapeHtml(group.name) + '</td><td colspan="2" class="empty-table">Sem movimento.</td></tr>').join("") || '<tr><td colspan="3" class="empty-table">Não há movimentos de resultado na competência.</td></tr>';
  renderBarList($("#analysis-performance-comparison"), [
    { label: "Receita · mês anterior", amountCents: report.performance.previous.revenueCents },
    { label: "Receita · atual", amountCents: report.performance.revenueCents },
    { label: "Resultado · mês anterior", amountCents: report.performance.previous.economicResultCents },
    { label: "Resultado · atual", amountCents: report.performance.economicResultCents },
  ], "label", "amountCents");
  renderAnalysisCostCenters(report);
  const trendData = report.comparative.trend;
  drawReportLineChart($("#analysis-trend-chart"), trendData, [{ className: "line-projected", points: trendData.map((item) => ({ period: item.period, value: item.amountCents })) }], { months: true });
  $("#analysis-variation-absolute").textContent = formatMoney(report.comparative.absoluteVariationCents);
  $("#analysis-variation-percent").textContent = report.comparative.percentageVariation == null ? "Não disponível (período anterior igual a zero)" : reportPercent(report.comparative.percentageVariation);
  renderAnalysisVertical(report);
  const managerial = report.managerial;
  const cards = [
    ["Cobertura de 30 dias", managerial.coverageRatio == null ? "Não calculável" : reportNumber(managerial.coverageRatio, 2) + "×", "Caixa disponível ÷ contas a pagar previstas em 30 dias"],
    ["Fôlego financeiro", managerial.cashRunwayDays == null ? "Não calculável" : reportNumber(managerial.cashRunwayDays, 1) + " dias", "Gasto médio diário: " + formatMoney(managerial.averageDailyOutflowCents)],
    ["Pagamentos em dia", managerial.onTimePaymentRate == null ? "Dados insuficientes" : reportPercent(managerial.onTimePaymentRate * 100), "Considera títulos liquidados e a data da última parcela"],
    ["Concentração de despesas", managerial.expenseConcentration == null ? "Selecione uma conta" : reportPercent(managerial.expenseConcentration), managerial.expenseAccountName || "Escolha uma conta no filtro de concentração"],
    ["Evolução do patrimônio líquido", formatMoney(managerial.netWorthEvolutionCents), "Atual: " + formatMoney(managerial.currentNetWorthCents) + " · anterior: " + formatMoney(managerial.previousNetWorthCents)],
    ["Competência × caixa", formatMoney(managerial.economicResultCents) + " · " + formatMoney(managerial.netCashMovementCents), "Resultado econômico · movimento líquido de caixa"],
  ];
  $("#analysis-managerial-cards").innerHTML = cards.map((item) => '<article class="analysis-card"><div class="analysis-card-heading"><strong>' + escapeHtml(item[0]) + '</strong></div><div class="analysis-card-value">' + escapeHtml(item[1]) + '</div><small>' + escapeHtml(item[2]) + '</small></article>').join("");
  $("#analysis-managerial-note").textContent = managerial.runwayExplanation + " " + managerial.onTimePaymentDefinition + " " + managerial.cashResultExplanation;
  $("#analysis-content").dataset.report = JSON.stringify(report);
}

function renderAll() {
  renderOpeningNotice();
  renderJournal();
  renderDocuments("payable");
  renderDocuments("receivable");
  renderLedgerSelects();
  renderBankStatementAccounts();
  const selectedDegree = $("#trial-degree").value;
  $("#trial-degree").innerHTML = `<option value="">Todos</option>${finance.degrees.slice().sort((a, b) => a.number - b.number).map((degree) => `<option value="${degree.number}">${degree.number} — ${escapeHtml(degree.name)}</option>`).join("")}`;
  $("#trial-degree").value = selectedDegree;
  const selectedBudgetCategory = $("#budget-report-category").value;
  $("#budget-report-category").innerHTML = `<option value="all">Todas</option>${accountOptions(accountsByGroup([4, 5, 6]))}`;
  if ([...$("#budget-report-category").options].some((item) => item.value === selectedBudgetCategory)) $("#budget-report-category").value = selectedBudgetCategory;
  const selectedBudgetCenter = $("#budget-report-cost-center").value;
  $("#budget-report-cost-center").innerHTML = `<option value="all">Todos</option><option value="none">Sem centro de custo</option>${finance.costCenters.slice().sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true })).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code + " · " + item.name)}${item.active ? "" : " (inativo)"}</option>`).join("")}`;
  if ([...$("#budget-report-cost-center").options].some((item) => item.value === selectedBudgetCenter)) $("#budget-report-cost-center").value = selectedBudgetCenter;
  else $("#budget-report-cost-center").value = "all";
  renderDreCostCenterOptions();
  const analysisCenter = $("#analysis-cost-center").value;
  $("#analysis-cost-center").innerHTML = '<option value="">Todos</option>' + finance.costCenters.filter((item) => item.active).slice().sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true })).map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.code + " · " + item.name) + '</option>').join("");
  if ([...$("#analysis-cost-center").options].some((item) => item.value === analysisCenter)) $("#analysis-cost-center").value = analysisCenter;
  const expenseAccount = $("#analysis-expense-account").value;
  $("#analysis-expense-account").innerHTML = '<option value="">Selecione uma conta</option>' + accountsByGroup([6]).slice().sort((a, b) => accountCode(a.id).localeCompare(accountCode(b.id), "pt-BR", { numeric: true })).map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(accountCode(item.id) + " · " + item.name) + '</option>').join("");
  if ([...$("#analysis-expense-account").options].some((item) => item.value === expenseAccount)) $("#analysis-expense-account").value = expenseAccount;
  analysisTrendOptions();
  renderCatalog();
  renderCashFlow().catch((error) => {
    $("#cash-head").replaceChildren();
    $("#cash-body").innerHTML = `<tr><td class="empty-table">Não foi possível carregar o fluxo: ${escapeHtml(error.message)}</td></tr>`;
  });
  renderDashboard().catch((error) => setReportState("dashboard-state", "Não foi possível carregar o Dashboard: " + error.message, true));
  renderFinancialAnalysis().catch((error) => setReportState("analysis-state", "Não foi possível carregar a Análise Financeira: " + error.message, true));
  if (activeScreen === "ledger" && $("#ledger-account").value) loadLedger().catch((error) => showToast(error.message, true));
  if (activeScreen === "bank-statements") loadBankStatement();
  if (activeScreen === "trial-balance") loadTrialBalance().catch((error) => showToast(error.message, true));
  if (activeScreen === "dre") loadIncomeStatement().catch((error) => showToast(error.message, true));
}

function daysInMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function shiftMonth(period, delta) {
  const [year, month] = period.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function deleteCatalog(type, id) {
  if (!window.confirm("Excluir este cadastro?")) return;
  const url = ({ degrees: "/api/graus", subcategories: "/api/subcategorias", accounts: "/api/contas" })[type];
  try {
    await apiCall("DELETE", `${url}/${id}`);
    await refreshFinance();
    showToast("Cadastro excluído.");
  } catch (error) { showToast(error.message, true); }
}

async function deleteDocument(kind, id) {
  if (!window.confirm("Excluir este documento em rascunho?")) return;
  const base = kind === "payable" ? "/api/contas-a-pagar" : "/api/contas-a-receber";
  try {
    await apiCall("DELETE", `${base}/${id}`);
    await refreshFinance();
    showToast("Rascunho excluído.");
  } catch (error) { showToast(error.message, true); }
}

async function reverseEntry(id) {
  const entry = finance.journalEntries.find((item) => item.id === id);
  if (!entry) return;
  const reason = window.prompt(`Motivo do estorno do lançamento ${entry.entryNumber}:`);
  if (!reason?.trim()) return;
  const date = todayCuiaba();
  try {
    await apiCall("POST", `/api/livro-diario/${id}/estorno`, { reason: reason.trim(), postingDate: date, period: date.slice(0, 7) });
    await refreshFinance();
    showToast("Estorno lançado no Livro Diário; o original foi preservado.");
  } catch (error) { showToast(error.message, true); }
}

function handleDocumentAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, kind, id } = button.dataset;
  const list = kind === "payable" ? finance.payables : finance.receivables;
  const document = list.find((item) => item.id === id);
  if (!document) return;
  if (action === "edit-document") openDocumentDialog(kind, document);
  else if (action === "recognize-document") openRecognition(kind, document);
  else if (action === "settle-document") openSettlement(kind, document);
  else if (action === "delete-document") deleteDocument(kind, id);
}

async function jumpToJournal(entryId) {
  const entry = finance.journalEntries.find((item) => item.id === entryId);
  if (!entry) { showToast("Lançamento contábil não encontrado.", true); return; }
  $("#journal-month").value = entry.period;
  setScreen("journal");
  renderJournal();
  const row = [...$("#journal-body").rows].find((item) => Number(item.cells[1]?.textContent) === entry.entryNumber);
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
  row?.classList.add("row-highlight");
  setTimeout(() => row?.classList.remove("row-highlight"), 1800);
}

function openReportAccount(accountId) {
  const account = finance.planAccounts.find((item) => item.id === accountId);
  if (!account) return showToast("Conta analítica não encontrada.", true);
  let fromDate;
  let toDate;
  if (activeScreen === "financial-analysis") {
    const period = $("#analysis-period").value;
    fromDate = period + "-01";
    toDate = period + "-" + String(daysInMonth(period)).padStart(2, "0");
  } else {
    fromDate = $("#dashboard-from").value;
    toDate = $("#dashboard-to").value;
  }
  $("#ledger-account").value = accountId;
  $("#ledger-from").value = fromDate;
  $("#ledger-to").value = toDate;
  setScreen("ledger");
  loadLedger().catch((error) => showToast(error.message, true));
}

function openReportTitle(kind, id) {
  const isPayable = kind === "payable";
  const listId = isPayable ? "#payable-body" : "#receivable-body";
  const document = (isPayable ? finance.payables : finance.receivables).find((item) => item.id === id);
  if (!document) return showToast("Documento financeiro não encontrado.", true);
  const prefix = isPayable ? "payable" : "receivable";
  $("#" + prefix + "-status-filter").value = "todas";
  $("#" + prefix + "-period-filter").value = "";
  setScreen(isPayable ? "payables" : "receivables");
  renderDocuments(isPayable ? "payable" : "receivable");
  const row = $(listId).querySelector('[data-document-id="' + id + '"]');
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
  row?.classList.add("row-highlight");
  setTimeout(() => row?.classList.remove("row-highlight"), 1800);
}

function openReportDegree(groupNumber) {
  const fromDate = activeScreen === "financial-analysis" ? $("#analysis-period").value + "-01" : $("#dashboard-from").value;
  const toDate = activeScreen === "financial-analysis" ? $("#analysis-period").value + "-" + String(daysInMonth($("#analysis-period").value)).padStart(2, "0") : $("#dashboard-to").value;
  $("#trial-from").value = fromDate.slice(0, 7);
  $("#trial-to").value = toDate.slice(0, 7);
  $("#trial-degree").value = String(groupNumber);
  setScreen("trial-balance");
  loadTrialBalance().catch((error) => showToast(error.message, true));
}

function showDashboardDayDetails(date) {
  const report = JSON.parse($("#dashboard-content").dataset.report || "{}");
  if (!report.cash) return;
  const actual = (report.cash.actualEvents || []).filter((item) => item.date === date);
  const forecast = (report.cash.forecastEvents || []).filter((item) => item.date === date);
  const recurring = (report.cash.recurringEstimates || []).filter((item) => item.date === date);
  const items = actual.map((item) => '<div class="chart-detail-row"><span><button class="text-button" data-journal-entry="' + escapeHtml(item.entryId) + '">Diário ' + escapeHtml(item.entryNumber || "") + '</button> ' + escapeHtml(item.description || "Movimento contábil") + '</span><strong>' + escapeHtml(formatMoney(item.amountCents)) + '</strong></div>');
  for (const item of forecast) {
    if (item.sourceType === "budget") {
      items.push('<div class="chart-detail-row"><span><button class="text-button" data-budget-open="' + escapeHtml(item.budgetId) + '">Orçado</button> ' + escapeHtml(item.title || item.description) + ' · vencimento ' + escapeHtml(datePt(item.plannedDueDate || item.date)) + '</span><strong>' + escapeHtml(formatMoney(item.amountCents)) + '</strong></div>');
      continue;
    }
    const kind = item.sourceType.indexOf("payable") >= 0 ? "payable" : "receivable";
    items.push('<div class="chart-detail-row"><span><button class="text-button" data-open-title="' + kind + '" data-id="' + escapeHtml(item.sourceId) + '">' + (item.sourceType.indexOf("draft") >= 0 ? "Rascunho" : "Título") + '</button> ' + escapeHtml(item.description) + '</span><strong>' + escapeHtml(formatMoney(item.amountCents)) + '</strong></div>');
  }
  for (const item of recurring) items.push('<div class="chart-detail-row"><span>Estimativa recorrente · ' + escapeHtml(item.description) + '</span><strong>' + escapeHtml(formatMoney(item.amountCents)) + '</strong></div>');
  $("#dash-chart-details").innerHTML = '<strong>Movimentos de ' + escapeHtml(datePt(date)) + '</strong>' + (items.length ? items.join("") : '<p class="small-note">Nenhum lançamento ou previsão neste dia.</p>');
}

function handleAnalysisChartDrill(period) {
  const selector = $("#analysis-trend-selector").value;
  if (selector.startsWith("account:")) {
    const accountId = selector.slice(8);
    $("#ledger-account").value = accountId;
    $("#ledger-from").value = period + "-01";
    $("#ledger-to").value = period + "-" + String(daysInMonth(period)).padStart(2, "0");
    setScreen("ledger");
    loadLedger().catch((error) => showToast(error.message, true));
    return;
  }
  let degree = selector.startsWith("degree:") ? selector.slice(7) : "";
  if (selector.startsWith("subcategory:")) {
    const code = subcategoryCode(selector.slice(12));
    degree = code.split(".")[0];
  }
  if (/^[1-6]$/.test(degree)) {
    $("#trial-from").value = period;
    $("#trial-to").value = period;
    $("#trial-degree").value = degree;
    setScreen("trial-balance");
    loadTrialBalance().catch((error) => showToast(error.message, true));
  } else {
    $("#dre-period").value = period;
    setScreen("dre");
    loadIncomeStatement().catch((error) => showToast(error.message, true));
  }
}

function bindEvents() {
  $("#login-form").addEventListener("submit", login);
  $$('[data-guardian-refresh], [data-guardian-retry]').forEach((button) => button.addEventListener("click", loadGuardianBriefing));
  $$('[data-guardian-panel]').forEach((panel) => panel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-guardian-action]");
    if (!button || !panel.contains(button)) return;
    const id = button.dataset.guardianEntityId;
    if (button.dataset.guardianAction === "payable") openReportTitle("payable", id);
    else if (button.dataset.guardianAction === "receivable") openReportTitle("receivable", id);
    else if (button.dataset.guardianAction === "journal") jumpToJournal(id).catch((error) => showToast(error.message, true));
    else if (button.dataset.guardianAction === "account") openReportAccount(id);
  }));
  $("#logout-button").addEventListener("click", () => logout().catch((error) => showToast(error.message, true)));
  $("#assistant-open-button").addEventListener("click", () => openAssistant().catch((error) => showToast(error.message, true)));
  $("#deepseek-settings-open").addEventListener("click", () => openDeepSeekSettings().catch((error) => showToast(error.message, true)));
  $("#assistant-configure-key").addEventListener("click", () => openDeepSeekSettings().catch((error) => showToast(error.message, true)));
  $("#assistant-new-conversation").addEventListener("click", resetAssistantConversation);
  $("#assistant-form").addEventListener("submit", submitAssistantMessage);
  $("#agent-new-conversation").addEventListener("click", () => createAgentConversation().catch(() => {}));
  $("#agent-refresh-conversations").addEventListener("click", () => loadAgentConversations().catch((error) => setAgentRoomListStatus(error.message, { error: true })));
  $("#agent-room-list-retry").addEventListener("click", () => {
    if (agentRoomListRetryMode === "create" && agentCreateRequestId) createAgentConversation({ title: agentCreateTitle }).catch(() => {});
    else loadAgentConversations();
  });
  $("#agent-conversation-retry").addEventListener("click", () => {
    if (activeAgentConversationId) openAgentConversation(activeAgentConversationId, { focus: false });
  });
  $("#agent-load-older").addEventListener("click", loadOlderAgentMessages);
  $("#agent-room-list-toggle").addEventListener("click", () => {
    const rail = $("#agent-room-rail");
    const open = !rail.classList.contains("is-open");
    rail.classList.toggle("is-open", open);
    $("#agent-room-list-toggle").setAttribute("aria-expanded", String(open));
  });
  $("#agent-room-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-conversation-id]");
    if (!button) return;
    openAgentConversation(button.dataset.conversationId).catch((error) => setAgentConversationStatus(error.message, { retry: true }));
  });
  $("#agent-form").addEventListener("submit", submitAgentMessage);
  $("#agent-configure-key").addEventListener("click", () => openDeepSeekSettings().catch((error) => showToast(error.message, true)));
  $("#agent-key-required-configure").addEventListener("click", () => openDeepSeekSettings().catch((error) => showToast(error.message, true)));
  $("#agent-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!$("#agent-submit").disabled) $("#agent-form").requestSubmit();
    }
  });
  $("#agent-input").addEventListener("input", () => {
    agentDrafts.set(activeAgentConversationId || "__new__", $("#agent-input").value);
  });
  $("#agent-response-level").addEventListener("change", (event) => {
    agentResponseLevel = normalizeAgentResponseLevel(event.target.value);
    event.target.value = agentResponseLevel;
    $("#agent-response-level-status").textContent = `Nível da explicação: ${AGENT_RESPONSE_LEVEL_LABELS[agentResponseLevel]}. Vale somente nesta sessão.`;
  });
  $("#agent-messages").addEventListener("click", (event) => {
    const confirmAction = event.target.closest("[data-agent-action-confirm]");
    if (confirmAction) {
      runAgentActionOperation(confirmAction.dataset.agentActionConfirm, "confirmar");
      return;
    }
    const cancelAction = event.target.closest("[data-agent-action-cancel]");
    if (cancelAction) {
      runAgentActionOperation(cancelAction.dataset.agentActionCancel, "cancelar");
      return;
    }
    const refreshAction = event.target.closest("[data-agent-action-refresh]");
    if (refreshAction) {
      runAgentActionOperation(refreshAction.dataset.agentActionRefresh, "refresh");
      return;
    }
    const sourceButton = event.target.closest("[data-agent-source-screen]");
    if (sourceButton) {
      const navButton = $$(".nav-link").find((button) => button.dataset.screen === sourceButton.dataset.agentSourceScreen);
      navButton?.click();
      return;
    }
    const suggestion = event.target.closest("[data-agent-prompt]");
    if (suggestion) {
      submitAgentSuggestion(suggestion.dataset.agentPrompt);
      return;
    }
    const retry = event.target.closest("[data-retry-agent-message]");
    if (retry) retryAgentMessage(retry.dataset.retryAgentMessage);
  });
  $("#agent-messages").addEventListener("submit", (event) => {
    if (event.target.closest("form[data-agent-action-form]")) submitAgentActionRevision(event);
  });
  $("#agent-messages").addEventListener("change", updateAgentActionPartyLink);
  $("#agent-messages").addEventListener("input", updateAgentActionPartyLink);
  $("#agent-actions-retry").addEventListener("click", () => loadAgentActions(activeAgentConversationId));
  $("#deepseek-settings-form").addEventListener("submit", saveDeepSeekSettings);
  $("#deepseek-remove-key").addEventListener("click", () => removeDeepSeekSettings().catch((error) => showToast(error.message, true)));
  $$(".nav-link").forEach((button) => button.addEventListener("click", () => {
    setScreen(button.dataset.screen);
    if (button.dataset.screen === "ledger" && $("#ledger-account").value) loadLedger().catch((error) => showToast(error.message, true));
    if (button.dataset.screen === "bank-statements") loadBankStatement();
    if (button.dataset.screen === "trial-balance") loadTrialBalance().catch((error) => showToast(error.message, true));
    if (button.dataset.screen === "balance-sheet") loadBalanceSheet();
    if (button.dataset.screen === "dre") loadIncomeStatement().catch((error) => showToast(error.message, true));
  }));
  $(".brand").addEventListener("click", (event) => { event.preventDefault(); setScreen("dashboard"); });
  $("#primary-action").addEventListener("click", () => {
    const action = $("#primary-action").dataset.action;
    if (action === "payable") openDocumentDialog("payable");
    else if (action === "receivable") openDocumentDialog("receivable");
    else if (action === "registration") openNewRegistration();
    else if (action === "budget") openNewBudgetDialog();
    else openManualDialog();
  });
  $$(".budget-tab").forEach((button) => button.addEventListener("click", () => setBudgetView(button.dataset.budgetView)));
  $(".budget-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = $$(".budget-tab");
    const current = tabs.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    tabs[next].focus();
    setBudgetView(tabs[next].dataset.budgetView);
  });
  $("#budget-list-filters").addEventListener("submit", (event) => { event.preventDefault(); loadBudgetPlans(); });
  $("#budget-report-filters").addEventListener("submit", (event) => { event.preventDefault(); loadBudgetReport().catch((error) => setReportState("budget-report-state", error.message, true)); });
  $("#budget-list-body").addEventListener("click", (event) => handleBudgetListAction(event));
  $("#budget-report-body").addEventListener("click", (event) => handleBudgetListAction(event));
  $("#budget-occurrence-rows").addEventListener("click", handleBudgetOccurrenceRowAction);
  $("#budget-form").addEventListener("submit", submitBudgetForm);
  $("#budget-generate").addEventListener("click", generateBudgetOccurrences);
  $("#budget-add-occurrence").addEventListener("click", addBudgetOccurrenceRow);
  $("#budget-schedule-mode").addEventListener("change", () => {
    $("#budget-monthly-controls").hidden = $("#budget-schedule-mode").value !== "monthly";
    sendFormError($("#budget-error"), "");
  });
  $("#budget-direction").addEventListener("change", () => {
    updateBudgetEditorFields($("#budget-direction").value);
    $("#budget-party-name").value = "";
  });
  $("#budget-party-select").addEventListener("change", () => {
    const party = finance.parties.find((item) => item.id === $("#budget-party-select").value);
    if (party) $("#budget-party-name").value = party.name;
  });
  $("#budget-party-name").addEventListener("input", () => {
    const linked = finance.parties.find((item) => item.id === $("#budget-party-select").value);
    if (linked && $("#budget-party-name").value.trim() !== linked.name) $("#budget-party-select").value = "";
  });
  $("#budget-convert-party-select").addEventListener("change", () => {
    const party = finance.parties.find((item) => item.id === $("#budget-convert-party-select").value);
    if (party) $("#budget-convert-party-name").value = party.name;
  });
  $("#budget-convert-party-name").addEventListener("input", () => {
    const linked = finance.parties.find((item) => item.id === $("#budget-convert-party-select").value);
    if (linked && $("#budget-convert-party-name").value.trim() !== linked.name) $("#budget-convert-party-select").value = "";
  });
  $("#budget-convert-form").addEventListener("input", invalidateBudgetConversionPreview);
  $("#budget-convert-form").addEventListener("change", invalidateBudgetConversionPreview);
  $("#budget-convert-preview").addEventListener("click", previewBudgetConversion);
  $("#budget-convert-form").addEventListener("submit", submitBudgetConversion);
  $("#budget-open-created-document").addEventListener("click", () => {
    if (!budgetConversionCreatedDocument) return;
    const created = budgetConversionCreatedDocument;
    $("#budget-convert-dialog").close();
    openReportTitle(created.kind, created.document.id);
  });
  $("#cashflow-previous").addEventListener("click", () => { selectedMonth = shiftMonth($("#cashflow-month").value, -1); $("#cashflow-month").value = selectedMonth; renderCashFlow().catch((error) => showToast(error.message, true)); });
  $("#cashflow-next").addEventListener("click", () => { selectedMonth = shiftMonth($("#cashflow-month").value, 1); $("#cashflow-month").value = selectedMonth; renderCashFlow().catch((error) => showToast(error.message, true)); });
  $("#cashflow-month").addEventListener("change", () => { selectedMonth = $("#cashflow-month").value; renderCashFlow().catch((error) => showToast(error.message, true)); });
  $("#dashboard-preset").addEventListener("change", () => setDashboardPreset($("#dashboard-preset").value));
  $("#dashboard-filters").addEventListener("submit", (event) => { event.preventDefault(); renderDashboard().catch((error) => setReportState("dashboard-state", error.message, true)); });
  $("#analysis-filters").addEventListener("submit", (event) => { event.preventDefault(); renderFinancialAnalysis().catch((error) => setReportState("analysis-state", error.message, true)); });
  $("#analysis-trend-selector").addEventListener("change", () => renderFinancialAnalysis().catch((error) => setReportState("analysis-state", error.message, true)));
  $("#analysis-vertical-selector").addEventListener("change", () => {
    const report = JSON.parse($("#analysis-content").dataset.report || "{}");
    if (report.comparative) renderAnalysisVertical(report);
  });
  $$(".analysis-tab").forEach((button) => button.addEventListener("click", () => {
    $$(".analysis-tab").forEach((item) => item.classList.toggle("is-active", item === button));
    $$(".analysis-pane").forEach((item) => {
      const active = item.dataset.analysisPane === button.dataset.analysisTab;
      item.hidden = !active;
      item.classList.toggle("is-active", active);
    });
  }));
  $("#journal-month").addEventListener("change", renderJournal);
  $("#journal-sort-head").addEventListener("click", (event) => handleReportSort("journal", event));
  $("#payable-sort-head").addEventListener("click", (event) => handleReportSort("payable", event));
  $("#receivable-sort-head").addEventListener("click", (event) => handleReportSort("receivable", event));
  $("#new-journal-entry").addEventListener("click", openManualDialog);
  $("#new-payable").addEventListener("click", () => openDocumentDialog("payable"));
  $("#new-receivable").addEventListener("click", () => openDocumentDialog("receivable"));
  $("#payable-status-filter").addEventListener("change", () => renderDocuments("payable"));
  $("#payable-period-filter").addEventListener("change", () => renderDocuments("payable"));
  $("#receivable-status-filter").addEventListener("change", () => renderDocuments("receivable"));
  $("#receivable-period-filter").addEventListener("change", () => renderDocuments("receivable"));
  $("#payable-body").addEventListener("click", handleDocumentAction);
  $("#receivable-body").addEventListener("click", handleDocumentAction);
  $("#payable-budget-body").addEventListener("click", handleBudgetListAction);
  $("#receivable-budget-body").addEventListener("click", handleBudgetListAction);
  $("#journal-body").addEventListener("click", (event) => {
    const link = event.target.closest("[data-action='reverse-entry']");
    if (link) reverseEntry(link.dataset.id);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".document-party-field")) closeDocumentPartySuggestions();
    const go = event.target.closest("[data-go-screen]");
    if (go) { event.preventDefault(); setScreen(go.dataset.goScreen); }
    const budget = event.target.closest("[data-budget-open]");
    if (budget) { event.preventDefault(); openBudgetEditor(budget.dataset.budgetOpen); return; }
    const title = event.target.closest("[data-open-title]");
    if (title) { event.preventDefault(); openReportTitle(title.dataset.openTitle, title.dataset.id); }
    const party = event.target.closest("[data-open-party]");
    if (party) {
      event.preventDefault();
      setRegistrationType("parties");
      setScreen("registrations");
      openPartyDialog(party.dataset.openParty);
      return;
    }
    const account = event.target.closest("[data-open-account]");
    if (account) { event.preventDefault(); openReportAccount(account.dataset.openAccount); }
    const degree = event.target.closest("[data-open-degree]");
    if (degree) { event.preventDefault(); openReportDegree(degree.dataset.openDegree); }
    const chartPoint = event.target.closest("[data-chart-date]");
    if (chartPoint) {
      if (chartPoint.closest("#dashboard-cash-chart")) showDashboardDayDetails(chartPoint.dataset.chartDate);
      else if (chartPoint.closest("#analysis-trend-chart")) handleAnalysisChartDrill(chartPoint.dataset.chartDate);
    }
    const cashDrill = event.target.closest("[data-drill='cash-ledger']");
    if (cashDrill) {
      const accountId = finance.planAccounts.find((item) => item.postable && item.cashEquivalent)?.id;
      if (accountId) openReportAccount(accountId);
      else setScreen("ledger");
    }
    const journalDrill = event.target.closest("[data-drill='journal-cash']");
    if (journalDrill) {
      selectedMonth = $("#dashboard-to").value.slice(0, 7);
      $("#journal-month").value = selectedMonth;
      setScreen("journal");
      renderJournal();
    }
    const link = event.target.closest("[data-journal-entry]");
    if (link) { event.preventDefault(); jumpToJournal(link.dataset.journalEntry); }
    const close = event.target.closest("[data-close]");
    if (close) $(`#${close.dataset.close}`).close();
  });

  $("#manual-form").addEventListener("submit", submitManualEntry);
  $("#add-manual-line").addEventListener("click", () => createManualLine());
  $("#document-form").addEventListener("submit", submitDocument);
  $("#recognition-form").addEventListener("submit", submitRecognition);
  $("#settlement-form").addEventListener("submit", submitSettlement);
  $("#catalog-form").addEventListener("submit", submitCatalog);
  $("#cost-center-form").addEventListener("submit", submitCostCenter);
  $("#ledger-filters").addEventListener("submit", (event) => loadLedger(event).catch((error) => showToast(error.message, true)));
  $("#bank-statement-filters").addEventListener("submit", loadBankStatement);
  $("#bank-statement-account").addEventListener("change", () => loadBankStatement());
  $("#trial-filters").addEventListener("submit", (event) => loadTrialBalance(event).catch((error) => showToast(error.message, true)));
  $("#trial-level-up").addEventListener("click", () => changeTrialBalanceLevel(-1));
  $("#trial-level-down").addEventListener("click", () => changeTrialBalanceLevel(1));
  $("#balance-sheet-filters").addEventListener("submit", (event) => loadBalanceSheet(event));
  $("#balance-sheet-level-up").addEventListener("click", () => changeBalanceSheetLevel(-1));
  $("#balance-sheet-level-down").addEventListener("click", () => changeBalanceSheetLevel(1));
  $("#dre-period").addEventListener("change", () => loadIncomeStatement().catch((error) => showToast(error.message, true)));
  $("#dre-regime").addEventListener("change", () => loadIncomeStatement().catch((error) => showToast(error.message, true)));
  $("#dre-cost-center").addEventListener("change", () => loadIncomeStatement().catch((error) => showToast(error.message, true)));
  $("#cost-report-filters").addEventListener("submit", (event) => { event.preventDefault(); renderCostCenterReport().catch((error) => showToast(error.message, true)); });
  $("#ledger-account").addEventListener("change", () => loadLedger().catch((error) => showToast(error.message, true)));
  $("#trial-degree").addEventListener("change", () => loadTrialBalance().catch((error) => showToast(error.message, true)));
  $$(".registration-tab").forEach((button) => button.addEventListener("click", () => setRegistrationType(button.dataset.register)));
  $("#add-registration").addEventListener("click", openNewRegistration);
  $("#party-search").addEventListener("input", () => {
    clearTimeout(partySearchTimer);
    partySearchTimer = setTimeout(() => loadParties(), 220);
  });
  $("#party-role-filter").addEventListener("change", () => loadParties());
  $("#party-status-filter").addEventListener("change", () => loadParties());
  $("#party-person-type").addEventListener("change", updatePartyTaxIdLabel);
  $("#party-form").addEventListener("submit", submitPartyForm);
  $("#new-document-party").addEventListener("click", () => {
    closeDocumentPartySuggestions();
    openPartyDialog(null, { documentKind: activeDocumentKind });
  });
  $("#document-party").addEventListener("input", () => {
    if (selectedDocumentPartyId && $("#document-party").value.trim() !== selectedDocumentPartyText) {
      selectedDocumentPartyId = null;
      selectedDocumentPartyText = "";
      setDocumentPartyStatus("Vínculo removido. Informe um nome livre (até 120 caracteres) ou selecione outro cadastro ativo.");
    }
    scheduleDocumentPartySearch();
  });
  $("#document-party").addEventListener("focus", () => {
    if (!selectedDocumentPartyId && $("#document-party").value.trim()) scheduleDocumentPartySearch(true);
  });
  $("#document-party").addEventListener("blur", () => setTimeout(closeDocumentPartySuggestions, 140));
  $("#document-party").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && documentPartySuggestions.length) {
      event.preventDefault();
      setDocumentPartyActiveIndex(documentPartyActiveIndex + 1);
    } else if (event.key === "ArrowUp" && documentPartySuggestions.length) {
      event.preventDefault();
      setDocumentPartyActiveIndex(documentPartyActiveIndex < 0 ? documentPartySuggestions.length - 1 : documentPartyActiveIndex - 1);
    } else if (event.key === "Enter" && documentPartyActiveIndex >= 0 && documentPartySuggestions[documentPartyActiveIndex]) {
      event.preventDefault();
      selectDocumentParty(documentPartySuggestions[documentPartyActiveIndex]);
    } else if (event.key === "Escape" && !$("#document-party-options").hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeDocumentPartySuggestions();
    }
  });
  $("#document-party-options").addEventListener("click", (event) => {
    const option = event.target.closest("[data-party-option]");
    if (!option) return;
    const party = documentPartySuggestions[Number(option.dataset.partyOption)];
    if (party) selectDocumentParty(party);
  });
  $("#registration-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "retry-parties") { loadParties(); return; }
    if (button.dataset.action === "edit-party") { openPartyDialog(button.dataset.id); return; }
    if (button.dataset.action === "toggle-party") { togglePartyActive(button.dataset.id, button.dataset.active === "true"); return; }
    const item = button.dataset.type === "degrees" ? finance.degrees.find((record) => record.id === button.dataset.id)
      : button.dataset.type === "subcategories" ? finance.subcategories.find((record) => record.id === button.dataset.id)
        : finance.planAccounts.find((record) => record.id === button.dataset.id);
    if (button.dataset.action === "edit-catalog" && item) openCatalogDialog(button.dataset.type, item);
    if (button.dataset.action === "delete-catalog") deleteCatalog(button.dataset.type, button.dataset.id);
    if (button.dataset.action === "edit-center") openCostCenterDialog(finance.costCenters.find((record) => record.id === button.dataset.id));
    if (button.dataset.action === "delete-center") deleteCostCenter(button.dataset.id);
  });
  $("#catalog-dialog").addEventListener("close", () => { editingCatalog = null; });
  $("#document-dialog").addEventListener("close", () => {
    editingDocument = null;
    documentIdempotencyKey = null;
    documentPartySearchToken += 1;
    clearTimeout(documentPartySearchTimer);
    closeDocumentPartySuggestions();
    selectedDocumentPartyId = null;
    selectedDocumentPartyText = "";
  });
  $("#recognition-dialog").addEventListener("close", () => { pendingDocumentAction = null; });
  $("#settlement-dialog").addEventListener("close", () => { pendingDocumentAction = null; settlementIdempotencyKey = null; });
  $("#cost-center-dialog").addEventListener("close", () => { editingCostCenterId = null; });
  $("#party-dialog").addEventListener("close", () => {
    partyDialogLoadToken += 1;
    editingPartyId = null;
    partyCreateIdempotencyKey = null;
    partyDialogContext = null;
    $("#party-form").reset();
    $("#party-extra-fields").open = false;
    $("#party-fields").disabled = false;
    $("#party-save").disabled = false;
    $("#party-save").textContent = "Salvar cadastro";
    $("#party-dialog-status").hidden = true;
    $("#party-dialog-status").textContent = "";
    sendFormError($("#party-error"), "");
    updatePartyTaxIdLabel();
  });
  $("#budget-dialog").addEventListener("close", () => { budgetEditorState = null; });
  $("#budget-convert-dialog").addEventListener("close", () => {
    budgetConversionState = null;
    budgetConversionPreview = null;
    budgetConversionCreatedDocument = null;
    $("#budget-convert-form").reset();
    $("#budget-convert-success").hidden = true;
    $("#budget-convert-review").hidden = true;
    $("#budget-convert-actions").hidden = false;
    $("#budget-convert-preview").disabled = false;
    $("#budget-convert-confirm").disabled = true;
    sendFormError($("#budget-convert-error"), "");
  });
}

async function deleteCostCenter(id) {
  if (!window.confirm("Excluir este centro de custo? Se ele já tiver histórico, o servidor pedirá que seja inativado.")) return;
  try {
    await apiCall("DELETE", `/api/centros-de-custo/${id}`);
    await refreshFinance();
    showToast("Centro de custo excluído.");
  } catch (error) { showToast(error.message, true); }
}

async function initializeWorkspace() {
  try {
    const { financeiro } = await request("/api/financeiro");
    finance = financeiro;
    selectedMonth = finance.defaultPeriod || "2026-10";
    const currentDay = todayCuiaba();
    const currentPeriod = currentDay.slice(0, 7);
    $("#dashboard-preset").value = "current-month";
    $("#dashboard-from").value = currentPeriod + "-01";
    $("#dashboard-to").value = currentDay;
    $("#dashboard-horizon").value = "30";
    $("#dashboard-from").disabled = true;
    $("#dashboard-to").disabled = true;
    $("#analysis-period").value = currentPeriod;
    $("#budget-report-from").value = `${currentPeriod}-01`;
    $("#budget-report-to").value = `${currentPeriod}-${String(daysInMonth(currentPeriod)).padStart(2, "0")}`;
    $("#cashflow-month").value = selectedMonth;
    $("#journal-month").value = selectedMonth;
    $("#trial-from").value = selectedMonth;
    $("#trial-to").value = selectedMonth;
    $("#dre-period").value = selectedMonth;
    $("#cost-report-from").value = selectedMonth;
    $("#cost-report-to").value = selectedMonth;
    const from = `${selectedMonth}-01`;
    const to = `${selectedMonth}-${String(daysInMonth(selectedMonth)).padStart(2, "0")}`;
    $("#bank-statement-from").value = from;
    $("#bank-statement-to").value = to;
    $("#ledger-from").value = from;
    $("#ledger-to").value = to;
    renderAll();
    loadGuardianBriefing();
  } catch (error) {
    $("#cash-body").innerHTML = `<tr><td class="empty-table">Não foi possível carregar os dados: ${escapeHtml(error.message)}. Confirme que o servidor foi iniciado com node server.js.</td></tr>`;
    $("#cashflow-period-label").textContent = "";
    showToast(error.message, true);
  }
}

async function initialize() {
  bindEvents();
  try {
    const session = await request("/api/sessao");
    if (!session.autenticado) return showLogin();
    showWorkspace();
    await initializeWorkspace();
  } catch (error) { showLogin(error.message); }
}

initialize();

