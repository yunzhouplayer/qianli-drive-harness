const baseUrl = process.env.WORKBENCH_URL || "http://127.0.0.1:8777";

const checks = [
  ["/api/health", (json) => json.ok === true],
  ["/api/summary", (json) => Boolean(json.repoRoot && json.serviceHealth)],
  ["/api/services", (json) => Array.isArray(json.services) && json.services.length >= 1],
  ["/api/codex/status", (json) => Boolean(json.codexHome && json.config)],
  ["/api/agents/status", (json) => Array.isArray(json.roles) && json.roles.length === 5],
  ["/api/usage/local", (json) => Boolean(json.summary && json.source)],
];

let failed = 0;
for (const [path, validate] of checks) {
  const response = await fetch(`${baseUrl}${path}`);
  const json = await response.json();
  const ok = response.ok && validate(json);
  console.log(`${ok ? "ok" : "fail"} ${path}`);
  if (!ok) failed += 1;
}

if (failed) {
  console.error(`${failed} smoke checks failed`);
  process.exit(1);
}

console.log("Codex Ops Workbench smoke checks passed");
