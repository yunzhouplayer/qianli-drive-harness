const fs = require("fs");
const vm = require("vm");

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
    };
    this.value = "";
    this.innerHTML = "";
    this.textContent = "";
    this.files = [];
    this.listeners = {};
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  click() {
    if (this.listeners.click) this.listeners.click();
  }
}

const elements = new Map();
const requirementTextarea = new Element("textarea");
const multimodalTextarea = new Element("textarea");
const clarifyTextarea = new Element("textarea");
const itemClarifyTextarea = new Element("textarea");
const fileInput = new Element("input");
const runButton = new Element("button");
const analyzeButton = new Element("button");
const exportButton = new Element("button");
const exportAssetsButton = new Element("button");
const addTextButton = new Element("button");
const requirementInputs = new Element("div");
const coverageMetric = new Element("span");
const adoptionMetric = new Element("span");
const fileParseStatus = new Element("div");

requirementInputs.children.push(requirementTextarea);
elements.set("#requirementInputs", requirementInputs);
elements.set("#fileInput", fileInput);
elements.set("#multimodalNotes", multimodalTextarea);
elements.set("#humanClarifications", clarifyTextarea);
elements.set("#analyzeRequirements", analyzeButton);
elements.set("#runPipeline", runButton);
elements.set("#exportJson", exportButton);
elements.set("#exportAssets", exportAssetsButton);
elements.set("#addText", addTextButton);
elements.set("#coverageMetric", coverageMetric);
elements.set("#adoptionMetric", adoptionMetric);
elements.set("#fileParseStatus", fileParseStatus);

["#collaboration", "#llm", "#review", "#units", "#clarify", "#tech", "#points", "#strategy", "#cases", "#readiness", "#trace", "#artifacts", "#assets"].forEach((selector) => {
  elements.set(selector, new Element("section"));
});

const documentStub = {
  querySelector(selector) {
    if (selector.startsWith("[data-clarification-input]")) return itemClarifyTextarea.value ? itemClarifyTextarea : null;
    return elements.get(selector) || null;
  },
  querySelectorAll(selector) {
    if (selector === "textarea") return [requirementTextarea, clarifyTextarea];
    if (selector === "#requirementInputs textarea") return requirementInputs.children;
    if (selector === "[data-clarification-input]") return [itemClarifyTextarea].filter((item) => item.value);
    if (selector === ".tab") return [];
    if (selector === ".tab-panel") return [];
    if (selector === "#stepList li") return [];
    return [];
  },
  createElement(tagName) {
    return new Element(tagName);
  },
  addEventListener() {},
};

const sandbox = {
  document: documentStub,
  Blob,
  URL: {
    createObjectURL() {
      return "blob:test";
    },
    revokeObjectURL() {},
  },
  Date,
  console,
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("app.js", "utf8"), sandbox);

(async () => {
  requirementTextarea.value =
    "乘客可以在乘客端发起 Robotaxi 叫车，系统需要实时匹配附近空闲车辆，并实时展示订单状态。若没有可用车辆，需要给出明确失败提示。";
  multimodalTextarea.value = "截图显示站点推荐列表需要展示历史站点和热点站点。";
  clarifyTextarea.value = "实时匹配阈值为 5 秒。\n订单状态实时展示阈值为 30 秒。\n无车时 3 秒内提示暂无可用车辆。";
  itemClarifyTextarea.dataset = {
    clarificationId: "CLARIFY-001",
    sourceRef: "REQ-SENT-001",
    question: "实时匹配需要明确可测阈值。",
  };
  itemClarifyTextarea.value = "针对 CLARIFY-001：实时匹配阈值为 5 秒，超过后展示加载和重试提示。";
  fileInput.files = [
    {
      name: "passenger-miniapp-prd.txt",
      type: "text/plain",
      size: 120,
      async text() {
        return "首页需要展示安全保障条幅。站点推荐需要支持历史站点和热点站点。小程序 Push 需要支持消息订阅模板。";
      },
    },
  ];

  const artifacts = await vm.runInContext("runPipeline()", sandbox);

  if (!artifacts.review.humanClarifications.length) {
    throw new Error("Expected human clarifications to be captured.");
  }

  if (!artifacts.review.humanClarifications.some((item) => item.clarificationId === "CLARIFY-001")) {
    throw new Error("Expected per-item clarification answer to be captured with clarificationId.");
  }

  const resolvedClarifications = artifacts.review.clarificationItems.filter((item) => item.status === "resolved_by_human");
  if (!resolvedClarifications.length) {
    throw new Error("Expected human clarifications to resolve matching clarification items.");
  }

  if (!artifacts.review.acceptanceCriteria.some((item) => item.sourceRef === "HUMAN-CLARIFY-001")) {
    throw new Error("Expected human clarification to become acceptance criteria.");
  }

  if (artifacts.intake.files[0].extractionStatus !== "parsed") {
    throw new Error("Expected uploaded text file to be parsed.");
  }

  if (artifacts.intake.documentStats.parsedChars < 40) {
    throw new Error("Expected parsed document text to enter intake stats.");
  }

  if (artifacts.review.businessGoals.length <= 3) {
    throw new Error(`Expected more than 3 goals after file parsing, got ${artifacts.review.businessGoals.length}.`);
  }

  if (!artifacts.intake.texts.some((item) => item.sourceType === "manual_multimodal_transcript")) {
    throw new Error("Expected manual multimodal transcript to enter requirement intake.");
  }

  if (artifacts.review.requirementUnits.length !== artifacts.review.businessGoals.length) {
    throw new Error("Expected requirement units to be persisted in requirement review.");
  }

  const highRiskCases = artifacts.cases.filter((item) => item.priority === "P0" || item.priority === "P1");
  if (!highRiskCases.length || !highRiskCases.every((item) => item.reviewStatus === "pending_human_review")) {
    throw new Error("Expected P0/P1 cases to require human review.");
  }

  if (artifacts.collaboration.agents.length !== 4) {
    throw new Error("Expected collaboration board for four agents.");
  }

  ["product-agent", "development-agent", "testing-agent", "review-agent"].forEach((agentId) => {
    if (!artifacts.collaboration.agents.some((agent) => agent.id === agentId)) {
      throw new Error(`Expected collaboration agent: ${agentId}.`);
    }
  });

  const analysisDraft = await vm.runInContext("buildRequirementAnalysisDraft()", sandbox);
  if (analysisDraft.phase !== "requirement_analysis") {
    throw new Error("Expected staged requirement analysis phase.");
  }
  if (!analysisDraft.review.clarificationItems.length) {
    throw new Error("Expected requirement analysis to list clarification items before downstream generation.");
  }
  if (analysisDraft.cases.length) {
    throw new Error("Expected no test cases before clarification/downstream generation.");
  }

  analysisDraft.intake.humanClarifications = [];
  analysisDraft.review.humanClarifications = [];
  analysisDraft.review.clarificationItems = [
    {
      id: "CLARIFY-SMOKE-001",
      sourceRef: "REQ-SENT-001",
      keyword: "实时",
      question: "实时匹配需要明确可测阈值。",
      reason: "影响测试边界。",
      generatedBy: "smoke-test",
      status: "pending_human_confirmation",
    },
  ];
  sandbox.analysisDraft = analysisDraft;
  vm.runInContext("state.artifacts = analysisDraft; state.requirementAnalysisReady = true; renderRequirementAnalysisStage(state.artifacts)", sandbox);
  if (!runButton.disabled || !runButton.textContent.includes("先完成")) {
    throw new Error("Expected downstream generation button to be disabled while clarification items are open.");
  }
  const firstClarification = analysisDraft.review.clarificationItems[0];
  itemClarifyTextarea.dataset = {
    clarificationId: firstClarification.id,
    sourceRef: firstClarification.sourceRef,
    question: firstClarification.question,
  };
  itemClarifyTextarea.value = "实时匹配阈值为 5 秒，超过后展示加载和重试提示。";
  sandbox.clarificationSubmitButton = {
    dataset: { clarificationSubmit: firstClarification.id },
  };
  vm.runInContext("submitClarificationAnswer(clarificationSubmitButton)", sandbox);
  if (runButton.disabled || runButton.textContent !== "生成后续测试资产") {
    throw new Error("Expected downstream generation button to be enabled after required clarification is answered.");
  }
  analysisDraft.review.clarificationItems = [
    {
      id: "CLARIFY-SMOKE-002",
      sourceRef: "REQ-SENT-002",
      keyword: "站点",
      question: "站点推荐排序规则是否需要明确？",
      reason: "影响测试边界。",
      generatedBy: "smoke-test",
      status: "pending_human_confirmation",
    },
    {
      id: "CLARIFY-SMOKE-003",
      sourceRef: "REQ-SENT-003",
      keyword: "短信",
      question: "短信失败是否需要兜底？",
      reason: "影响异常路径。",
      generatedBy: "smoke-test",
      status: "pending_human_confirmation",
    },
  ];
  analysisDraft.review.acceptanceCriteria = [];
  sandbox.analysisDraft = analysisDraft;
  vm.runInContext("state.artifacts = analysisDraft; state.requirementAnalysisReady = true; renderRequirementAnalysisStage(state.artifacts); skipOpenClarifications()", sandbox);
  const skippedStatuses = vm.runInContext("state.artifacts.review.clarificationItems.map((item) => item.status)", sandbox);
  if (!skippedStatuses.every((status) => status === "skipped_by_human")) {
    throw new Error("Expected batch skip to mark open clarification items as skipped_by_human.");
  }
  if (runButton.disabled || runButton.textContent !== "生成后续测试资产") {
    throw new Error("Expected downstream generation button to be enabled after batch skipping clarifications.");
  }
  const skippedCriteria = vm.runInContext("state.artifacts.review.acceptanceCriteria.filter((item) => String(item.id).startsWith('AC-CLARIFY-')).length", sandbox);
  if (skippedCriteria) {
    throw new Error("Expected skipped clarifications not to create clarification acceptance criteria.");
  }

  if (artifacts.reviewResult.coverageRate < 95) {
    throw new Error(`Expected coverage >= 95, got ${artifacts.reviewResult.coverageRate}.`);
  }

  if (artifacts.reviewResult.adoptionRate < 90) {
    throw new Error(`Expected adoption >= 90, got ${artifacts.reviewResult.adoptionRate}.`);
  }

  if (!artifacts.testAssets?.cases?.length) {
    throw new Error("Expected generated test assets.");
  }

  if (!artifacts.gateResults?.results?.length) {
    throw new Error("Expected quality gate results.");
  }

  if (artifacts.releaseReadiness.status !== "not_ready") {
    throw new Error("Expected release readiness to be blocked before high-risk human review.");
  }

  const firstCaseText = [...artifacts.cases[0].steps, artifacts.cases[0].expectedResult].join("\n");
  if (!firstCaseText.includes("叫车入口") || firstCaseText.includes("产品功能反馈入口")) {
    throw new Error("Expected default ride-hailing case to use order flow steps, not feedback steps.");
  }

  const firstAsset = artifacts.testAssets.cases[0];
  ["id", "version", "title", "scenario", "execution", "fixture", "validators", "expected_result", "review"].forEach(
    (field) => {
      if (!(field in firstAsset)) {
        throw new Error(`Expected test asset field: ${field}.`);
      }
    },
  );

  await vm.runInContext(
    "runPipeline().then((artifacts) => { state.artifacts = artifacts; state.artifacts.cases.filter((item) => item.reviewStatus === 'pending_human_review').forEach((item) => { recordCaseReview(item, 'approved_by_human', '烟测批量通过'); }); refreshReviewState(); })",
    sandbox,
  );

  const reviewed = vm.runInContext("state.artifacts", sandbox);

  if (reviewed.reviewResult.adoptionRate < 90) {
    throw new Error(`Expected reviewed adoption >= 90, got ${reviewed.reviewResult.adoptionRate}.`);
  }

  if (!reviewed.gateResults.results.every((item) => item.status === "passed")) {
    throw new Error("Expected all reviewed test assets to pass quality gates.");
  }

  if (reviewed.releaseReadiness.status !== "ready") {
    throw new Error(`Expected release readiness after review, got ${reviewed.releaseReadiness.status}.`);
  }

  const reviewedHighRisk = reviewed.cases.filter((item) => item.priority === "P0" || item.priority === "P1");
  if (!reviewedHighRisk.every((item) => item.reviewHistory.some((history) => history.reviewer === "human-reviewer"))) {
    throw new Error("Expected reviewed high-risk cases to keep human review evidence.");
  }

  if (!reviewed.testAssets.cases[0].review.history.length) {
    throw new Error("Expected test assets to include review history.");
  }

  const preservedUnits = Array.from({ length: 120 }, (_, index) => ({
    id: `LLM-REQ-${String(index + 1).padStart(3, "0")}`,
    sourceTextRef: "REQ-TEXT-001",
    content: `LLM 第一阶段需求单元 ${index + 1}`,
    generatedBy: "llm-product-agent",
  }));
  const preservationArtifact = await vm.runInContext("runPipeline()", sandbox);
  preservationArtifact.review.requirementUnits = preservedUnits;
  preservationArtifact.review.businessGoals = preservedUnits.map((unit) => ({
    id: `GOAL-${unit.id}`,
    sourceRef: unit.id,
    summary: unit.content,
  }));
  preservationArtifact.requirementAnalysisEnhancement = {
    llmEnabled: true,
    mode: "llm_rag_requirement_analysis",
    retrievedKnowledge: [],
    requirementAnalysis: {
      requirementUnits: preservedUnits.map((unit) => ({
        id: unit.id,
        requirement: unit.content,
      })),
    },
  };
  preservationArtifact.agentEnhancement = {
    llmEnabled: true,
    mode: "llm_rag_agent_enhanced",
    suggestedClarifications: [
      {
        sourceRef: "LLM-REQ-002",
        question: "车控指令超时阈值与重试策略是什么？",
        reason: "影响异常分支测试。",
      },
    ],
    agentGeneratedAssets: {
      productClarifications: [
        {
          id: "LLM-PROD-CLARIFY-001",
          sourceRef: "LLM-REQ-003",
          question: "短信回调失败后是否需要补偿机制？",
          acceptanceImpact: "影响降级用例。",
        },
      ],
      developmentImpacts: [{ id: "LLM-TECH-001", sourceRef: "LLM-REQ-001", domain: "mobile_passenger", impact: "技术影响", testability: "automatable" }],
      testPoints: [{ id: "LLM-TP-001", sourceRef: "LLM-REQ-001", priority: "P1", title: "后续阶段测试点", risk: "风险" }],
      testCases: [
        {
          id: "LLM-CASE-001",
          sourceRefs: ["LLM-TP-001", "LLM-REQ-001"],
          priority: "P1",
          title: "后续阶段用例",
          preconditions: ["前置条件"],
          steps: ["执行步骤"],
          expectedResults: ["预期结果"],
        },
      ],
      harnessGates: [],
    },
    requirementAnalysis: {
      requirementUnits: Array.from({ length: 8 }, (_, index) => ({
        id: `COMPRESSED-REQ-${index + 1}`,
        requirement: `第二阶段压缩需求 ${index + 1}`,
      })),
    },
  };
  sandbox.preservationArtifact = preservationArtifact;
  vm.runInContext("state.artifacts = preservationArtifact; applyAgentEnhancementToPipeline(state.artifacts)", sandbox);
  const preservedCount = vm.runInContext("state.artifacts.review.requirementUnits.length", sandbox);
  if (preservedCount !== 120) {
    throw new Error(`Expected downstream generation to preserve 120 analyzed requirement units, got ${preservedCount}.`);
  }
  vm.runInContext("renderAgentEnhancement(state.artifacts)", sandbox);
  const llmHtml = elements.get("#llm").innerHTML;
  if (!llmHtml.includes("需求单元") || !llmHtml.includes("<strong>120</strong>")) {
    throw new Error("Expected LLM panel to summarize first-stage requirement analysis after downstream generation.");
  }
  if (llmHtml.includes("第二阶段压缩需求")) {
    throw new Error("Expected LLM panel to ignore second-stage requirementAnalysis payload.");
  }
  const mergedClarifications = vm.runInContext("state.artifacts.review.clarificationItems.map((item) => item.question)", sandbox);
  if (!mergedClarifications.some((item) => item.includes("车控指令超时阈值")) || !mergedClarifications.some((item) => item.includes("短信回调失败"))) {
    throw new Error("Expected LLM/RAG suggested clarifications to be merged into review.clarificationItems.");
  }

  console.log(
    JSON.stringify(
      {
        cases: artifacts.cases.length,
        traceRows: artifacts.traceability.length,
        parsedFiles: artifacts.intake.documentStats.parsedFiles,
        parsedChars: artifacts.intake.documentStats.parsedChars,
        businessGoals: artifacts.review.businessGoals.length,
        multimodalTranscripts: artifacts.intake.texts.filter((item) => item.sourceType === "manual_multimodal_transcript").length,
        requirementUnits: artifacts.review.requirementUnits.length,
        highRiskCases: highRiskCases.length,
        collaborationAgents: artifacts.collaboration.agents.length,
        coverageRate: artifacts.reviewResult.coverageRate,
        adoptionRate: artifacts.reviewResult.adoptionRate,
        reviewedAdoptionRate: reviewed.reviewResult.adoptionRate,
        releaseReadiness: reviewed.releaseReadiness.status,
        firstCaseDomain: "ride_hailing",
        testAssets: reviewed.testAssets.cases.length,
        passedGateAssets: reviewed.gateResults.results.filter((item) => item.status === "passed").length,
        firstAssetReview: reviewed.testAssets.cases[0].review.status,
        reviewEvidence: reviewedHighRisk[0].reviewHistory.at(-1).reviewer,
        humanClarifications: artifacts.review.humanClarifications.length,
        resolvedClarifications: resolvedClarifications.length,
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
