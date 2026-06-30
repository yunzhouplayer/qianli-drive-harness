#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = findRepoRoot(process.cwd());

const NOISE_PATTERNS = [
  /^(背景|目标|文档|版本号|变更|产品概述|需求背景|产品架构|云端交互|页面说明|主流程交互|主视觉原型|逻辑描述|待办|依赖项|负责人|时间|需求内容)/,
  /(何高|徐天鸣|董强|张天佐|雷官瑜|高振旭)/,
  /(应具备明确输入、处理结果和用户可见反馈)/,
  /^异常输入或前置条件不满足时/,
];

const SPECIFIC_SIGNALS = [
  "登录",
  "安全",
  "跑马灯",
  "解锁",
  "空调",
  "座椅",
  "反馈",
  "上传",
  "途经点",
  "路径规划",
  "分享",
  "站点",
  "历史",
  "热门",
  "消息",
  "订阅",
  "模板",
  "弹窗",
  "短信",
  "回调",
  "messageId",
  "sms_code",
];

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["out-dir"] && !args.outDir) args.outDir = args["out-dir"];
  if (args["sample-limit"] && !args.sampleLimit) args.sampleLimit = args["sample-limit"];
  if (args.help || !args.input || !args.outDir) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const inputPath = path.resolve(REPO_ROOT, args.input);
  const outDir = path.resolve(REPO_ROOT, args.outDir);
  const artifacts = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  fs.mkdirSync(outDir, { recursive: true });

  const converted = convertCandidates(artifacts, args);
  writeYaml(path.join(outDir, "accepted-requirements.yaml"), converted.requirements);
  writeYaml(path.join(outDir, "accepted-function-points.yaml"), converted.functionPoints);
  writeYaml(path.join(outDir, "accepted-test-cases.yaml"), converted.cases);
  writeYaml(path.join(outDir, "rejected-candidates.yaml"), converted.rejected);
  writeYaml(path.join(outDir, "candidate-quality-report.yaml"), converted.report);
  writeYaml(path.join(outDir, "review-queue.yaml"), converted.reviewQueue);
  writeJson(path.join(outDir, "review-queue.json"), converted.reviewQueue);
  writeYaml(path.join(outDir, "runtime-fixture.asset.yaml"), converted.fixture);
  writeYaml(path.join(outDir, "runtime-validator.asset.yaml"), converted.validator);
  writeYaml(path.join(outDir, "scenario.asset.yaml"), converted.scenario);

  if (converted.individualCases.length) {
    const caseDir = path.join(outDir, "case-samples");
    fs.mkdirSync(caseDir, { recursive: true });
    for (const item of converted.individualCases.slice(0, Number(args.sampleLimit || 5))) {
      writeYaml(path.join(caseDir, `${item.id}.case.yaml`), item);
    }
  }

  console.log(JSON.stringify(converted.report.summary, null, 2));
}

function convertCandidates(artifacts, args) {
  const feature = args.feature || "PRD 候选用例";
  const outDirRepoPath = normalizeRepoPath(args.outDir);
  const requirementByAcceptance = new Map((artifacts.review?.acceptanceCriteria || []).map((item) => [item.id, item.sourceRef]));
  const requirementById = new Map((artifacts.review?.requirementUnits || []).map((item) => [item.id, item]));
  const pointById = new Map((artifacts.testPoints?.points || []).map((item) => [item.id, item]));

  const acceptedCases = [];
  const rejected = [];
  const seenFingerprints = new Map();

  for (const candidate of artifacts.cases || []) {
    const decision = evaluateCandidate(candidate, pointById, requirementByAcceptance);
    if (!decision.accepted) {
      rejected.push(rejectedCandidate(candidate, decision.reasons, decision.gates));
      continue;
    }

    const fingerprint = buildFingerprint(candidate);
    if (seenFingerprints.has(fingerprint)) {
      rejected.push(rejectedCandidate(candidate, [`duplicate_with:${seenFingerprints.get(fingerprint)}`], { duplicate_gate: "failed" }));
      continue;
    }
    seenFingerprints.set(fingerprint, candidate.id);
    acceptedCases.push(candidate);
  }

  const acceptedPointIds = new Set(acceptedCases.flatMap((item) => item.sourceRefs || []).filter((ref) => pointById.has(ref)));
  const acceptedRequirementIds = new Set();
  for (const candidate of acceptedCases) {
    for (const ref of candidate.sourceRefs || []) {
      if (requirementByAcceptance.has(ref)) acceptedRequirementIds.add(requirementByAcceptance.get(ref));
      if (ref.startsWith("REQ-")) acceptedRequirementIds.add(ref);
    }
  }

  const acceptedRequirements = [...acceptedRequirementIds].map((id) => requirementById.get(id)).filter(Boolean);
  const acceptedPoints = [...acceptedPointIds].map((id) => pointById.get(id)).filter(Boolean);
  const scenarioId = "SCN-CANDIDATE-HARNESS-001";
  const fixtureId = "FIXTURE-CANDIDATE-HARNESS-001";
  const validatorId = "VALIDATOR-CANDIDATE-HARNESS-001";

  const harnessCases = acceptedCases.map((candidate, index) => {
    const pointIds = (candidate.sourceRefs || []).filter((ref) => pointById.has(ref));
    const requirementIds = (candidate.sourceRefs || [])
      .map((ref) => requirementByAcceptance.get(ref) || (ref.startsWith("REQ-") ? ref : null))
      .filter(Boolean);
    return {
      id: `CASE-HARNESS-${String(index + 1).padStart(3, "0")}`,
      original_candidate_id: candidate.id,
      version: "v1",
      title: cleanTitle(candidate.title || `候选用例 ${index + 1}`),
      description: `由生成工具候选用例 ${candidate.id} 经 Harness Candidate Quality Gate 收敛。`,
      scenario: `${outDirRepoPath}/scenario.asset.yaml`,
      source: { type: "requirement", ref: `${outDirRepoPath}/accepted-requirements.yaml` },
      traceability: {
        requirement_ids: requirementIds,
        function_point_ids: pointIds,
      },
      execution: {
        type: "manual",
        environment: "test",
        timeout_seconds: 600,
        retry: { enabled: false, max_attempts: 1 },
      },
      fixture: `${outDirRepoPath}/runtime-fixture.asset.yaml`,
      preconditions: candidate.preconditions || [],
      steps: (candidate.steps || []).map((step, stepIndex) => ({
        name: `步骤 ${stepIndex + 1}`,
        action: step,
        expected_observation: stepIndex === (candidate.steps || []).length - 1 ? candidate.expectedResult : "",
      })),
      validators: [`${outDirRepoPath}/runtime-validator.asset.yaml`],
      expected_result: {
        summary: candidate.expectedResult || "按候选用例预期结果验证。",
        evidence: ["screenshot", "operation_log", "validator_result"],
      },
      risk: {
        level: candidate.priority || "P2",
        impact_tags: inferImpactTags(candidate),
      },
      tags: ["candidate-to-harness", candidate.type || "functional"],
      created_by: "agent",
      review: {
        status: HIGH_RISK(candidate.priority) ? "pending_review" : "draft",
        source_status: candidate.reviewStatus || "",
      },
    };
  });

  const fixture = {
    id: fixtureId,
    version: "v1",
    title: `${feature} 通用候选用例测试数据`,
    description: "由 candidate-to-harness 生成的最小执行数据模板，正式执行前需按模块细化。",
    data_scope: "synthetic",
    isolation: { strategy: "unique_ids", collision_policy: "fail_fast" },
    environment: { target: "test", network_profile: "normal" },
    entities: [
      { id: "passenger_candidate_001", type: "passenger", initial_state: "registered" },
      { id: "order_candidate_001", type: "order", initial_state: "available_when_needed" },
    ],
    secrets: { required: false, source: "external_secret_manager" },
    cleanup: { required: true, actions: ["purge_synthetic_records", "reset_mock_state"] },
    safety: { production_safe: false, pii_allowed: false, notes: "仅允许合成数据。" },
  };

  const validator = {
    id: validatorId,
    version: "v1",
    title: `${feature} 通用候选用例校验器`,
    description: "第一版通用确定性校验器，正式入库前应按模块拆分。",
    inputs: ["execution_result", "screenshot", "operation_log", "state_snapshot"],
    rules: [
      { id: "expected_result_observed", type: "existence", assertion: { target_observation: "case.expected_result.summary" } },
      { id: "no_unhandled_error", type: "existence", assertion: { forbidden_observation: "unhandled_error_or_blank_page" } },
    ],
    supported_rule_types: ["existence", "equality", "state_machine", "consistency", "data_quality"],
    result: {
      pass_condition: "all_rules_passed",
      failure_output: ["failed_rule_id", "case_id", "actual_observation", "expected_observation", "evidence_ref"],
    },
    evidence: { required: true, fields: ["run_id", "case_id", "screenshot", "operation_log", "state_snapshot"] },
    created_by: "agent",
    review: { status: "draft" },
  };

  const scenario = {
    id: scenarioId,
    version: "v1",
    title: `${feature} 候选用例准入场景`,
    description: "生成工具 raw candidates 经 Harness 收敛后的准入场景。",
    domain: "mobile_passenger",
    source: { type: "agent_suggestion", ref: args.input || "" },
    risk: { level: acceptedCases.some((item) => item.priority === "P0") ? "P0" : "P1", impact_tags: ["passenger_experience"] },
    coverage: { target: "accepted generator candidates", dimensions: [...new Set(harnessCases.flatMap((item) => item.tags))] },
    cases: harnessCases.slice(0, Number(args.sampleLimit || 5)).map((item) => `${outDirRepoPath}/case-samples/${item.id}.case.yaml`),
    owner: "qa-platform",
    tags: ["candidate-to-harness"],
    created_by: "agent",
    review: { status: "draft", reviewers: ["qa-owner"] },
  };

  const report = buildReport(artifacts, acceptedCases, rejected, acceptedRequirements, acceptedPoints, harnessCases);
  const reviewQueue = buildReviewQueue(artifacts, harnessCases);
  return {
    requirements: {
      artifact_type: "accepted_requirements",
      requirements: acceptedRequirements.map((item) => ({
        id: item.id,
        sourceTextRef: item.sourceTextRef,
        content: item.content,
      })),
    },
    functionPoints: {
      artifact_type: "accepted_function_points",
      points: acceptedPoints.map((item) => ({
        id: item.id,
        sourceRef: item.sourceRef,
        type: item.type,
        priority: item.priority,
        description: item.description,
      })),
    },
    cases: {
      artifact_type: "accepted_test_cases",
      cases: harnessCases,
    },
    rejected: {
      artifact_type: "rejected_candidates",
      rejected,
    },
    report,
    reviewQueue,
    fixture,
    validator,
    scenario,
    individualCases: harnessCases,
  };
}

function buildReviewQueue(artifacts, harnessCases) {
  const clarificationItems = (artifacts.review?.clarificationItems || []).map((item, index) => ({
    id: item.id || `CLARIFY-${String(index + 1).padStart(3, "0")}`,
    source_ref: item.sourceRef || item.source_ref || item.requirementId || "",
    question: item.question || item.content || item.description || String(item),
    impact: item.impact || item.reason || "影响需求理解、测试点拆分或预期结果判定。",
    recommended_action: item.recommendedAction || item.recommended_action || "请业务/产品确认后再进入高风险用例评审。",
  }));
  const manualReviewCases = harnessCases
    .filter((item) => HIGH_RISK(item.risk?.level) && item.review?.status !== "approved")
    .map((item) => ({
      id: item.id,
      original_candidate_id: item.original_candidate_id,
      title: item.title,
      risk_level: item.risk?.level || "",
      review_status: item.review?.status || "",
      requirement_ids: item.traceability?.requirement_ids || [],
      function_point_ids: item.traceability?.function_point_ids || [],
      expected_result: item.expected_result?.summary || "",
      recommended_action: "请确认用例标题、前置条件、步骤、预期结果、优先级和追溯关系是否可接受。",
    }));
  return {
    artifact_type: "review_queue",
    summary: {
      clarification_items_total: clarificationItems.length,
      manual_review_cases_total: manualReviewCases.length,
      p0_pending_review: manualReviewCases.filter((item) => item.risk_level === "P0").length,
      p1_pending_review: manualReviewCases.filter((item) => item.risk_level === "P1").length,
    },
    clarification_items: clarificationItems,
    manual_review_cases: manualReviewCases,
  };
}

function evaluateCandidate(candidate, pointById, requirementByAcceptance) {
  const cleanedTitle = cleanTitle(candidate.title || "");
  const text = [
    cleanedTitle,
    ...(candidate.preconditions || []),
    ...(candidate.steps || []),
    candidate.expectedResult,
  ].filter(Boolean).join(" ");

  const gates = {};
  const reasons = [];
  const sourceRefs = candidate.sourceRefs || [];
  const hasTrace = sourceRefs.some((ref) => pointById.has(ref) || requirementByAcceptance.has(ref) || ref.startsWith("REQ-"));
  const hasSpecificSignal = SPECIFIC_SIGNALS.some((signal) => text.includes(signal));
  const noisy = NOISE_PATTERNS.some((pattern) => pattern.test(cleanedTitle));
  const generic = isGenericCandidate(candidate);
  const hasConcreteSteps = (candidate.steps || []).some((step) => SPECIFIC_SIGNALS.some((signal) => step.includes(signal)));
  const hasExpected = Boolean(candidate.expectedResult && candidate.expectedResult.length >= 8);

  gates.traceability_gate = hasTrace ? "passed" : "failed";
  gates.noise_gate = noisy ? "failed" : "passed";
  gates.specificity_gate = hasSpecificSignal && cleanedTitle.length >= 6 && (!generic || hasConcreteSteps) ? "passed" : "failed";
  gates.atomicity_gate = isLikelyAtomic(candidate) ? "passed" : "warning";
  gates.expected_result_gate = hasExpected ? "passed" : "failed";

  if (!hasTrace) reasons.push("missing_traceability");
  if (noisy) reasons.push("noise_source_or_title");
  if (!hasSpecificSignal || cleanedTitle.length < 6 || (generic && !hasConcreteSteps)) reasons.push("generic_or_not_specific");
  if (!hasExpected) reasons.push("missing_expected_result");

  return { accepted: reasons.length === 0, reasons, gates };
}

function rejectedCandidate(candidate, reasons, gates) {
  return {
    id: candidate.id,
    title: candidate.title,
    priority: candidate.priority,
    sourceRefs: candidate.sourceRefs || [],
    reasons,
    gates,
  };
}

function isGenericCandidate(candidate) {
  const title = candidate.title || "";
  return title.includes("应具备明确输入、处理结果和用户可见反馈") || title.startsWith("异常输入或前置条件不满足时");
}

function isLikelyAtomic(candidate) {
  const title = candidate.title || "";
  const separators = ["、", "以及", "并", "和"];
  return separators.filter((item) => title.includes(item)).length <= 2;
}

function buildFingerprint(candidate) {
  return normalizeText([
    cleanTitle(candidate.title || ""),
    candidate.expectedResult || "",
    ...(candidate.steps || []),
  ].join(" ")).slice(0, 120);
}

function cleanTitle(title) {
  return title
    .replace(/\s+/g, " ")
    .replace(/应具备明确输入、处理结果和用户可见反?馈?.*$/, "")
    .replace(/^验证：/, "")
    .trim();
}

function normalizeText(text) {
  return cleanTitle(text).replace(/[，。；、：:\s]/g, "").toLowerCase();
}

function inferImpactTags(candidate) {
  const text = [candidate.title, ...(candidate.steps || []), candidate.expectedResult].join(" ");
  const tags = new Set(["passenger_experience"]);
  if (/(订单|途经点|路径|约车)/.test(text)) tags.add("order_lifecycle");
  if (/(车辆|空调|座椅|解锁|车控)/.test(text)) tags.add("vehicle_cloud_consistency");
  if (/(站点|推荐|历史|热门)/.test(text)) tags.add("dispatch_quality");
  if (/(短信|消息|Push|订阅|模板)/i.test(text)) tags.add("vehicle_cloud_consistency");
  if (/(数据|回调|messageId|sms_code)/i.test(text)) tags.add("data_quality");
  return [...tags];
}

function HIGH_RISK(priority) {
  return priority === "P0" || priority === "P1";
}

function buildReport(artifacts, acceptedCases, rejected, acceptedRequirements, acceptedPoints, harnessCases) {
  const rawCases = artifacts.cases || [];
  const rejectedByReason = {};
  for (const item of rejected) {
    for (const reason of item.reasons) rejectedByReason[reason] = (rejectedByReason[reason] || 0) + 1;
  }
  return {
    artifact_type: "candidate_quality_report",
    summary: {
      raw_requirement_units: artifacts.review?.requirementUnits?.length || 0,
      raw_test_points: artifacts.testPoints?.points?.length || 0,
      raw_cases: rawCases.length,
      accepted_requirements: acceptedRequirements.length,
      accepted_function_points: acceptedPoints.length,
      accepted_cases: acceptedCases.length,
      rejected_cases: rejected.length,
      acceptance_rate: rawCases.length ? Math.round((acceptedCases.length / rawCases.length) * 100) : 0,
      p0_cases: harnessCases.filter((item) => item.risk.level === "P0").length,
      p1_cases: harnessCases.filter((item) => item.risk.level === "P1").length,
      p2_cases: harnessCases.filter((item) => item.risk.level === "P2").length,
    },
    gates: {
      noise_gate: "enabled",
      specificity_gate: "enabled",
      traceability_gate: "enabled",
      duplicate_gate: "enabled",
      expected_result_gate: "enabled",
    },
    rejected_by_reason: rejectedByReason,
    next_actions: [
      "人工复核 accepted P0/P1 用例",
      "将高风险 accepted cases 拆分专用 Fixture 和 Validator",
      "对 rejected 的 noise_source_or_title 检查生成工具拆句规则",
      "将 Gate Runner 结果回写到生成工具 UI",
    ],
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node vv-automation/harness/runtime/candidate-to-harness.mjs \\
    --input output/harness/prd-0330/generator-frontend-runpipeline-artifacts.json \\
    --out-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/from-generator \\
    --feature "0330 乘客端小程序 PRD"
`);
}

function writeYaml(filePath, data) {
  fs.writeFileSync(filePath, `${toYaml(data)}\n`, "utf8");
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toYaml(value, indent = 0) {
  const spaces = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value.map((item) => {
      if (isPlainObject(item)) {
        const entries = Object.entries(item);
        if (!entries.length) return `${spaces}- {}`;
        const [firstKey, firstValue] = entries[0];
        const rest = Object.fromEntries(entries.slice(1));
        const firstLine = isPlainObject(firstValue) || Array.isArray(firstValue)
          ? `${spaces}- ${firstKey}:\n${toYaml(firstValue, indent + 4)}`
          : `${spaces}- ${firstKey}: ${formatScalar(firstValue)}`;
        const restText = Object.keys(rest).length ? `\n${toYaml(rest, indent + 2)}` : "";
        return `${firstLine}${restText}`;
      }
      if (Array.isArray(item)) return `${spaces}-\n${toYaml(item, indent + 2)}`;
      return `${spaces}- ${formatScalar(item)}`;
    }).join("\n");
  }
  if (isPlainObject(value)) {
    return Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item)) return item.length ? `${spaces}${key}:\n${toYaml(item, indent + 2)}` : `${spaces}${key}: []`;
      if (isPlainObject(item)) return Object.keys(item).length ? `${spaces}${key}:\n${toYaml(item, indent + 2)}` : `${spaces}${key}: {}`;
      return `${spaces}${key}: ${formatScalar(item)}`;
    }).join("\n");
  }
  return `${spaces}${formatScalar(value)}`;
}

function formatScalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  if (!text) return '""';
  if (/[:#{}\[\],&*?|\-<>=!%@`]/.test(text) || /^\s|\s$/.test(text)) return JSON.stringify(text);
  return text;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findRepoRoot(startDir) {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    current = path.dirname(current);
  }
  return startDir;
}

function normalizeRepoPath(inputPath) {
  if (!inputPath) return "";
  if (path.isAbsolute(inputPath)) return path.relative(REPO_ROOT, inputPath);
  return inputPath;
}
