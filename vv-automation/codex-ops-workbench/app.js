const state = {
  summary: null,
  services: [],
  codex: null,
  agents: null,
  usage: null,
};

const $ = (selector) => document.querySelector(selector);
const fmt = new Intl.DateTimeFormat("zh-CN", { hour12: false, dateStyle: "short", timeStyle: "medium" });

document.addEventListener("DOMContentLoaded", () => {
  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#installAutostartBtn").addEventListener("click", installAutostart);
  document.querySelectorAll("nav a").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll("nav a").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });
  refreshAll();
  setInterval(refreshAll, 10000);
});

async function refreshAll() {
  try {
    const [summary, services, codex, agents, usage] = await Promise.all([
      getJson("/api/summary"),
      getJson("/api/services"),
      getJson("/api/codex/status"),
      getJson("/api/agents/status"),
      getJson("/api/usage/local"),
    ]);
    state.summary = summary;
    state.services = services.services || [];
    state.codex = codex;
    state.agents = agents;
    state.usage = usage;
    render();
  } catch (error) {
    toast(`刷新失败：${error.message}`, true);
  }
}

function render() {
  $("#repoRoot").textContent = state.summary?.repoRoot || "";
  $("#generatedAt").textContent = state.summary?.generatedAt ? `刷新于 ${fmt.format(new Date(state.summary.generatedAt))}` : "未刷新";
  renderSummary();
  renderServices();
  renderCodex();
  renderAgents();
  renderUsage();
}

function renderSummary() {
  const summary = state.summary;
  const metrics = [
    ["服务健康", `${summary.serviceHealth.healthy}/${summary.serviceHealth.total}`, summary.serviceHealth.unhealthy ? "warn" : "ok"],
    ["Codex 进程", summary.codex.running ? "运行中" : "未检测到", summary.codex.running ? "ok" : "warn"],
    ["插件/技能", `${summary.codex.plugins}/${summary.codex.skills}`, "neutral"],
    ["Agent 配置", `${summary.agents.configured}/${summary.agents.total}`, summary.agents.configured === summary.agents.total ? "ok" : "warn"],
    ["API 请求估算", String(summary.usage.apiRequests || 0), "neutral"],
    ["本地错误信号", String(summary.usage.errors || 0), summary.usage.errors ? "warn" : "ok"],
  ];
  $("#summaryMetrics").innerHTML = metrics
    .map(([label, value, tone]) => `<article class="metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`)
    .join("");

  $("#eventList").innerHTML = (summary.events || []).length
    ? summary.events
        .slice()
        .reverse()
        .map((event) => `<div class="event"><span>${escapeHtml(event.scope)}</span><b>${escapeHtml(event.type)}</b><em>${escapeHtml(event.message)}</em></div>`)
        .join("")
    : `<div class="empty">暂无事件</div>`;
}

function renderServices() {
  $("#serviceGrid").innerHTML = state.services
    .map((service) => {
      const statusTone = service.health === "healthy" ? "ok" : "warn";
      return `<article class="service-card">
        <div class="service-title">
          <div>
            <h4>${escapeHtml(service.name)}</h4>
            <p>${escapeHtml(service.description || "")}</p>
          </div>
          <span class="badge ${statusTone}">${escapeHtml(service.runtimeStatus)}</span>
        </div>
        <div class="service-meta">
          <span>端口 ${escapeHtml(service.port || "-")}</span>
          <span>PID ${escapeHtml(service.pid || "-")}</span>
          <span>${escapeHtml(service.healthMessage || "unknown")}</span>
        </div>
        <div class="memory-line ${service.memoryStatus === "critical" || service.memoryStatus === "leak-risk" ? "danger" : ""}">
          <span>内存</span>
          <strong>${escapeHtml(service.memoryMessage || "未采样")}</strong>
        </div>
        <div class="toggle-row">
          <label><input type="checkbox" data-action="autostart" data-id="${escapeAttr(service.id)}" ${service.autostart ? "checked" : ""}/> 自启动</label>
          <label><input type="checkbox" data-action="autorestart" data-id="${escapeAttr(service.id)}" ${service.autoRestart ? "checked" : ""}/> 挂掉拉起</label>
        </div>
        <div class="button-row">
          <button data-action="start" data-id="${escapeAttr(service.id)}">启动</button>
          <button data-action="restart" data-id="${escapeAttr(service.id)}">重启</button>
          <button data-action="stop" data-id="${escapeAttr(service.id)}">停止</button>
          <button data-action="logs" data-id="${escapeAttr(service.id)}">日志</button>
        </div>
        <details>
          <summary>注册命令</summary>
          <code>${escapeHtml(service.commandPreview || "")}</code>
        </details>
        <pre id="logs-${escapeAttr(service.id)}" class="log-box"></pre>
      </article>`;
    })
    .join("");

  $("#serviceGrid").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => serviceAction(button.dataset.id, button.dataset.action));
  });
  $("#serviceGrid").querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => serviceAction(input.dataset.id, input.dataset.action, { enabled: input.checked }));
  });
}

function renderCodex() {
  const codex = state.codex;
  $("#codexHome").textContent = codex.codexHome;
  const rows = [
    ["Codex 进程", codex.processes.length ? codex.processes.join("\n") : "未检测到"],
    ["用户 config.toml", presentLabel(codex.config)],
    ["项目 .codex/config.toml", presentLabel(codex.projectConfig)],
    ["Automations", `${codex.automations.count} 项`],
    ["Plugins", `${codex.plugins.count} 项`],
    ["Skills", `${codex.skills.count} 项`],
    ["Sessions", `${codex.sessions.count} 项`],
  ];
  $("#codexStatus").innerHTML = rows.map(([key, value]) => kv(key, value)).join("");
  $("#configHints").textContent = (codex.mcpConfigHints || []).map((item) => `${item.line}: ${item.text}`).join("\n") || "未发现配置线索";
}

function renderAgents() {
  $("#agentGrid").innerHTML = state.agents.roles
    .map(
      (role) => `<article class="agent-card ${role.present ? "ok" : "warn"}">
        <span>${escapeHtml(role.id)}</span>
        <strong>${role.present ? "已配置" : "缺失"}</strong>
        <p>${escapeHtml(role.path)}</p>
      </article>`,
    )
    .join("");
  const rows = [
    ["工作流", presentLabel(state.agents.workflow)],
    ["Prompt", presentLabel(state.agents.prompt)],
    ["Skill binding", presentLabel(state.agents.binding)],
    ["最近产物", state.agents.recentArtifacts?.length ? state.agents.recentArtifacts.map((item) => item.path).join("\n") : "暂无 artifacts"],
  ];
  $("#agentAssets").innerHTML = rows.map(([key, value]) => kv(key, value)).join("");
}

function renderUsage() {
  const usage = state.usage;
  const cards = [
    ["扫描文件", usage.summary.scannedFiles],
    ["API 请求", usage.summary.apiRequests],
    ["输入字段估算", usage.summary.tokenInputs],
    ["输出字段估算", usage.summary.tokenOutputs],
    ["错误信号", usage.summary.errors],
  ];
  $("#usagePanel").innerHTML = `${cards
    .map(([label, value]) => `<div class="usage-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("")}
    <div class="usage-note">${escapeHtml(usage.note)}${usage.summary.ignoredLargeTokenFields ? ` 已忽略 ${usage.summary.ignoredLargeTokenFields} 个异常大的累计字段。` : ""}</div>
    <div class="model-list">${(usage.summary.topModels || []).map((item) => `<span>${escapeHtml(item.model)} · ${item.count}</span>`).join("") || "<span>暂无模型记录</span>"}</div>`;
}

async function serviceAction(id, action, body = {}) {
  try {
    if (action === "logs") {
      const result = await getJson(`/api/services/${encodeURIComponent(id)}/logs`);
      $(`#logs-${cssEscape(id)}`).textContent = result.logs.join("\n") || "暂无日志";
      return;
    }
    const result = await postJson(`/api/services/${encodeURIComponent(id)}/${action}`, body);
    toast(`${id}: ${result.status || action} 成功`);
    await refreshAll();
  } catch (error) {
    toast(`${id}: ${action} 失败：${error.message}`, true);
  }
}

async function installAutostart() {
  try {
    const result = await postJson("/api/workbench/autostart", { action: "install" });
    toast(`自启动已安装：${result.label}`);
  } catch (error) {
    toast(`自启动安装失败：${error.message}`, true);
  }
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.message || json.error || `${response.status} ${response.statusText}`);
  return json;
}

function kv(key, value) {
  return `<div><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function presentLabel(item) {
  if (!item?.present) return "缺失";
  return `${item.path || ""}\n${item.updatedAt || ""}`;
}

function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", error);
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
