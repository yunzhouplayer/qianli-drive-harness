#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import {
  REPO_ROOT,
  isEnabled,
  normalizeRepoPath,
  parseArgs,
  readJson,
  resolveRepoPath,
  writeYaml,
} from "./harness-io.mjs";

main().catch((error) => {
  console.error(error.stack || `[harness-smoke] ${error.message}`);
  process.exit(2);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  normalizeAliasArgs(args);
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const runId = args.runId || "RUN-HARNESS-SMOKE-001";
  const workDir = normalizeRepoPath(args.workDir || "vv-automation/harness/reports/harness-smoke");
  if (isEnabled(args.clean) || args.clean === undefined) {
    fs.rmSync(resolveRepoPath(workDir), { recursive: true, force: true });
  }
  const assetsDir = path.join(workDir, "assets");
  fs.mkdirSync(resolveRepoPath(assetsDir), { recursive: true });

  const sourcePath = path.join(assetsDir, "mock-requirement.md");
  fs.writeFileSync(resolveRepoPath(sourcePath), [
    "# Harness Mock Smoke Requirement",
    "",
    "乘客端订单到站状态需要同步到 OMS 和乘客端；站点推荐需要返回历史、热门、附近站点；短信和小程序 Push 需要触达成功。",
    "",
  ].join("\n"), "utf8");

  const scenarioPath = path.join(assetsDir, "mock-runtime-smoke.scenario.yaml");
  const fixturePath = path.join(assetsDir, "mock-runtime-smoke.fixture.yaml");
  const casePath = path.join(assetsDir, "mock-runtime-smoke.case.yaml");
  writeYaml(scenarioPath, buildScenario({ casePath, sourcePath }));
  writeYaml(fixturePath, buildFixture());
  writeYaml(casePath, buildCase({ scenarioPath, fixturePath, sourcePath }));

  const execution = runExecutionRunner({
    casePath,
    workDir,
    runId,
  });
  const summary = readJson(path.join(workDir, "execution-summary.json"));
  assertSmoke(summary);

  const smokeSummary = {
    run_id: runId,
    status: "passed",
    work_dir: workDir,
    assets: {
      case: casePath,
      fixture: fixturePath,
      scenario: scenarioPath,
    },
    execution,
    assertions: {
      execution_status: summary.status,
      validator_count: summary.validators.length,
      validators_passed: summary.validators.every((item) => item.status === "passed"),
      gate_decision: summary.gate?.decision || "",
    },
    outputs: summary.outputs,
  };
  fs.writeFileSync(resolveRepoPath(path.join(workDir, "harness-smoke-summary.json")), `${JSON.stringify(smokeSummary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(smokeSummary, null, 2));
}

function runExecutionRunner({ casePath, workDir, runId }) {
  const result = spawnSync(process.execPath, [
    "vv-automation/harness/runtime/execution-runner.mjs",
    "--case", casePath,
    "--adapter", "mock",
    "--out-dir", workDir,
    "--run-id", runId,
    "--gate", "true",
    "--trigger", "manual",
    "--actor", "harness-smoke",
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`execution-runner failed with exit ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return {
    exit_code: result.status,
    stdout: result.stdout.trim(),
  };
}

function assertSmoke(summary) {
  if (summary.status !== "passed") throw new Error(`Expected execution status passed, got ${summary.status}`);
  if (!summary.validators || summary.validators.length !== 3) throw new Error(`Expected 3 validators, got ${summary.validators?.length || 0}`);
  const failed = summary.validators.filter((item) => item.status !== "passed");
  if (failed.length > 0) throw new Error(`Expected all validators passed, failed: ${failed.map((item) => item.id).join(", ")}`);
  if (!summary.gate || summary.gate.decision !== "passed") throw new Error(`Expected gate decision passed, got ${summary.gate?.decision || "missing"}`);
}

function buildScenario({ casePath, sourcePath }) {
  return {
    id: "SCN-HARNESS-MOCK-RUNTIME-SMOKE-001",
    version: "v1",
    title: "Harness mock adapter 最小执行闭环",
    description: "覆盖订单状态、站点推荐、短信/Push 三类确定性 validator 的本地 mock smoke。",
    domain: "mobile_passenger",
    source: { type: "manual_design", ref: sourcePath },
    risk: { level: "P1", impact_tags: ["order_lifecycle", "passenger_experience", "ci_ct_stability"] },
    coverage: { target: "harness runtime smoke", dimensions: ["order_status", "station_recommendation", "notification_delivery"] },
    cases: [casePath],
    owner: "qa-platform",
    tags: ["harness-smoke", "mock-adapter"],
    created_by: "human",
    review: { status: "approved", reviewers: ["qa-owner"] },
  };
}

function buildFixture() {
  return {
    id: "FIXTURE-HARNESS-MOCK-RUNTIME-SMOKE-001",
    version: "v1",
    title: "Harness mock adapter smoke 合成数据",
    description: "准备乘客、订单、车辆和站点推荐所需的合成上下文。",
    data_scope: "synthetic",
    isolation: { strategy: "unique_ids", collision_policy: "fail_fast" },
    environment: { target: "mock", region: "shanghai_test_region", network_profile: "normal" },
    entities: [
      { id: "passenger_smoke_001", type: "passenger", initial_state: "waiting_for_pickup" },
      { id: "vehicle_smoke_001", type: "vehicle", initial_state: "PICKING_UP" },
      { id: "order_smoke_001", type: "order", initial_state: "PICKING_UP" },
    ],
    secrets: { required: false, source: "external_secret_manager" },
    cleanup: { required: true, actions: ["reset_mock_state", "purge_mock_evidence"] },
    safety: { production_safe: false, pii_allowed: false, notes: "仅使用合成数据。" },
    review: { status: "approved" },
  };
}

function buildCase({ scenarioPath, fixturePath, sourcePath }) {
  return {
    id: "CASE-HARNESS-MOCK-RUNTIME-SMOKE-001",
    version: "v1",
    title: "mock adapter 验证订单到站、站点推荐、短信和 Push 触达",
    description: "通过本地 mock adapter 验证 Harness 执行层、evidence、report 和业务 validator 最小闭环。",
    scenario: scenarioPath,
    source: { type: "manual_design", ref: sourcePath },
    traceability: {
      requirement_ids: ["REQ-HARNESS-MOCK-SMOKE-001"],
      function_point_ids: ["TP-HARNESS-MOCK-SMOKE-001"],
    },
    execution: {
      type: "mock",
      environment: "mock",
      timeout_seconds: 60,
      retry: { enabled: false, max_attempts: 1 },
    },
    fixture: fixturePath,
    preconditions: ["使用 synthetic fixture，不访问真实系统和生产数据。"],
    steps: [
      { name: "初始化订单和车辆", action: "prepare_fixture", expected_observation: "订单处于 PICKING_UP，车辆处于接驾中。" },
      { name: "注入车辆到站事件", action: "emit_vehicle_arrived_event", expected_observation: "订单状态在 30 秒内同步为 ARRIVED。" },
      { name: "请求站点推荐", action: "request_station_recommendations", expected_observation: "返回历史、热门、附近站点且无重复。" },
      { name: "触发短信和 Push", action: "send_sms_and_push", expected_observation: "短信和小程序 Push 均触达成功并包含模板 ID。" },
    ],
    validators: [
      "vv-automation/harness/validators/business/order-status-transition.validator.yaml",
      "vv-automation/harness/validators/business/station-recommendation.validator.yaml",
      "vv-automation/harness/validators/business/notification-delivery.validator.yaml",
    ],
    expected_result: {
      summary: "订单到站状态、站点推荐、短信和小程序 Push 触达均满足 mock validator。",
      evidence: ["operation_log", "state_snapshot", "validator_result"],
    },
    risk: { level: "P1", impact_tags: ["order_lifecycle", "passenger_experience", "ci_ct_stability"] },
    tags: ["harness-smoke", "mock-adapter", "runtime"],
    created_by: "human",
    review: { status: "approved", reviewed_by: "qa-owner", decision: "approve", reason: "Harness smoke fixture." },
  };
}

function normalizeAliasArgs(args) {
  if (args["work-dir"] && !args.workDir) args.workDir = args["work-dir"];
  if (args["run-id"] && !args.runId) args.runId = args["run-id"];
}

function printUsage() {
  console.log(`Usage:
  node vv-automation/harness/runtime/harness-smoke.mjs

Options:
  --work-dir vv-automation/harness/reports/harness-smoke
  --clean true
`);
}
