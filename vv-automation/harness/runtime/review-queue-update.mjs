#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = findRepoRoot(process.cwd());
const APPROVED_STATUSES = new Set(["approved", "accepted", "reviewed", "passed"]);

main().catch((error) => {
  console.error(error.stack || `[review-queue-update] ${error.message}`);
  process.exit(2);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  normalizeAliasArgs(args);
  if (args.help || !args.queue || !args.action || (!args.case && !isEnabled(args.allPending) && !args.risk && !args.status)) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const queuePath = path.resolve(REPO_ROOT, args.queue);
  const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  const actor = args.actor || "qa-owner";
  const reviewedAt = new Date().toISOString();
  const targetIds = resolveTargetIds(queue, args);
  const action = normalizeAction(args.action);
  if (["approve", "reject", "revise"].includes(action) && !String(args.reason || "").trim()) {
    throw new Error("--reason is required for review decisions.");
  }

  const updates = [];
  const rejected = [];
  for (const item of queue.manual_review_cases || []) {
    if (!targetIds.has(item.id)) continue;
    const beforeStatus = item.review_status || "";
    applyReviewAction(item, action, args, actor, reviewedAt);
    updates.push({
      id: item.id,
      title: item.title,
      before_status: beforeStatus,
      after_status: item.review_status,
      action,
    });
    if (action === "reject") rejected.push(buildRejectedReviewItem(item, args, actor, reviewedAt));
  }

  if (updates.length === 0) throw new Error("No review queue items matched the requested case selector.");

  queue.review_history = [
    ...(queue.review_history || []),
    {
      action,
      actor,
      reviewed_at: reviewedAt,
      case_ids: updates.map((item) => item.id),
      reason: args.reason || "",
      notes: args.notes || "",
    },
  ];
  queue.summary = summarizeQueue(queue);

  writeJson(queuePath, queue);
  writeYaml(queuePath.replace(/\.json$/, ".yaml"), queue);

  if (args.cases) {
    updateAcceptedCasesYaml(path.resolve(REPO_ROOT, args.cases), targetIds, action, args, actor, reviewedAt);
  }
  if (args.caseDir) {
    updateCaseSamples(path.resolve(REPO_ROOT, args.caseDir), targetIds, action, args, actor, reviewedAt);
  }
  if (isEnabled(args.approveRelatedAssets)) {
    updateRelatedAssets({ args, actor, reviewedAt });
  }
  if (rejected.length > 0) {
    const rejectedPath = path.resolve(REPO_ROOT, args.rejectedOut || path.join(path.dirname(args.queue), "rejected-by-review.json"));
    const existing = fs.existsSync(rejectedPath) ? JSON.parse(fs.readFileSync(rejectedPath, "utf8")) : { artifact_type: "rejected_by_review", rejected: [] };
    existing.rejected = [...(existing.rejected || []), ...rejected];
    writeJson(rejectedPath, existing);
  }

  console.log(JSON.stringify({
    queue: normalizeRepoPath(queuePath),
    action,
    updated: updates.length,
    cases: updates.map((item) => ({ id: item.id, status: item.after_status })),
    summary: queue.summary,
  }, null, 2));
}

function normalizeAction(action) {
  if (!["approve", "reject", "revise"].includes(action)) throw new Error(`Unsupported action: ${action}`);
  return action;
}

function resolveTargetIds(queue, args) {
  const cases = queue.manual_review_cases || [];
  if (isEnabled(args.allPending)) {
    return new Set(cases
      .filter((item) => !APPROVED_STATUSES.has(item.review_status))
      .map((item) => item.id));
  }
  const selectorRiskLevels = new Set(normalizeList(args.risk || args.riskLevel).map((item) => item.toUpperCase()));
  const selectorStatuses = new Set(normalizeList(args.status));
  if (selectorRiskLevels.size > 0 || selectorStatuses.size > 0) {
    return new Set(cases
      .filter((item) => selectorRiskLevels.size === 0 || selectorRiskLevels.has(String(item.risk_level || "").toUpperCase()))
      .filter((item) => selectorStatuses.size === 0 || selectorStatuses.has(item.review_status || ""))
      .map((item) => item.id));
  }
  return new Set(normalizeList(args.case));
}

function applyReviewAction(item, action, args, actor, reviewedAt) {
  if (action === "approve") {
    item.review_status = "approved";
  } else if (action === "reject") {
    item.review_status = "rejected";
  } else if (action === "revise") {
    item.review_status = "needs_revision";
    if (args.title) item.title = args.title;
    if (args.expectedResult) item.expected_result = args.expectedResult;
    if (args.risk) item.risk_level = args.risk;
  }
  item.reviewed_by = actor;
  item.reviewed_at = reviewedAt;
  item.review_reason = args.reason || "";
  item.review_notes = args.notes || "";
}

function buildRejectedReviewItem(item, args, actor, reviewedAt) {
  return {
    id: item.id,
    original_candidate_id: item.original_candidate_id || "",
    title: item.title,
    risk_level: item.risk_level,
    rejected_by: actor,
    rejected_at: reviewedAt,
    reason: args.reason || "",
    notes: args.notes || "",
  };
}

function summarizeQueue(queue) {
  const cases = queue.manual_review_cases || [];
  return {
    clarification_items_total: queue.summary?.clarification_items_total ?? (queue.clarification_items || []).length,
    clarification_items_confirmed: queue.summary?.clarification_items_confirmed ?? (queue.clarification_items || []).filter((item) => item.status === "confirmed").length,
    clarification_items_pending: queue.summary?.clarification_items_pending ?? (queue.clarification_items || []).filter((item) => item.status !== "confirmed").length,
    manual_review_cases_total: cases.length,
    p0_pending_review: cases.filter((item) => item.risk_level === "P0" && !APPROVED_STATUSES.has(item.review_status)).length,
    p1_pending_review: cases.filter((item) => item.risk_level === "P1" && !APPROVED_STATUSES.has(item.review_status)).length,
    approved_cases: cases.filter((item) => APPROVED_STATUSES.has(item.review_status)).length,
    rejected_cases: cases.filter((item) => item.review_status === "rejected").length,
    needs_revision_cases: cases.filter((item) => item.review_status === "needs_revision").length,
  };
}

function updateAcceptedCasesYaml(filePath, targetIds, action, args, actor, reviewedAt) {
  if (!fs.existsSync(filePath)) return;
  let text = fs.readFileSync(filePath, "utf8");
  for (const caseId of targetIds) {
    text = updateCaseBlockReview(text, caseId, 2, buildReviewFields(action, args, actor, reviewedAt));
  }
  fs.writeFileSync(filePath, text, "utf8");
}

function updateCaseSamples(caseDir, targetIds, action, args, actor, reviewedAt) {
  if (!fs.existsSync(caseDir)) return;
  for (const caseId of targetIds) {
    const filePath = path.join(caseDir, `${caseId}.case.yaml`);
    if (!fs.existsSync(filePath)) continue;
    const updated = updateTopLevelReview(fs.readFileSync(filePath, "utf8"), buildReviewFields(action, args, actor, reviewedAt));
    fs.writeFileSync(filePath, updated, "utf8");
  }
}

function buildReviewFields(action, args, actor, reviewedAt) {
  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "needs_revision";
  return {
    status,
    reviewed_by: actor,
    reviewed_at: reviewedAt,
    decision: action,
    reason: args.reason || "",
    notes: args.notes || "",
    related_assets_approved: action === "approve" && isEnabled(args.approveRelatedAssets),
  };
}

function updateCaseBlockReview(text, caseId, caseIndent, fields) {
  const pattern = new RegExp(`(^ {${caseIndent}}- id: "?${escapeRegExp(caseId)}"?[\\s\\S]*?)(?=\\n {${caseIndent}}- id:|\\n?$)`, "m");
  return text.replace(pattern, (block) => replaceReviewBlock(block, caseIndent + 2, fields));
}

function updateTopLevelReview(text, fields) {
  return replaceReviewBlock(text, 0, fields);
}

function replaceReviewBlock(block, parentIndent, fields) {
  const reviewIndent = " ".repeat(parentIndent);
  const childIndent = " ".repeat(parentIndent + 2);
  const replacement = [
    `${reviewIndent}review:`,
    ...Object.entries(fields).map(([key, value]) => `${childIndent}${key}: ${formatScalar(value)}`),
  ].join("\n");

  const reviewPattern = new RegExp(`^ {${parentIndent}}review:\\n(?: {${parentIndent + 2}}.*\\n?)*`, "m");
  if (reviewPattern.test(block)) {
    return block.replace(reviewPattern, `${replacement}\n`);
  }
  return `${block.trimEnd()}\n${replacement}\n`;
}

function updateRelatedAssets({ args, actor, reviewedAt }) {
  const assetPaths = [
    args.scenario,
    args.fixture,
    ...normalizeList(args.validator || args.validators),
  ].filter(Boolean);
  for (const repoPath of assetPaths) {
    const filePath = path.resolve(REPO_ROOT, repoPath);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    const updated = replaceReviewBlock(text, 0, {
      status: "approved",
      reviewed_by: actor,
      reviewed_at: reviewedAt,
      decision: "approve",
      reason: args.reason || "Approved with related case review.",
      notes: args.notes || "",
    });
    fs.writeFileSync(filePath, updated, "utf8");
  }
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
    } else if (args[key]) {
      args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
      index += 1;
    } else {
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function normalizeAliasArgs(args) {
  if (args["all-pending"] && !args.allPending) args.allPending = args["all-pending"];
  if (args["case-dir"] && !args.caseDir) args.caseDir = args["case-dir"];
  if (args["expected-result"] && !args.expectedResult) args.expectedResult = args["expected-result"];
  if (args["approve-related-assets"] && !args.approveRelatedAssets) args.approveRelatedAssets = args["approve-related-assets"];
  if (args["rejected-out"] && !args.rejectedOut) args.rejectedOut = args["rejected-out"];
  if (args["risk-level"] && !args.riskLevel) args.riskLevel = args["risk-level"];
}

function printUsage() {
  console.log(`Usage:
  node vv-automation/harness/runtime/review-queue-update.mjs \\
    --queue vv-automation/harness/assets/<run>/final-generated/review-queue.json \\
    --cases vv-automation/harness/assets/<run>/final-generated/accepted-test-cases.yaml \\
    --case-dir vv-automation/harness/assets/<run>/final-generated/case-samples \\
    --action approve \\
    --case CASE-HARNESS-001 \\
    --actor qa-owner \\
    --reason "Reviewed by QA"

  node vv-automation/harness/runtime/review-queue-update.mjs \\
    --queue vv-automation/harness/assets/<run>/final-generated/review-queue.json \\
    --cases vv-automation/harness/assets/<run>/final-generated/accepted-test-cases.yaml \\
    --action approve \\
    --risk P0,P1 \\
    --status pending_review \\
    --actor qa-owner \\
    --reason "Batch reviewed by QA"

  node vv-automation/harness/runtime/review-queue-update.mjs \\
    --queue vv-automation/harness/assets/<run>/final-generated/review-queue.json \\
    --cases vv-automation/harness/assets/<run>/final-generated/accepted-test-cases.yaml \\
    --action reject \\
    --case CASE-HARNESS-001 \\
    --reason "Scope excluded"
`);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeYaml(filePath, data) {
  fs.writeFileSync(filePath, `${toYaml(data)}\n`, "utf8");
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

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeList(item));
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function isEnabled(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRepoPath(inputPath) {
  if (!inputPath) return "";
  if (path.isAbsolute(inputPath)) return path.relative(REPO_ROOT, inputPath).replaceAll(path.sep, "/");
  return inputPath.replaceAll(path.sep, "/");
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
