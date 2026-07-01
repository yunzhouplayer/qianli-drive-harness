#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { executeMockCase } from "../adapters/mock/mock-adapter.mjs";
import { evaluateValidators } from "../validators/business/business-validators.mjs";
import {
  REPO_ROOT,
  isEnabled,
  normalizeList,
  normalizeRepoPath,
  parseArgs,
  readYaml,
  resolveRepoPath,
  writeJson,
  writeYaml,
} from "./harness-io.mjs";

main().catch((error) => {
  console.error(error.stack || `[execution-runner] ${error.message}`);
  process.exit(2);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  normalizeAliasArgs(args);
  if (args.help || !args.case) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const startedAt = new Date().toISOString();
  const runId = args.runId || buildRunId(startedAt);
  const outDir = normalizeRepoPath(args.outDir || path.join("output/harness/execution-runs", runId));
  const evidenceDir = path.join(outDir, "evidence");
  const reportDir = path.join(outDir, "reports");
  const gateDir = path.join(outDir, "gates");

  const casePath = normalizeRepoPath(args.case);
  const caseAsset = readYaml(casePath);
  const fixturePath = normalizeRepoPath(args.fixture || caseAsset.fixture || "");
  const fixture = fixturePath ? readYaml(fixturePath) : {};
  const validatorPaths = normalizeList(args.validator || args.validators || caseAsset.validators || []);
  const validators = validatorPaths.map((validatorPath) => ({
    path: normalizeRepoPath(validatorPath),
    asset: readYaml(validatorPath),
  }));

  if (!fixturePath) throw new Error("Case must reference a fixture or --fixture must be provided.");
  if (validators.length === 0) throw new Error("Case must reference at least one validator or --validator must be provided.");
  if ((args.adapter || "mock") !== "mock") throw new Error(`Unsupported adapter: ${args.adapter}`);

  const adapterResult = await executeMockCase({ caseAsset, fixture, runId, startedAt });
  const validatorResults = evaluateValidators({ validators, caseAsset, adapterResult });
  const status = validatorResults.every((item) => item.status === "passed") ? "passed" : "failed";
  const evidence = buildEvidence({
    runId,
    casePath,
    caseAsset,
    fixturePath,
    fixture,
    validators,
    validatorResults,
    adapterResult,
    startedAt,
    outDir,
  });
  const report = buildReport({
    runId,
    casePath,
    caseAsset,
    fixturePath,
    validators,
    validatorResults,
    adapterResult,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    outDir,
  });

  const evidenceJsonPath = path.join(evidenceDir, "execution-evidence.json");
  const evidenceYamlPath = path.join(evidenceDir, "execution-evidence.yaml");
  const validatorResultsPath = path.join(evidenceDir, "validator-results.json");
  const reportJsonPath = path.join(reportDir, "execution-report.json");
  const reportYamlPath = path.join(reportDir, "execution-report.yaml");

  writeJson(evidenceJsonPath, evidence);
  writeYaml(evidenceYamlPath, evidence);
  writeJson(validatorResultsPath, { run_id: runId, case_id: caseAsset.id, results: validatorResults });
  writeJson(reportJsonPath, report);
  writeYaml(reportYamlPath, report);

  let gateResult = null;
  if (isEnabled(args.gate)) {
    const gateResultPath = path.join(gateDir, `${caseAsset.id || "case"}.gate-result.yaml`);
    gateResult = runGateRunner({
      casePath,
      scenarioPath: normalizeRepoPath(args.scenario || caseAsset.scenario || ""),
      fixturePath,
      validatorPaths,
      evidencePath: evidenceJsonPath,
      outPath: gateResultPath,
      runId,
      trigger: args.trigger || "manual",
      actor: args.actor || "execution-runner",
    });
  }

  const summary = {
    run_id: runId,
    case_id: caseAsset.id || "",
    status,
    adapter: args.adapter || "mock",
    outputs: {
      evidence_json: evidenceJsonPath,
      evidence_yaml: evidenceYamlPath,
      validator_results_json: validatorResultsPath,
      report_json: reportJsonPath,
      report_yaml: reportYamlPath,
      gate_result_yaml: gateResult?.outPath || "",
    },
    validators: validatorResults.map((item) => ({
      id: item.validator_id,
      status: item.status,
      failed_rules: item.failed_rules,
    })),
    gate: gateResult ? {
      exit_code: gateResult.exitCode,
      decision: gateResult.decision,
    } : null,
  };
  writeJson(path.join(outDir, "execution-summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));

  if (status !== "passed") process.exit(1);
}

function buildEvidence({ runId, casePath, caseAsset, fixturePath, fixture, validators, validatorResults, adapterResult, startedAt, outDir }) {
  const evidenceItems = [
    {
      id: "EV-EXECUTION-LOG-001",
      type: "operation_log",
      ref: path.join(outDir, "evidence", "execution-evidence.json"),
      description: "Mock adapter operation log and observations.",
      produced_by: "harness_runtime",
      related_step: "all",
      related_validator_rule: "",
      checksum: checksum(adapterResult.operation_log),
      retention: { required: true, days: 180 },
    },
    {
      id: "EV-STATE-SNAPSHOT-001",
      type: "state_snapshot",
      ref: path.join(outDir, "evidence", "execution-evidence.json"),
      description: "Mock adapter final state snapshot.",
      produced_by: "mock_adapter",
      related_step: "all",
      related_validator_rule: "",
      checksum: checksum(adapterResult.state_snapshot),
      retention: { required: true, days: 180 },
    },
    {
      id: "EV-VALIDATOR-RESULT-001",
      type: "validator_result",
      ref: path.join(outDir, "evidence", "validator-results.json"),
      description: "Deterministic validator results.",
      produced_by: "business_validator",
      related_step: "all",
      related_validator_rule: validatorResults.flatMap((item) => item.rule_results.map((rule) => rule.rule_id)).join(","),
      checksum: checksum(validatorResults),
      retention: { required: true, days: 180 },
    },
  ];

  return {
    template_id: "TPL-EVIDENCE-001",
    version: "v1",
    artifact_type: "evidence",
    stage: "test_execution_evidence",
    evidence: {
      evidence_id: `EVIDENCE-${runId}-${caseAsset.id || "CASE"}`,
      run_id: runId,
      case_id: caseAsset.id || "",
      scenario_id: caseAsset.scenario || "",
      collected_at: startedAt,
      collector: {
        type: "harness_runtime",
        id: "execution-runner.mjs",
      },
      environment: {
        target: fixture.environment?.target || caseAsset.execution?.environment || "local",
        build_version: "",
        app_version: "",
        data_scope: fixture.data_scope || "synthetic",
      },
      source_assets: {
        case: casePath,
        fixture: fixturePath,
        validators: validators.map((item) => item.path),
      },
      items: evidenceItems,
      validator_results: validatorResults.map((item) => ({
        validator_id: item.validator_id,
        status: item.status,
        passed_rules: item.passed_rules,
        failed_rules: item.failed_rules,
        evidence_item_refs: ["EV-VALIDATOR-RESULT-001"],
      })),
      adapter_result: adapterResult,
      diagnostics: adapterResult.diagnostics,
      privacy: {
        contains_pii: false,
        desensitized: true,
        sensitive_fields: [],
      },
      integrity: {
        immutable_after_report: true,
        checksum_algorithm: "sha256",
        checksum: checksum({ adapterResult, validatorResults }),
      },
    },
    quality_checks: {
      evidence_type_declared: "passed",
      evidence_ref_or_plan_present: "passed",
      validator_result_linked: validatorResults.length > 0 ? "passed" : "failed",
      pii_policy_declared: "passed",
      retention_declared: "passed",
    },
    review: {
      status: "draft",
      reviewers: [],
      findings: [],
    },
  };
}

function buildReport({ runId, casePath, caseAsset, fixturePath, validators, validatorResults, adapterResult, status, startedAt, finishedAt, outDir }) {
  const failed = status === "passed" ? 0 : 1;
  return {
    id: `REPORT-${runId}-${caseAsset.id || "CASE"}`,
    version: "v1",
    execution: {
      run_id: runId,
      started_at: startedAt,
      finished_at: finishedAt,
      environment: caseAsset.execution?.environment || "mock",
      trigger: "manual",
      adapter: "mock",
    },
    summary: {
      status,
      total_cases: 1,
      passed: status === "passed" ? 1 : 0,
      failed,
      blocked: 0,
    },
    results: [
      {
        case_id: caseAsset.id || "",
        case_ref: casePath,
        fixture_ref: fixturePath,
        status,
        validators: validatorResults.map((item) => ({
          validator_id: item.validator_id,
          status: item.status,
          passed_rules: item.passed_rules,
          failed_rules: item.failed_rules,
        })),
      },
    ],
    evidence: [
      { type: "execution_evidence", ref: path.join(outDir, "evidence", "execution-evidence.json") },
      { type: "validator_result", ref: path.join(outDir, "evidence", "validator-results.json") },
    ],
    risks: buildReportRisks({ status, validators, validatorResults }),
    recommendations: buildRecommendations({ status, adapterResult }),
  };
}

function buildReportRisks({ status, validators, validatorResults }) {
  const risks = [];
  if (status !== "passed") {
    risks.push({ level: "P1", description: "存在未通过的确定性 validator，不能进入准出。" });
  }
  if (validators.some((item) => item.path.includes("/business/"))) {
    risks.push({ level: "P3", description: "当前为 mock adapter 离线执行结果，仍需真实系统 adapter 验证。" });
  }
  for (const result of validatorResults.filter((item) => item.status !== "passed")) {
    risks.push({ level: "P2", description: `${result.validator_id} failed: ${result.failed_rules.join(", ")}` });
  }
  return risks.length ? risks : [{ level: "P3", description: "未识别阻断风险；mock 结果仅作为 Harness 链路验证。" }];
}

function buildRecommendations({ status, adapterResult }) {
  const recommendations = [];
  if (status !== "passed") recommendations.push("修复失败 validator 后重新执行。");
  if (adapterResult.adapter?.mode === "offline") recommendations.push("接入真实 OMS/RAS/乘客端 adapter 后补充真实执行证据。");
  return recommendations;
}

function runGateRunner({ casePath, scenarioPath, fixturePath, validatorPaths, evidencePath, outPath, runId, trigger, actor }) {
  const args = [
    "vv-automation/harness/runtime/gate-runner.mjs",
    "--asset", casePath,
    "--fixture", fixturePath,
    "--evidence", evidencePath,
    "--out", outPath,
    "--runId", runId,
    "--trigger", trigger,
    "--actor", actor,
  ];
  if (scenarioPath) args.push("--scenario", scenarioPath);
  for (const validatorPath of validatorPaths) args.push("--validator", validatorPath);

  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) {
    throw new Error(`gate-runner failed with exit ${result.status}: ${result.stderr || result.stdout}`);
  }
  return {
    outPath,
    exitCode: result.status,
    decision: parseGateDecision(outPath),
  };
}

function parseGateDecision(gateResultPath) {
  const fullPath = resolveRepoPath(gateResultPath);
  if (!fs.existsSync(fullPath)) return "";
  const text = fs.readFileSync(fullPath, "utf8");
  return (text.match(/\n\s*decision:\n(?:.*\n)*?\s{4}status:\s*"?([^"\n]+)"?/) || [])[1] || "";
}

function checksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildRunId(now) {
  const compact = now.replace(/\D/g, "").slice(0, 14);
  return `RUN-${compact}`;
}

function normalizeAliasArgs(args) {
  if (args["out-dir"] && !args.outDir) args.outDir = args["out-dir"];
  if (args["run-id"] && !args.runId) args.runId = args["run-id"];
}

function printUsage() {
  console.log(`Usage:
  node vv-automation/harness/runtime/execution-runner.mjs \\
    --case vv-automation/harness/assets/cases/mock-runtime-smoke.case.yaml \\
    --adapter mock \\
    --out-dir output/harness/execution-smoke \\
    --gate true
`);
}
