import { createServer } from "node:http";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const workbenchDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(workbenchDir, "../..");
const runtimeDir = resolve(workbenchDir, ".runtime");
const logDir = resolve(runtimeDir, "logs");
const registryPath = resolve(workbenchDir, "services.json");
const overridesPath = resolve(runtimeDir, "service-overrides.json");
const port = Number(process.env.PORT || 8777);
const host = process.env.HOST || "127.0.0.1";
const codeHome = process.env.CODEX_HOME || join(homedir(), ".codex");

const managed = new Map();
const monitorState = new Map();
const eventLog = [];

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

await mkdir(logDir, { recursive: true });
await ensureOverrides();
await autostartRegisteredServices();
setInterval(() => {
  monitorServices().catch((error) => logEvent("monitor", "error", error.message));
}, 5000).unref();

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
    if (url.pathname === "/api/health") return sendJson(response, 200, { ok: true, service: "codex-ops-workbench" });
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/api/summary") return sendJson(response, 200, await buildSummary());
    if (url.pathname === "/api/services") return sendJson(response, 200, await listServices());
    if (url.pathname.startsWith("/api/services/")) return handleServiceAction(request, response, url);
    if (url.pathname === "/api/codex/status") return sendJson(response, 200, await getCodexStatus());
    if (url.pathname === "/api/agents/status") return sendJson(response, 200, await getAgentStatus());
    if (url.pathname === "/api/usage/local") return sendJson(response, 200, await getLocalUsage());
    if (url.pathname === "/api/workbench/autostart") return handleWorkbenchAutostart(request, response);
    if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "method_not_allowed" });
    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: "internal_error", message: error.message });
  }
}).listen(port, host, () => {
  logEvent("workbench", "started", `http://${host}:${port}/`);
  console.log(`Codex Ops Workbench listening on http://${host}:${port}/`);
});

async function handleServiceAction(request, response, url) {
  const [, , , serviceId, action] = url.pathname.split("/");
  if (!serviceId || !action) return sendJson(response, 404, { error: "not_found" });
  const body = request.method === "POST" ? await readJsonBody(request) : {};
  const services = await loadServices();
  const service = services.find((item) => item.id === serviceId);
  if (!service) return sendJson(response, 404, { error: "unknown_service" });

  if (request.method === "GET" && action === "logs") {
    return sendJson(response, 200, { serviceId, logs: await readServiceLogs(serviceId) });
  }
  if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });

  if (action === "start") return sendJson(response, 200, await startService(service));
  if (action === "stop") return sendJson(response, 200, await stopService(service));
  if (action === "restart") {
    const stopped = await stopService(service);
    if (stopped.ok === false) return sendJson(response, 200, stopped);
    return sendJson(response, 200, await startService(service));
  }
  if (action === "autostart") {
    await updateOverride(service.id, { autostart: Boolean(body.enabled) });
    return sendJson(response, 200, { ok: true, serviceId: service.id, autostart: Boolean(body.enabled) });
  }
  if (action === "autorestart") {
    await updateOverride(service.id, { autoRestart: Boolean(body.enabled) });
    return sendJson(response, 200, { ok: true, serviceId: service.id, autoRestart: Boolean(body.enabled) });
  }
  return sendJson(response, 404, { error: "unknown_action" });
}

async function startService(service) {
  if (managed.get(service.id)?.process && isProcessAlive(managed.get(service.id).process.pid)) {
    await updateOverride(service.id, { desiredState: "running" });
    return { ok: true, serviceId: service.id, status: "running", pid: managed.get(service.id).process.pid };
  }
  const existingHealth = await checkHealth(service);
  if (existingHealth.ok) {
    await updateOverride(service.id, { desiredState: "running" });
    logEvent(service.id, "external_running", existingHealth.message);
    return { ok: true, serviceId: service.id, status: "external-running", pid: null, message: existingHealth.message };
  }
  validateServiceCommand(service);
  const cwd = resolveInsideRepo(service.cwd || ".");
  const env = { ...process.env, ...(service.env || {}), PORT: String(service.port || process.env.PORT || "") };
  const child = spawn(service.command[0], service.command.slice(1), {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  managed.set(service.id, { process: child, startedAt: new Date().toISOString(), restartCount: managed.get(service.id)?.restartCount || 0 });
  monitorState.set(service.id, monitorState.get(service.id) || { rssSamples: [], health: "unknown", failures: [] });
  await updateOverride(service.id, { desiredState: "running" });
  logEvent(service.id, "started", `pid ${child.pid}`);

  child.stdout.on("data", (chunk) => writeServiceLog(service.id, "stdout", chunk));
  child.stderr.on("data", (chunk) => writeServiceLog(service.id, "stderr", chunk));
  child.on("exit", (code, signal) => {
    logEvent(service.id, "exited", `code=${code ?? "null"} signal=${signal ?? "null"}`);
    const current = managed.get(service.id);
    if (current?.process?.pid === child.pid) managed.set(service.id, { ...current, process: null, exitedAt: new Date().toISOString() });
    scheduleRestartIfNeeded(service).catch((error) => logEvent(service.id, "restart_error", error.message));
  });
  return { ok: true, serviceId: service.id, status: "running", pid: child.pid };
}

async function stopService(service) {
  await updateOverride(service.id, { desiredState: "stopped" });
  const item = managed.get(service.id);
  if (!item?.process || !isProcessAlive(item.process.pid)) {
    const health = await checkHealth(service);
    if (health.ok) {
      return {
        ok: false,
        serviceId: service.id,
        status: "external-running",
        message: "服务由外部进程提供，工作台没有托管 PID，未执行停止。",
      };
    }
    return { ok: true, serviceId: service.id, status: "stopped" };
  }
  item.process.kill("SIGTERM");
  await wait(900);
  if (isProcessAlive(item.process.pid)) item.process.kill("SIGKILL");
  logEvent(service.id, "stopped", `pid ${item.process.pid}`);
  return { ok: true, serviceId: service.id, status: "stopped" };
}

async function scheduleRestartIfNeeded(service) {
  const overrides = await loadOverrides();
  const override = overrides.services?.[service.id] || {};
  const shouldRestart = override.desiredState === "running" && effectiveBoolean(service.autoRestartDefault, override.autoRestart);
  if (!shouldRestart) return;
  const current = managed.get(service.id) || {};
  const restartCount = (current.restartCount || 0) + 1;
  managed.set(service.id, { ...current, restartCount });
  const delayMs = Math.min(30000, 2000 * restartCount);
  logEvent(service.id, "restart_scheduled", `${delayMs}ms`);
  await wait(delayMs);
  const fresh = (await loadServices()).find((item) => item.id === service.id);
  if (fresh) await startService(fresh);
}

async function monitorServices() {
  const services = await loadServices();
  for (const service of services) {
    const state = monitorState.get(service.id) || { rssSamples: [], health: "unknown", failures: [] };
    const managedItem = managed.get(service.id);
    const pid = managedItem?.process?.pid;
    const health = await checkHealth(service);
    state.health = health.ok ? "healthy" : "unhealthy";
    state.lastHealthMessage = health.message;
    state.checkedAt = new Date().toISOString();
    if (!health.ok) state.failures = [...(state.failures || []).slice(-4), { at: state.checkedAt, message: health.message }];

    if (pid && isProcessAlive(pid)) {
      const rssMb = await getProcessRssMb(pid);
      if (rssMb !== null) {
        state.rssSamples = [...(state.rssSamples || []), { at: Date.now(), rssMb }].slice(-12);
        const leak = evaluateMemoryLeak(state.rssSamples, service);
        state.rssMb = rssMb;
        state.memoryStatus = leak.status;
        state.memoryMessage = leak.message;
        if (leak.restart) {
          logEvent(service.id, "memory_restart", leak.message);
          await stopService(service);
          await updateOverride(service.id, { desiredState: "running" });
          await startService(service);
        }
      }
    }
    monitorState.set(service.id, state);

    const overrides = await loadOverrides();
    const override = overrides.services?.[service.id] || {};
    const desired = override.desiredState;
    if (desired === "running" && !pid && effectiveBoolean(service.autoRestartDefault, override.autoRestart)) {
      await scheduleRestartIfNeeded(service);
    }
  }
}

function evaluateMemoryLeak(samples, service) {
  const latest = samples.at(-1);
  if (!latest) return { status: "unknown", message: "no rss sample", restart: false };
  const limit = Number(service.memoryLimitMb || 0);
  if (limit && latest.rssMb > limit) {
    return { status: "critical", message: `RSS ${latest.rssMb}MB exceeds ${limit}MB`, restart: true };
  }
  if (samples.length >= 6) {
    const first = samples[0];
    const growth = latest.rssMb - first.rssMb;
    const threshold = Number(service.memoryGrowthThresholdMb || 96);
    const monotonic = samples.slice(1).every((sample, index) => sample.rssMb >= samples[index].rssMb - 4);
    if (growth > threshold && monotonic) {
      return { status: "leak-risk", message: `RSS grew ${growth}MB across ${samples.length} samples`, restart: true };
    }
  }
  return { status: "ok", message: `RSS ${latest.rssMb}MB`, restart: false };
}

async function listServices() {
  const services = await loadServices();
  return {
    services: await Promise.all(
      services.map(async (service) => {
        const item = managed.get(service.id);
        const pid = item?.process?.pid || null;
        const monitor = monitorState.get(service.id) || {};
        const health = await checkHealth(service);
        return {
          ...withoutCommandSecrets(service),
          commandPreview: service.command.join(" "),
          pid,
          managed: Boolean(pid && isProcessAlive(pid)),
          runtimeStatus: pid && isProcessAlive(pid) ? "running" : health.ok ? "external-running" : "stopped",
          health: health.ok ? "healthy" : "unhealthy",
          healthMessage: health.message,
          startedAt: item?.startedAt || null,
          restartCount: item?.restartCount || 0,
          rssMb: monitor.rssMb || null,
          memoryStatus: monitor.memoryStatus || "unknown",
          memoryMessage: monitor.memoryMessage || "未采样",
          failures: monitor.failures || [],
          recentEvents: eventLog.filter((entry) => entry.scope === service.id).slice(-8),
        };
      }),
    ),
  };
}

async function buildSummary() {
  const serviceList = await listServices();
  const codex = await getCodexStatus();
  const agents = await getAgentStatus();
  const usage = await getLocalUsage();
  const healthy = serviceList.services.filter((service) => service.health === "healthy").length;
  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    codexHome: codeHome,
    serviceHealth: { total: serviceList.services.length, healthy, unhealthy: serviceList.services.length - healthy },
    codex: {
      running: codex.processes.length > 0,
      configPresent: codex.config.present,
      automations: codex.automations.count,
      plugins: codex.plugins.count,
      skills: codex.skills.count,
    },
    agents: { total: agents.roles.length, configured: agents.roles.filter((role) => role.present).length },
    usage: usage.summary,
    events: eventLog.slice(-12),
  };
}

async function getCodexStatus() {
  const configPath = join(codeHome, "config.toml");
  const projectConfigPath = join(repoRoot, ".codex", "config.toml");
  const processes = await listProcesses(["Codex", "codex"]);
  return {
    codexHome: codeHome,
    processes,
    config: await fileSummary(configPath),
    projectConfig: await fileSummary(projectConfigPath),
    automations: await directorySummary(join(codeHome, "automations")),
    plugins: await directorySummary(join(codeHome, "plugins")),
    skills: await directorySummary(join(codeHome, "skills")),
    sessions: await directorySummary(join(codeHome, "sessions")),
    mcpConfigHints: await extractConfigHints(configPath, ["mcp_servers", "plugins", "features", "model", "sandbox_mode", "approval_policy"]),
  };
}

async function getAgentStatus() {
  const roles = [
    ["product", "agents/roles/product-agent.md"],
    ["development", "agents/roles/development-agent.md"],
    ["testing", "agents/roles/testing-agent.md"],
    ["review", "agents/roles/review-agent.md"],
    ["critic", "agents/roles/critic-agent.md"],
  ];
  return {
    roles: await Promise.all(
      roles.map(async ([id, path]) => {
        const absolute = resolve(repoRoot, path);
        const summary = await fileSummary(absolute);
        return { id, name: toTitle(id), path, present: summary.present, updatedAt: summary.updatedAt, size: summary.size };
      }),
    ),
    workflow: await fileSummary(resolve(repoRoot, "agents/workflows/agile-testcase-generation.md")),
    prompt: await fileSummary(resolve(repoRoot, "agents/prompts/agile-testcase-generation.md")),
    binding: await fileSummary(resolve(repoRoot, "agents/skill-bindings/agile-testcase-generation.yaml")),
    recentArtifacts: await listRecentFiles(resolve(repoRoot, "artifacts"), 8),
  };
}

async function getLocalUsage() {
  const candidates = [
    join(codeHome, "logs"),
    join(codeHome, "sessions"),
    join(codeHome, "codex.log"),
  ];
  const files = [];
  for (const candidate of candidates) {
    files.push(...(await collectFiles(candidate, 80)));
  }
  let apiRequests = 0;
  let tokenInputs = 0;
  let tokenOutputs = 0;
  let errors = 0;
  let ignoredLargeTokenFields = 0;
  const modelCounts = new Map();
  for (const file of files.slice(0, 120)) {
    const text = await safeReadText(file, 256000);
    if (!text) continue;
    apiRequests += countMatches(text, "codex.api_request");
    errors += countMatches(text, "\"error\"");
    for (const match of text.matchAll(/"model"\s*:\s*"([^"]+)"/g)) modelCounts.set(match[1], (modelCounts.get(match[1]) || 0) + 1);
    for (const match of text.matchAll(/"input_tokens"\s*:\s*(\d+)/g)) {
      const value = Number(match[1]);
      if (value <= 2000000) tokenInputs += value;
      else ignoredLargeTokenFields += 1;
    }
    for (const match of text.matchAll(/"output_tokens"\s*:\s*(\d+)/g)) {
      const value = Number(match[1]);
      if (value <= 2000000) tokenOutputs += value;
      else ignoredLargeTokenFields += 1;
    }
  }
  return {
    source: "local_codex_logs_estimate",
    note: "本地估算只扫描 CODEX_HOME 日志/会话文件；准确 credit/token 需要接入官方 Analytics API 或平台账单数据。",
    summary: {
      scannedFiles: files.length,
      apiRequests,
      tokenInputs,
      tokenOutputs,
      errors,
      ignoredLargeTokenFields,
      topModels: [...modelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([model, count]) => ({ model, count })),
    },
  };
}

async function handleWorkbenchAutostart(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
  const body = await readJsonBody(request);
  const action = body.action || "install";
  const label = "com.qianli.codex-ops-workbench";
  const plistPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  if (action === "uninstall") {
    await runLaunchctl(["bootout", `gui/${process.getuid()}`, plistPath]).catch(() => null);
    await rm(plistPath, { force: true });
    return sendJson(response, 200, { ok: true, action, plistPath });
  }
  const plist = buildLaunchAgentPlist(label);
  await mkdir(dirname(plistPath), { recursive: true });
  await writeFile(plistPath, plist, "utf8");
  await runLaunchctl(["bootstrap", `gui/${process.getuid()}`, plistPath]).catch(async () => {
    await runLaunchctl(["kickstart", "-k", `gui/${process.getuid()}/${label}`]);
  });
  return sendJson(response, 200, { ok: true, action: "install", plistPath, label });
}

function buildLaunchAgentPlist(label) {
  const command = `cd ${shellQuote(workbenchDir)} && PORT=${port} node server.mjs`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${escapeXml(command)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(join(logDir, "launchd.out.log"))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(join(logDir, "launchd.err.log"))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_HOME</key><string>${escapeXml(codeHome)}</string>
  </dict>
</dict>
</plist>
`;
}

async function loadServices() {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const overrides = await loadOverrides();
  return (registry.services || []).map((service) => {
    const override = overrides.services?.[service.id] || {};
    return {
      ...service,
      autostart: effectiveBoolean(service.autostartDefault, override.autostart),
      autoRestart: effectiveBoolean(service.autoRestartDefault, override.autoRestart),
      desiredState: override.desiredState || "stopped",
    };
  });
}

async function autostartRegisteredServices() {
  const services = await loadServices();
  for (const service of services) {
    if (service.id !== "codex-ops-workbench" && service.autostart) {
      startService(service).catch((error) => logEvent(service.id, "autostart_error", error.message));
    }
  }
}

async function loadOverrides() {
  await ensureOverrides();
  return JSON.parse(await readFile(overridesPath, "utf8"));
}

async function ensureOverrides() {
  await mkdir(runtimeDir, { recursive: true });
  try {
    await readFile(overridesPath, "utf8");
  } catch {
    await writeFile(overridesPath, JSON.stringify({ services: {} }, null, 2));
  }
}

async function updateOverride(serviceId, patch) {
  const overrides = await loadOverrides();
  overrides.services ||= {};
  overrides.services[serviceId] = { ...(overrides.services[serviceId] || {}), ...patch };
  await writeFile(overridesPath, JSON.stringify(overrides, null, 2));
}

async function checkHealth(service) {
  if (!service.healthCheck) return { ok: false, message: "no health check configured" };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1600);
    const response = await fetch(service.healthCheck, { signal: controller.signal });
    clearTimeout(timeout);
    return { ok: response.ok, message: `${response.status} ${response.statusText}` };
  } catch (error) {
    return { ok: false, message: error.name === "AbortError" ? "health check timeout" : error.message };
  }
}

async function serveStatic(pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(workbenchDir, relativePath);
  if (!filePath.startsWith(workbenchDir)) return sendJson(response, 403, { error: "forbidden" });
  try {
    const data = await readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes.get(extname(filePath)) || "application/octet-stream" });
    response.end(data);
  } catch {
    sendJson(response, 404, { error: "not_found" });
  }
}

function validateServiceCommand(service) {
  if (!Array.isArray(service.command) || !service.command.length) throw new Error("service command must be an array");
  if (service.command.some((part) => /[;&|`$<>]/.test(part))) throw new Error("unsafe command token in service registry");
  resolveInsideRepo(service.cwd || ".");
}

function resolveInsideRepo(pathname) {
  const resolved = resolve(repoRoot, pathname);
  if (!resolved.startsWith(repoRoot)) throw new Error(`path escapes repo: ${pathname}`);
  return resolved;
}

function withoutCommandSecrets(service) {
  const { env, ...rest } = service;
  return rest;
}

async function writeServiceLog(serviceId, stream, chunk) {
  const line = `[${new Date().toISOString()}] ${stream}: ${chunk.toString()}`;
  await appendFile(join(logDir, `${serviceId}.log`), line).catch(() => null);
}

async function readServiceLogs(serviceId) {
  const text = await safeReadText(join(logDir, `${serviceId}.log`), 90000);
  return text ? text.split(/\r?\n/).slice(-300) : [];
}

function logEvent(scope, type, message) {
  eventLog.push({ at: new Date().toISOString(), scope, type, message });
  if (eventLog.length > 300) eventLog.shift();
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fileSummary(pathname) {
  try {
    const info = await stat(pathname);
    return { path: pathname, present: true, size: info.size, updatedAt: info.mtime.toISOString() };
  } catch {
    return { path: pathname, present: false };
  }
}

async function directorySummary(pathname) {
  try {
    const entries = await readdir(pathname, { withFileTypes: true });
    return { path: pathname, present: true, count: entries.length, entries: entries.slice(0, 20).map((entry) => entry.name) };
  } catch {
    return { path: pathname, present: false, count: 0, entries: [] };
  }
}

async function listRecentFiles(pathname, limit) {
  const files = await collectFiles(pathname, 100);
  const summaries = await Promise.all(files.map((file) => fileSummary(file)));
  return summaries
    .filter((item) => item.present)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit)
    .map((item) => ({ ...item, path: relative(repoRoot, item.path) }));
}

async function collectFiles(pathname, limit, depth = 0) {
  try {
    const info = await stat(pathname);
    if (info.isFile()) return [pathname];
    if (!info.isDirectory() || depth > 3) return [];
    const entries = await readdir(pathname, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      files.push(...(await collectFiles(join(pathname, entry.name), limit - files.length, depth + 1)));
      if (files.length >= limit) break;
    }
    return files;
  } catch {
    return [];
  }
}

async function safeReadText(pathname, maxBytes = 64000) {
  try {
    const data = await readFile(pathname);
    return data.subarray(Math.max(0, data.length - maxBytes)).toString("utf8");
  } catch {
    return "";
  }
}

async function extractConfigHints(pathname, keys) {
  const text = await safeReadText(pathname, 200000);
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((line) => keys.some((key) => line.text.includes(key)))
    .slice(0, 60);
}

async function listProcesses(patterns) {
  const output = await execFileText("ps", ["-axo", "pid,comm,args"]);
  return output
    .split(/\r?\n/)
    .filter((line) => patterns.some((pattern) => line.toLowerCase().includes(pattern.toLowerCase())))
    .filter((line) => !line.includes("ps -axo"))
    .slice(0, 20)
    .map((line) => truncateMiddle(line.trim(), 220));
}

async function getProcessRssMb(pid) {
  try {
    const output = await execFileText("ps", ["-o", "rss=", "-p", String(pid)]);
    const kb = Number(output.trim());
    return Number.isFinite(kb) ? Math.round(kb / 1024) : null;
  } catch {
    return null;
  }
}

function execFileText(command, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolvePromise(stdout);
    });
  });
}

function runLaunchctl(args) {
  return execFileText("launchctl", args);
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function effectiveBoolean(defaultValue, overrideValue) {
  return typeof overrideValue === "boolean" ? overrideValue : Boolean(defaultValue);
}

function countMatches(text, needle) {
  return text.split(needle).length - 1;
}

function toTitle(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function truncateMiddle(value, maxLength) {
  if (value.length <= maxLength) return value;
  const keep = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
