import { spawn } from "node:child_process";

const port = 18765;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: import.meta.dirname,
  env: {
    ...process.env,
    PORT: String(port),
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "",
    ARK_API_KEY: "",
    ARK_MODEL: "",
    ARK_BASE_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(port);
  const home = await fetch(`http://127.0.0.1:${port}/`);
  const html = await home.text();
  if (!home.ok || !html.includes("测试用例自动生成")) {
    throw new Error("Expected static home page to be served.");
  }

  const head = await fetch(`http://127.0.0.1:${port}/styles.css`, { method: "HEAD" });
  if (!head.ok || !head.headers.get("content-type")?.includes("text/css")) {
    throw new Error("Expected HEAD request for static CSS to return text/css.");
  }

  const missing = await fetch(`http://127.0.0.1:${port}/missing-file.js`);
  if (missing.status !== 404) {
    throw new Error(`Expected missing static file to return 404, got ${missing.status}.`);
  }

  const analysisResponse = await fetch(`http://127.0.0.1:${port}/api/requirement-analyze`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      artifacts: buildSmokeArtifacts(),
    }),
  });
  const analysisResult = await analysisResponse.json();
  if (analysisResult.mode !== "analysis_rule_fallback_with_rag") {
    throw new Error(`Expected analysis_rule_fallback_with_rag, got ${analysisResult.mode}`);
  }
  if (!analysisResult.requirementAnalysis?.businessCapabilities?.length) {
    throw new Error("Expected staged requirement analysis business capabilities.");
  }
  if (!analysisResult.requirementAnalysis?.requirementUnits?.length) {
    throw new Error("Expected staged requirement analysis requirement units.");
  }
  if (analysisResult.agentGeneratedAssets?.testCases?.length) {
    throw new Error("Expected requirement analysis stage not to return test cases.");
  }

  const response = await fetch(`http://127.0.0.1:${port}/api/agent-generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      artifacts: buildSmokeArtifacts(),
    }),
  });
  const result = await response.json();
  if (result.mode !== "rule_fallback_with_rag") {
    throw new Error(`Expected rule_fallback_with_rag, got ${result.mode}`);
  }
  if (!result.retrievedKnowledge?.length) {
    throw new Error("Expected RAG knowledge retrieval results.");
  }
  if (!result.agentFindings?.some((item) => item.agent === "review-agent")) {
    throw new Error("Expected review-agent finding.");
  }
  if (result.requirementAnalysis) {
    throw new Error("Expected downstream asset generation not to return requirementAnalysis.");
  }
  if (!result.generationSummary || result.generationSummary.strategy !== "chunked_requirement_unit_generation") {
    throw new Error("Expected chunked generation summary.");
  }
  if (!result.agentGeneratedAssets?.developmentImpacts?.length) {
    throw new Error("Expected Dev Agent generated technical impacts.");
  }
  if (!result.agentGeneratedAssets?.testPoints?.length) {
    throw new Error("Expected Test Agent generated test points.");
  }
  if (!result.agentGeneratedAssets?.testCases?.length) {
    throw new Error("Expected Test Agent generated test cases.");
  }
  if (!result.agentGeneratedAssets?.harnessGates?.length) {
    throw new Error("Expected Review Agent / Harness Gate results.");
  }
  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        llmEnabled: result.llmEnabled,
        staticHome: home.status,
        missingStatic: missing.status,
        analysisMode: analysisResult.mode,
        retrievedKnowledge: result.retrievedKnowledge.length,
        chunkCount: result.generationSummary.chunkCount,
        coveredRequirementUnits: result.generationSummary.coveredRequirementUnits,
        agentTestPoints: result.agentGeneratedAssets.testPoints.length,
        agentTestCases: result.agentGeneratedAssets.testCases.length,
        harnessGates: result.agentGeneratedAssets.harnessGates.length,
        additionalTestIdeas: result.additionalTestIdeas.length,
      },
      null,
      2,
    ),
  );
} finally {
  server.kill("SIGTERM");
}

function buildSmokeArtifacts() {
  return {
    review: {
      requirementUnits: [
        {
          id: "REQ-SENT-001",
          content: "站点推荐需要展示历史站点和热点站点，小程序 Push 需要支持消息模板。",
        },
      ],
      clarificationItems: [],
    },
    intake: {
      texts: [
        {
          id: "REQ-TEXT-001",
          content: "站点推荐需要展示历史站点和热点站点，小程序 Push 需要支持消息模板。",
        },
      ],
      files: [],
      documentStats: { parsedFiles: 0, parsedPages: 0, parsedChars: 0 },
      humanClarifications: [],
    },
    technical: {
      domains: ["mobile_passenger", "oms"],
    },
    testPoints: {
      points: [{ id: "TP-001", priority: "P1", description: "站点推荐测试点" }],
    },
    cases: [{ id: "CASE-001", priority: "P1", reviewStatus: "pending_human_review" }],
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
