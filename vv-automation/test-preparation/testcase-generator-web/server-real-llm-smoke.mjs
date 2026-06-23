import { spawn } from "node:child_process";

const port = Number(process.env.REAL_LLM_SMOKE_PORT || 18769);
const provider = process.env.LLM_PROVIDER || process.env.MODEL_PROVIDER || "openai";
const requiredEnvKey = provider === "volcengine-coding-plan" ? "ARK_API_KEY" : "OPENAI_API_KEY";

if (!process.env[requiredEnvKey]) {
  throw new Error(
    `${requiredEnvKey} is required for real LLM smoke. Run with: ${requiredEnvKey}=... node server-real-llm-smoke.mjs`,
  );
}

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: import.meta.dirname,
  env: {
    ...process.env,
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(port);
  const response = await fetch(`http://127.0.0.1:${port}/api/agent-generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      artifacts: {
        intake: {
          texts: [
            {
              id: "REQ-TEXT-001",
              content:
                "乘客端小程序需要支持 Push 消息模板，车辆到达上车点后通知乘客；若 Push 失败，需要有用户可见的降级提示。",
            },
          ],
          files: [],
          documentStats: { parsedFiles: 0, parsedPages: 0, parsedChars: 0 },
          humanClarifications: [],
        },
        review: {
          requirementUnits: [
            {
              id: "REQ-SENT-001",
              content:
                "乘客端小程序需要支持 Push 消息模板，车辆到达上车点后通知乘客；若 Push 失败，需要有用户可见的降级提示。",
            },
          ],
          clarificationItems: [
            {
              id: "CLARIFY-001",
              sourceRef: "REQ-SENT-001",
              question: "Push 失败后的降级渠道、重试次数和用户提示文案需要明确。",
              status: "pending_human_confirmation",
            },
          ],
        },
        technical: {
          domains: ["mobile_passenger", "vehicle_cloud", "oms"],
          impacts: [
            {
              id: "TECH-001",
              sourceRef: "REQ-SENT-001",
              summary: "需要验证订单状态事件、Push 模板服务和乘客端消息展示的一致性。",
              testability: "automatable",
            },
          ],
        },
        testPoints: {
          points: [{ id: "TP-001", priority: "P0", description: "车辆到达后 Push 消息模板触达" }],
        },
        cases: [{ id: "CASE-001", priority: "P0", reviewStatus: "pending_human_review" }],
        releaseReadiness: { status: "not_ready" },
      },
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`App API returned ${response.status}: ${JSON.stringify(result).slice(0, 500)}`);
  }
  if (result.mode !== "llm_rag_agent_enhanced" || result.llmEnabled !== true) {
    throw new Error(`Expected real LLM mode, got mode=${result.mode}, llmEnabled=${result.llmEnabled}`);
  }
  if (!result.requirementAnalysis?.businessCapabilities?.length) {
    throw new Error("Expected real LLM requirement analysis business capabilities.");
  }
  if (!result.agentGeneratedAssets?.testPoints?.length) {
    throw new Error("Expected real LLM generated test points.");
  }
  if (!result.agentGeneratedAssets?.testCases?.length) {
    throw new Error("Expected real LLM generated test cases.");
  }
  if (!result.agentGeneratedAssets?.harnessGates?.length) {
    throw new Error("Expected real LLM Harness Gate results.");
  }
  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        llmEnabled: result.llmEnabled,
        provider: result.provider,
        model: result.model,
        retrievedKnowledge: result.retrievedKnowledge?.length || 0,
        requirementCapabilities: result.requirementAnalysis.businessCapabilities.length,
        agentTestPoints: result.agentGeneratedAssets.testPoints.length,
        agentTestCases: result.agentGeneratedAssets.testCases.length,
        harnessGates: result.agentGeneratedAssets.harnessGates.length,
      },
      null,
      2,
    ),
  );
} finally {
  server.kill("SIGTERM");
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
