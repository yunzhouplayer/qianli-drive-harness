const state = {
  artifacts: null,
  requirementAnalysisReady: false,
  pdfjs: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

$("#addText").addEventListener("click", () => {
  const textarea = document.createElement("textarea");
  textarea.placeholder = "继续输入另一段需求、会议纪要、验收标准或补充说明。";
  $("#requirementInputs").appendChild(textarea);
  resetRequirementAnalysisState();
});

$("#fileInput").addEventListener("change", () => {
  const files = Array.from($("#fileInput").files);
  $("#fileParseStatus").textContent = files.length
    ? `已选择 ${files.length} 个文件，点击“分析需求”后解析正文。`
    : "尚未解析上传文档。";
  resetRequirementAnalysisState();
});

$("#analyzeRequirements").addEventListener("click", async () => {
  await analyzeRequirementsAndRender();
});

$("#runPipeline").addEventListener("click", async () => {
  if (hasOpenClarifications(state.artifacts?.review)) {
    activateTab("clarify");
    $("#fileParseStatus").textContent = "请先逐条完成待澄清项，再生成后续测试资产。";
    updateRunPipelineState(state.artifacts);
    return;
  }
  await generateAndRender();
});

$("#clarify").addEventListener("click", (event) => {
  const skipButton = event.target.closest("[data-skip-open-clarifications]");
  if (skipButton) {
    skipOpenClarifications();
    return;
  }
  const button = event.target.closest("[data-clarification-submit]");
  if (!button) return;
  submitClarificationAnswer(button);
});

$("#exportJson").addEventListener("click", async () => {
  if (!state.artifacts) {
    await generateAndRender();
  }
  const blob = new Blob([JSON.stringify(state.artifacts, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `testcase-generation-${state.artifacts.runId}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

$("#exportAssets").addEventListener("click", async () => {
  if (!state.artifacts) {
    await generateAndRender();
  }
  downloadJson(`test-assets-${state.artifacts.runId}.json`, {
    schema: "contracts/test-assets/case.schema.yaml",
    cases: state.artifacts.testAssets.cases,
  });
});

updateRunPipelineState(null);

async function generateAndRender() {
  if (hasOpenClarifications(state.artifacts?.review)) {
    activateTab("clarify");
    $("#fileParseStatus").textContent = "请先逐条完成待澄清项，再生成后续测试资产。";
    updateRunPipelineState(state.artifacts);
    return;
  }
  const button = $("#runPipeline");
  button.disabled = true;
  button.textContent = "生成资产中...";
  $("#fileParseStatus").textContent = "正在读取上传文档正文...";
  try {
    const requirementAnalysisEnhancement =
      state.artifacts?.requirementAnalysisEnhancement || state.artifacts?.agentEnhancement || null;
    state.artifacts = await runPipeline();
    state.artifacts.requirementAnalysisEnhancement = requirementAnalysisEnhancement;
    state.artifacts.agentEnhancement = await requestAgentEnhancement(state.artifacts);
    applyAgentEnhancementToPipeline(state.artifacts);
    renderAll(state.artifacts);
  } catch (error) {
    $("#fileParseStatus").textContent = `生成失败：${error.message}`;
    throw error;
  } finally {
    updateRunPipelineState(state.artifacts);
  }
}

async function analyzeRequirementsAndRender() {
  const button = $("#analyzeRequirements");
  button.disabled = true;
  button.textContent = "分析中...";
  $("#fileParseStatus").textContent = "正在读取上传文档正文...";
  try {
    const artifacts = await buildRequirementAnalysisDraft();
    artifacts.agentEnhancement = await requestRequirementAnalysis(artifacts);
    applyRequirementAnalysisToReview(artifacts, artifacts.agentEnhancement);
    artifacts.requirementAnalysisEnhancement = artifacts.agentEnhancement;
    state.artifacts = artifacts;
    state.requirementAnalysisReady = true;
    renderRequirementAnalysisStage(artifacts);
    updateRunPipelineState(artifacts);
  } catch (error) {
    $("#fileParseStatus").textContent = `需求分析失败：${error.message}`;
    throw error;
  } finally {
    button.disabled = false;
    button.textContent = "分析需求";
  }
}

function resetRequirementAnalysisState() {
  state.requirementAnalysisReady = false;
  updateRunPipelineState(null);
}

function hasOpenClarifications(review) {
  return Boolean((review?.clarificationItems || []).some(isClarificationOpen));
}

function countOpenClarifications(review) {
  return (review?.clarificationItems || []).filter(isClarificationOpen).length;
}

function isClarificationOpen(item) {
  return !["resolved_by_human", "skipped_by_human", "closed"].includes(item?.status);
}

function isClarificationProcessed(item) {
  return !isClarificationOpen(item);
}

function updateRunPipelineState(artifacts) {
  const button = $("#runPipeline");
  if (!button) return;
  if (!state.requirementAnalysisReady || !artifacts) {
    button.disabled = true;
    button.textContent = "先分析需求";
    return;
  }
  const openCount = countOpenClarifications(artifacts.review);
  if (openCount) {
    button.disabled = true;
    button.textContent = `先完成 ${openCount} 个澄清`;
    return;
  }
  button.disabled = false;
  button.textContent = "生成后续测试资产";
}

async function requestRequirementAnalysis(artifacts) {
  if (typeof fetch !== "function") {
    return buildClientAgentFallback("fetch_unavailable");
  }
  try {
    const response = await fetch("/api/requirement-analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ artifacts }),
    });
    if (!response.ok) return buildClientAgentFallback(`http_${response.status}`);
    return await response.json();
  } catch (error) {
    return buildClientAgentFallback(error.message);
  }
}

async function requestAgentEnhancement(artifacts) {
  if (typeof fetch !== "function") {
    return buildClientAgentFallback("fetch_unavailable");
  }
  try {
    const response = await fetch("/api/agent-generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ artifacts }),
    });
    if (!response.ok) return buildClientAgentFallback(`http_${response.status}`);
    return await response.json();
  } catch (error) {
    return buildClientAgentFallback(error.message);
  }
}

function buildClientAgentFallback(reason) {
  return {
    artifactId: "LLM-RAG-AGENT-ENHANCEMENT-CLIENT-FALLBACK",
    mode: "client_rule_fallback",
    llmEnabled: false,
    retrievedKnowledge: [],
    agentFindings: [
      {
        agent: "review-agent",
        finding: `未连接本地 LLM/RAG 后端，当前使用前端规则结果。原因：${reason}`,
      },
    ],
    suggestedClarifications: [],
    additionalTestIdeas: [],
    reviewFindings: [],
    agentWorkflow: [
      {
        agent: "review-agent",
        stage: "client_fallback",
        role: "前端回退提示",
        input: ["浏览器本地规则结果"],
        output: ["fallback 状态说明"],
        findings: [`未连接本地 LLM/RAG 后端，当前使用前端规则结果。原因：${reason}`],
        handoffTo: "human-reviewer",
        status: "needs_review",
        summary: "后端 Agent workflow 不可用。",
      },
    ],
  };
}

function applyRequirementAnalysisToReview(artifacts, enhancement) {
  const analysis = enhancement?.requirementAnalysis;
  const analyzedUnits = normalizeAnalyzedRequirementUnits(analysis);
  if (!analyzedUnits.length) return;

  const intake = artifacts.intake;
  const humanClarifications = intake.humanClarifications || [];
  const dedupedUnits = dedupeRequirementLikeItems(analyzedUnits, (item) => item.requirement || item.content || item.title || "");
  const requirementUnits = dedupedUnits.map((item, index) => ({
    id: item.id || `LLM-REQ-${String(index + 1).padStart(3, "0")}`,
    sourceTextRef: item.sourceRef || "REQ-TEXT-001",
    content: item.requirement || item.content || item.title || "",
    title: item.title || (item.requirement || item.content || "").slice(0, 36),
    type: item.type || "function",
    priority: item.priority || classifyRequirementPriority(item.requirement || item.content || item.title || ""),
    rationale: item.rationale || "",
    generatedBy: enhancement.llmEnabled ? "llm-product-agent" : "rag-rule-product-agent",
  }));
  const businessGoals = requirementUnits.map((item) => ({
    id: `GOAL-${item.id}`,
    sourceRef: item.id,
    summary: item.content,
  }));
  const clarificationItems = normalizeAgentClarificationItems(
    [
      ...(analysis.ambiguities || []).map((item) => ({
        sourceRef: item.sourceRef,
        question: item.issue || item.suggestedClarification,
        reason: item.suggestedClarification,
        source: "requirement_analysis_ambiguity",
      })),
      ...(enhancement.agentGeneratedAssets?.productClarifications || []).map((item) => ({
        sourceRef: item.sourceRef,
        question: item.question,
        reason: item.acceptanceImpact,
        source: "product_agent_clarification",
      })),
      ...(enhancement.suggestedClarifications || []).map((item) => ({
        sourceRef: item.sourceRef,
        question: item.question,
        reason: item.reason,
        source: "llm_suggested_clarification",
      })),
    ],
    humanClarifications,
    "LLM-CLARIFY",
  );
  const unresolvedClarifications = clarificationItems.filter(isClarificationOpen).length;
  const acceptanceCriteria = requirementUnits.map((item, index) => ({
    id: `LLM-AC-${String(index + 1).padStart(3, "0")}`,
    sourceRef: item.id,
    criteria: `${item.content} 应具备明确触发条件、系统处理、用户可见反馈和可验证证据。`,
  }));
  const clarifiedCriteria = humanClarifications.map((item, index) => ({
    id: `AC-HUMAN-${String(index + 1).padStart(3, "0")}`,
    sourceRef: item.id,
    criteria: item.content,
  }));
  artifacts.review = {
    ...artifacts.review,
    artifactId: "REQ-REVIEW-LLM-001",
    agent: "product-agent",
    generatedBy: enhancement.llmEnabled ? "llm_rag_requirement_analysis" : enhancement.mode,
    requirementUnits,
    businessGoals,
    clarificationItems,
    humanClarifications,
    acceptanceCriteria: [...acceptanceCriteria, ...clarifiedCriteria],
    clarityScore: Math.max(60, Math.min(100, 100 - unresolvedClarifications * 10)),
    clearEnough: unresolvedClarifications === 0,
  };
}

function normalizeAgentClarificationItems(items, humanClarifications, idPrefix) {
  const seen = new Set();
  const normalized = [];
  (items || []).forEach((item) => {
    const question = item.question || item.issue || item.suggestedClarification || "";
    if (!question) return;
    const sourceRef = item.sourceRef || "LLM-REQ-UNKNOWN";
    const key = `${sourceRef}:${buildRequirementFingerprint(question)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const matchedClarification = findMatchingHumanClarification(
      question,
      { content: `${question} ${item.reason || item.acceptanceImpact || ""}` },
      humanClarifications,
    );
    normalized.push({
      id: `${idPrefix}-${String(normalized.length + 1).padStart(3, "0")}`,
      sourceRef,
      keyword: "llm_clarification",
      question,
      reason: item.reason || item.acceptanceImpact || "",
      generatedBy: item.source || "llm_suggested_clarification",
      status: matchedClarification ? "resolved_by_human" : "pending_human_confirmation",
      resolvedBy: matchedClarification?.id || null,
    });
  });
  return normalized;
}

function mergeAgentClarificationsIntoReview(review, enhancement, intake) {
  const humanClarifications = intake.humanClarifications || review.humanClarifications || [];
  const agentItems = normalizeAgentClarificationItems(
    [
      ...(enhancement?.agentGeneratedAssets?.productClarifications || []).map((item) => ({
        sourceRef: item.sourceRef,
        question: item.question,
        reason: item.acceptanceImpact,
        source: "product_agent_clarification",
      })),
      ...(enhancement?.suggestedClarifications || []).map((item) => ({
        sourceRef: item.sourceRef,
        question: item.question,
        reason: item.reason,
        source: "llm_suggested_clarification",
      })),
      ...(enhancement?.agentReflectionFindings || [])
        .filter((item) => item.type === "clarification_gap")
        .map((item) => ({
          sourceRef: item.sourceRef,
          question: item.finding,
          reason: item.recommendation,
          source: "critic_agent_clarification_gap",
        })),
    ],
    humanClarifications,
    "AGENT-CLARIFY",
  );
  const existing = review.clarificationItems || [];
  const merged = [...existing];
  const seen = new Set(existing.map((item) => `${item.sourceRef}:${buildRequirementFingerprint(item.question || "")}`));
  agentItems.forEach((item) => {
    const key = `${item.sourceRef}:${buildRequirementFingerprint(item.question || "")}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      ...item,
      id: `AGENT-CLARIFY-${String(merged.length + 1).padStart(3, "0")}`,
    });
  });
  const unresolvedClarifications = merged.filter(isClarificationOpen).length;
  return {
    ...review,
    humanClarifications,
    clarificationItems: merged,
    clarityScore: Math.max(60, Math.min(100, 100 - unresolvedClarifications * 10)),
    clearEnough: unresolvedClarifications === 0,
  };
}

function appendClarificationAcceptanceCriteria(review) {
  const existing = review.acceptanceCriteria || [];
  const existingIds = new Set(existing.map((item) => item.id));
  const clarificationCriteria = (review.clarificationItems || [])
    .filter((item) => item.status === "resolved_by_human" && item.resolvedBy)
    .map((item, index) => ({
      id: `AC-CLARIFY-${String(index + 1).padStart(3, "0")}`,
      sourceRef: item.id,
      criteria: findHumanClarificationForItem(item, review.humanClarifications || [])?.content || item.question,
    }))
    .filter((item) => !existingIds.has(item.id));
  return {
    ...review,
    acceptanceCriteria: [...existing, ...clarificationCriteria],
  };
}

function normalizeAnalyzedRequirementUnits(analysis) {
  if (!analysis) return [];
  if (analysis.requirementUnits?.length) {
    return analysis.requirementUnits
      .map((item, index) => ({
        id: item.id || `LLM-REQ-${String(index + 1).padStart(3, "0")}`,
        sourceRef: item.sourceRef,
        title: item.title,
        requirement: item.requirement || item.content || item.capability || item.title,
        type: item.type,
        priority: item.priority,
        rationale: item.rationale,
      }))
      .filter((item) => item.requirement);
  }
  return (analysis.businessCapabilities || [])
    .map((item, index) => ({
      id: `LLM-REQ-${String(index + 1).padStart(3, "0")}`,
      sourceRef: item.sourceRef,
      title: item.capability,
      requirement: item.capability,
      type: "function",
      priority: classifyRequirementPriority(item.capability || ""),
      rationale: item.rationale,
    }))
    .filter((item) => item.requirement);
}

function applyHumanClarificationsToReview(review, intake) {
  const humanClarifications = intake.humanClarifications || [];
  const clarificationItems = (review.clarificationItems || []).map((item) => {
    const matchedClarification = findMatchingHumanClarification(item.keyword || item.question, { id: item.id, content: item.question }, humanClarifications);
    return {
      ...item,
      status: matchedClarification ? "resolved_by_human" : item.status,
      resolvedBy: matchedClarification?.id || item.resolvedBy || null,
    };
  });
  const clarifiedCriteria = humanClarifications.map((item, index) => ({
    id: `AC-HUMAN-${String(index + 1).padStart(3, "0")}`,
    sourceRef: item.id,
    criteria: item.content,
  }));
  const acceptanceCriteria = [
    ...(review.acceptanceCriteria || []).filter((item) => !String(item.id).startsWith("AC-HUMAN-")),
    ...clarifiedCriteria,
  ];
  const unresolvedClarifications = clarificationItems.filter(isClarificationOpen).length;
  return {
    ...review,
    humanClarifications,
    clarificationItems,
    acceptanceCriteria,
    clarityScore: Math.max(60, Math.min(100, 100 - unresolvedClarifications * 10)),
    clearEnough: unresolvedClarifications === 0,
  };
}

function applyAgentEnhancementToPipeline(artifacts) {
  const enhancement = artifacts.agentEnhancement;
  const assets = enhancement?.agentGeneratedAssets;
  artifacts.review = appendClarificationAcceptanceCriteria(
    mergeAgentClarificationsIntoReview(artifacts.review, enhancement, artifacts.intake),
  );
  if (!assets?.testPoints?.length || !assets?.testCases?.length) {
    recomputeDownstreamArtifacts(artifacts);
    return;
  }

  artifacts.technical = convertAgentTechnical(assets, artifacts.technical);
  artifacts.testPoints = convertAgentTestPoints(assets);
  artifacts.strategy = testingStrategy(artifacts.testPoints, artifacts.review);
  artifacts.strategy.generatedBy = enhancement.llmEnabled ? "llm-testing-agent" : enhancement.mode;
  artifacts.cases = convertAgentTestCases(assets);
  recomputeDownstreamArtifacts(artifacts);
}

function convertAgentTechnical(assets, fallbackTechnical) {
  const impacts = (assets.developmentImpacts || []).map((item, index) => ({
    id: item.id || `LLM-TECH-${String(index + 1).padStart(3, "0")}`,
    sourceRef: item.sourceRef || "LLM-REQ-UNKNOWN",
    summary: item.impact || item.summary || "LLM 识别的技术影响。",
    testability: item.testability || "needs_probe",
    generatedBy: "llm-development-agent",
  }));
  const domains = Array.from(new Set([...(fallbackTechnical.domains || []), ...impacts.map((item) => inferDomainFromText(item.summary))]));
  return {
    ...fallbackTechnical,
    artifactId: "TECH-IMPACT-LLM-001",
    agent: "development-agent",
    domains,
    interfaceCandidates: domains.map((domain) => `${domain}_service_api`),
    impacts,
  };
}

function convertAgentTestPoints(assets) {
  return {
    artifactId: "TEST-POINTS-LLM-001",
    agent: "testing-agent",
    points: assets.testPoints.map((item, index) => ({
      id: item.id || `LLM-TP-${String(index + 1).padStart(3, "0")}`,
      sourceRef: item.sourceRef || "LLM-REQ-UNKNOWN",
      type: "llm_reasoned",
      priority: item.priority || "P2",
      description: item.title || item.risk || "LLM 生成测试点",
      risk: item.risk || "",
      generatedBy: "llm-testing-agent",
    })),
  };
}

function convertAgentTestCases(assets) {
  return assets.testCases.map((item, index) => {
    const priority = item.priority || "P2";
    return {
      id: item.id || `LLM-CASE-${String(index + 1).padStart(3, "0")}`,
      title: item.title || "LLM 生成候选用例",
      type: "functional",
      priority,
      sourceRefs: item.sourceRefs?.length ? item.sourceRefs : [`LLM-TP-${String(index + 1).padStart(3, "0")}`],
      preconditions: item.preconditions?.length ? item.preconditions : ["测试用户、订单、车辆或相关业务数据已准备。"],
      steps: item.steps?.length ? item.steps : ["进入相关业务入口。", "按需求描述完成关键操作。", "采集关键状态和证据。"],
      expectedResult: item.expectedResults?.join("；") || item.expectedResult || "系统行为与验收标准一致，关键状态和用户可见反馈正确。",
      reviewStatus: priority === "P0" || priority === "P1" ? "pending_human_review" : "auto_reviewed",
      reviewHistory:
        priority === "P0" || priority === "P1"
          ? []
          : [
              {
                status: "auto_reviewed",
                reviewer: "testing-agent",
                reviewedAt: new Date().toISOString(),
                note: "LLM P2 用例自动评审通过",
              },
            ],
      generatedBy: "llm-testing-agent",
    };
  });
}

function recomputeDownstreamArtifacts(artifacts) {
  artifacts.reviewResult = reviewCases(artifacts.cases, artifacts.testPoints, artifacts.review);
  artifacts.traceability = buildTraceability(
    artifacts.intake,
    artifacts.review,
    artifacts.technical,
    artifacts.testPoints,
    artifacts.cases,
  );
  artifacts.testAssets = buildTestAssets(artifacts.cases, artifacts.traceability, artifacts.reviewResult);
  artifacts.gateResults = runQualityGates(artifacts.testAssets.cases);
  artifacts.releaseReadiness = buildReleaseReadiness(
    artifacts.reviewResult,
    artifacts.traceability,
    artifacts.cases,
    artifacts.gateResults,
  );
  artifacts.collaboration = buildCollaborationBoard(
    artifacts.intake,
    artifacts.review,
    artifacts.technical,
    artifacts.testPoints,
    artifacts.strategy,
    artifacts.cases,
    artifacts.reviewResult,
    artifacts.gateResults,
  );
}

function inferDomainFromText(text) {
  if (hasAny(text, ["支付", "计费", "结算"])) return "billing_settlement";
  if (hasAny(text, ["车辆", "车端", "Push", "短信", "消息"])) return "vehicle_cloud";
  if (hasAny(text, ["登录", "身份"])) return "identity";
  if (hasAny(text, ["调度", "派单", "匹配"])) return "dispatch";
  return "mobile_passenger";
}

async function readRequirementFiles(files) {
  const parsed = [];
  for (const [index, file] of files.entries()) {
    const id = `REQ-FILE-${String(index + 1).padStart(3, "0")}`;
    $("#fileParseStatus").textContent = `正在解析 ${file.name}...`;
    parsed.push(await readRequirementFile(file, id));
  }
  return parsed;
}

async function readRequirementFile(file, id) {
  const metadata = {
    id,
    name: file.name,
    type: file.type || inferFileType(file.name),
    size: file.size,
    extractionStatus: "metadata_only",
    pageCount: 0,
    charCount: 0,
    parser: "none",
  };

  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const extracted = await extractPdfRequirementText(file);
    metadata.extractionStatus = extracted.content ? "parsed" : "empty";
    metadata.pageCount = extracted.pageCount;
    metadata.charCount = extracted.content.length;
    metadata.parser = "pdfjs-dist";
    return buildParsedFileResult(file, id, metadata, extracted.content);
  }

  if (file.type?.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(file.name)) {
    const content = normalizeRequirementText(await file.text());
    metadata.extractionStatus = content ? "parsed" : "empty";
    metadata.charCount = content.length;
    metadata.parser = "File.text";
    return buildParsedFileResult(file, id, metadata, content);
  }

  if (file.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name)) {
    metadata.extractionStatus = "manual_transcript_required";
    metadata.parser = "manual_multimodal_transcript";
    return buildParsedFileResult(file, id, metadata, "");
  }

  metadata.extractionStatus = "unsupported";
  return buildParsedFileResult(file, id, metadata, "");
}

function buildParsedFileResult(file, id, metadata, content) {
  return {
    file: metadata,
    text: {
      id: `${id}-TEXT`,
      content,
      sourceType: "file",
      fileRef: id,
      fileName: file.name,
      pageCount: metadata.pageCount,
      charCount: content.length,
    },
  };
}

async function extractPdfRequirementText(file) {
  if (typeof file.arrayBuffer !== "function") {
    return { content: "", pageCount: 0 };
  }
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    $("#fileParseStatus").textContent = `正在解析 ${file.name}：${pageNumber}/${pdf.numPages} 页`;
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => item.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) pages.push(`第 ${pageNumber} 页\n${pageText}`);
  }
  return {
    content: normalizeRequirementText(pages.join("\n")),
    pageCount: pdf.numPages,
  };
}

async function loadPdfJs() {
  if (state.pdfjs) return state.pdfjs;
  const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", window.location.href).href;
  state.pdfjs = pdfjs;
  return pdfjs;
}

function inferFileType(name) {
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.(txt|md|csv|json)$/i.test(name)) return "text/plain";
  return "unknown";
}

document.addEventListener("click", (event) => {
  const action = event.target?.dataset?.action;
  if (!action || !state.artifacts) return;
  if (action === "approve-case" || action === "reject-case") {
    applyCaseReview(
      event.target.dataset.caseId,
      action === "approve-case" ? "approved_by_human" : "rejected_by_human",
      action === "approve-case" ? "人工确认通过" : "人工退回",
    );
  }
  if (action === "approve-high-risk") {
    state.artifacts.cases
      .filter((testCase) => testCase.reviewStatus === "pending_human_review")
      .forEach((testCase) => {
        recordCaseReview(testCase, "approved_by_human", "批量通过 P0/P1 用例");
      });
    refreshReviewState();
  }
});

$$(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".tab").forEach((item) => item.classList.remove("active"));
    $$(".tab-panel").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    $(`#${button.dataset.tab}`).classList.add("active");
  });
});

async function runPipeline() {
  const { normalizedTexts, files, humanClarifications, runId } = await collectRequirementIntake();
  const intake = productIntake(normalizedTexts, files, humanClarifications, runId);
  const review = state.artifacts?.review?.requirementUnits?.length
    ? applyHumanClarificationsToReview(state.artifacts.review, intake)
    : productReview(intake);
  const technical = developmentAnalysis(review);
  const testPoints = testingPoints(review, technical);
  const strategy = testingStrategy(testPoints, review);
  const cases = testingCases(testPoints, strategy);
  const reviewResult = reviewCases(cases, testPoints, review);
  const traceability = buildTraceability(intake, review, technical, testPoints, cases);
  const testAssets = buildTestAssets(cases, traceability, reviewResult);
  const gateResults = runQualityGates(testAssets.cases);
  const releaseReadiness = buildReleaseReadiness(reviewResult, traceability, cases, gateResults);
  const collaboration = buildCollaborationBoard(
    intake,
    review,
    technical,
    testPoints,
    strategy,
    cases,
    reviewResult,
    gateResults,
  );

  return {
    runId,
    agents: ["product-agent", "development-agent", "testing-agent", "review-agent"],
    collaboration,
    intake,
    review,
    technical,
    testPoints,
    strategy,
    cases,
    reviewResult,
    traceability,
    testAssets,
    gateResults,
    releaseReadiness,
  };
}

async function buildRequirementAnalysisDraft() {
  const { normalizedTexts, files, humanClarifications, runId } = await collectRequirementIntake();
  const intake = productIntake(normalizedTexts, files, humanClarifications, runId);
  const review = productReview(intake);
  const technical = emptyTechnicalAnalysis();
  const testPoints = { artifactId: "TEST-POINTS-PENDING", agent: "testing-agent", points: [] };
  const strategy = emptyTestingStrategy(review);
  const cases = [];
  const reviewResult = reviewCases(cases, testPoints, review);
  const traceability = [];
  const testAssets = buildTestAssets(cases, traceability, reviewResult);
  const gateResults = runQualityGates(testAssets.cases);
  const releaseReadiness = buildReleaseReadiness(reviewResult, traceability, cases, gateResults);
  const collaboration = buildCollaborationBoard(
    intake,
    review,
    technical,
    testPoints,
    strategy,
    cases,
    reviewResult,
    gateResults,
  );

  return {
    runId,
    phase: "requirement_analysis",
    agents: ["product-agent"],
    collaboration,
    intake,
    review,
    technical,
    testPoints,
    strategy,
    cases,
    reviewResult,
    traceability,
    testAssets,
    gateResults,
    releaseReadiness,
  };
}

async function collectRequirementIntake() {
  const texts = Array.from(document.querySelectorAll("#requirementInputs textarea"))
    .map((item, index) => ({
      id: `REQ-TEXT-${String(index + 1).padStart(3, "0")}`,
      content: item.value.trim(),
    }))
    .filter((item) => item.content.length > 0);

  const parsedFiles = await readRequirementFiles(Array.from($("#fileInput").files));
  const files = parsedFiles.map((item) => item.file);
  const fileTexts = parsedFiles
    .filter((item) => item.text.content.length > 0)
    .map((item) => item.text);
  const multimodalNotes = $("#multimodalNotes").value.trim()
    ? [
        {
          id: "REQ-MULTIMODAL-001",
          content: $("#multimodalNotes").value.trim(),
          sourceType: "manual_multimodal_transcript",
        },
      ]
    : [];
  const humanClarifications = $("#humanClarifications").value
    .split(/\n+/)
    .map((item, index) => ({
      id: `HUMAN-CLARIFY-${String(index + 1).padStart(3, "0")}`,
      content: item.trim(),
    }))
    .filter((item) => item.content.length > 0);
  const itemClarifications = Array.from(document.querySelectorAll("[data-clarification-input]"))
    .map((textarea) => {
      const content = textarea.value.trim();
      if (!content) return null;
      return {
        id: `HUMAN-${textarea.dataset.clarificationId}`,
        clarificationId: textarea.dataset.clarificationId,
        sourceRef: textarea.dataset.sourceRef,
        question: textarea.dataset.question,
        content,
      };
    })
    .filter(Boolean);

  const requirementTexts = [...texts, ...fileTexts, ...multimodalNotes];
  const normalizedTexts = requirementTexts.length
    ? requirementTexts
    : [
        {
          id: "REQ-TEXT-001",
          content:
            "用户可以在乘客端发起叫车，系统需要在可服务区域内匹配车辆，并实时展示订单状态。",
        },
      ];

  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return {
    runId,
    normalizedTexts,
    files,
    humanClarifications: mergeHumanClarifications(humanClarifications, itemClarifications),
  };
}

function mergeHumanClarifications(base, additions) {
  const merged = [];
  const seen = new Set();
  [...(base || []), ...(additions || [])].forEach((item) => {
    const key = item.clarificationId || buildRequirementFingerprint(item.content || "");
    if (!item.content || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

function submitClarificationAnswer(button) {
  if (!state.artifacts?.review) return;
  const clarificationId = button.dataset.clarificationSubmit;
  const textarea = document.querySelector(`[data-clarification-input][data-clarification-id="${cssEscape(clarificationId)}"]`);
  const content = textarea?.value.trim();
  if (!content) return;
  const item = state.artifacts.review.clarificationItems.find((entry) => entry.id === clarificationId);
  const answer = {
    id: `HUMAN-${clarificationId}`,
    clarificationId,
    sourceRef: item?.sourceRef || textarea.dataset.sourceRef || "",
    question: item?.question || textarea.dataset.question || "",
    content,
  };
  state.artifacts.intake.humanClarifications = mergeHumanClarifications(
    (state.artifacts.intake.humanClarifications || []).filter((entry) => entry.clarificationId !== clarificationId),
    [answer],
  );
  state.artifacts.review = appendClarificationAcceptanceCriteria(
    applyHumanClarificationsToReview(state.artifacts.review, state.artifacts.intake),
  );
  if (state.artifacts.cases?.length) {
    recomputeDownstreamArtifacts(state.artifacts);
    renderAll(state.artifacts);
  } else {
    renderRequirementAnalysisStage(state.artifacts);
  }
  updateRunPipelineState(state.artifacts);
  activateTab("clarify");
}

function cssEscape(value) {
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function skipOpenClarifications() {
  if (!state.artifacts?.review) return;
  const skippedAt = new Date().toISOString();
  let skippedCount = 0;
  state.artifacts.review = {
    ...state.artifacts.review,
    clarificationItems: (state.artifacts.review.clarificationItems || []).map((item) => {
      if (!isClarificationOpen(item)) return item;
      skippedCount += 1;
      return {
        ...item,
        status: "skipped_by_human",
        skippedBy: "human-reviewer",
        skippedAt,
        skipReason: "用户选择批量跳过，后续测试资产按当前需求信息生成。",
      };
    }),
  };
  const unresolvedClarifications = (state.artifacts.review.clarificationItems || []).filter(isClarificationOpen).length;
  state.artifacts.review = {
    ...state.artifacts.review,
    clarityScore: Math.max(60, Math.min(100, 100 - unresolvedClarifications * 10)),
    clearEnough: unresolvedClarifications === 0,
  };
  $("#fileParseStatus").textContent = skippedCount
    ? `已跳过 ${skippedCount} 个澄清项，可继续生成后续测试资产。`
    : "当前没有可跳过的澄清项。";
  if (state.artifacts.cases?.length) {
    recomputeDownstreamArtifacts(state.artifacts);
    renderAll(state.artifacts);
  } else {
    renderRequirementAnalysisStage(state.artifacts);
  }
  updateRunPipelineState(state.artifacts);
  activateTab("clarify");
}

function buildReleaseReadiness(reviewResult, traceability, cases, gateResults) {
  const highRiskPending = cases.filter(
    (testCase) =>
      (testCase.priority === "P0" || testCase.priority === "P1") && testCase.reviewStatus === "pending_human_review",
  ).length;
  const missingTrace = traceability.filter((item) => !item.testPoint || !item.requirementInputs.length).length;
  const blockedAssets = gateResults.results.filter((item) => item.status === "blocked").length;
  const gates = [
    {
      id: "coverage_threshold",
      name: "需求闭环覆盖率 >= 95%",
      status: reviewResult.coverageRate >= 95 ? "passed" : "blocked",
      evidence: `${reviewResult.coverageRate}%`,
    },
    {
      id: "adoption_threshold",
      name: "采纳率 >= 90%",
      status: reviewResult.adoptionRate >= 90 ? "passed" : "blocked",
      evidence: `${reviewResult.adoptionRate}%`,
    },
    {
      id: "high_risk_review",
      name: "P0/P1 人工评审完成",
      status: highRiskPending === 0 ? "passed" : "blocked",
      evidence: `${highRiskPending} 条待人工评审`,
    },
    {
      id: "traceability_complete",
      name: "用例追溯完整",
      status: missingTrace === 0 ? "passed" : "blocked",
      evidence: `${missingTrace} 条缺少追溯`,
    },
    {
      id: "asset_quality_gates",
      name: "测试资产质量门禁通过",
      status: blockedAssets === 0 ? "passed" : "blocked",
      evidence: `${blockedAssets} 个资产 blocked`,
    },
  ];
  return {
    artifactId: "RELEASE-READINESS-001",
    status: gates.every((gate) => gate.status === "passed") ? "ready" : "not_ready",
    gates,
  };
}

function buildCollaborationBoard(intake, review, technical, testPoints, strategy, cases, reviewResult, gateResults) {
  const unresolvedClarifications = review.clarificationItems.filter(isClarificationOpen).length;
  const p0Cases = cases.filter((testCase) => testCase.priority === "P0").length;
  const p1Cases = cases.filter((testCase) => testCase.priority === "P1").length;
  const blockedAssets = gateResults.results.filter((item) => item.status === "blocked").length;
  const uncoveredRequirements = reviewResult.uncoveredRequirementUnitIds?.length || 0;
  const criticWarnings = blockedAssets + uncoveredRequirements;
  return {
    artifactId: "AGILE-COLLABORATION-001",
    method: "agile-test-development",
    agents: [
      {
        id: "product-agent",
        role: "需求拆解与验收标准",
        owns: ["INTAKE", "REQ-REVIEW", "CLARIFY"],
        produced: [intake.artifactId, review.artifactId],
        handoffTo: "development-agent",
        status: unresolvedClarifications ? "needs_clarification" : "done",
        summary: `${review.requirementUnits.length} 个需求单元，${review.clarificationItems.length} 个澄清项，${unresolvedClarifications} 个未解决。`,
      },
      {
        id: "development-agent",
        role: "技术影响与可测性分析",
        owns: ["TECH-IMPACT"],
        produced: [technical.artifactId],
        handoffTo: "testing-agent",
        status: technical.impacts.length ? "done" : "needs_review",
        summary: `${technical.domains.length} 个业务/技术域，${technical.impacts.length} 条技术影响。`,
      },
      {
        id: "testing-agent",
        role: "测试点、策略与用例生成",
        owns: ["TEST-POINTS", "TEST-STRATEGY", "TEST-CASES"],
        produced: [testPoints.artifactId, strategy.artifactId],
        handoffTo: "review-agent",
        status: blockedAssets ? "needs_human_review" : "done",
        summary: `${testPoints.points.length} 个测试点，${cases.length} 条用例，${p0Cases} 条 P0，${p1Cases} 条 P1。`,
      },
      {
        id: "review-agent",
        role: "Harness Gate 与准出质量校验",
        owns: ["CASE-REVIEW", "QUALITY-GATES", "RELEASE-READINESS"],
        produced: [reviewResult.artifactId, gateResults.gateSet],
        handoffTo: "critic-agent",
        status: blockedAssets ? "needs_human_review" : "done",
        summary: `${blockedAssets} 个资产被门禁阻断，P0/P1 用例需人工确认后进入主资产。`,
      },
      {
        id: "critic-agent",
        role: "反思评审与缺口修复建议",
        owns: ["REFLECTION-FINDINGS", "COVERAGE-GAPS", "REPAIR-SCOPE"],
        produced: [reviewResult.artifactId, gateResults.gateSet],
        handoffTo: "human-reviewer",
        status: criticWarnings ? "needs_review" : "done",
        summary: `${uncoveredRequirements} 个需求闭环缺口，${blockedAssets} 个门禁阻断；覆盖或质量缺口需进入 repair 或人工复核。`,
      },
    ],
  };
}

function productIntake(texts, files, humanClarifications, runId) {
  return {
    artifactId: `INTAKE-${runId}`,
    agent: "product-agent",
    texts,
    files,
    documentStats: {
      parsedFiles: files.filter((file) => file.extractionStatus === "parsed").length,
      parsedPages: files.reduce((total, file) => total + (file.pageCount || 0), 0),
      parsedChars: texts.reduce((total, text) => total + text.content.length, 0),
    },
    humanClarifications,
    sourceType: "requirement",
  };
}

function productReview(intake) {
  const sentences = dedupeRequirementLikeItems(splitRequirementTexts(intake.texts), (item) => item.content).map((item, index) => ({
    ...item,
    id: `REQ-SENT-${String(index + 1).padStart(3, "0")}`,
  }));
  const ambiguityKeywords = ["尽快", "实时", "友好", "合理", "高效", "适当", "支持"];
  const clarificationItems = [];

  sentences.forEach((sentence, index) => {
    ambiguityKeywords.forEach((keyword) => {
      if (sentence.content.includes(keyword)) {
        const matchedClarification = findMatchingHumanClarification(keyword, sentence, intake.humanClarifications);
        clarificationItems.push({
          id: `CLARIFY-${String(clarificationItems.length + 1).padStart(3, "0")}`,
          sourceRef: sentence.id,
          keyword,
          question: `“${keyword}”需要明确可测试阈值或验收标准。`,
          status: matchedClarification ? "resolved_by_human" : "pending_human_confirmation",
          resolvedBy: matchedClarification?.id || null,
        });
      }
    });
  });

  const businessGoals = extractGoals(sentences);
  const acceptanceCriteria = businessGoals.map((goal, index) => ({
    id: `AC-${String(index + 1).padStart(3, "0")}`,
    sourceRef: goal.sourceRef,
    criteria: `${goal.summary} 应具备明确输入、处理结果和用户可见反馈。`,
  }));
  const clarifiedCriteria = intake.humanClarifications.map((item, index) => ({
    id: `AC-HUMAN-${String(index + 1).padStart(3, "0")}`,
    sourceRef: item.id,
    criteria: item.content,
  }));

  const unresolvedClarifications = clarificationItems.filter(isClarificationOpen).length;
  const clarityScore = Math.max(60, Math.min(100, 100 - unresolvedClarifications * 10));

  return {
    artifactId: "REQ-REVIEW-001",
    agent: "product-agent",
    requirementUnits: sentences,
    businessGoals,
    clarificationItems,
    humanClarifications: intake.humanClarifications,
    acceptanceCriteria: [...acceptanceCriteria, ...clarifiedCriteria],
    clarityScore,
    clearEnough: clarityScore >= 80,
  };
}

function findMatchingHumanClarification(keyword, sentence, humanClarifications) {
  const sourceTokens = extractClarificationTokens(sentence.content);
  return humanClarifications.find((item) => {
    const content = item.content;
    if (item.clarificationId && item.clarificationId === sentence.id) return true;
    if (item.question && buildRequirementFingerprint(item.question) === buildRequirementFingerprint(sentence.content)) return true;
    if (!content.includes(keyword) && !sourceTokens.some((token) => content.includes(token))) return false;
    return /\d+\s*(秒|分钟|次|%|米|公里|个|条|小时)|阈值|标准|口径|规则|范围|条件|提示|失败|成功/.test(content);
  });
}

function extractClarificationTokens(content) {
  return ["实时", "匹配", "状态", "车辆", "订单", "无车", "提示", "站点", "短信", "Push", "支付", "登录"].filter((token) =>
    content.includes(token),
  );
}

function developmentAnalysis(review) {
  const domains = new Set(["order", "mobile_passenger"]);
  const impacts = [];

  review.businessGoals.forEach((goal, index) => {
    if (hasAny(goal.summary, ["车辆", "匹配", "调度", "派单"])) {
      domains.add("dispatch");
      domains.add("vehicle");
    }
    if (hasAny(goal.summary, ["支付", "计费", "账单"])) {
      domains.add("payment");
      domains.add("billing_settlement");
    }
    if (hasAny(goal.summary, ["状态", "实时", "同步", "推送"])) {
      domains.add("vehicle_cloud");
      domains.add("oms");
    }
    impacts.push({
      id: `TECH-${String(index + 1).padStart(3, "0")}`,
      sourceRef: goal.sourceRef,
      summary: `需要验证 ${goal.summary} 的系统边界、状态流转和数据一致性。`,
      testability: "automatable",
    });
  });

  return {
    artifactId: "TECH-IMPACT-001",
    agent: "development-agent",
    domains: Array.from(domains),
    interfaceCandidates: Array.from(domains).map((domain) => `${domain}_service_api`),
    dataDependencies: ["synthetic_user", "synthetic_order", "synthetic_vehicle"],
    toolingNeeds: ["fixture_factory", "status_timeline_collector", "validator_runner"],
    impacts,
  };
}

function emptyTechnicalAnalysis() {
  return {
    artifactId: "TECH-IMPACT-PENDING",
    agent: "development-agent",
    domains: [],
    interfaceCandidates: [],
    dataDependencies: [],
    toolingNeeds: [],
    impacts: [],
  };
}

function testingPoints(review, technical) {
  const points = [];
  review.acceptanceCriteria.forEach((criteria) => {
    const priority = classifyRequirementPriority(criteria.criteria);
    points.push({
      id: `TP-${String(points.length + 1).padStart(3, "0")}`,
      sourceRef: criteria.id,
      type: "positive",
      priority,
      description: `验证：${criteria.criteria}`,
    });
    points.push({
      id: `TP-${String(points.length + 1).padStart(3, "0")}`,
      sourceRef: criteria.id,
      type: "negative",
      priority: priority === "P0" ? "P1" : "P2",
      description: `验证异常输入或前置条件不满足时，系统有明确失败反馈。`,
    });
  });

  technical.impacts.forEach((impact) => {
    points.push({
      id: `TP-${String(points.length + 1).padStart(3, "0")}`,
      sourceRef: impact.id,
      type: "state_consistency",
      priority: classifyRequirementPriority(impact.summary) === "P0" ? "P0" : "P1",
      description: impact.summary,
    });
  });

  return {
    artifactId: "TEST-POINTS-001",
    agent: "testing-agent",
    points,
  };
}

function emptyTestingStrategy(review) {
  return {
    artifactId: "TEST-STRATEGY-PENDING",
    agent: "testing-agent",
    scope: "pending_after_clarification",
    approach: ["需求分析完成并补充澄清后，再生成测试策略、测试点和测试用例。"],
    entryCriteria: review.clearEnough ? "可进入后续生成。" : "仍有待澄清项，暂不进入后续生成。",
    riskSummary: "待需求澄清后评估。",
  };
}

function classifyRequirementPriority(text) {
  if (hasAny(text, ["安全", "登录", "支付", "计费", "结算", "订单", "车辆控制", "座椅控制", "空调", "短信", "Push", "消息模板"])) {
    return "P0";
  }
  if (hasAny(text, ["调度", "派单", "匹配", "状态", "实时", "站点", "行程", "途经点", "推荐", "分享", "反馈", "弹窗"])) {
    return "P1";
  }
  return "P2";
}

function testingStrategy(testPoints, review) {
  const p0Count = testPoints.points.filter((point) => point.priority === "P0").length;
  const p1Count = testPoints.points.filter((point) => point.priority === "P1").length;
  return {
    artifactId: "TEST-STRATEGY-001",
    agent: "testing-agent",
    scope: "functional_testing",
    approach: [
      "优先覆盖主流程、P0 阻断风险和 P1 高风险点。",
      "每条用例必须关联测试点和需求来源。",
      "P0/P1 用例必须人工评审。",
      "本期不展开性能、兼容性和接口自动化，只保留扩展点。",
    ],
    entryCriteria: review.clearEnough
      ? "需求清晰度达标，可以生成候选用例。"
      : "需求仍有澄清项，生成结果只能作为草案。",
    riskSummary: `共识别 ${p0Count} 个 P0 测试点、${p1Count} 个 P1 测试点。`,
  };
}

function testingCases(testPoints, strategy) {
  return testPoints.points.map((point, index) => {
    const priority = point.priority;
    const steps = buildCaseSteps(point);
    const expectedResult = buildExpectedResult(point);
    return {
      id: `CASE-FUNC-${String(index + 1).padStart(3, "0")}`,
      title: point.description.replace(/^验证：?/, "").slice(0, 48),
      type: "functional",
      priority,
      sourceRefs: [point.sourceRef, point.id],
      preconditions: ["测试用户、订单、车辆或相关业务数据已准备。"],
      steps,
      expectedResult,
      reviewStatus: priority === "P0" || priority === "P1" ? "pending_human_review" : "auto_reviewed",
      reviewHistory:
        priority === "P0" || priority === "P1"
          ? []
          : [
              {
                status: "auto_reviewed",
                reviewer: "testing-agent",
                reviewedAt: new Date().toISOString(),
                note: "P2 用例自动评审通过",
              },
            ],
      generatedBy: strategy.agent,
    };
  });
}

function buildCaseSteps(point) {
  const text = point.description;
  if (hasAny(text, ["用户登录", "登录页优化", "登录"])) {
    return [
      "打开乘客端小程序并进入登录页。",
      "使用合法手机号或授权方式完成登录。",
      "检查登录成功后的首页跳转、用户态缓存和再次进入小程序的登录态保持。",
    ];
  }
  if (hasAny(text, ["叫车", "订单", "匹配车辆", "空闲车辆"])) {
    return [
      "打开乘客端小程序并进入叫车入口。",
      "选择上车点、目的地或推荐站点后发起叫车。",
      "检查订单创建、车辆匹配、订单状态展示和无车失败提示。",
    ];
  }
  if (hasAny(text, ["车辆控制", "座椅控制", "空调"])) {
    return [
      "进入行程中的车辆控制入口。",
      "分别触发座椅控制和空调控制操作。",
      "采集小程序操作反馈、云端控制接口返回和车端状态回传。",
    ];
  }
  if (hasAny(text, ["站点推荐", "历史", "热点"])) {
    return [
      "进入下车站点选择页面。",
      "查看历史站点和热点站点推荐列表。",
      "选择一个推荐站点并提交，记录站点名称、位置和订单目的地更新结果。",
    ];
  }
  if (hasAny(text, ["增加途经点", "途经点"])) {
    return [
      "创建或进入一个可编辑目的地的行程。",
      "添加一个途经点并调整目的地顺序。",
      "提交后检查行程路线、订单详情和云端接口中的途经点数据。",
    ];
  }
  if (hasAny(text, ["小程序Push", "消息模板", "Push"])) {
    return [
      "在小程序中完成消息订阅授权。",
      "触发满足模板消息发送条件的业务事件。",
      "检查模板消息内容、跳转链接和用户接收状态。",
    ];
  }
  if (hasAny(text, ["短信接入", "短信", "火山云"])) {
    return [
      "触发需要发送短信的业务场景。",
      "检查短信服务商调用请求和返回结果。",
      "核对用户收到的短信内容、发送时间和失败重试/降级记录。",
    ];
  }
  if (hasAny(text, ["分享", "小程序页面分享"])) {
    return [
      "进入支持分享的小程序页面。",
      "触发页面分享并打开分享链接。",
      "检查分享标题、路径参数和被分享用户打开后的页面状态。",
    ];
  }
  if (hasAny(text, ["产品功能反馈", "反馈入口"])) {
    return [
      "进入产品功能反馈入口。",
      "提交包含文本和可选联系方式的反馈内容。",
      "检查提交成功提示、后台记录和异常输入提示。",
    ];
  }
  if (hasAny(text, ["弹窗"])) {
    return [
      "构造满足弹窗展示条件的用户或订单状态。",
      "进入目标页面并观察弹窗展示。",
      "操作关闭、确认或跳转按钮，检查弹窗状态不重复或按规则再次展示。",
    ];
  }
  return [
    "进入相关业务入口。",
    "按需求描述完成关键操作。",
    "采集页面状态、接口返回或业务状态流转。",
  ];
}

function buildExpectedResult(point) {
  const text = point.description;
  if (point.type === "negative") return "异常输入或前置条件不满足时，系统给出明确失败提示，且不产生错误业务状态。";
  if (hasAny(text, ["用户登录", "登录页优化", "登录"])) return "用户登录成功后进入正确页面，登录态稳定保存，失败场景有明确提示。";
  if (hasAny(text, ["叫车", "订单", "匹配车辆", "空闲车辆"])) return "订单创建成功，车辆匹配和订单状态展示正确，无车场景给出明确失败提示。";
  if (hasAny(text, ["车辆控制", "座椅控制", "空调"])) return "控制指令下发成功，用户可见反馈、云端接口返回和车端状态保持一致。";
  if (hasAny(text, ["站点推荐", "历史", "热点"])) return "推荐列表展示正确，用户选择后目的地或下车点按推荐站点更新。";
  if (hasAny(text, ["增加途经点", "途经点"])) return "途经点被正确保存到行程路线和订单数据中，顺序及展示一致。";
  if (hasAny(text, ["小程序Push", "消息模板", "Push"])) return "订阅授权和模板消息发送链路正常，消息内容、跳转和接收状态正确。";
  if (hasAny(text, ["短信接入", "短信", "火山云"])) return "短信发送请求、服务商响应和用户收到内容一致，失败链路有记录或降级处理。";
  return "系统行为与验收标准一致，关键状态和用户可见反馈正确。";
}

function reviewCases(cases, testPoints, review) {
  const coverage = computeReviewCoverage(cases, testPoints, review);
  const coverageRate = coverage.requirementCoverageRate || coverage.testPointCoverageRate;
  const highRiskPending = cases.filter((item) => item.reviewStatus === "pending_human_review").length;
  const rejected = cases.filter((item) => item.reviewStatus === "rejected_by_human").length;
  const reviewed = cases.filter((item) => item.reviewStatus !== "pending_human_review").length;
  const unresolvedClarifications = (review.clarificationItems || []).filter(isClarificationOpen).length;
  const predictedAdoption = Math.max(70, Math.min(96, coverageRate - unresolvedClarifications * 5));
  const adoptionRate =
    highRiskPending === 0 && reviewed > 0 ? Math.round(((reviewed - rejected) / reviewed) * 100) : predictedAdoption;

  return {
    artifactId: "CASE-REVIEW-001",
    agent: "testing-agent",
    coverageRate,
    requirementCoverageRate: coverage.requirementCoverageRate,
    testPointCoverageRate: coverage.testPointCoverageRate,
    uncoveredRequirementUnitIds: coverage.uncoveredRequirementUnitIds,
    coverageBasis: "requirement_traceability",
    adoptionRate,
    findings: [
      `${coverage.coveredRequirementUnits}/${coverage.totalRequirementUnits} 个需求单元已有测试点和用例闭环覆盖。`,
      `${coverage.coveredTestPoints}/${coverage.totalTestPoints} 个测试点已有用例引用。`,
      `${highRiskPending} 条 P0/P1 用例需要人工评审。`,
      `${rejected} 条用例被人工退回。`,
      highRiskPending > 0 ? "高风险用例需要人工评审后才能进入执行链路。" : "无需强制人工评审。",
      adoptionRate >= 90 ? "采纳率预测达标。" : "采纳率预测未达标，需要补充澄清或人工优化。",
      coverageRate >= 95 ? "覆盖率预测达标。" : "覆盖率预测未达标，需要补充测试点或用例。",
    ],
  };
}

function computeReviewCoverage(cases, testPoints, review) {
  const requirementIds = new Set((review.requirementUnits || []).map((item) => item.id));
  const acceptanceToRequirement = new Map((review.acceptanceCriteria || []).map((item) => [item.id, item.sourceRef]));
  const pointIds = new Set((testPoints.points || []).map((item) => item.id));
  const pointRequirementMap = new Map();
  (testPoints.points || []).forEach((point) => {
    if (requirementIds.has(point.sourceRef)) pointRequirementMap.set(point.id, point.sourceRef);
    else if (requirementIds.has(acceptanceToRequirement.get(point.sourceRef))) {
      pointRequirementMap.set(point.id, acceptanceToRequirement.get(point.sourceRef));
    }
  });
  const coveredTestPoints = new Set();
  const coveredRequirementUnits = new Set();

  cases.forEach((testCase) => {
    const pointRefs = (testCase.sourceRefs || []).filter((ref) => pointIds.has(ref));
    pointRefs.forEach((pointId) => {
      coveredTestPoints.add(pointId);
      const requirementId = pointRequirementMap.get(pointId);
      if (requirementId) coveredRequirementUnits.add(requirementId);
    });
  });

  const totalRequirementUnits = requirementIds.size;
  const totalTestPoints = pointIds.size;
  const requirementCoverageRate = totalRequirementUnits
    ? Math.round((coveredRequirementUnits.size / totalRequirementUnits) * 100)
    : 0;
  const testPointCoverageRate = totalTestPoints ? Math.round((coveredTestPoints.size / totalTestPoints) * 100) : 0;

  return {
    totalRequirementUnits,
    coveredRequirementUnits: coveredRequirementUnits.size,
    requirementCoverageRate,
    uncoveredRequirementUnitIds: Array.from(requirementIds).filter((id) => !coveredRequirementUnits.has(id)),
    totalTestPoints,
    coveredTestPoints: coveredTestPoints.size,
    testPointCoverageRate,
  };
}

function applyCaseReview(caseId, reviewStatus, note) {
  const target = state.artifacts.cases.find((testCase) => testCase.id === caseId);
  if (!target) return;
  recordCaseReview(target, reviewStatus, note);
  refreshReviewState();
}

function recordCaseReview(testCase, reviewStatus, note) {
  testCase.reviewStatus = reviewStatus;
  testCase.reviewHistory = testCase.reviewHistory || [];
  testCase.reviewHistory.push({
    status: reviewStatus,
    reviewer: "human-reviewer",
    reviewedAt: new Date().toISOString(),
    note,
  });
}

function refreshReviewState() {
  state.artifacts.reviewResult = reviewCases(state.artifacts.cases, state.artifacts.testPoints, state.artifacts.review);
  state.artifacts.traceability = buildTraceability(
    state.artifacts.intake,
    state.artifacts.review,
    state.artifacts.technical,
    state.artifacts.testPoints,
    state.artifacts.cases,
  );
  state.artifacts.testAssets = buildTestAssets(
    state.artifacts.cases,
    state.artifacts.traceability,
    state.artifacts.reviewResult,
  );
  state.artifacts.gateResults = runQualityGates(state.artifacts.testAssets.cases);
  state.artifacts.releaseReadiness = buildReleaseReadiness(
    state.artifacts.reviewResult,
    state.artifacts.traceability,
    state.artifacts.cases,
    state.artifacts.gateResults,
  );
  state.artifacts.collaboration = buildCollaborationBoard(
    state.artifacts.intake,
    state.artifacts.review,
    state.artifacts.technical,
    state.artifacts.testPoints,
    state.artifacts.strategy,
    state.artifacts.cases,
    state.artifacts.reviewResult,
    state.artifacts.gateResults,
  );
  renderAll(state.artifacts);
}

function runQualityGates(testAssets) {
  return {
    gateSet: "harness-quality-gates.v1",
    runId: `GATE-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    results: testAssets.map((asset) => {
      const gateResults = [
        schemaGate(asset),
        traceabilityGate(asset),
        validatorGate(asset),
        evidenceGate(asset),
        reviewGate(asset),
      ];
      const hasBlocked = gateResults.some((gate) => gate.status === "blocked" || gate.status === "failed");
      const hasWarning = gateResults.some((gate) => gate.status === "warning");
      return {
        assetId: asset.id,
        status: hasBlocked ? "blocked" : hasWarning ? "warning" : "passed",
        executable: !hasBlocked,
        gates: gateResults,
      };
    }),
  };
}

function schemaGate(asset) {
  const required = ["id", "version", "title", "scenario", "execution", "fixture", "validators", "expected_result", "review"];
  const missing = required.filter((field) => asset[field] === undefined || asset[field] === null || asset[field] === "");
  return {
    gateId: "schema_gate",
    status: missing.length ? "blocked" : "passed",
    findings: missing.map((field) => `缺少必填字段：${field}`),
  };
}

function traceabilityGate(asset) {
  const findings = [];
  if (!asset.source?.type) findings.push("缺少 source.type");
  if (!asset.source?.ref) findings.push("缺少 source.ref");
  return {
    gateId: "traceability_gate",
    status: findings.length ? "blocked" : "passed",
    findings,
  };
}

function validatorGate(asset) {
  const findings = [];
  if (!asset.validators?.length) findings.push("缺少 validator 引用");
  if (!asset.expected_result?.summary) findings.push("缺少 expected_result.summary");
  return {
    gateId: "validator_gate",
    status: findings.length ? "blocked" : "passed",
    findings,
  };
}

function evidenceGate(asset) {
  const findings = [];
  if (!asset.expected_result?.evidence?.length) findings.push("缺少 evidence 声明");
  return {
    gateId: "evidence_gate",
    status: findings.length ? "warning" : "passed",
    findings,
  };
}

function reviewGate(asset) {
  const findings = [];
  const highRisk = asset.risk?.level === "P0" || asset.risk?.level === "P1";
  if (!asset.review?.status) findings.push("缺少 review.status");
  if (highRisk && asset.review?.status !== "approved") findings.push("P0/P1 高风险用例必须人工评审通过");
  if (asset.review?.status === "rejected") findings.push("用例已被人工退回");
  return {
    gateId: "review_gate",
    status: findings.length ? "blocked" : "passed",
    findings,
  };
}

function buildTestAssets(cases, traceability, reviewResult) {
  const traceByCase = new Map(traceability.map((item) => [item.caseId, item]));
  return {
    contract: "contracts/test-assets/case.schema.yaml",
    generatedAt: new Date().toISOString(),
    cases: cases.map((testCase) => {
      const trace = traceByCase.get(testCase.id);
      return {
        id: testCase.id,
        version: "v1",
        title: testCase.title,
        description: `由测试用例自动生成工具生成，来源：${testCase.sourceRefs.join(", ")}`,
        scenario: "SCN-AUTO-GENERATED-FUNCTIONAL-001",
        source: {
          type: "requirement",
          ref: trace?.requirementInputs?.join(", ") || "REQ-TEXT-001",
        },
        execution: {
          type: "scenario",
          environment: "test",
          timeout_seconds: 300,
          retry: {
            enabled: false,
            max_attempts: 1,
          },
        },
        fixture: "FIXTURE-AUTO-GENERATED-SYNTHETIC-001",
        steps: testCase.steps.map((step, index) => ({
          name: `步骤 ${index + 1}`,
          action: step,
        })),
        tools: [],
        validators: ["VALIDATOR-AUTO-GENERATED-EXPECTED-RESULT-001"],
        expected_result: {
          summary: testCase.expectedResult,
          evidence: ["execution_log", "status_snapshot", "review_record"],
        },
        risk: {
          level: testCase.priority,
          impact_tags: ["passenger_experience", "order_lifecycle"],
        },
        tags: ["auto-generated", "functional", "web-mvp"],
        created_by: "agent",
        review: {
          status: mapReviewStatus(testCase.reviewStatus),
          source_status: testCase.reviewStatus,
          history: testCase.reviewHistory || [],
          adoption_rate: reviewResult.adoptionRate,
          coverage_rate: reviewResult.coverageRate,
        },
      };
    }),
  };
}

function mapReviewStatus(status) {
  if (status === "approved_by_human" || status === "auto_reviewed") return "approved";
  if (status === "rejected_by_human") return "rejected";
  return "pending_review";
}

function buildTraceability(intake, review, technical, testPoints, cases) {
  return cases.map((testCase) => ({
    caseId: testCase.id,
    testPoint: testCase.sourceRefs.find(isTestPointRef),
    upstreamRefs: testCase.sourceRefs,
    requirementInputs: intake.texts.map((text) => text.id),
    humanClarifications: intake.humanClarifications.map((item) => item.id),
    clarificationCount: review.clarificationItems.length,
    technicalImpactCount: technical.impacts.length,
  }));
}

function isTestPointRef(ref) {
  return /^TP-/.test(ref) || /(^|-)TP-/.test(ref);
}

function renderAll(artifacts) {
  updateFileParseStatus(artifacts);
  updateSteps(artifacts);
  $("#coverageMetric").textContent = `${artifacts.reviewResult.coverageRate}%`;
  $("#adoptionMetric").textContent = `${artifacts.reviewResult.adoptionRate}%`;
  renderCollaboration(artifacts);
  renderAgentEnhancement(artifacts);
  renderReview(artifacts);
  renderRequirementUnits(artifacts);
  renderClarify(artifacts);
  renderTech(artifacts);
  renderPoints(artifacts);
  renderStrategy(artifacts);
  renderCases(artifacts);
  renderReadiness(artifacts);
  renderTrace(artifacts);
  renderArtifacts(artifacts);
  renderAssets(artifacts);
  updateRunPipelineState(artifacts);
}

function renderRequirementAnalysisStage(artifacts) {
  updateFileParseStatus(artifacts);
  updateSteps(artifacts);
  $("#coverageMetric").textContent = "0%";
  $("#adoptionMetric").textContent = "0%";
  renderCollaboration(artifacts);
  renderAgentEnhancement(artifacts);
  renderReview(artifacts);
  renderRequirementUnits(artifacts);
  renderClarify(artifacts);
  $("#tech").innerHTML = '<p class="muted">待用户补充澄清后生成技术影响分析。</p>';
  $("#points").innerHTML = '<p class="muted">待用户补充澄清后生成测试点。</p>';
  $("#strategy").innerHTML = '<p class="muted">待用户补充澄清后生成测试策略。</p>';
  $("#cases").innerHTML = '<p class="muted">待用户补充澄清后生成测试用例。</p>';
  $("#readiness").innerHTML = '<p class="muted">待测试资产生成后计算准出门禁。</p>';
  $("#trace").innerHTML = '<p class="muted">待测试资产生成后生成追溯矩阵。</p>';
  renderArtifacts(artifacts);
  $("#assets").innerHTML = '<p class="muted">待后续测试资产生成。</p>';
  updateRunPipelineState(artifacts);
  activateTab(artifacts.review.clarificationItems.length ? "clarify" : "review");
}

function activateTab(tabId) {
  $$(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === tabId));
  $$(".tab-panel").forEach((item) => item.classList.toggle("active", item.id === tabId));
}

function renderAgentEnhancement({ requirementAnalysisEnhancement, agentEnhancement }) {
  const analysisEnhancement = requirementAnalysisEnhancement || agentEnhancement || buildClientAgentFallback("not_requested");
  const enhancement = agentEnhancement || buildClientAgentFallback("not_requested");
  const knowledge = enhancement.retrievedKnowledge?.length ? enhancement.retrievedKnowledge : analysisEnhancement.retrievedKnowledge || [];
  const summary = enhancement.generationSummary || {};
  const analysisSummary = analysisEnhancement.analysisSummary || {};
  const findings = enhancement.agentReflectionFindings || [];
  const openFindings = findings.filter((item) => item.status !== "closed" && item.severity !== "info");
  $("#llm").innerHTML = `
    <h3>LLM/RAG 增强</h3>
    <div class="summary-grid">
      <div class="summary-card">
        <label>需求分析</label>
        <strong>${escapeHtml(analysisEnhancement.mode || "-")}</strong>
        <span class="badge ${analysisEnhancement.llmEnabled ? "ok" : "warn"}">${analysisEnhancement.llmEnabled ? "LLM" : "fallback"}</span>
        <p>${analysisSummary.analyzedRequirementUnits || analysisEnhancement.requirementAnalysis?.requirementUnits?.length || 0} 个需求单元</p>
      </div>
      <div class="summary-card">
        <label>资产生成</label>
        <strong>${escapeHtml(enhancement.mode || "-")}</strong>
        <span class="badge ${enhancement.llmEnabled ? "ok" : "warn"}">${enhancement.llmEnabled ? "LLM" : "fallback"}</span>
        <p>${summary.generatedTestPoints || enhancement.agentGeneratedAssets?.testPoints?.length || 0} 个测试点，${summary.generatedTestCases || enhancement.agentGeneratedAssets?.testCases?.length || 0} 条用例</p>
      </div>
      <div class="summary-card">
        <label>需求闭环覆盖率</label>
        <strong>${summary.requirementCoverageRate ?? summary.coverageRate ?? 0}%</strong>
        <span class="badge ${(summary.requirementCoverageRate ?? summary.coverageRate ?? 0) >= 100 ? "ok" : "warn"}">target 100%</span>
        <p>${summary.coveredRequirementUnits || 0}/${summary.totalRequirementUnits || 0} 已覆盖</p>
      </div>
      <div class="summary-card">
        <label>测试点覆盖率</label>
        <strong>${summary.testPointCoverageRate ?? 0}%</strong>
        <span class="badge ${(summary.testPointCoverageRate ?? 0) >= 100 ? "ok" : "warn"}">target 100%</span>
        <p>${openFindings.length ? `${openFindings.length} 个待处理发现` : "Critic 已闭环"}</p>
      </div>
    </div>
    ${renderGenerationSummary(enhancement.generationSummary)}
    ${renderAgentWorkflow(enhancement.agentWorkflow)}
    ${renderReflectionFindings(enhancement.agentReflectionFindings)}
    <details>
      <summary>高级详情</summary>
      <h4>第一阶段需求解析</h4>
      ${renderRequirementAnalysis(analysisEnhancement.requirementAnalysis, { compact: true })}
      ${renderAgentWorkflow(analysisEnhancement.agentWorkflow)}
      ${renderAgentGeneratedAssets(enhancement.agentGeneratedAssets, { compact: true })}
      <h4>RAG 命中文档</h4>
      ${
        knowledge.length
          ? `<table><thead><tr><th>路径</th><th>分数</th><th>摘要</th></tr></thead><tbody>${knowledge
              .slice(0, 8)
              .map((item) => `<tr><td>${escapeHtml(item.path)}</td><td>${item.score}</td><td>${escapeHtml(item.excerpt || "")}</td></tr>`)
              .join("")}</tbody></table>`
          : '<p class="muted">暂无 RAG 命中，或当前使用纯前端回退。</p>'
      }
      <h4>Agent 发现</h4>
      <ul>${(enhancement.agentFindings || []).slice(0, 12).map((item) => `<li><strong>${item.agent}</strong> ${escapeHtml(item.finding)}</li>`).join("")}</ul>
      <h4>补充测试想法</h4>
      ${
        enhancement.additionalTestIdeas?.length
          ? `<table><thead><tr><th>来源</th><th>优先级</th><th>标题</th><th>原因</th></tr></thead><tbody>${enhancement.additionalTestIdeas
              .slice(0, 12)
              .map((item) => `<tr><td>${item.sourceRef}</td><td>${item.priority}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.reason || "")}</td></tr>`)
              .join("")}</tbody></table>`
          : '<p class="muted">暂无补充测试想法。</p>'
      }
    </details>
  `;
}

function renderAgentWorkflow(workflow) {
  if (!workflow?.length) {
    return '<h4>Agent Workflow</h4><p class="muted">暂无结构化 Agent 参与记录。</p>';
  }
  return `
    <h4>Agent Workflow</h4>
    <table><thead><tr><th>Agent</th><th>职责</th><th>输入</th><th>输出</th><th>发现</th><th>交接</th><th>状态</th></tr></thead><tbody>
      ${workflow
        .map(
          (item) => `<tr>
            <td>${escapeHtml(item.agent || item.id || "")}</td>
            <td>${escapeHtml(item.role || "")}</td>
            <td>${escapeHtml((item.input || []).join("；"))}</td>
            <td>${escapeHtml((item.output || []).join("；"))}</td>
            <td>${escapeHtml((item.findings || []).join("；") || item.summary || "")}</td>
            <td>${escapeHtml(item.handoffTo || "")}</td>
            <td><span class="badge ${item.status === "done" ? "ok" : item.status === "blocked" ? "block" : "warn"}">${escapeHtml(item.status || "")}</span></td>
          </tr>`,
        )
        .join("")}
    </tbody></table>
  `;
}

function renderGenerationSummary(summary) {
  if (!summary) {
    return '<p class="muted">尚未生成后续测试资产。</p>';
  }
  const uncovered = summary.uncoveredRequirementUnitIds || [];
  const hasFailures = (summary.failedChunks || 0) > 0;
  return `
    <h4>生成结果</h4>
    <p>
      <span class="badge ${hasFailures ? "warn" : "ok"}">${hasFailures ? `${summary.failedChunks} 个分片回退` : "LLM 分片全部成功"}</span>
      <span class="badge ${(summary.requirementCoverageRate ?? 0) >= 100 ? "ok" : "warn"}">需求 ${summary.requirementCoverageRate ?? summary.coverageRate ?? 0}%</span>
      <span class="badge ${(summary.testPointCoverageRate ?? 0) >= 100 ? "ok" : "warn"}">测试点 ${summary.testPointCoverageRate ?? 0}%</span>
      <span class="badge ${summary.reflectionStatus === "closed" ? "ok" : "warn"}">${escapeHtml(summary.reflectionStatus || "")}</span>
    </p>
    <p class="muted">生成 ${summary.generatedTestPoints || 0} 个测试点、${summary.generatedTestCases || 0} 条用例；修复 ${summary.repairRounds || 0} 轮，补偿 ${summary.compensatedAssets || 0} 个资产。</p>
    <details>
      <summary>分片与覆盖详情</summary>
      <table><thead><tr><th>分片</th><th>成功</th><th>回退</th><th>需求闭环</th><th>测试点覆盖</th></tr></thead><tbody>
        <tr>
          <td>${summary.chunkCount || 0}</td>
          <td>${summary.succeededChunks || 0}</td>
          <td>${summary.failedChunks || 0}</td>
          <td>${summary.coveredRequirementUnits || 0}/${summary.totalRequirementUnits || 0}</td>
          <td>${summary.testPointCoverageRate ?? 0}%</td>
        </tr>
      </tbody></table>
      ${
        uncovered.length
          ? `<p class="muted">未覆盖需求单元：${escapeHtml(uncovered.slice(0, 30).join(", "))}${uncovered.length > 30 ? " ..." : ""}</p>`
          : '<p class="muted">所有一阶段需求单元均已有测试点和用例闭环。</p>'
      }
    </details>
  `;
}

function renderReflectionFindings(findings) {
  if (!findings?.length) {
    return '<h4>Critic Agent 反思</h4><p class="muted">暂无 Critic 反思结果。</p>';
  }
  const openFindings = findings.filter((item) => item.status !== "closed" && item.severity !== "info");
  const displayFindings = openFindings.length ? openFindings : findings.filter((item) => item.severity === "info").slice(0, 3);
  return `
    <h4>Critic Agent 反思</h4>
    ${
      openFindings.length
        ? `<p><span class="badge warn">${openFindings.length} 个待处理问题</span></p>`
        : '<p><span class="badge ok">覆盖与追溯已闭环</span></p>'
    }
    <table><thead><tr><th>类型</th><th>级别</th><th>来源</th><th>发现</th><th>建议</th></tr></thead><tbody>
      ${displayFindings
        .map(
          (item) => `<tr><td>${escapeHtml(item.type)}</td><td><span class="badge ${item.severity === "warning" ? "warn" : item.severity === "blocker" ? "block" : "ok"}">${escapeHtml(item.severity)}</span></td><td>${escapeHtml(item.sourceRef || "")}</td><td>${escapeHtml(item.finding || "")}</td><td>${escapeHtml(item.recommendation || "")}</td></tr>`,
        )
        .join("")}
    </tbody></table>
    <details>
      <summary>全部 Critic 记录</summary>
      <table><thead><tr><th>ID</th><th>类型</th><th>状态</th><th>来源</th><th>发现</th></tr></thead><tbody>
        ${findings
          .map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.status || "")}</td><td>${escapeHtml(item.sourceRef || "")}</td><td>${escapeHtml(item.finding || "")}</td></tr>`)
          .join("")}
      </tbody></table>
    </details>
  `;
}

function renderAgentGeneratedAssets(assets, options = {}) {
  if (!assets) {
    return '<h4>Agent 候选资产</h4><p class="muted">暂无后端 Agent 候选资产。</p>';
  }
  const summary = `
    <div class="summary-grid compact">
      <div class="summary-card"><label>澄清</label><strong>${assets.productClarifications?.length || 0}</strong></div>
      <div class="summary-card"><label>技术影响</label><strong>${assets.developmentImpacts?.length || 0}</strong></div>
      <div class="summary-card"><label>测试点</label><strong>${assets.testPoints?.length || 0}</strong></div>
      <div class="summary-card"><label>用例</label><strong>${assets.testCases?.length || 0}</strong></div>
    </div>
  `;
  if (options.compact) {
    return `
      <h4>Agent 候选资产</h4>
      ${summary}
      <details>
        <summary>查看候选资产明细</summary>
        ${renderAgentGeneratedAssetDetails(assets)}
      </details>
    `;
  }
  return `<h4>Agent 候选资产</h4>${summary}${renderAgentGeneratedAssetDetails(assets)}`;
}

function renderAgentGeneratedAssetDetails(assets) {
  return `
    <h4>Product Agent 澄清项</h4>
    ${
      assets.productClarifications?.length
        ? `<ul>${assets.productClarifications
            .map((item) => `<li><strong>${escapeHtml(item.id)}</strong> ${escapeHtml(item.question)} <span class="muted">${escapeHtml(item.acceptanceImpact || "")}</span></li>`)
            .join("")}</ul>`
        : '<p class="muted">暂无新增澄清项。</p>'
    }
    <h4>Dev Agent 技术影响</h4>
    ${
      assets.developmentImpacts?.length
        ? `<table><thead><tr><th>ID</th><th>来源</th><th>领域</th><th>影响</th><th>可测性</th></tr></thead><tbody>${assets.developmentImpacts
            .map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.sourceRef)}</td><td>${escapeHtml(item.domain)}</td><td>${escapeHtml(item.impact)}</td><td>${escapeHtml(item.testability)}</td></tr>`)
            .join("")}</tbody></table>`
        : '<p class="muted">暂无新增技术影响。</p>'
    }
    <h4>Test Agent 测试点</h4>
    ${
      assets.testPoints?.length
        ? `<table><thead><tr><th>ID</th><th>来源</th><th>优先级</th><th>标题</th><th>风险</th></tr></thead><tbody>${assets.testPoints
            .map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.sourceRef)}</td><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.risk || "")}</td></tr>`)
            .join("")}</tbody></table>`
        : '<p class="muted">暂无新增测试点。</p>'
    }
    <h4>Test Agent 候选用例</h4>
    ${
      assets.testCases?.length
        ? assets.testCases
            .map(
              (item) => `<article class="case-card">
                <div class="case-head">
                  <strong>${escapeHtml(item.id)} ${escapeHtml(item.title)}</strong>
                  <span class="badge ${item.priority === "P0" ? "block" : item.priority === "P1" ? "warn" : "ok"}">${escapeHtml(item.priority)}</span>
                </div>
                <p class="muted">来源：${escapeHtml((item.sourceRefs || []).join(", "))}</p>
                <p><strong>前置：</strong>${escapeHtml((item.preconditions || []).join("；"))}</p>
                <p><strong>步骤：</strong>${escapeHtml((item.steps || []).join(" / "))}</p>
                <p><strong>预期：</strong>${escapeHtml((item.expectedResults || []).join("；"))}</p>
              </article>`,
            )
            .join("")
        : '<p class="muted">暂无候选用例。</p>'
    }
    <h4>Review Agent / Harness Gate</h4>
    ${
      assets.harnessGates?.length
        ? `<table><thead><tr><th>ID</th><th>状态</th><th>发现</th><th>证据</th></tr></thead><tbody>${assets.harnessGates
            .map((item) => `<tr><td>${escapeHtml(item.id)}</td><td><span class="badge ${item.status === "passed" ? "ok" : item.status === "warning" ? "warn" : "block"}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.finding)}</td><td>${escapeHtml(item.evidence || "")}</td></tr>`)
            .join("")}</tbody></table>`
        : '<p class="muted">暂无候选门禁结果。</p>'
    }
  `;
}

function renderRequirementAnalysis(analysis, options = {}) {
  if (!analysis) {
    return '<h3>需求解析发现</h3><p class="muted">暂无后端需求解析结果。</p>';
  }
  if (options.compact) {
    return `
      <p class="muted">${escapeHtml(analysis.sourceSummary || "")}</p>
      <div class="summary-grid compact">
        <div class="summary-card"><label>需求单元</label><strong>${analysis.requirementUnits?.length || 0}</strong></div>
        <div class="summary-card"><label>业务能力</label><strong>${analysis.businessCapabilities?.length || 0}</strong></div>
        <div class="summary-card"><label>待澄清</label><strong>${analysis.ambiguities?.length || 0}</strong></div>
        <div class="summary-card"><label>风险信号</label><strong>${analysis.riskSignals?.length || 0}</strong></div>
      </div>
      <p class="muted">完整需求拆解请查看“需求单元”和“澄清项”页。</p>
    `;
  }
  return `
    <h3>需求解析发现</h3>
    <p class="muted">${escapeHtml(analysis.sourceSummary || "")}</p>
    <h4>需求单元</h4>
    ${
      analysis.requirementUnits?.length
        ? `<table><thead><tr><th>ID</th><th>来源</th><th>优先级</th><th>类型</th><th>标题</th><th>需求</th></tr></thead><tbody>${analysis.requirementUnits
            .map((item) => `<tr><td>${escapeHtml(item.id || "")}</td><td>${escapeHtml(item.sourceRef || "")}</td><td>${escapeHtml(item.priority || "")}</td><td>${escapeHtml(item.type || "")}</td><td>${escapeHtml(item.title || "")}</td><td>${escapeHtml(item.requirement || item.content || "")}</td></tr>`)
            .join("")}</tbody></table>`
        : '<p class="muted">暂无独立需求单元，当前将使用业务能力字段兼容展示。</p>'
    }
    <h4>业务能力</h4>
    ${
      analysis.businessCapabilities?.length
        ? `<table><thead><tr><th>来源</th><th>能力</th><th>依据</th></tr></thead><tbody>${analysis.businessCapabilities
            .map((item) => `<tr><td>${escapeHtml(item.sourceRef)}</td><td>${escapeHtml(item.capability)}</td><td>${escapeHtml(item.rationale || "")}</td></tr>`)
            .join("")}</tbody></table>`
        : '<p class="muted">暂无额外业务能力发现。</p>'
    }
    <h4>歧义/缺失</h4>
    ${
      analysis.ambiguities?.length
        ? `<ul>${analysis.ambiguities
            .map((item) => `<li><strong>${escapeHtml(item.sourceRef)}</strong> ${escapeHtml(item.issue)} <span class="muted">${escapeHtml(item.suggestedClarification || "")}</span></li>`)
            .join("")}</ul>`
        : '<p class="muted">暂无歧义或缺失发现。</p>'
    }
    <h4>风险信号</h4>
    ${
      analysis.riskSignals?.length
        ? `<table><thead><tr><th>来源</th><th>优先级</th><th>信号</th><th>原因</th></tr></thead><tbody>${analysis.riskSignals
            .map((item) => `<tr><td>${escapeHtml(item.sourceRef)}</td><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.signal)}</td><td>${escapeHtml(item.reason || "")}</td></tr>`)
            .join("")}</tbody></table>`
        : '<p class="muted">暂无新增风险信号。</p>'
    }
  `;
}

function renderReadiness({ releaseReadiness }) {
  $("#readiness").innerHTML = `
    <h3>准出门禁</h3>
    <p>
      <span class="badge ${releaseReadiness.status === "ready" ? "ok" : "block"}">${releaseReadiness.status}</span>
    </p>
    <table><thead><tr><th>门禁</th><th>状态</th><th>证据</th></tr></thead><tbody>
      ${releaseReadiness.gates
        .map(
          (gate) => `<tr>
            <td>${escapeHtml(gate.name)}</td>
            <td><span class="badge ${gate.status === "passed" ? "ok" : "block"}">${gate.status}</span></td>
            <td>${escapeHtml(gate.evidence)}</td>
          </tr>`,
        )
        .join("")}
    </tbody></table>
  `;
}

function renderCollaboration({ collaboration }) {
  $("#collaboration").innerHTML = `
    <h3>Agent 敏捷协作看板</h3>
    <p class="muted">这里展示 Product、Development、Testing、Review/Harness Gate、Critic 在本轮测试开发中的产物、交接对象和状态。配置 LLM 后，后端会优先生成结构化候选资产。</p>
    <table><thead><tr><th>Agent</th><th>职责</th><th>产物</th><th>交接给</th><th>状态</th><th>摘要</th></tr></thead><tbody>
      ${collaboration.agents
        .map(
          (agent) => `<tr>
            <td>${agent.id}</td>
            <td>${escapeHtml(agent.role)}</td>
            <td>${agent.produced.join(", ")}</td>
            <td>${agent.handoffTo}</td>
            <td><span class="badge ${agent.status === "done" ? "ok" : "warn"}">${agent.status}</span></td>
            <td>${escapeHtml(agent.summary)}</td>
          </tr>`,
        )
        .join("")}
    </tbody></table>
  `;
}

function renderRequirementUnits({ review, testPoints, cases }) {
  const acByRequirement = new Map(review.acceptanceCriteria.map((item) => [item.sourceRef, item.id]));
  const pointCountByAc = countBy(testPoints.points.map((point) => point.sourceRef));
  const caseCountByPoint = countBy(cases.flatMap((testCase) => testCase.sourceRefs.filter(isTestPointRef)));
  $("#units").innerHTML = `
    <h3>需求解析单元</h3>
    <p class="muted">这里展示文档正文被拆成哪些可测试需求单元，以及每个单元向下游验收标准、测试点、用例的映射。</p>
    <table><thead><tr><th>ID</th><th>来源</th><th>需求单元</th><th>AC</th><th>测试点</th><th>用例</th></tr></thead><tbody>
      ${review.requirementUnits
        .map((unit) => {
          const acId = acByRequirement.get(unit.id) || "-";
          const linkedPoints = testPoints.points.filter((point) => point.sourceRef === acId).map((point) => point.id);
          const caseCount = linkedPoints.reduce((total, pointId) => total + (caseCountByPoint.get(pointId) || 0), 0);
          return `<tr>
            <td>${unit.id}</td>
            <td>${escapeHtml(unit.sourceFileName || unit.sourceTextRef || "-")}</td>
            <td>${escapeHtml(unit.content)}</td>
            <td>${acId}</td>
            <td>${pointCountByAc.get(acId) || 0}</td>
            <td>${caseCount}</td>
          </tr>`;
        })
        .join("")}
    </tbody></table>
  `;
}

function updateFileParseStatus({ intake }) {
  if (!intake.files.length) {
    $("#fileParseStatus").textContent = "未上传文档，当前使用文本输入或默认样例。";
    return;
  }
  $("#fileParseStatus").textContent =
    `已解析 ${intake.documentStats.parsedFiles}/${intake.files.length} 个文件，` +
    `${intake.documentStats.parsedPages} 页，${intake.documentStats.parsedChars} 字符进入需求分析。`;
}

function updateSteps(artifacts) {
  const activeCount = artifacts.phase === "requirement_analysis" ? 3 : 7;
  $$("#stepList li").forEach((item, index) => {
    if (index < activeCount) item.classList.add("active");
    else item.classList.remove("active");
  });
}

function renderReview({ intake, review, agentEnhancement }) {
  $("#review").innerHTML = `
    <div class="grid">
      <div class="card">
        <h3>需求评审</h3>
        <p><span class="badge ${review.clearEnough ? "ok" : "warn"}">清晰度 ${review.clarityScore}</span></p>
        <p class="muted">输入文本 ${intake.texts.length} 段，上传文件 ${intake.files.length} 个，已解析 ${intake.documentStats.parsedPages} 页 / ${intake.documentStats.parsedChars} 字符。</p>
      </div>
      <div class="card">
        <h3>业务目标</h3>
        <ul>${review.businessGoals.map((goal) => `<li>${escapeHtml(goal.summary)}</li>`).join("")}</ul>
      </div>
    </div>
    ${renderParsedFiles(intake.files)}
    <h3>验收标准草案</h3>
    <table><thead><tr><th>ID</th><th>来源</th><th>标准</th></tr></thead><tbody>
      ${review.acceptanceCriteria
        .map((item) => `<tr><td>${item.id}</td><td>${item.sourceRef}</td><td>${escapeHtml(item.criteria)}</td></tr>`)
        .join("")}
    </tbody></table>
    ${renderReflectionFindings(agentEnhancement?.agentReflectionFindings)}
  `;
}

function renderParsedFiles(files) {
  if (!files.length) return "";
  return `
    <h3>文档解析结果</h3>
    <table><thead><tr><th>ID</th><th>文件</th><th>状态</th><th>页数</th><th>字符数</th><th>解析器</th></tr></thead><tbody>
      ${files
        .map(
          (file) =>
            `<tr><td>${file.id}</td><td>${escapeHtml(file.name)}</td><td><span class="badge ${file.extractionStatus === "parsed" ? "ok" : "warn"}">${file.extractionStatus}</span></td><td>${file.pageCount}</td><td>${file.charCount}</td><td>${file.parser}</td></tr>`,
        )
        .join("")}
    </tbody></table>
  `;
}

function renderClarify({ review }) {
  const items = review.clarificationItems || [];
  const openItems = items.filter(isClarificationOpen);
  const resolvedItems = items.filter(isClarificationProcessed);
  $("#clarify").innerHTML = `
    <h3>人工澄清项</h3>
    <p>
      <span class="badge ${openItems.length ? "warn" : "ok"}">${openItems.length ? `${openItems.length} 个待澄清` : "无待澄清项"}</span>
      <span class="badge">${resolvedItems.length} 个已处理</span>
    </p>
    ${
      openItems.length
        ? `<div class="clarify-toolbar">
            <p class="muted">可以逐条补充明确口径；如果暂时无法确认，也可以批量跳过，后续资产会按当前需求信息生成并保留跳过记录。</p>
            <button type="button" data-skip-open-clarifications>批量跳过待澄清项</button>
          </div>
          <div class="clarify-list">${openItems.map((item) => renderClarificationCard(item, review)).join("")}</div>`
        : '<p class="muted">当前没有必须先澄清的问题，可以继续生成后续测试资产。</p>'
    }
    ${
      resolvedItems.length
        ? `<details><summary>已处理澄清项</summary><table><thead><tr><th>ID</th><th>来源</th><th>问题</th><th>状态</th><th>处理结果</th></tr></thead><tbody>${resolvedItems
            .map((item) => {
              const answer = findHumanClarificationForItem(item, review.humanClarifications || []);
              return `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.sourceRef || "")}</td><td>${escapeHtml(item.question || "")}</td><td><span class="badge ${item.status === "skipped_by_human" ? "warn" : "ok"}">${escapeHtml(item.status || "")}</span></td><td>${escapeHtml(answer?.content || item.skipReason || item.resolvedBy || "-")}</td></tr>`;
            })
            .join("")}</tbody></table></details>`
        : ""
    }
    ${
      review.humanClarifications.length
        ? `<details><summary>全部人工补充</summary><ul>${review.humanClarifications.map((item) => `<li><strong>${item.id}</strong> ${escapeHtml(item.content)}</li>`).join("")}</ul></details>`
        : ""
    }
  `;
}

function renderClarificationCard(item, review) {
  return `
    <article class="clarify-card">
      <div>
        <div class="case-head">
          <strong>${escapeHtml(item.id)} ${escapeHtml(item.sourceRef || "")}</strong>
          <span class="badge warn">${escapeHtml(item.status || "pending")}</span>
        </div>
        <p>${escapeHtml(item.question || "")}</p>
        ${item.reason ? `<p class="muted">${escapeHtml(item.reason)}</p>` : ""}
        <p class="muted">来源：${escapeHtml(item.generatedBy || "rule_product_review")}</p>
      </div>
      ${renderClarificationAnswerControl(item, review)}
    </article>
  `;
}

function renderClarificationAnswerControl(item, review) {
  if (item.status === "closed") return "-";
  const answer = findHumanClarificationForItem(item, review.humanClarifications || []);
  return `
    <div class="inline-clarification">
      <textarea
        data-clarification-input
        data-clarification-id="${escapeHtml(item.id)}"
        data-source-ref="${escapeHtml(item.sourceRef || "")}"
        data-question="${escapeHtml(item.question || "")}"
        placeholder="填写该问题的明确口径、阈值、规则或边界条件。">${escapeHtml(answer?.content || "")}</textarea>
      <button type="button" data-clarification-submit="${escapeHtml(item.id)}">${answer ? "更新" : "提交"}</button>
      ${answer ? `<span class="muted">${escapeHtml(answer.id)}</span>` : ""}
    </div>
  `;
}

function findHumanClarificationForItem(item, humanClarifications) {
  return humanClarifications.find(
    (entry) =>
      entry.clarificationId === item.id ||
      (entry.question && buildRequirementFingerprint(entry.question) === buildRequirementFingerprint(item.question || "")) ||
      entry.id === item.resolvedBy,
  );
}

function renderTech({ technical }) {
  $("#tech").innerHTML = `
    <div class="grid">
      <div class="card"><h3>涉及业务域</h3>${technical.domains.map((item) => `<span class="badge">${item}</span>`).join("")}</div>
      <div class="card"><h3>工具建议</h3><ul>${technical.toolingNeeds.map((item) => `<li>${item}</li>`).join("")}</ul></div>
    </div>
    <h3>技术影响</h3>
    <table><thead><tr><th>ID</th><th>来源</th><th>影响</th><th>可测性</th></tr></thead><tbody>
      ${technical.impacts
        .map((item) => `<tr><td>${item.id}</td><td>${item.sourceRef}</td><td>${escapeHtml(item.summary)}</td><td>${item.testability}</td></tr>`)
        .join("")}
    </tbody></table>
  `;
}

function renderPoints({ testPoints }) {
  $("#points").innerHTML = `
    <h3>Testing Agent 测试点</h3>
    <table><thead><tr><th>ID</th><th>类型</th><th>优先级</th><th>来源</th><th>描述</th></tr></thead><tbody>
      ${testPoints.points
        .map(
          (item) =>
            `<tr><td>${item.id}</td><td>${item.type}</td><td><span class="badge ${priorityBadgeClass(item.priority)}">${item.priority}</span></td><td>${item.sourceRef}</td><td>${escapeHtml(item.description)}</td></tr>`,
        )
        .join("")}
    </tbody></table>
  `;
}

function renderStrategy({ strategy }) {
  $("#strategy").innerHTML = `
    <div class="card">
      <h3>功能测试策略</h3>
      <p><span class="badge">scope: ${strategy.scope}</span></p>
      <ul>${strategy.approach.map((item) => `<li>${item}</li>`).join("")}</ul>
      <p><strong>准入：</strong>${strategy.entryCriteria}</p>
      <p><strong>风险：</strong>${strategy.riskSummary}</p>
    </div>
  `;
}

function renderCases({ cases, reviewResult }) {
  const pendingHighRisk = cases.some((item) => item.reviewStatus === "pending_human_review");
  $("#cases").innerHTML = `
    <h3>生成测试用例</h3>
    <p>
      <span class="badge ${reviewResult.coverageRate >= 95 ? "ok" : "warn"}">需求闭环覆盖率 ${reviewResult.coverageRate}%</span>
      <span class="badge ${reviewResult.testPointCoverageRate >= 95 ? "ok" : "warn"}">测试点覆盖率 ${reviewResult.testPointCoverageRate || 0}%</span>
      <span class="badge ${reviewResult.adoptionRate >= 90 ? "ok" : "warn"}">采纳率 ${reviewResult.adoptionRate}%</span>
    </p>
    ${
      pendingHighRisk
        ? '<p><button data-action="approve-high-risk" class="primary">批量通过 P0/P1 用例</button></p>'
        : '<p><span class="badge ok">高风险用例已完成评审</span></p>'
    }
    <table><thead><tr><th>ID</th><th>标题</th><th>优先级</th><th>步骤</th><th>预期</th><th>评审</th><th>证据</th><th>操作</th></tr></thead><tbody>
      ${cases
        .map(
          (item) => `<tr>
            <td>${item.id}</td>
            <td>${escapeHtml(item.title)}</td>
            <td><span class="badge ${priorityBadgeClass(item.priority)}">${item.priority}</span></td>
            <td><ol>${item.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></td>
            <td>${escapeHtml(item.expectedResult)}</td>
            <td><span class="badge ${reviewBadgeClass(item.reviewStatus)}">${item.reviewStatus}</span></td>
            <td>${renderReviewEvidence(item)}</td>
            <td>${renderReviewActions(item)}</td>
          </tr>`,
        )
        .join("")}
    </tbody></table>
    <h3>自动评审发现</h3>
    <ul>${reviewResult.findings.map((item) => `<li>${item}</li>`).join("")}</ul>
  `;
}

function renderReviewEvidence(testCase) {
  const latest = testCase.reviewHistory?.[testCase.reviewHistory.length - 1];
  if (!latest) return "-";
  return `${latest.reviewer}<br><span class="muted">${escapeHtml(latest.note || latest.status)}</span>`;
}

function renderReviewActions(testCase) {
  if (testCase.reviewStatus !== "pending_human_review") return "-";
  return `
    <div class="review-actions">
      <button data-action="approve-case" data-case-id="${testCase.id}">通过</button>
      <button data-action="reject-case" data-case-id="${testCase.id}">退回</button>
    </div>
  `;
}

function reviewBadgeClass(status) {
  if (status === "approved_by_human" || status === "auto_reviewed") return "ok";
  if (status === "rejected_by_human") return "block";
  return "warn";
}

function priorityBadgeClass(priority) {
  if (priority === "P0") return "block";
  if (priority === "P1") return "warn";
  return "";
}

function renderTrace({ traceability }) {
  $("#trace").innerHTML = `
    <h3>追溯矩阵</h3>
    <table><thead><tr><th>用例</th><th>测试点</th><th>上游引用</th><th>需求输入</th><th>人工补充</th><th>澄清项</th><th>技术影响</th></tr></thead><tbody>
      ${traceability
        .map(
          (item) =>
            `<tr><td>${item.caseId}</td><td>${item.testPoint}</td><td>${item.upstreamRefs.join(", ")}</td><td>${item.requirementInputs.join(", ")}</td><td>${item.humanClarifications.join(", ") || "-"}</td><td>${item.clarificationCount}</td><td>${item.technicalImpactCount}</td></tr>`,
        )
        .join("")}
    </tbody></table>
  `;
}

function renderArtifacts(artifacts) {
  const selected = {
    runId: artifacts.runId,
    collaboration: artifacts.collaboration,
    agentEnhancement: artifacts.agentEnhancement,
    intake: artifacts.intake,
    requirementReview: artifacts.review,
    technicalImpact: artifacts.technical,
    testPoints: artifacts.testPoints,
    testStrategy: artifacts.strategy,
    generatedCases: artifacts.cases,
    caseReview: artifacts.reviewResult,
    releaseReadiness: artifacts.releaseReadiness,
    traceability: artifacts.traceability,
  };
  $("#artifacts").innerHTML = `
    <h3>中间产物 JSON</h3>
    <p class="muted">用于验证各阶段产物可查看、可导出、可追溯。完整内容可点击“导出 JSON”。</p>
    <pre>${escapeHtml(JSON.stringify(selected, null, 2))}</pre>
  `;
}

function renderAssets(artifacts) {
  const assets = artifacts.testAssets.cases;
  const gateByAsset = new Map(artifacts.gateResults.results.map((result) => [result.assetId, result]));
  $("#assets").innerHTML = `
    <h3>Harness 测试资产</h3>
    <p class="muted">以下内容按 <code>contracts/test-assets/case.schema.yaml</code> 风格生成，可作为后续 Harness 入库和质量门禁输入。</p>
    <p>
      <span class="badge ${artifacts.gateResults.results.every((item) => item.status === "passed") ? "ok" : "warn"}">
        Gate: ${summarizeGateStatus(artifacts.gateResults.results)}
      </span>
    </p>
    <table><thead><tr><th>ID</th><th>标题</th><th>风险</th><th>评审</th><th>Gate</th><th>来源</th></tr></thead><tbody>
      ${assets
        .map((asset) => {
          const gate = gateByAsset.get(asset.id);
          return `<tr><td>${asset.id}</td><td>${escapeHtml(asset.title)}</td><td>${asset.risk.level}</td><td>${asset.review.status}</td><td><span class="badge ${gate?.status === "passed" ? "ok" : "block"}">${gate?.status || "unknown"}</span></td><td>${asset.source.ref}</td></tr>`;
        })
        .join("")}
    </tbody></table>
    <h3>资产 JSON</h3>
    <pre>${escapeHtml(JSON.stringify({ testAssets: artifacts.testAssets, gateResults: artifacts.gateResults }, null, 2))}</pre>
  `;
}

function summarizeGateStatus(results) {
  const passed = results.filter((item) => item.status === "passed").length;
  const blocked = results.filter((item) => item.status === "blocked").length;
  const warning = results.filter((item) => item.status === "warning").length;
  return `${passed} passed / ${warning} warning / ${blocked} blocked`;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function splitRequirementTexts(texts) {
  const units = [];
  texts.forEach((text) => {
    extractRequirementCandidates(text.content)
      .filter(isRequirementLikeUnit)
      .forEach((content) => {
        units.push({
          id: `REQ-SENT-${String(units.length + 1).padStart(3, "0")}`,
          sourceTextRef: text.id,
          sourceFileRef: text.fileRef || null,
          sourceFileName: text.fileName || null,
          content,
        });
      });
  });
  return units;
}

function dedupeRequirementLikeItems(items, getText) {
  const kept = [];
  for (const item of items || []) {
    const text = getText(item);
    if (!text) continue;
    const fingerprint = buildRequirementFingerprint(text);
    const duplicate = kept.some((existing) => {
      const existingFingerprint = buildRequirementFingerprint(getText(existing));
      return fingerprint === existingFingerprint || areRequirementFingerprintsSimilar(fingerprint, existingFingerprint);
    });
    if (!duplicate) kept.push(item);
  }
  return kept;
}

function buildRequirementFingerprint(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, "")
    .replace(/icon/g, "图标")
    .replace(/页面/g, "页")
    .replace(/新增/g, "增加")
    .replace(/[\s:：,，.。;；、_\-—/\\()[\]{}<>《》【】]+/g, "")
    .replace(/[""]/g, "")
    .trim();
}

function areRequirementFingerprintsSimilar(left, right) {
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length) >= 0.72;
  }
  const leftChars = new Set(Array.from(left));
  const rightChars = new Set(Array.from(right));
  const intersection = Array.from(leftChars).filter((char) => rightChars.has(char)).length;
  const union = new Set([...leftChars, ...rightChars]).size || 1;
  const charSimilarity = intersection / union;
  const leftBigrams = buildBigrams(left);
  const rightBigrams = buildBigrams(right);
  const bigramIntersection = Array.from(leftBigrams).filter((token) => rightBigrams.has(token)).length;
  const bigramUnion = new Set([...leftBigrams, ...rightBigrams]).size || 1;
  return charSimilarity >= 0.92 || bigramIntersection / bigramUnion >= 0.82;
}

function buildBigrams(text) {
  const chars = Array.from(text);
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`));
}

function extractRequirementCandidates(text) {
  const normalized = normalizeRequirementText(text);
  const rawChunks = normalized
    .split(/(?:[。！？；;]\s*)|\n+/)
    .flatMap(splitPdfTableLikeChunk)
    .map(cleanRequirementUnit)
    .filter(Boolean);

  const chunks = mergeFeatureRows(rawChunks);

  return chunks.flatMap((chunk) => {
    const numbered = chunk
      .split(/(?=\s*(?:\d+[.)、]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*)/)
      .map(cleanRequirementUnit)
      .filter(Boolean);
    return numbered.length > 1 ? numbered : [chunk];
  });
}

function mergeFeatureRows(chunks) {
  const featureNames = [
    "用户登录",
    "首页安全保障",
    "车辆控制",
    "功能反馈",
    "增加途经点",
    "小程序页面分享",
    "站点推荐",
    "行程管理",
    "小程序Push",
    "弹窗",
    "短信接入",
  ];
  const merged = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (featureNames.includes(chunk)) {
      const next = chunks[index + 1] || "";
      if (next && !featureNames.includes(next) && !isTableNoise(next)) {
        merged.push(`${chunk}：${next}`);
        index += 1;
      } else {
        merged.push(chunk);
      }
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}

function splitPdfTableLikeChunk(chunk) {
  const parts = chunk
    .split(/\s{2,}|(?<=\S)\s+(?=(?:用户登录|首页安全保障|车辆控制|功能反馈|增加途经点|小程序页面分享|站点推荐|行程管理|小程序Push|弹窗|短信接入|登录页|首页|站点|行程|Push|短信|车辆|订单|支付|分享|反馈|弹窗))/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [chunk];
}

function cleanRequirementUnit(content) {
  return String(content || "")
    .replace(/^第\s*\d+\s*页\s*/, "")
    .replace(/^\s*(?:\d+[.)、]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRequirementText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\u0001/g, "\n")
    .replace(/[⼩]/g, "小")
    .replace(/[⻚]/g, "页")
    .replace(/[⽤]/g, "用")
    .replace(/[⼾]/g, "户")
    .replace(/[⻋]/g, "车")
    .replace(/[⾏]/g, "行")
    .replace(/[⽂]/g, "文")
    .replace(/[⽬]/g, "目")
    .replace(/[⾯]/g, "面")
    .replace(/[⾄]/g, "至")
    .replace(/[⽅]/g, "方")
    .replace(/[⽆]/g, "无")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRequirementLikeUnit(content) {
  if (content.length < 6) return false;
  if (content.length > 220) return false;
  if (/^第\s*\d+\s*页$/.test(content)) return false;
  if (isTableNoise(content)) return false;
  if (/^[\d.\s]+$/.test(content)) return false;
  if (!/[\u4e00-\u9fa5]/.test(content)) return false;
  const requirementSignals = [
    "需要",
    "支持",
    "展示",
    "显示",
    "新增",
    "增加",
    "优化",
    "接入",
    "推荐",
    "登录",
    "分享",
    "反馈",
    "控制",
    "弹窗",
    "短信",
    "Push",
    "行程",
    "站点",
    "订单",
    "车辆",
    "支付",
    "消息",
    "模板",
  ];
  return requirementSignals.some((signal) => content.includes(signal));
}

function isTableNoise(content) {
  return /^(版本号|时间|变更内容|需求内容|变更人|功能|描述|依赖项|依赖项负责人|负责人|文档说明|产品概述|产品架构|云端交互|无|何高|董强|徐天鸣|高振旭)$/.test(
    content,
  );
}

function extractGoals(sentences) {
  return sentences.length
    ? sentences.map((sentence) => ({
        sourceRef: sentence.id,
        sourceTextRef: sentence.sourceTextRef,
        sourceFileRef: sentence.sourceFileRef,
        sourceFileName: sentence.sourceFileName,
        summary: sentence.content,
      }))
    : [
        {
          sourceRef: "REQ-SENT-001",
          summary: "默认需求：完成核心业务流程并给出用户可见反馈",
        },
      ];
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function countBy(values) {
  const result = new Map();
  values.forEach((value) => {
    result.set(value, (result.get(value) || 0) + 1);
  });
  return result;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
