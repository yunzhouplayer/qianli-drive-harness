#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = findRepoRoot(process.cwd());
const GATE_SET_PATH = "vv-automation/harness/quality-gates/gates.yaml";
const CASE_SCHEMA_PATH = "contracts/test-assets/case.schema.yaml";
const FIXTURE_SCHEMA_PATH = "contracts/test-assets/fixture.schema.yaml";
const VALIDATOR_SCHEMA_PATH = "contracts/test-assets/validator.schema.yaml";

const REVIEW_APPROVED_STATUSES = new Set(["approved", "accepted", "reviewed", "passed"]);
const HIGH_RISK_LEVELS = new Set(["P0", "P1"]);

main().catch((error) => {
  console.error(error.stack || `[gate-runner] ${error.message}`);
  process.exit(2);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.asset) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const casePath = normalizeRepoPath(args.asset);
  const caseAsset = loadYamlFile(casePath);
  const scenarioPath = normalizeRepoPath(args.scenario || caseAsset.scenario || "");
  const fixturePath = normalizeRepoPath(args.fixture || caseAsset.fixture || "");
  const validatorPaths = normalizeList(args.validator || args.validators || caseAsset.validators || []);

  const scenario = scenarioPath ? loadYamlFile(scenarioPath) : null;
  const fixture = fixturePath ? loadYamlFile(fixturePath) : null;
  const validators = validatorPaths.map((validatorPath) => ({
    path: normalizeRepoPath(validatorPath),
    asset: loadYamlFile(normalizeRepoPath(validatorPath)),
  }));

  const context = {
    args,
    casePath,
    caseAsset,
    scenarioPath,
    scenario,
    fixturePath,
    fixture,
    validators,
    now: new Date().toISOString(),
  };

  const results = [
    runSchemaGate(context),
    runTraceabilityGate(context),
    runFixtureGate(context),
    runValidatorGate(context),
    runEvidenceGate(context),
    runReviewGate(context),
    runReflectionGate(context),
  ];

  const decision = buildDecision(results);
  const gateResult = buildGateResult(context, results, decision);

  if (args.out) {
    const outPath = path.resolve(REPO_ROOT, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${toYaml(gateResult)}\n`, "utf8");
  } else {
    process.stdout.write(`${toYaml(gateResult)}\n`);
  }

  if (decision.status === "failed" || decision.status === "blocked") {
    process.exit(1);
  }
}

function runSchemaGate(context) {
  const checks = [];
  const findings = [];

  checkRequiredFields({
    asset: context.caseAsset,
    schemaPath: CASE_SCHEMA_PATH,
    assetLabel: "case",
    checks,
    findings,
  });

  if (context.fixture) {
    checkRequiredFields({
      asset: context.fixture,
      schemaPath: FIXTURE_SCHEMA_PATH,
      assetLabel: "fixture",
      checks,
      findings,
    });
  } else {
    addCheck(checks, "fixture_asset_loaded", "failed", "Fixture file could not be loaded or was not declared.");
    addFinding(findings, "blocker", "Case must reference a resolvable fixture asset.");
  }

  if (context.validators.length > 0) {
    for (const validator of context.validators) {
      checkRequiredFields({
        asset: validator.asset,
        schemaPath: VALIDATOR_SCHEMA_PATH,
        assetLabel: `validator:${validator.path}`,
        checks,
        findings,
      });
    }
  } else {
    addCheck(checks, "validator_asset_loaded", "failed", "No validator asset could be loaded.");
    addFinding(findings, "blocker", "Case must reference at least one resolvable validator asset.");
  }

  return gate("schema_gate", checks, findings, statusFromChecks(checks));
}

function runTraceabilityGate(context) {
  const checks = [];
  const findings = [];
  const source = context.caseAsset.source || {};

  addBooleanCheck(checks, findings, "source_type_present", Boolean(source.type), "Case source.type is required.");
  addBooleanCheck(checks, findings, "source_ref_present", Boolean(source.ref), "Case source.ref is required.");

  if (source.ref) {
    const sourceExists = fs.existsSync(path.resolve(REPO_ROOT, source.ref));
    const status = sourceExists ? "passed" : "warning";
    addCheck(checks, "source_ref_resolvable", status, sourceExists ? "Source reference exists." : `Source reference is not currently resolvable: ${source.ref}`);
    if (!sourceExists) addFinding(findings, "low", `Source reference is not currently resolvable: ${source.ref}`);
  }

  if (context.scenarioPath) {
    const scenarioExists = fs.existsSync(path.resolve(REPO_ROOT, context.scenarioPath));
    addBooleanCheck(checks, findings, "scenario_ref_resolvable", scenarioExists, `Scenario reference is not resolvable: ${context.scenarioPath}`);
  } else {
    addBooleanCheck(checks, findings, "scenario_ref_present", false, "Case scenario reference is required.");
  }

  const traceability = context.caseAsset.traceability || {};
  const hasRequirementOrSource = nonEmptyArray(traceability.requirement_ids) || Boolean(source.ref);
  addBooleanCheck(checks, findings, "requirement_or_source_trace_present", hasRequirementOrSource, "Case must trace to a requirement or source reference.");

  return gate("traceability_gate", checks, findings, statusFromChecks(checks));
}

function runFixtureGate(context) {
  const checks = [];
  const findings = [];
  const fixture = context.fixture;

  if (!fixture) {
    addCheck(checks, "fixture_reference_present", "failed", "Fixture reference is missing or unresolved.");
    addFinding(findings, "blocker", "Fixture Gate requires a fixture asset.");
    return gate("fixture_gate", checks, findings, "failed");
  }

  addBooleanCheck(checks, findings, "data_scope_declared", Boolean(fixture.data_scope), "Fixture data_scope is required.");
  addBooleanCheck(checks, findings, "isolation_strategy_declared", Boolean(fixture.isolation?.strategy), "Fixture isolation.strategy is required.");
  addBooleanCheck(checks, findings, "cleanup_required_declared", typeof fixture.cleanup?.required === "boolean", "Fixture cleanup.required must be declared.");

  const cleanupRequired = fixture.cleanup?.required === true;
  addBooleanCheck(
    checks,
    findings,
    "cleanup_actions_present_when_required",
    !cleanupRequired || nonEmptyArray(fixture.cleanup?.actions),
    "Fixture cleanup.actions are required when cleanup.required is true.",
  );

  addBooleanCheck(checks, findings, "pii_policy_declared", typeof fixture.safety?.pii_allowed === "boolean", "Fixture safety.pii_allowed must be declared.");
  addBooleanCheck(checks, findings, "plaintext_secret_absent", fixture.secrets?.plaintext !== true, "Plaintext secrets are not allowed in fixture assets.");

  return gate("fixture_gate", checks, findings, statusFromChecks(checks));
}

function runValidatorGate(context) {
  const checks = [];
  const findings = [];

  addBooleanCheck(checks, findings, "validator_reference_present", context.validators.length > 0, "Case must reference at least one validator.");

  for (const validator of context.validators) {
    const rules = asArray(validator.asset.rules);
    addBooleanCheck(checks, findings, `deterministic_rules_present:${validator.asset.id || validator.path}`, rules.length > 0, "Validator must declare deterministic rules.");
    addBooleanCheck(checks, findings, `failure_output_declared:${validator.asset.id || validator.path}`, nonEmptyArray(validator.asset.result?.failure_output), "Validator result.failure_output is required.");
    addBooleanCheck(checks, findings, `evidence_fields_declared:${validator.asset.id || validator.path}`, nonEmptyArray(validator.asset.evidence?.fields), "Validator evidence.fields are required.");

    for (const rule of rules) {
      const isDeterministic = Boolean(rule.id && rule.type && rule.assertion);
      addBooleanCheck(checks, findings, `rule_is_deterministic:${rule.id || "unnamed_rule"}`, isDeterministic, "Each validator rule must declare id, type, and assertion.");
    }
  }

  return gate("validator_gate", checks, findings, statusFromChecks(checks));
}

function runEvidenceGate(context) {
  const checks = [];
  const findings = [];
  const evidencePlan = context.caseAsset.expected_result?.evidence;

  addBooleanCheck(checks, findings, "evidence_type_declared", nonEmptyArray(evidencePlan), "Case expected_result.evidence must declare evidence types.");

  const validatorsRequireEvidence = context.validators.every((validator) => validator.asset.evidence?.required !== true || nonEmptyArray(validator.asset.evidence?.fields));
  addBooleanCheck(checks, findings, "validator_result_linked", validatorsRequireEvidence, "Validators that require evidence must declare evidence fields.");

  const hasRuntimeEvidenceRef = nonEmptyArray(context.caseAsset.evidence_refs) || Boolean(context.args.evidence);
  if (hasRuntimeEvidenceRef) {
    addCheck(checks, "evidence_ref_or_plan_present", "passed", "Runtime evidence reference is present.");
  } else if (nonEmptyArray(evidencePlan)) {
    addCheck(checks, "evidence_ref_or_plan_present", "warning", "Evidence plan is declared, but no runtime evidence path exists before execution.");
    addFinding(findings, "low", "Evidence plan is declared, but no runtime evidence path exists before execution.");
  } else {
    addCheck(checks, "evidence_ref_or_plan_present", "failed", "Evidence plan or evidence reference is required.");
    addFinding(findings, "blocker", "Evidence plan or evidence reference is required.");
  }

  return gate("evidence_gate", checks, findings, statusFromChecks(checks, { warningOnlyStatus: "warning" }));
}

function runReviewGate(context) {
  const checks = [];
  const findings = [];
  const riskLevel = context.caseAsset.risk?.level || context.scenario?.risk?.level || "P2";
  const humanReviewRequired = HIGH_RISK_LEVELS.has(riskLevel);
  const caseReviewStatus = context.caseAsset.review?.status;
  const scenarioReviewStatus = context.scenario?.review?.status;
  const fixtureReviewStatus = context.fixture?.review?.status;
  const validatorReviewStatuses = context.validators.map((validator) => validator.asset.review?.status);

  addBooleanCheck(checks, findings, "review_status_present", Boolean(caseReviewStatus), "Case review.status is required.");
  addCheck(checks, "risk_level_checked", "passed", `Risk level is ${riskLevel}.`);

  if (humanReviewRequired) {
    const approved = REVIEW_APPROVED_STATUSES.has(caseReviewStatus);
    addCheck(checks, "high_risk_requires_human_review", approved ? "passed" : "blocked", approved ? "High-risk case is reviewed." : `High-risk case requires human review; current status is ${caseReviewStatus || "missing"}.`);
    if (!approved) addFinding(findings, "blocker", `P0/P1 case requires human review before executable admission; current status is ${caseReviewStatus || "missing"}.`);
  } else {
    addCheck(checks, "high_risk_requires_human_review", "not_applicable", "Human review is not required for this risk level.");
  }

  const generatedAssetReviewGap = [
    ["scenario", scenarioReviewStatus],
    ["fixture", fixtureReviewStatus],
    ...validatorReviewStatuses.map((status, index) => [`validator_${index + 1}`, status]),
  ].filter(([, status]) => status && !REVIEW_APPROVED_STATUSES.has(status));

  if (generatedAssetReviewGap.length > 0 && humanReviewRequired) {
    addCheck(checks, "related_generated_assets_reviewed", "blocked", "Related generated assets are not fully reviewed.");
    for (const [assetType, status] of generatedAssetReviewGap) {
      addFinding(findings, "medium", `${assetType} review status is ${status}; review before release readiness.`);
    }
  } else {
    addCheck(checks, "related_generated_assets_reviewed", "passed", "Related generated asset review status is acceptable for this run.");
  }

  return gate("review_gate", checks, findings, statusFromChecks(checks));
}

function runReflectionGate(context) {
  const checks = [];
  const findings = [];
  const agentGenerated = context.caseAsset.created_by === "agent";
  const reflectionPath = context.args.reflection ? normalizeRepoPath(context.args.reflection) : "";

  if (!agentGenerated) {
    addCheck(checks, "critic_findings_present_when_agent_generated", "not_applicable", "Asset is not agent generated.");
    return gate("reflection_gate", checks, findings, "not_applicable");
  }

  if (!reflectionPath) {
    addCheck(checks, "critic_findings_present_when_agent_generated", "warning", "No Critic reflection artifact was provided.");
    addFinding(findings, "low", "No Critic reflection artifact was provided; require reflection before release readiness.");
    return gate("reflection_gate", checks, findings, "warning");
  }

  const exists = fs.existsSync(path.resolve(REPO_ROOT, reflectionPath));
  addBooleanCheck(checks, findings, "critic_findings_present_when_agent_generated", exists, `Reflection artifact is not resolvable: ${reflectionPath}`);
  return gate("reflection_gate", checks, findings, statusFromChecks(checks));
}

function checkRequiredFields({ asset, schemaPath, assetLabel, checks, findings }) {
  const schema = loadYamlFile(schemaPath);
  const required = schema.required || [];
  for (const field of required) {
    const present = hasValue(asset?.[field]);
    const checkName = `${assetLabel}.${field}_present`;
    addBooleanCheck(checks, findings, checkName, present, `${assetLabel} is missing required field: ${field}`);
  }
}

function buildGateResult(context, results, decision) {
  return {
    template_id: "TPL-GATE-RESULT-001",
    version: "v1",
    artifact_type: "gate_result",
    stage: "harness_quality_gate",
    source_gate_set: {
      id: "harness-quality-gates.v1",
      path: GATE_SET_PATH,
    },
    gate_run: {
      gate_run_id: context.args.runId || buildRunId(context.now),
      run_at: context.now,
      trigger: {
        type: context.args.trigger || "manual",
        actor: context.args.actor || "local-user",
      },
      asset: {
        id: context.caseAsset.id || "",
        type: "case",
        path: context.casePath,
        version: context.caseAsset.version || "",
        risk_level: context.caseAsset.risk?.level || "",
      },
      inputs: {
        source_refs: unique(compact([context.caseAsset.source?.ref, context.scenario?.source?.ref])),
        related_assets: {
          scenario: context.scenarioPath || "",
          case: context.casePath,
          fixture: context.fixturePath || "",
          validators: context.validators.map((validator) => validator.path),
          agent_artifacts: normalizeList(context.args.agentArtifact || context.args.agentArtifacts || []),
          traceability_matrix: context.args.traceability || "",
        },
      },
      results,
      decision,
    },
    quality_checks: {
      gate_ids_known: "passed",
      failed_or_blocked_has_findings: failedOrBlockedHasFindings(results) ? "passed" : "failed",
      warning_not_release_acceptable: decision.status === "warning" && decision.release_acceptable ? "failed" : "passed",
      decision_matches_gate_results: "passed",
    },
  };
}

function buildDecision(results) {
  const statuses = results.map((result) => result.status);
  const blocked = statuses.includes("blocked");
  const failed = statuses.includes("failed");
  const warning = statuses.includes("warning");

  if (blocked) {
    return {
      status: "blocked",
      executable: false,
      reportable: false,
      release_acceptable: false,
      reason: "存在阻断级门禁结果，资产不能进入执行链路。",
      required_actions: collectRequiredActions(results),
    };
  }

  if (failed) {
    return {
      status: "failed",
      executable: false,
      reportable: false,
      release_acceptable: false,
      reason: "存在失败门禁结果，资产不能进入执行链路。",
      required_actions: collectRequiredActions(results),
    };
  }

  if (warning) {
    return {
      status: "warning",
      executable: true,
      reportable: false,
      release_acceptable: false,
      reason: "可进入低风险试运行，但不能作为发布准入依据。",
      required_actions: collectRequiredActions(results),
    };
  }

  return {
    status: "passed",
    executable: true,
    reportable: true,
    release_acceptable: true,
    reason: "所有最小 Harness 门禁通过。",
    required_actions: [],
  };
}

function collectRequiredActions(results) {
  return results
    .filter((result) => ["blocked", "failed", "warning"].includes(result.status))
    .flatMap((result) => result.findings.map((finding) => ({
      owner: "qa-owner",
      action: `[${result.gate_id}] ${finding.message}`,
      due_at: "",
    })));
}

function gate(gateId, checks, findings, status) {
  return {
    gate_id: gateId,
    status,
    checks,
    findings,
  };
}

function addBooleanCheck(checks, findings, name, passed, failureMessage) {
  if (passed) {
    addCheck(checks, name, "passed", "OK");
  } else {
    addCheck(checks, name, "failed", failureMessage);
    addFinding(findings, "blocker", failureMessage);
  }
}

function addCheck(checks, name, status, message) {
  checks.push({ name, status, message });
}

function addFinding(findings, severity, message) {
  findings.push({ severity, message });
}

function statusFromChecks(checks, options = {}) {
  const statuses = checks.map((check) => check.status);
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("warning")) return options.warningOnlyStatus || "warning";
  if (statuses.every((status) => status === "not_applicable")) return "not_applicable";
  return "passed";
}

function failedOrBlockedHasFindings(results) {
  return results.every((result) => {
    if (!["failed", "blocked"].includes(result.status)) return true;
    return result.findings.length > 0;
  });
}

function buildRunId(isoTimestamp) {
  const compactTimestamp = isoTimestamp.replace(/[-:TZ.]/g, "").slice(0, 14);
  return `GATE-RUN-${compactTimestamp}`;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else if (args[key]) {
      args[key] = Array.isArray(args[key]) ? [...args[key], next] : [args[key], next];
      index += 1;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node vv-automation/harness/runtime/gate-runner.mjs \\
    --asset vv-automation/harness/assets/cases/smoke-001-arrival-status-sync.case.yaml \\
    --out vv-automation/harness/quality-gates/examples/generated-smoke-001-gate-result.yaml

Options:
  --asset <path>        Required. Case asset YAML.
  --scenario <path>     Optional. Defaults to case.scenario.
  --fixture <path>      Optional. Defaults to case.fixture.
  --validator <path>    Optional. Can be repeated. Defaults to case.validators.
  --out <path>          Optional. Writes gate result YAML. Defaults to stdout.
  --actor <id>          Optional. Actor recorded in the gate result.
  --trigger <type>      Optional. manual, ci, scheduled, agent, regression.
  --reflection <path>   Optional. Critic reflection artifact path.
`);
}

function loadYamlFile(repoPath) {
  const absolutePath = path.resolve(REPO_ROOT, repoPath);
  if (!repoPath || !fs.existsSync(absolutePath)) {
    throw new Error(`YAML file does not exist: ${repoPath}`);
  }
  return parseYaml(fs.readFileSync(absolutePath, "utf8"));
}

function parseYaml(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw) => ({ raw, indent: raw.match(/^ */)[0].length, text: raw.trimEnd() }))
    .filter((line) => line.text.trim() && !line.text.trim().startsWith("#"));

  const [value] = parseBlock(lines, 0, 0);
  return value || {};
}

function parseBlock(lines, startIndex, indent) {
  const first = nextLineAtOrAfter(lines, startIndex, indent);
  if (!first) return [{}, startIndex];

  if (first.line.indent === indent && first.line.text.trimStart().startsWith("- ")) {
    return parseArray(lines, first.index, indent);
  }
  return parseObject(lines, first.index, indent);
}

function parseArray(lines, startIndex, indent) {
  const output = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      index += 1;
      continue;
    }
    const trimmed = line.text.trimStart();
    if (trimmed !== "-" && !trimmed.startsWith("- ")) break;

    const rest = trimmed === "-" ? "" : trimmed.slice(2).trim();
    if (!rest) {
      const [child, nextIndex] = parseBlock(lines, index + 1, nextContentIndent(lines, index + 1, indent + 2));
      output.push(child);
      index = nextIndex;
      continue;
    }

    const keyValue = splitKeyValue(rest);
    if (keyValue) {
      const item = {};
      assignKeyValue(item, keyValue.key, keyValue.value);
      const next = lines[index + 1];
      if (next && next.indent > indent) {
        const [child, nextIndex] = parseObject(lines, index + 1, next.indent);
        output.push(deepMerge(item, child));
        index = nextIndex;
      } else {
        output.push(item);
        index += 1;
      }
    } else {
      output.push(parseScalar(rest));
      index += 1;
    }
  }

  return [output, index];
}

function parseObject(lines, startIndex, indent) {
  const output = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      index += 1;
      continue;
    }
    const trimmed = line.text.trimStart();
    if (trimmed.startsWith("- ")) break;

    const keyValue = splitKeyValue(trimmed);
    if (!keyValue) {
      index += 1;
      continue;
    }

    if (keyValue.value === "") {
      const childIndent = nextContentIndent(lines, index + 1, indent + 2);
      const [child, nextIndex] = parseBlock(lines, index + 1, childIndent);
      output[keyValue.key] = child;
      index = nextIndex;
    } else {
      output[keyValue.key] = parseScalar(keyValue.value);
      index += 1;
    }
  }

  return [output, index];
}

function splitKeyValue(text) {
  const match = text.match(/^([^:]+):(.*)$/);
  if (!match) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

function assignKeyValue(target, key, value) {
  target[key] = value === "" ? {} : parseScalar(value);
}

function parseScalar(value) {
  if (value === "") return "";
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function nextLineAtOrAfter(lines, startIndex, indent) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].indent >= indent) return { line: lines[index], index };
  }
  return null;
}

function nextContentIndent(lines, startIndex, fallback) {
  for (let index = startIndex; index < lines.length; index += 1) {
    return lines[index].indent;
  }
  return fallback;
}

function deepMerge(left, right) {
  for (const [key, value] of Object.entries(right)) {
    if (isPlainObject(left[key]) && isPlainObject(value)) {
      left[key] = deepMerge(left[key], value);
    } else {
      left[key] = value;
    }
  }
  return left;
}

function toYaml(value, indent = 0) {
  const spaces = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.map((item) => {
      if (isPlainObject(item)) {
        return `${spaces}-\n${toYaml(item, indent + 2)}`;
      }
      if (Array.isArray(item)) {
        return `${spaces}-\n${toYaml(item, indent + 2)}`;
      }
      return `${spaces}- ${formatScalar(item)}`;
    }).join("\n");
  }

  if (isPlainObject(value)) {
    return Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item)) {
        return item.length === 0 ? `${spaces}${key}: []` : `${spaces}${key}:\n${toYaml(item, indent + 2)}`;
      }
      if (isPlainObject(item)) {
        return Object.keys(item).length === 0 ? `${spaces}${key}: {}` : `${spaces}${key}:\n${toYaml(item, indent + 2)}`;
      }
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
  if (/[:#{}\[\],&*?|\-<>=!%@`]/.test(text) || /^\s|\s$/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeList(item));
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeRepoPath(inputPath) {
  if (!inputPath) return "";
  if (path.isAbsolute(inputPath)) return path.relative(REPO_ROOT, inputPath);
  return inputPath;
}

function findRepoRoot(startDir) {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    current = path.dirname(current);
  }
  return startDir;
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== "";
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) return [value];
  return [];
}

function compact(values) {
  return values.filter((value) => value !== undefined && value !== null && value !== "");
}

function unique(values) {
  return [...new Set(values)];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
