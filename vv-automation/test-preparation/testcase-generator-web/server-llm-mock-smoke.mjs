import { createServer } from "node:http";
import { spawn } from "node:child_process";

const appPort = 18767;
const mockOpenaiPort = 18768;

const mockOpenai = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  const body = await readJsonBody(request);
  if (!body.model || !body.input?.length) {
    sendJson(response, 400, { error: "invalid_mock_request" });
    return;
  }
  const prompt = body.input.find((item) => item.role === "user")?.content || "";
  const promptPayload = parsePromptPayload(prompt);
  const isRequirementAnalysis = promptPayload.stage === "requirement_analysis";
  const isRepair = Boolean(promptPayload.artifacts?.repairContext);
  if (isRepair) {
    sendJson(response, 200, {
      id: "mock-response-repair-bad-json",
      output_text: "{\"agentGeneratedAssets\":",
    });
    return;
  }
  sendJson(response, 200, {
    id: "mock-response-001",
    output_text: JSON.stringify(isRequirementAnalysis ? {
      requirementAnalysis: {
        sourceSummary: "mock LLM parsed requirement intake.",
        requirementUnits: [
          {
            id: "LLM-REQ-001",
            sourceRef: "REQ-SENT-001",
            title: "Push 消息模板触达",
            requirement: "乘客端小程序需要通过 Push 消息模板触达到达通知。",
            type: "notification",
            priority: "P0",
            rationale: "到达通知影响乘客上车体验。",
          },
        ],
        businessCapabilities: [
          {
            sourceRef: "REQ-SENT-001",
            capability: "Push 消息模板触达",
            rationale: "原始需求明确提到小程序 Push 消息模板。",
          },
        ],
        ambiguities: [
          {
            sourceRef: "REQ-SENT-001",
            issue: "消息模板失败重试策略未定义。",
            suggestedClarification: "补充失败重试次数、降级渠道和用户提示。",
          },
        ],
        riskSignals: [
          {
            sourceRef: "REQ-SENT-001",
            priority: "P0",
            signal: "Push",
            reason: "Push 触达影响用户行程状态感知。",
          },
        ],
      },
      agentGeneratedAssets: {
        productClarifications: [
          {
            id: "LLM-CLARIFY-001",
            sourceRef: "REQ-SENT-001",
            question: "Push 发送失败后是否需要短信兜底？",
            acceptanceImpact: "影响异常路径验收标准。",
          },
        ],
        developmentImpacts: [
          {
            id: "LLM-TECH-001",
            sourceRef: "REQ-SENT-001",
            domain: "vehicle_cloud",
            impact: "需要验证 Push 服务、模板配置和订单状态事件的一致性。",
            testability: "automatable",
          },
        ],
        testPoints: [
          {
            id: "LLM-TP-001",
            sourceRef: "REQ-SENT-001",
            priority: "P0",
            title: "Push 消息模板发送与降级验证",
            risk: "通知缺失会导致乘客错过关键行程状态。",
          },
        ],
        testCases: [
          {
            id: "LLM-CASE-001",
            sourceRefs: ["LLM-TP-001", "REQ-SENT-001"],
            priority: "P0",
            title: "Push 消息模板发送与降级验证",
            preconditions: ["乘客端已登录", "存在可触发 Push 的订单状态事件"],
            steps: ["触发订单状态事件", "观察 Push 模板内容", "模拟 Push 发送失败"],
            expectedResults: ["Push 内容与模板一致", "失败后进入定义的降级链路"],
          },
        ],
        harnessGates: [
          {
            id: "LLM-GATE-001",
            status: "warning",
            finding: "P0 LLM 候选用例需要人工评审后进入主资产。",
            evidence: "LLM-CASE-001",
          },
        ],
      },
      agentFindings: [{ agent: "testing-agent", finding: "mock LLM generated P0 Push testcase." }],
      suggestedClarifications: [
        { sourceRef: "REQ-SENT-001", question: "是否需要短信兜底？", reason: "P0 通知触达风险。" },
      ],
      additionalTestIdeas: [
        { sourceRef: "REQ-SENT-001", priority: "P0", title: "Push 失败短信兜底", reason: "高风险通知链路。" },
      ],
      reviewFindings: [
        { gate: "llm_mock_gate", status: "warning", finding: "mock LLM path verified." },
      ],
    } : {
      agentGeneratedAssets: {
        productClarifications: [],
        developmentImpacts: [
          {
            id: "LLM-TECH-001",
            sourceRef: "REQ-SENT-001",
            domain: "vehicle_cloud",
            impact: "需要验证 Push 服务、模板配置和订单状态事件的一致性。",
            testability: "automatable",
          },
        ],
        testPoints: [
          {
            id: "LLM-TP-001",
            sourceRef: "REQ-SENT-001",
            priority: "P0",
            title: "Push 消息模板发送验证",
            risk: "通知缺失影响乘客行程状态感知。",
          },
          {
            id: "LLM-TP-002",
            sourceRef: "REQ-SENT-001",
            priority: "P1",
            title: "Push 消息失败降级验证",
            risk: "降级策略缺失会导致异常路径不可控。",
          },
        ],
        testCases: [
          {
            id: "LLM-CASE-001",
            sourceRefs: ["LLM-TP-001", "REQ-SENT-001"],
            priority: "P0",
            title: "Push 消息模板发送验证",
            preconditions: ["乘客端已登录"],
            steps: ["触发订单状态事件", "观察 Push 模板内容"],
            expectedResults: ["Push 内容与模板一致"],
          },
        ],
        harnessGates: [],
      },
      agentFindings: [{ agent: "testing-agent", finding: "mock LLM generated partial testcase coverage." }],
      suggestedClarifications: [],
      additionalTestIdeas: [],
      reviewFindings: [{ gate: "llm_mock_gate", status: "warning", finding: "mock LLM path verified." }],
    }),
  });
});

await listen(mockOpenai, mockOpenaiPort);

const appServer = spawn(process.execPath, ["server.mjs"], {
  cwd: import.meta.dirname,
  env: {
    ...process.env,
    PORT: String(appPort),
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "mock-key",
    OPENAI_BASE_URL: `http://127.0.0.1:${mockOpenaiPort}/v1`,
    OPENAI_MODEL: "mock-model",
    ARK_API_KEY: "",
    ARK_MODEL: "",
    ARK_BASE_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(appPort);
  const analysisResponse = await fetch(`http://127.0.0.1:${appPort}/api/requirement-analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifacts: buildSmokeArtifacts() }),
  });
  const analysisResult = await analysisResponse.json();
  if (analysisResult.mode !== "llm_rag_requirement_analysis" || analysisResult.llmEnabled !== true) {
    throw new Error(`Expected llm_rag_requirement_analysis, got ${analysisResult.mode}`);
  }
  if (analysisResult.agentGeneratedAssets?.testCases?.length) {
    throw new Error("Expected LLM requirement analysis stage not to expose test cases.");
  }
  if (!analysisResult.requirementAnalysis?.requirementUnits?.length) {
    throw new Error("Expected mock LLM requirement units.");
  }
  if (!analysisResult.agentWorkflow?.some((item) => item.agent === "product-agent")) {
    throw new Error("Expected requirement analysis workflow to include product-agent.");
  }

  const response = await fetch(`http://127.0.0.1:${appPort}/api/agent-generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifacts: buildSmokeArtifacts(),
    }),
  });
  const result = await response.json();
  if (result.mode !== "llm_rag_agent_enhanced_chunked_partial" || result.llmEnabled !== true) {
    throw new Error(`Expected llm_rag_agent_enhanced_chunked_partial, got ${result.mode}`);
  }
  if (result.model !== "mock-model") {
    throw new Error(`Expected mock-model, got ${result.model}`);
  }
  if (result.agentGeneratedAssets?.testCases?.[0]?.id !== "LLM-CASE-001") {
    throw new Error("Expected mock LLM generated testcase to be returned.");
  }
  if (result.requirementAnalysis) {
    throw new Error("Expected downstream asset generation not to return requirementAnalysis.");
  }
  if (!result.generationSummary || result.generationSummary.succeededChunks !== 1) {
    throw new Error("Expected one successful generation chunk.");
  }
  if (result.generationSummary.requirementCoverageRate !== 100 || result.generationSummary.testPointCoverageRate !== 100) {
    throw new Error("Expected deterministic compensation to close requirement and test point coverage.");
  }
  const finalTestPointIds = new Set((result.agentGeneratedAssets?.testPoints || []).map((item) => item.id));
  const coveredTestPointIds = new Set((result.agentGeneratedAssets?.testCases || []).flatMap((item) => item.sourceRefs || []).filter((ref) => finalTestPointIds.has(ref)));
  for (const id of finalTestPointIds) {
    if (!coveredTestPointIds.has(id)) {
      throw new Error(`Expected final testcase sourceRefs to cover test point ${id}.`);
    }
  }
  if (result.generationSummary.repairRounds !== 1 || result.generationSummary.compensatedAssets < 1) {
    throw new Error("Expected one failed repair round followed by deterministic compensation.");
  }
  if (!result.agentReflectionFindings?.some((item) => item.type === "coverage_gap")) {
    throw new Error("Expected Critic Agent coverage_gap finding.");
  }
  const workflowAgents = new Set((result.agentWorkflow || []).map((item) => item.agent));
  for (const agent of ["product-agent", "development-agent", "testing-agent", "review-agent", "critic-agent"]) {
    if (!workflowAgents.has(agent)) {
      throw new Error(`Expected agentWorkflow to include ${agent}.`);
    }
  }
  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        analysisMode: analysisResult.mode,
        llmEnabled: result.llmEnabled,
        model: result.model,
        generatedCases: result.agentGeneratedAssets.testCases.length,
        firstCase: result.agentGeneratedAssets.testCases[0].id,
        chunkCount: result.generationSummary.chunkCount,
        coveredRequirementUnits: result.generationSummary.coveredRequirementUnits,
        requirementCoverageRate: result.generationSummary.requirementCoverageRate,
        testPointCoverageRate: result.generationSummary.testPointCoverageRate,
        repairRounds: result.generationSummary.repairRounds,
        compensatedAssets: result.generationSummary.compensatedAssets,
        reflectionFindings: result.agentReflectionFindings.length,
        workflowAgents: Array.from(workflowAgents),
      },
      null,
      2,
    ),
  );
} finally {
  appServer.kill("SIGTERM");
  mockOpenai.close();
}

function listen(server, port) {
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
}

function buildSmokeArtifacts() {
  return {
    intake: {
      texts: [{ id: "REQ-TEXT-001", content: "小程序 Push 需要支持消息模板。" }],
      files: [],
      documentStats: { parsedFiles: 0, parsedPages: 0, parsedChars: 0 },
      humanClarifications: [],
    },
    review: {
      requirementUnits: [
        { id: "REQ-SENT-001", content: "小程序 Push 需要支持消息模板。", priority: "P0" },
        { id: "REQ-SENT-002", content: "小程序站点推荐需要展示历史站点。", priority: "P1" },
      ],
      clarificationItems: [],
    },
    technical: { domains: ["mobile_passenger", "vehicle_cloud"] },
    testPoints: { points: [{ id: "TP-001", priority: "P0", description: "Push 测试点" }] },
    cases: [{ id: "CASE-001", priority: "P0", reviewStatus: "pending_human_review" }],
    releaseReadiness: { status: "not_ready" },
  };
}

async function waitForServer(portNumber) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Server did not start in time.");
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function parsePromptPayload(prompt) {
  try {
    return JSON.parse(String(prompt || "{}"));
  } catch {
    return {};
  }
}
