#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const REPO_ROOT = findRepoRoot(process.cwd());
const RUNTIME_DIR = "vv-automation/harness/runtime";
const DEFAULT_PYTHON = path.join(
  process.env.HOME || "",
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
);
const PDF_EXTRACTOR = `
import sys
import pdfplumber

pdf_path = sys.argv[1]
parts = []
with pdfplumber.open(pdf_path) as pdf:
    for index, page in enumerate(pdf.pages, start=1):
        text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
        parts.append(f"\\n\\n--- page {index} ---\\n{text}")
sys.stdout.write("\\n".join(parts))
`;

main().catch((error) => {
  console.error(error.stack || `[prd-to-harness] ${error.message}`);
  process.exit(2);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  normalizeAliasArgs(args);
  if (args.help || (!args.pdf && !args.textFile) || !args.outDir) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const workDir = normalizeRepoPath(args.workDir || inferWorkDir(args));
  const harnessOutDir = normalizeRepoPath(args.outDir);
  const sampleLimit = Number(args.sampleLimit || 5);
  const reviewLimit = Number(args.reviewLimit || 20);
  fs.mkdirSync(path.resolve(REPO_ROOT, workDir), { recursive: true });

  const textFile = args.pdf
    ? extractPdfToText({
        pdfPath: path.resolve(args.pdf),
        outPath: path.resolve(REPO_ROOT, workDir, "extracted.txt"),
        pythonOverride: args.python,
      })
    : path.resolve(REPO_ROOT, args.textFile);

  const extractedText = fs.readFileSync(textFile, "utf8");
  const intakeGate = evaluateRequirementIntake(extractedText, args);
  if (!intakeGate.passed && !args.allowNonPrd) {
    const blockedSummary = buildBlockedIntakeRun({
      args,
      workDir,
      harnessOutDir,
      textFile,
      extractedText,
      intakeGate,
    });
    writeJson(path.resolve(REPO_ROOT, workDir, "intake-gate-result.json"), intakeGate);
    fs.writeFileSync(path.resolve(REPO_ROOT, workDir, "intake-gate-result.md"), buildIntakeGateMarkdown(intakeGate), "utf8");
    writeJson(path.resolve(REPO_ROOT, workDir, "run-summary.json"), blockedSummary);
    writeJson(path.resolve(REPO_ROOT, workDir, "review-brief.json"), blockedSummary.review_brief);
    fs.writeFileSync(path.resolve(REPO_ROOT, workDir, "run-summary.md"), buildMarkdown(blockedSummary), "utf8");
    fs.writeFileSync(path.resolve(REPO_ROOT, workDir, "review-brief.md"), buildReviewBriefMarkdown(blockedSummary.review_brief), "utf8");
    console.log(JSON.stringify(compactSummary(blockedSummary), null, 2));
    return;
  }

  const preGenerationClarifications = dedupeClarificationItems(inferClarificationItems(extractedText)).slice(0, reviewLimit);
  if (preGenerationClarifications.length > 0 && !isEnabled(args.clarificationsConfirmed)) {
    const blockedSummary = buildBlockedClarificationRun({
      args,
      workDir,
      harnessOutDir,
      textFile,
      extractedText,
      intakeGate,
      clarificationItems: preGenerationClarifications,
    });
    const clarificationGate = buildClarificationGateResult(preGenerationClarifications, args);
    writeJson(path.resolve(REPO_ROOT, workDir, "clarification-gate-result.json"), clarificationGate);
    fs.writeFileSync(path.resolve(REPO_ROOT, workDir, "clarification-gate-result.md"), buildClarificationGateMarkdown(clarificationGate), "utf8");
    writeJson(path.resolve(REPO_ROOT, workDir, "run-summary.json"), blockedSummary);
    writeJson(path.resolve(REPO_ROOT, workDir, "review-brief.json"), blockedSummary.review_brief);
    fs.writeFileSync(path.resolve(REPO_ROOT, workDir, "run-summary.md"), buildMarkdown(blockedSummary), "utf8");
    fs.writeFileSync(path.resolve(REPO_ROOT, workDir, "review-brief.md"), buildReviewBriefMarkdown(blockedSummary.review_brief), "utf8");
    console.log(JSON.stringify(compactSummary(blockedSummary), null, 2));
    return;
  }

  const generationTextFile = prepareGenerationTextFile({
    textFile,
    workDir,
    clarificationAnswers: args.clarificationAnswers,
  });
  const generatorOut = path.join(workDir, "generator-runpipeline-artifacts.json");
  const generator = runNodeScript({
    script: path.join(RUNTIME_DIR, "generator-runpipeline.mjs"),
    args: ["--text-file", generationTextFile, "--out", generatorOut],
    label: "generator-runpipeline",
  });
  const generatorSummary = parseJsonObject(generator.stdout, "generator-runpipeline summary");
  const generatorArtifacts = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, generatorOut), "utf8"));

  const candidate = runNodeScript({
    script: path.join(RUNTIME_DIR, "candidate-to-harness.mjs"),
    args: [
      "--input",
      generatorOut,
      "--out-dir",
      harnessOutDir,
      "--feature",
      args.feature || inferFeatureName(args),
      "--sample-limit",
      String(sampleLimit),
    ],
    label: "candidate-to-harness",
  });
  const candidateSummary = parseJsonObject(candidate.stdout, "candidate-to-harness summary");
  const clarificationAnswersAsset = copyClarificationAnswersToHarness({
    clarificationAnswers: args.clarificationAnswers,
    harnessOutDir,
  });

  const gateResults = runSampleGates({
    harnessOutDir,
    workDir,
    sampleLimit,
  });
  const reviewBrief = buildReviewBrief({
    generatorArtifacts,
    extractedText,
    harnessOutDir,
    candidateSummary,
    gateResults,
    reviewLimit,
    clarificationsConfirmed: isEnabled(args.clarificationsConfirmed),
    clarificationAnswers: args.clarificationAnswers,
  });
  syncReviewQueueWithReviewBrief(harnessOutDir, reviewBrief);

  const summary = {
    input: {
      pdf: args.pdf ? path.resolve(args.pdf) : null,
      text_file: generationTextFile,
      original_text_file: textFile,
      extracted_chars: extractedText.length,
      clarification_answers: args.clarificationAnswers ? normalizeRepoPath(args.clarificationAnswers) : "",
      clarification_answers_asset: clarificationAnswersAsset,
    },
    outputs: {
      work_dir: workDir,
      generator_artifacts: generatorOut,
      harness_out_dir: harnessOutDir,
      run_summary_json: path.join(workDir, "run-summary.json"),
      run_summary_md: path.join(workDir, "run-summary.md"),
      review_brief_json: path.join(workDir, "review-brief.json"),
      review_brief_md: path.join(workDir, "review-brief.md"),
    },
    intake_gate: intakeGate,
    clarification_gate: {
      decision: preGenerationClarifications.length > 0 ? "confirmed" : "passed",
      reason: preGenerationClarifications.length > 0 ? "需求澄清项已确认，继续生成测试用例。" : "未识别到阻断级需求澄清项。",
      clarification_items_total: preGenerationClarifications.length,
      clarification_answers: args.clarificationAnswers ? normalizeRepoPath(args.clarificationAnswers) : "",
      clarification_answers_asset: clarificationAnswersAsset,
    },
    generator: generatorSummary,
    harness_candidate_quality: candidateSummary,
    gates: gateResults,
    review_brief: reviewBrief,
  };

  writeJson(path.resolve(REPO_ROOT, workDir, "run-summary.json"), summary);
  writeJson(path.resolve(REPO_ROOT, workDir, "review-brief.json"), reviewBrief);
  fs.writeFileSync(path.resolve(REPO_ROOT, workDir, "run-summary.md"), buildMarkdown(summary), "utf8");
  fs.writeFileSync(path.resolve(REPO_ROOT, workDir, "review-brief.md"), buildReviewBriefMarkdown(reviewBrief), "utf8");
  console.log(JSON.stringify(compactSummary(summary), null, 2));
}

function evaluateRequirementIntake(text, args) {
  const normalized = text.replace(/\s+/g, "");
  const checks = [];
  const findings = [];

  addIntakeCheck(checks, findings, "document_has_enough_text", text.trim().length >= 800, `抽取文本长度为 ${text.trim().length}，低于 PRD 最小建议长度 800。`);
  addIntakeCheck(
    checks,
    findings,
    "has_requirement_structure",
    /(需求|背景|目标|范围|功能|流程|交互|验收|规则|页面|接口|异常|权限|状态)/.test(text),
    "未识别到需求文档常见结构字段。",
  );
  addIntakeCheck(
    checks,
    findings,
    "has_testable_behavior",
    /(支持|展示|允许|禁止|校验|触发|生成|发送|同步|保存|更新|失败|成功|提示|跳转|下单|登录|推荐|订阅|控制)/.test(text),
    "未识别到可测试行为描述。",
  );
  addIntakeCheck(
    checks,
    findings,
    "not_invoice_or_admin_document",
    !/(开票信息|纳税人识别号|纳税⼈识别号|银行账号|开[户戶]行|发票类型|增值税)/.test(text),
    "文档命中开票/行政信息特征，不应作为 PRD 生成测试用例。",
  );

  const passed = checks.every((item) => item.status === "passed");
  return {
    artifact_type: "requirement_intake_gate_result",
    input: {
      pdf: args.pdf ? path.resolve(args.pdf) : null,
      text_file: args.textFile ? path.resolve(REPO_ROOT, args.textFile) : null,
    },
    passed,
    decision: passed ? "passed" : "blocked",
    reason: passed ? "需求准入检查通过。" : "需求准入检查未通过，停止生成测试用例。",
    checks,
    findings,
    required_actions: passed ? [] : [
      "请提供真实 PRD、需求说明、用户故事或功能变更说明。",
      "如这是需求附件而非 PRD，请同时提供主 PRD。",
      "如确实要对开票信息本身做测试，请明确被测系统、业务流程和验收规则。",
    ],
  };
}

function addIntakeCheck(checks, findings, name, condition, failureMessage) {
  checks.push({
    name,
    status: condition ? "passed" : "failed",
    message: condition ? "OK" : failureMessage,
  });
  if (!condition) findings.push({ severity: "blocker", message: failureMessage });
}

function buildBlockedIntakeRun({ args, workDir, harnessOutDir, textFile, extractedText, intakeGate }) {
  const reviewBrief = {
    summary: {
      clarification_items_total: 1,
      clarification_items_shown: 1,
      manual_review_cases_total: 0,
      manual_review_cases_shown: 0,
      p0_pending_review: 0,
      p1_pending_review: 0,
      accepted_cases: 0,
      gate_samples_blocked: 0,
    },
    clarification_items: [
      {
        id: "CLARIFY-INTAKE-001",
        source_ref: "requirement_intake_gate",
        question: "当前输入不是可测试 PRD。请确认是否上传了错误文件，或补充真实需求文档。",
        impact: "无法可靠拆分需求、测试点、测试策略和测试用例。",
        recommended_action: "提供 PRD 后重新运行；若目标是测试开票信息维护流程，请补充被测系统入口、角色、操作流程和验收规则。",
      },
    ],
    manual_review_cases: [],
    confirmation_prompt: "当前输入未通过需求准入门禁，请先确认/替换 PRD 后再生成测试用例。",
  };
  return {
    input: {
      pdf: args.pdf ? path.resolve(args.pdf) : null,
      text_file: textFile,
      extracted_chars: extractedText.length,
    },
    outputs: {
      work_dir: workDir,
      generator_artifacts: "",
      harness_out_dir: harnessOutDir,
      run_summary_json: path.join(workDir, "run-summary.json"),
      run_summary_md: path.join(workDir, "run-summary.md"),
      review_brief_json: path.join(workDir, "review-brief.json"),
      review_brief_md: path.join(workDir, "review-brief.md"),
      intake_gate_json: path.join(workDir, "intake-gate-result.json"),
      intake_gate_md: path.join(workDir, "intake-gate-result.md"),
    },
    intake_gate: intakeGate,
    generator: {
      requirementUnits: 0,
      testPoints: 0,
      cases: 0,
      p0Cases: 0,
      releaseReadiness: "blocked_by_requirement_intake",
    },
    harness_candidate_quality: {
      raw_requirement_units: 0,
      raw_test_points: 0,
      raw_cases: 0,
      accepted_requirements: 0,
      accepted_function_points: 0,
      accepted_cases: 0,
      rejected_cases: 0,
      acceptance_rate: 0,
      p0_cases: 0,
      p1_cases: 0,
      p2_cases: 0,
    },
    gates: [],
    review_brief: reviewBrief,
  };
}

function buildBlockedClarificationRun({ args, workDir, harnessOutDir, textFile, extractedText, intakeGate, clarificationItems }) {
  const reviewBrief = {
    summary: {
      clarification_items_total: clarificationItems.length,
      clarification_items_shown: clarificationItems.length,
      manual_review_cases_total: 0,
      manual_review_cases_shown: 0,
      p0_pending_review: 0,
      p1_pending_review: 0,
      accepted_cases: 0,
      gate_samples_blocked: 0,
    },
    clarification_items: clarificationItems,
    manual_review_cases: [],
    confirmation_prompt: `请先确认 ${clarificationItems.length} 个需求澄清项；确认后再生成测试用例。`,
  };
  return {
    input: {
      pdf: args.pdf ? path.resolve(args.pdf) : null,
      text_file: textFile,
      extracted_chars: extractedText.length,
      clarification_answers: "",
    },
    outputs: {
      work_dir: workDir,
      generator_artifacts: "",
      harness_out_dir: harnessOutDir,
      run_summary_json: path.join(workDir, "run-summary.json"),
      run_summary_md: path.join(workDir, "run-summary.md"),
      review_brief_json: path.join(workDir, "review-brief.json"),
      review_brief_md: path.join(workDir, "review-brief.md"),
      clarification_gate_json: path.join(workDir, "clarification-gate-result.json"),
      clarification_gate_md: path.join(workDir, "clarification-gate-result.md"),
    },
    intake_gate: intakeGate,
    clarification_gate: {
      decision: "blocked",
      reason: "存在待澄清需求项，停止生成测试用例。",
    },
    generator: {
      requirementUnits: 0,
      testPoints: 0,
      cases: 0,
      p0Cases: 0,
      releaseReadiness: "blocked_by_clarification",
    },
    harness_candidate_quality: {
      raw_requirement_units: 0,
      raw_test_points: 0,
      raw_cases: 0,
      accepted_requirements: 0,
      accepted_function_points: 0,
      accepted_cases: 0,
      rejected_cases: 0,
      acceptance_rate: 0,
      p0_cases: 0,
      p1_cases: 0,
      p2_cases: 0,
    },
    gates: [],
    review_brief: reviewBrief,
  };
}

function buildClarificationGateResult(clarificationItems, args) {
  return {
    artifact_type: "clarification_gate_result",
    decision: "blocked",
    reason: "存在待澄清需求项，必须先确认再生成测试用例。",
    input: {
      pdf: args.pdf ? path.resolve(args.pdf) : null,
      text_file: args.textFile ? path.resolve(REPO_ROOT, args.textFile) : null,
    },
    clarification_items: clarificationItems,
    required_actions: [
      "请逐条确认澄清项。",
      "将确认结果写入 clarification-answers.md，或在对话中说明结论。",
      "确认后使用 --clarifications-confirmed true 重新运行；如有答案文件，同时传入 --clarification-answers <file>。",
    ],
  };
}

function extractPdfToText({ pdfPath, outPath, pythonOverride }) {
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);
  const candidates = [
    pythonOverride,
    process.env.PRD_TO_HARNESS_PYTHON,
    DEFAULT_PYTHON,
    "python3",
    "python",
  ].filter(Boolean);

  const errors = [];
  for (const python of candidates) {
    const result = spawnSync(python, ["-c", PDF_EXTRACTOR, pdfPath], {
      encoding: "utf8",
      maxBuffer: 200 * 1024 * 1024,
    });
    if (result.error) {
      errors.push(`${python}: ${result.error.message}`);
      continue;
    }
    if (result.status !== 0) {
      errors.push(`${python}: ${(result.stderr || "").trim() || `exit ${result.status}`}`);
      continue;
    }
    const text = cleanExtractedText(result.stdout || "");
    if (!text.trim()) throw new Error(`PDF text extraction produced empty text: ${pdfPath}`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${text}\n`, "utf8");
    return outPath;
  }

  throw new Error([
    "Unable to extract PDF text. Install pdfplumber or pass --python to a Python runtime that has it.",
    ...errors.map((item) => `- ${item}`),
  ].join("\n"));
}

function prepareGenerationTextFile({ textFile, workDir, clarificationAnswers }) {
  if (!clarificationAnswers) return textFile;
  const answersPath = path.resolve(REPO_ROOT, clarificationAnswers);
  if (!fs.existsSync(answersPath)) throw new Error(`Clarification answers file not found: ${answersPath}`);
  const combinedPath = path.resolve(REPO_ROOT, workDir, "generation-input-with-clarifications.txt");
  const baseText = fs.readFileSync(textFile, "utf8");
  const answers = fs.readFileSync(answersPath, "utf8");
  fs.writeFileSync(
    combinedPath,
    [
      baseText.trim(),
      "",
      "--- clarified requirement decisions ---",
      answers.trim(),
      "",
    ].join("\n"),
    "utf8",
  );
  return combinedPath;
}

function copyClarificationAnswersToHarness({ clarificationAnswers, harnessOutDir }) {
  if (!clarificationAnswers) return "";
  const answersPath = path.resolve(REPO_ROOT, clarificationAnswers);
  if (!fs.existsSync(answersPath)) return "";
  const targetPath = path.resolve(REPO_ROOT, harnessOutDir, path.basename(answersPath));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(answersPath, targetPath);
  return normalizeRepoPath(targetPath);
}

function runSampleGates({ harnessOutDir, workDir, sampleLimit }) {
  const caseDir = path.resolve(REPO_ROOT, harnessOutDir, "case-samples");
  if (!fs.existsSync(caseDir)) return [];

  return fs.readdirSync(caseDir)
    .filter((file) => file.endsWith(".case.yaml"))
    .sort()
    .slice(0, sampleLimit)
    .map((file) => {
      const casePath = path.join(harnessOutDir, "case-samples", file);
      const outPath = path.join(workDir, "gate-results", file.replace(/\.case\.yaml$/, ".gate-result.yaml"));
      const result = runNodeScript({
        script: path.join(RUNTIME_DIR, "gate-runner.mjs"),
        args: ["--asset", casePath, "--out", outPath],
        label: `gate-runner:${file}`,
        allowedExitCodes: new Set([0, 1]),
      });
      const gateResultPath = path.resolve(REPO_ROOT, outPath);
      return {
        case: casePath,
        result: outPath,
        exit_code: result.status,
        decision: parseGateDecision(gateResultPath) || (result.status === 0 ? "passed" : "blocked_or_failed"),
      };
    });
}

function parseGateDecision(gateResultPath) {
  if (!fs.existsSync(gateResultPath)) return "";
  const content = fs.readFileSync(gateResultPath, "utf8");
  const match = content.match(/\n\s*decision:\n(?:.*\n)*?\s{4}status:\s*"?([^"\n]+)"?/);
  return match?.[1]?.trim() || "";
}

function buildReviewBrief({ generatorArtifacts, extractedText, harnessOutDir, candidateSummary, gateResults, reviewLimit, clarificationsConfirmed = false, clarificationAnswers = "" }) {
  const reviewQueue = loadReviewQueue(harnessOutDir);
  const answerMap = loadClarificationAnswerMap(clarificationAnswers);
  const sourceClarifications = [
    ...(reviewQueue.clarification_items || []),
    ...normalizeClarificationItems(generatorArtifacts.review?.clarificationItems || [], reviewLimit),
    ...inferClarificationItems(extractedText || ""),
  ];
  const clarificationItems = dedupeClarificationItems(sourceClarifications)
    .slice(0, reviewLimit)
    .map((item) => mergeClarificationAnswer(item, answerMap));
  const allManualReviewCases = reviewQueue.manual_review_cases?.length
    ? reviewQueue.manual_review_cases
    : parseAcceptedCasesForReview(path.resolve(REPO_ROOT, harnessOutDir, "accepted-test-cases.yaml"))
      .filter((item) => ["P0", "P1"].includes(item.risk_level) && !["approved", "accepted", "reviewed", "passed"].includes(item.review_status));
  const manualReviewCases = allManualReviewCases.slice(0, reviewLimit);
  const manualReviewTotal = allManualReviewCases.length;
  const clarificationConfirmedTotal = clarificationItems.filter((item) => item.status === "confirmed").length;
  const clarificationPendingTotal = clarificationItems.filter((item) => item.status !== "confirmed").length;

  return {
    summary: {
      clarification_items_total: clarificationItems.length,
      clarification_items_shown: clarificationItems.length,
      clarification_items_confirmed: clarificationConfirmedTotal,
      clarification_items_pending: clarificationPendingTotal,
      manual_review_cases_total: manualReviewTotal,
      manual_review_cases_shown: manualReviewCases.length,
      p0_pending_review: reviewQueue.summary?.p0_pending_review ?? allManualReviewCases.filter((item) => item.risk_level === "P0").length,
      p1_pending_review: reviewQueue.summary?.p1_pending_review ?? allManualReviewCases.filter((item) => item.risk_level === "P1").length,
      accepted_cases: candidateSummary.accepted_cases || allManualReviewCases.length,
      gate_samples_blocked: gateResults.filter((item) => item.decision === "blocked").length,
    },
    clarification_items: clarificationItems,
    manual_review_cases: manualReviewCases,
    confirmation_prompt: buildConfirmationPrompt(clarificationItems, manualReviewTotal, clarificationsConfirmed),
  };
}

function loadReviewQueue(harnessOutDir) {
  const filePath = path.resolve(REPO_ROOT, harnessOutDir, "review-queue.json");
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function syncReviewQueueWithReviewBrief(harnessOutDir, reviewBrief) {
  const queuePath = path.resolve(REPO_ROOT, harnessOutDir, "review-queue.json");
  if (!fs.existsSync(queuePath)) return;
  const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  queue.clarification_items = reviewBrief.clarification_items || [];
  queue.summary = {
    ...(queue.summary || {}),
    clarification_items_total: reviewBrief.summary?.clarification_items_total || 0,
    clarification_items_shown: reviewBrief.summary?.clarification_items_shown || 0,
    clarification_items_confirmed: reviewBrief.summary?.clarification_items_confirmed || 0,
    clarification_items_pending: reviewBrief.summary?.clarification_items_pending || 0,
    manual_review_cases_total: reviewBrief.summary?.manual_review_cases_total || (queue.manual_review_cases || []).length,
    manual_review_cases_shown: reviewBrief.summary?.manual_review_cases_shown || Math.min((queue.manual_review_cases || []).length, 30),
    p0_pending_review: reviewBrief.summary?.p0_pending_review ?? queue.summary?.p0_pending_review ?? 0,
    p1_pending_review: reviewBrief.summary?.p1_pending_review ?? queue.summary?.p1_pending_review ?? 0,
  };
  writeJson(queuePath, queue);
  writeYaml(queuePath.replace(/\.json$/, ".yaml"), queue);
}

function loadClarificationAnswerMap(clarificationAnswers) {
  if (!clarificationAnswers) return new Map();
  const answerPath = path.resolve(REPO_ROOT, clarificationAnswers);
  const candidatePaths = [
    answerPath,
    answerPath.replace(/\.[^.]+$/, ".json"),
  ];
  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath) || !filePath.endsWith(".json")) continue;
    const artifact = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return new Map((artifact.answers || []).map((item) => [item.id, item]));
  }
  if (!fs.existsSync(answerPath)) return new Map();
  return parseMarkdownClarificationAnswers(fs.readFileSync(answerPath, "utf8"));
}

function parseMarkdownClarificationAnswers(text) {
  const answerMap = new Map();
  const sections = text.split(/^### /m).slice(1);
  for (const section of sections) {
    const [idLine, ...rest] = section.split("\n");
    const id = idLine.trim();
    const body = rest.join("\n");
    const answer = (body.match(/^- Answer:\s*(.*)$/m) || [])[1] || "";
    const status = (body.match(/^- Status:\s*(.*)$/m) || [])[1] || (answer && answer !== "N/A" ? "confirmed" : "pending");
    answerMap.set(id, { id, answer, status });
  }
  for (const match of text.matchAll(/^- (CLARIFY-[A-Z0-9-]+)[：:]\s*(.*)$/gm)) {
    const id = match[1].trim();
    if (answerMap.has(id)) continue;
    const answer = match[2].trim();
    answerMap.set(id, { id, answer, status: answer ? "confirmed" : "pending" });
  }
  return answerMap;
}

function mergeClarificationAnswer(item, answerMap) {
  const answer = answerMap.get(item.id);
  if (!answer) return item;
  return {
    ...item,
    answer: answer.answer || "",
    status: answer.status || (answer.answer ? "confirmed" : "pending"),
    answered_by: answer.answered_by || "",
    answered_at: answer.answered_at || "",
  };
}

function normalizeClarificationItems(items, limit) {
  return items.slice(0, limit).map((item, index) => ({
    id: item.id || `CLARIFY-${String(index + 1).padStart(3, "0")}`,
    source_ref: item.sourceRef || item.source_ref || item.requirementId || "",
    question: item.question || item.content || item.description || String(item),
    impact: item.impact || item.reason || "影响需求理解、测试点拆分或预期结果判定。",
    recommended_action: item.recommendedAction || item.recommended_action || "请业务/产品确认后再进入高风险用例评审。",
  }));
}

function inferClarificationItems(text) {
  const items = [];
  const add = (id, sourceRef, question, impact, recommendedAction) => {
    items.push({
      id,
      source_ref: sourceRef,
      question,
      impact,
      recommended_action: recommendedAction,
      source: "harness_heuristic",
    });
  };

  if (/(延期|顺延)/.test(text)) {
    add(
      "CLARIFY-SCOPE-001",
      "scope延期/顺延",
      "车控能力中空调/座椅、车门解锁分别出现“延期/顺延”描述，本版本到底哪些车控功能进入 0330 交付范围？",
      "影响 P0 车控用例是否应纳入本版本准入，以及是否需要阻断发布。",
      "请产品/项目确认本版本范围：空调、座椅、车门解锁分别标注为本期实现、延期、仅联调或不测试。",
    );
  }

  if (/以UE为/.test(text)) {
    add(
      "CLARIFY-DOC-001",
      "需求描述/UE依赖",
      "PRD 写明详细页面内容以 UE 为准，本次生成是否已经包含最终 UE 版本？",
      "缺少 UE 会导致页面元素、文案、布局、跳转入口类用例只能按逻辑描述生成，无法完成 UI 验收。",
      "请提供 UE 链接/版本号/关键截图，或确认当前 PRD 文本足以作为测试依据。",
    );
  }

  if (/智驾云接[口⼝].*两种[方⽅]案|无智驾云接[口⼝]\/有智驾云/.test(text)) {
    add(
      "CLARIFY-DEPENDENCY-001",
      "行程管理/增加途经点",
      "增加途经点存在“无智驾云接口/有智驾云接口”两种方案，0330 版本采用哪一种？",
      "影响订单数据、路径规划、云端接口、状态一致性和回归范围。",
      "请明确采用方案、接口可用时间、降级策略，以及无接口方案下是否只做前端展示。",
    );
  }

  if (/有依赖|依赖项/.test(text)) {
    add(
      "CLARIFY-DEPENDENCY-002",
      "功能清单依赖项",
      "车辆控制、站点推荐、弹窗、短信等功能存在外部依赖，哪些依赖已 ready，哪些需要 mock 或延后测试？",
      "影响测试环境准备、用例可执行性、缺陷归因和发布准出。",
      "请输出依赖清单：接口负责人、联调环境、mock 策略、不可用时的准出判断。",
    );
  }

  if (/至少.*模板|模板ID|5个固定模板/.test(text)) {
    add(
      "CLARIFY-PUSH-001",
      "小程序Push/短信模板",
      "消息订阅写“至少一个模板，后续再增加”，短信写“5个固定模板”，具体模板 ID、触发场景、文案和跳转页面是什么？",
      "影响 Push/短信用例的覆盖矩阵、断言字段和验收口径。",
      "请补充模板清单：模板 ID、触发事件、变量字段、文案、跳转目标、失败重试规则。",
    );
  }

  if (/回调结果|messageId|sms_code|火山/.test(text)) {
    add(
      "CLARIFY-SMS-001",
      "短信接入/回调",
      "短信回调中 messageId、sms_code、渠道标识与业务服务的映射关系和状态枚举是否已有接口定义？",
      "影响短信发送成功/失败统计、幂等、重试、数据一致性和异常回归用例。",
      "请提供火山云回调字段说明、内部接口协议、状态枚举、幂等键和失败处理规则。",
    );
  }

  if (/站点推荐|历史搜索|热[门⻔]站点|跨区域/.test(text)) {
    add(
      "CLARIFY-STATION-001",
      "站点推荐",
      "站点推荐的排序、去重、跨区域提示文案、历史记录清理条件和运营配置优先级是否已确定？",
      "影响推荐列表正确性、边界条件和数据准备。",
      "请确认推荐规则：历史/热门/附近站点数量、排序、去重、无数据兜底、跨区域提示文案。",
    );
  }

  if (/上传图[片⽚]|最大500|20MB|bmp、jpg、png、jpeg/.test(text)) {
    add(
      "CLARIFY-FEEDBACK-001",
      "产品功能反馈",
      "图片上传限制是单张 20MB 还是总大小 20MB？上传 6 张后的替换/删除/失败重试规则是什么？",
      "影响反馈页边界值、异常上传、弱网和数据完整性用例。",
      "请确认图片大小口径、数量限制、删除/重传规则、失败后的缓存与提交策略。",
    );
  }

  if (/34度|38度|42度|实际情况/.test(text)) {
    add(
      "CLARIFY-VEHICLE-001",
      "座椅加热",
      "座椅加热低/中/高与实际车辆能力的映射标准是什么？不同车型不支持时如何展示和下发？",
      "影响车云一致性断言、车型差异和兼容性测试。",
      "请确认车型能力矩阵、温度档位映射、不可用状态展示和接口错误处理。",
    );
  }

  if (/待办/.test(text)) {
    add(
      "CLARIFY-TODO-001",
      "待办项",
      "PRD 中“行程分享的，安全员信息”标为待办，该项是否纳入 0330 测试范围？",
      "影响分享用例是否需要覆盖安全员信息，以及待办未完成时是否影响准出。",
      "请确认待办项归属版本、验收标准和未完成时的发布判断。",
    );
  }

  return items;
}

function dedupeClarificationItems(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = normalizeTextForKey(`${item.source_ref}:${item.question}`);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function normalizeTextForKey(text) {
  return String(text).replace(/\s+/g, "").replace(/[，。；、：:]/g, "").toLowerCase();
}

function buildConfirmationPrompt(clarificationItems, manualReviewTotal, clarificationsConfirmed = false) {
  const clarificationCount = clarificationItems.length;
  const confirmedTotal = clarificationItems.filter((item) => item.status === "confirmed").length;
  const pendingTotal = clarificationCount - confirmedTotal;
  if (clarificationCount > 0) {
    if (clarificationsConfirmed && pendingTotal === 0) {
      return `${clarificationCount} 个需求澄清项已确认；请继续评审 ${manualReviewTotal} 条 P0/P1 候选用例。`;
    }
    if (clarificationsConfirmed && pendingTotal > 0) {
      return `${confirmedTotal} 个需求澄清项已确认，仍有 ${pendingTotal} 个新增/未回答澄清项待确认；请先补充确认，再评审 ${manualReviewTotal} 条 P0/P1 候选用例。`;
    }
    return `请先确认 ${clarificationCount} 个需求澄清项，再评审 ${manualReviewTotal} 条 P0/P1 候选用例。`;
  }
  return `当前生成工具未识别明确需求澄清项；请重点评审 ${manualReviewTotal} 条 P0/P1 候选用例。`;
}

function parseAcceptedCasesForReview(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split(/\n  - id: /)
    .slice(1)
    .map((block) => `id: ${block}`)
    .map((block) => ({
      id: firstYamlValue(block, "id"),
      original_candidate_id: firstYamlValue(block, "original_candidate_id"),
      title: firstYamlValue(block, "title"),
      risk_level: firstNestedYamlValue(block, "risk", "level"),
      review_status: firstNestedYamlValue(block, "review", "status"),
      requirement_ids: listUnderNestedKey(block, "traceability", "requirement_ids"),
      function_point_ids: listUnderNestedKey(block, "traceability", "function_point_ids"),
      expected_result: firstNestedYamlValue(block, "expected_result", "summary"),
    }))
    .filter((item) => item.id);
}

function firstYamlValue(block, key) {
  const match = block.match(new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.*)$`, "m"));
  return cleanYamlScalar(match?.[1] || "");
}

function firstNestedYamlValue(block, parentKey, key) {
  const parent = block.match(new RegExp(`^[ \\t]{4}${escapeRegExp(parentKey)}:\\n([\\s\\S]*?)(?=\\n[ \\t]{4}\\S|\\n[ \\t]{2}- id:|$)`, "m"));
  if (!parent) return "";
  const match = parent[1].match(new RegExp(`^[ \\t]+${escapeRegExp(key)}:[ \\t]*(.*)$`, "m"));
  return cleanYamlScalar(match?.[1] || "");
}

function listUnderNestedKey(block, parentKey, key) {
  const parent = block.match(new RegExp(`^[ \\t]{4}${escapeRegExp(parentKey)}:\\n([\\s\\S]*?)(?=\\n[ \\t]{4}\\S|\\n[ \\t]{2}- id:|$)`, "m"));
  if (!parent) return [];
  const list = parent[1].match(new RegExp(`^[ \\t]+${escapeRegExp(key)}:\\n((?:[ \\t]+-[ \\t]*.*\\n?)+)`, "m"));
  if (!list) return [];
  return [...list[1].matchAll(/^[ \t]+-[ \t]*(.*)$/gm)].map((match) => cleanYamlScalar(match[1])).filter(Boolean);
}

function cleanYamlScalar(value) {
  return value.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runNodeScript({ script, args, label, allowedExitCodes = new Set([0]) }) {
  const result = spawnSync(process.execPath, [path.resolve(REPO_ROOT, script), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (!allowedExitCodes.has(result.status)) {
    throw new Error([
      `${label} failed with exit code ${result.status}.`,
      result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : "",
      result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : "",
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function parseJsonObject(text, label) {
  const trimmed = (text || "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Unable to parse ${label} as JSON: ${error.message}\n${trimmed.slice(0, 1000)}`);
  }
}

function cleanExtractedText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function buildMarkdown(summary) {
  const candidate = summary.harness_candidate_quality || {};
  const review = summary.review_brief?.summary || {};
  const lines = [
    "# PRD to Harness Run",
    "",
    `- Input PDF: ${summary.input.pdf || "N/A"}`,
    `- Text file: ${summary.input.text_file}`,
    `- Extracted chars: ${summary.input.extracted_chars}`,
    `- Generator artifacts: ${summary.outputs.generator_artifacts}`,
    `- Harness output: ${summary.outputs.harness_out_dir}`,
    "",
    "## Intake Gate",
    "",
    `- Decision: ${summary.intake_gate?.decision || "not_run"}`,
    `- Reason: ${summary.intake_gate?.reason || "N/A"}`,
    "",
    "## Clarification Gate",
    "",
    `- Decision: ${summary.clarification_gate?.decision || (review.clarification_items_total > 0 ? "confirmed" : "passed")}`,
    `- Reason: ${summary.clarification_gate?.reason || (review.clarification_items_total > 0 ? "需求澄清项已确认后继续生成。" : "未识别到阻断级需求澄清项。")}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Raw requirement units | ${summary.generator.requirementUnits ?? "N/A"} |`,
    `| Raw test points | ${summary.generator.testPoints ?? "N/A"} |`,
    `| Raw cases | ${summary.generator.cases ?? "N/A"} |`,
    `| Accepted requirements | ${candidate.accepted_requirements ?? "N/A"} |`,
    `| Accepted function points | ${candidate.accepted_function_points ?? "N/A"} |`,
    `| Accepted cases | ${candidate.accepted_cases ?? "N/A"} |`,
    `| Rejected cases | ${candidate.rejected_cases ?? "N/A"} |`,
    `| Acceptance rate | ${candidate.acceptance_rate ?? "N/A"} |`,
    `| P0 cases | ${candidate.p0_cases ?? "N/A"} |`,
    `| P1 cases | ${candidate.p1_cases ?? "N/A"} |`,
    `| Clarification items | ${review.clarification_items_total ?? "N/A"} |`,
    `| Manual review cases | ${review.manual_review_cases_total ?? "N/A"} |`,
    "",
    "## Review Brief",
    "",
    `- ${summary.review_brief?.confirmation_prompt || "N/A"}`,
    `- Review brief: ${summary.outputs.review_brief_md}`,
    "",
    "## Gate Samples",
    "",
    "| Case | Decision | Result |",
    "|---|---|---|",
    ...summary.gates.map((gate) => `| ${gate.case} | ${gate.decision} | ${gate.result} |`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function buildIntakeGateMarkdown(intakeGate) {
  const lines = [
    "# Requirement Intake Gate",
    "",
    `- Decision: ${intakeGate.decision}`,
    `- Reason: ${intakeGate.reason}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Message |",
    "|---|---|---|",
    ...intakeGate.checks.map((item) => `| ${item.name} | ${item.status} | ${item.message} |`),
    "",
    "## Required Actions",
    "",
    ...(intakeGate.required_actions.length ? intakeGate.required_actions.map((item) => `- ${item}`) : ["- N/A"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function buildClarificationGateMarkdown(clarificationGate) {
  const lines = [
    "# Requirement Clarification Gate",
    "",
    `- Decision: ${clarificationGate.decision}`,
    `- Reason: ${clarificationGate.reason}`,
    "",
    "## Clarification Items",
    "",
  ];
  if (!clarificationGate.clarification_items.length) {
    lines.push("- N/A");
  } else {
    lines.push("| ID | Source | Question | Impact | Recommended Action |");
    lines.push("|---|---|---|---|---|");
    for (const item of clarificationGate.clarification_items) {
      lines.push(`| ${item.id} | ${item.source_ref || "N/A"} | ${item.question} | ${item.impact} | ${item.recommended_action} |`);
    }
  }
  lines.push("", "## Required Actions", "");
  for (const item of clarificationGate.required_actions || []) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildReviewBriefMarkdown(reviewBrief) {
  const lines = [
    "# PRD Review Brief",
    "",
    "## Confirmation",
    "",
    reviewBrief.confirmation_prompt,
    "",
    "## Clarification Items",
    "",
  ];

  if (reviewBrief.clarification_items.length === 0) {
    lines.push("- 当前生成工具未识别明确需求澄清项。");
  } else {
    lines.push("| ID | Status | Source | Question | Answer | Impact | Recommended Action |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const item of reviewBrief.clarification_items) {
      lines.push(`| ${item.id} | ${item.status || "pending"} | ${item.source_ref || "N/A"} | ${item.question} | ${item.answer || "N/A"} | ${item.impact} | ${item.recommended_action} |`);
    }
  }

  lines.push("", "## Manual Review Cases", "");
  if (reviewBrief.manual_review_cases.length === 0) {
    lines.push("- 当前没有待人工评审的 P0/P1 用例。");
  } else {
    lines.push("| ID | Risk | Review | Title | Traceability | Expected Result |");
    lines.push("|---|---|---|---|---|---|");
    for (const item of reviewBrief.manual_review_cases) {
      const trace = [...item.requirement_ids, ...item.function_point_ids].join(", ") || "N/A";
      lines.push(`| ${item.id} | ${item.risk_level} | ${item.review_status} | ${item.title} | ${trace} | ${item.expected_result} |`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function compactSummary(summary) {
  return {
    extractedChars: summary.input.extracted_chars,
    intakeGate: summary.intake_gate ? {
      decision: summary.intake_gate.decision,
      reason: summary.intake_gate.reason,
      failedChecks: summary.intake_gate.checks.filter((item) => item.status !== "passed").map((item) => item.name),
    } : undefined,
    clarificationGate: summary.clarification_gate ? {
      decision: summary.clarification_gate.decision,
      reason: summary.clarification_gate.reason,
    } : undefined,
    generator: summary.generator,
    harnessCandidateQuality: summary.harness_candidate_quality,
    reviewBrief: {
      confirmationPrompt: summary.review_brief.confirmation_prompt,
      clarificationItemsTotal: summary.review_brief.summary.clarification_items_total,
      manualReviewCasesTotal: summary.review_brief.summary.manual_review_cases_total,
      manualReviewSamples: summary.review_brief.manual_review_cases.slice(0, 5).map((item) => ({
        id: item.id,
        risk: item.risk_level,
        title: item.title,
        reviewStatus: item.review_status,
      })),
    },
    gateSamples: summary.gates.length,
    outputs: summary.outputs,
  };
}

function writeJson(outPath, data) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeYaml(outPath, data) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${toYaml(data)}\n`, "utf8");
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

function inferWorkDir(args) {
  const baseName = args.pdf || args.textFile || "prd";
  return path.join("vv-automation/harness/reports", slugify(path.basename(baseName, path.extname(baseName))));
}

function inferFeatureName(args) {
  return `${path.basename(args.pdf || args.textFile || "PRD", path.extname(args.pdf || args.textFile || ""))} PRD`;
}

function normalizeAliasArgs(args) {
  if (args["text-file"] && !args.textFile) args.textFile = args["text-file"];
  if (args["out-dir"] && !args.outDir) args.outDir = args["out-dir"];
  if (args["work-dir"] && !args.workDir) args.workDir = args["work-dir"];
  if (args["sample-limit"] && !args.sampleLimit) args.sampleLimit = args["sample-limit"];
  if (args["review-limit"] && !args.reviewLimit) args.reviewLimit = args["review-limit"];
  if (args["allow-non-prd"] && !args.allowNonPrd) args.allowNonPrd = args["allow-non-prd"];
  if (args["clarifications-confirmed"] && !args.clarificationsConfirmed) args.clarificationsConfirmed = args["clarifications-confirmed"];
  if (args["clarification-answers"] && !args.clarificationAnswers) args.clarificationAnswers = args["clarification-answers"];
}

function isEnabled(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
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
  node vv-automation/harness/runtime/prd-to-harness.mjs \\
    --pdf /path/to/prd.pdf \\
    --work-dir vv-automation/harness/reports/prd-0330-auto \\
    --out-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/from-prd-auto \\
    --feature "0330 乘客端小程序 PRD"

  # After clarification items are confirmed:
  node vv-automation/harness/runtime/prd-to-harness.mjs \\
    --pdf /path/to/prd.pdf \\
    --work-dir vv-automation/harness/reports/prd-0330-auto \\
    --out-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/from-prd-auto \\
    --feature "0330 乘客端小程序 PRD" \\
    --clarifications-confirmed true \\
    --clarification-answers vv-automation/harness/reports/prd-0330-auto/clarification-answers.md

  node vv-automation/harness/runtime/prd-to-harness.mjs \\
    --text-file tmp/pdfs/prd-0330/extracted-clean.txt \\
    --out-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/from-prd-auto
`);
}

function normalizeRepoPath(inputPath) {
  const resolved = path.resolve(REPO_ROOT, inputPath);
  return path.relative(REPO_ROOT, resolved).replaceAll(path.sep, "/");
}

function slugify(value) {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || "prd";
}

function findRepoRoot(startDir) {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    current = path.dirname(current);
  }
  return startDir;
}
