#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = findRepoRoot(process.cwd());

main().catch((error) => {
  console.error(error.stack || `[clarification-answer] ${error.message}`);
  process.exit(2);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  normalizeAliasArgs(args);
  if (args.help || !args.reviewBrief || !args.out) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const reviewBriefPath = path.resolve(REPO_ROOT, args.reviewBrief);
  const reviewBrief = JSON.parse(fs.readFileSync(reviewBriefPath, "utf8"));
  const answerMap = parseAnswers(args.answer);
  const defaultAnswer = args.defaultAnswer || "";
  const actor = args.actor || "local-user";
  const answeredAt = new Date().toISOString();

  const answerItems = (reviewBrief.clarification_items || []).map((item) => {
    const answer = answerMap.get(item.id) || defaultAnswer;
    const status = answer ? "confirmed" : "pending";
    return {
      id: item.id,
      source_ref: item.source_ref || "",
      question: item.question || "",
      answer,
      status,
      answered_by: status === "confirmed" ? actor : "",
      answered_at: status === "confirmed" ? answeredAt : "",
      impact: item.impact || "",
      recommended_action: item.recommended_action || "",
    };
  });

  const artifact = {
    artifact_type: "clarification_answers",
    source_review_brief: normalizeRepoPath(args.reviewBrief),
    answered_by: actor,
    answered_at: answeredAt,
    summary: {
      total: answerItems.length,
      confirmed: answerItems.filter((item) => item.status === "confirmed").length,
      pending: answerItems.filter((item) => item.status !== "confirmed").length,
    },
    answers: answerItems,
  };

  const outPath = path.resolve(REPO_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buildMarkdown(artifact), "utf8");
  const jsonOutPath = path.resolve(REPO_ROOT, args.jsonOut || args.out.replace(/\.[^.]+$/, ".json"));
  fs.writeFileSync(jsonOutPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  if (!isEnabled(args.noUpdate)) {
    reviewBrief.clarification_items = answerItems.map((item) => ({
      ...findOriginalClarification(reviewBrief, item.id),
      answer: item.answer,
      status: item.status,
      answered_by: item.answered_by,
      answered_at: item.answered_at,
    }));
    reviewBrief.summary = {
      ...(reviewBrief.summary || {}),
      clarification_items_total: answerItems.length,
      clarification_items_confirmed: artifact.summary.confirmed,
      clarification_items_pending: artifact.summary.pending,
    };
    reviewBrief.confirmation_prompt = artifact.summary.pending > 0
      ? `仍有 ${artifact.summary.pending} 个需求澄清项待确认。`
      : `${artifact.summary.confirmed} 个需求澄清项已确认，可继续生成测试用例。`;
    fs.writeFileSync(reviewBriefPath, `${JSON.stringify(reviewBrief, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    answers: normalizeRepoPath(outPath),
    answers_json: normalizeRepoPath(jsonOutPath),
    summary: artifact.summary,
    review_brief_updated: !isEnabled(args.noUpdate),
  }, null, 2));
}

function parseAnswers(value) {
  const answerMap = new Map();
  const values = Array.isArray(value) ? value : value ? [value] : [];
  for (const item of values) {
    const index = String(item).indexOf("=");
    if (index <= 0) throw new Error(`Invalid --answer format, expected ID=answer: ${item}`);
    answerMap.set(String(item).slice(0, index).trim(), String(item).slice(index + 1).trim());
  }
  return answerMap;
}

function findOriginalClarification(reviewBrief, id) {
  return (reviewBrief.clarification_items || []).find((item) => item.id === id) || { id };
}

function buildMarkdown(artifact) {
  const lines = [
    "# Clarification Answers",
    "",
    `- Source review brief: ${artifact.source_review_brief}`,
    `- Answered by: ${artifact.answered_by}`,
    `- Answered at: ${artifact.answered_at}`,
    `- Confirmed: ${artifact.summary.confirmed}`,
    `- Pending: ${artifact.summary.pending}`,
    "",
    "## Answers",
    "",
  ];
  for (const item of artifact.answers) {
    lines.push(`### ${item.id}`);
    lines.push("");
    lines.push(`- Source: ${item.source_ref || "N/A"}`);
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Question: ${item.question}`);
    lines.push(`- Answer: ${item.answer || "N/A"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
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
  if (args["review-brief"] && !args.reviewBrief) args.reviewBrief = args["review-brief"];
  if (args["json-out"] && !args.jsonOut) args.jsonOut = args["json-out"];
  if (args["default-answer"] && !args.defaultAnswer) args.defaultAnswer = args["default-answer"];
  if (args["no-update"] && !args.noUpdate) args.noUpdate = args["no-update"];
}

function printUsage() {
  console.log(`Usage:
  node vv-automation/harness/runtime/clarification-answer.mjs \\
    --review-brief output/harness/<run>/review-brief.json \\
    --out output/harness/<run>/clarification-answers.md \\
    --default-answer "本轮暂不纳入未明确规则，按已确认范围生成。" \\
    --actor "qa-owner"

  node vv-automation/harness/runtime/clarification-answer.mjs \\
    --review-brief output/harness/<run>/review-brief.json \\
    --out output/harness/<run>/clarification-answers.md \\
    --answer CLARIFY-SCOPE-001="车控延期项本轮不纳入" \\
    --answer CLARIFY-DOC-001="按当前 PRD 文本生成"
`);
}

function isEnabled(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function normalizeRepoPath(inputPath) {
  if (!inputPath) return "";
  if (path.isAbsolute(inputPath)) return path.relative(REPO_ROOT, inputPath).replaceAll(path.sep, "/");
  return inputPath.replaceAll(path.sep, "/");
}

function findRepoRoot(startDir) {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    current = path.dirname(current);
  }
  return startDir;
}
