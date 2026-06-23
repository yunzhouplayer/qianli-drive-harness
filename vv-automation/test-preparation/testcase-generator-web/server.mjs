import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, relative, resolve } from "node:path";

const rootDir = resolve(import.meta.dirname);
const repoRoot = resolve(rootDir, "../../..");
const knowledgeRoot = resolve(repoRoot, "knowledge");
const port = Number(process.env.PORT || 8765);
const llmConfig = resolveLlmConfig();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".pdf", "application/pdf"],
]);

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/requirement-analyze") {
      await handleRequirementAnalyze(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/agent-generate") {
      await handleAgentGenerate(request, response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    if (request.url === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: "internal_error", message: error.message });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Testcase generator server listening on http://127.0.0.1:${port}/`);
});

async function handleRequirementAnalyze(request, response) {
  const body = await readJsonBody(request);
  const artifacts = body.artifacts || {};
  const retrievedKnowledge = await retrieveKnowledge(artifacts);
  const base = buildFallbackAgentResult(artifacts, retrievedKnowledge);

  if (!llmConfig.apiKey) {
    sendJson(response, 200, {
      ...toRequirementAnalysisOnly(base),
      mode: "analysis_rule_fallback_with_rag",
      model: null,
      llmEnabled: false,
      provider: llmConfig.provider,
      note: `${llmConfig.envKey} is not set; returned deterministic RAG-backed requirement analysis.`,
    });
    return;
  }

  try {
    const llmResult = await callChunkedRequirementAnalysis(artifacts, retrievedKnowledge);
    const mode =
      llmResult.analysisSummary?.strategy === "single_requirement_analysis"
        ? "llm_rag_requirement_analysis"
        : llmResult.analysisSummary?.failedChunks
          ? "llm_rag_requirement_analysis_chunked_partial"
          : "llm_rag_requirement_analysis_chunked";
    sendJson(response, 200, {
      ...toRequirementAnalysisOnly({ ...base, ...llmResult }),
      mode,
      llmEnabled: llmResult.llmEnabled,
      provider: llmConfig.provider,
      retrievedKnowledge,
    });
  } catch (error) {
    sendJson(response, 200, {
      ...toRequirementAnalysisOnly(base),
      mode: "analysis_llm_failed_rule_fallback_with_rag",
      llmEnabled: false,
      provider: llmConfig.provider,
      llmError: error.message,
      note: "LLM requirement analysis failed; returned deterministic RAG-backed analysis.",
    });
  }
}

function toRequirementAnalysisOnly(result) {
  const requirementAnalysis = normalizeServerRequirementAnalysis(result.requirementAnalysis);
  const agentGeneratedAssets = {
    productClarifications: result.agentGeneratedAssets?.productClarifications || [],
    developmentImpacts: [],
    testPoints: [],
    testCases: [],
    harnessGates: [],
  };
  return {
    ...result,
    requirementAnalysis,
    agentGeneratedAssets,
    additionalTestIdeas: [],
    reviewFindings: [],
    agentWorkflow: normalizeAgentWorkflow(result.agentWorkflow, {
      stage: "requirement_analysis",
      llmEnabled: result.llmEnabled,
      requirementAnalysis,
      agentGeneratedAssets,
      agentFindings: result.agentFindings || [],
      suggestedClarifications: result.suggestedClarifications || [],
    }),
  };
}

function toFullGenerationOnly(result) {
  return {
    ...result,
    requirementAnalysis: null,
  };
}

function dedupeServerArtifacts(artifacts) {
  const requirementUnits = dedupeServerRequirementUnits(artifacts.review?.requirementUnits || []);
  return {
    ...artifacts,
    review: {
      ...(artifacts.review || {}),
      requirementUnits,
      businessGoals: rebuildBusinessGoalsForUnits(requirementUnits, artifacts.review?.businessGoals || []),
      acceptanceCriteria: rebuildAcceptanceCriteriaForUnits(requirementUnits, artifacts.review?.acceptanceCriteria || []),
    },
  };
}

function normalizeServerRequirementAnalysis(analysis) {
  if (!analysis) return analysis;
  const requirementUnits = dedupeServerRequirementUnits(
    (analysis.requirementUnits || []).map((item) => ({
      ...item,
      content: item.requirement || item.content || item.title || "",
    })),
  ).map((item, index) => ({
    ...item,
    id: item.id || `REQ-UNIT-${String(index + 1).padStart(3, "0")}`,
    requirement: item.requirement || item.content,
  }));
  const unitIds = new Set(requirementUnits.map((item) => item.id));
  return {
    ...analysis,
    requirementUnits,
    businessCapabilities: dedupeServerTextItems(analysis.businessCapabilities || [], (item) => item.capability || ""),
    ambiguities: (analysis.ambiguities || []).filter((item) => !item.sourceRef || unitIds.has(item.sourceRef) || /^REQ-/.test(item.sourceRef)),
    riskSignals: dedupeServerTextItems(analysis.riskSignals || [], (item) => `${item.sourceRef || ""}:${item.signal || ""}:${item.reason || ""}`),
  };
}

function dedupeServerRequirementUnits(units) {
  const kept = [];
  for (const unit of units || []) {
    const text = unit.content || unit.requirement || unit.title || "";
    if (!text) continue;
    const fingerprint = buildServerRequirementFingerprint(text);
    const duplicate = kept.some((existing) => {
      const existingText = existing.content || existing.requirement || existing.title || "";
      const existingFingerprint = buildServerRequirementFingerprint(existingText);
      return fingerprint === existingFingerprint || areServerFingerprintsSimilar(fingerprint, existingFingerprint);
    });
    if (duplicate) continue;
    kept.push({
      ...unit,
      content: unit.content || unit.requirement || unit.title || "",
    });
  }
  return kept.map((unit, index) => ({
    ...unit,
    id: unit.id || `REQ-SENT-${String(index + 1).padStart(3, "0")}`,
  }));
}

function dedupeServerTextItems(items, getText) {
  const kept = [];
  for (const item of items) {
    const fingerprint = buildServerRequirementFingerprint(getText(item));
    if (!fingerprint) continue;
    const duplicate = kept.some((existing) => areServerFingerprintsSimilar(fingerprint, buildServerRequirementFingerprint(getText(existing))));
    if (!duplicate) kept.push(item);
  }
  return kept;
}

function rebuildBusinessGoalsForUnits(units, existingGoals) {
  const goalBySource = new Map((existingGoals || []).map((item) => [item.sourceRef, item]));
  return units.map((unit) => ({
    id: goalBySource.get(unit.id)?.id || `GOAL-${unit.id}`,
    sourceRef: unit.id,
    sourceTextRef: unit.sourceTextRef,
    sourceFileRef: unit.sourceFileRef || null,
    sourceFileName: unit.sourceFileName || null,
    summary: goalBySource.get(unit.id)?.summary || unit.content || unit.requirement || unit.title || "",
  }));
}

function rebuildAcceptanceCriteriaForUnits(units, existingCriteria) {
  const criteriaBySource = new Map((existingCriteria || []).filter((item) => item.sourceRef).map((item) => [item.sourceRef, item]));
  const humanCriteria = (existingCriteria || []).filter((item) => String(item.id || "").startsWith("AC-HUMAN-"));
  return [
    ...units.map((unit, index) => {
      const existing = criteriaBySource.get(unit.id);
      return {
        id: existing?.id || `AC-${String(index + 1).padStart(3, "0")}`,
        sourceRef: unit.id,
        criteria: existing?.criteria || `${unit.content || unit.requirement || unit.title} 应具备明确输入、处理结果和用户可见反馈。`,
      };
    }),
    ...humanCriteria,
  ];
}

async function handleAgentGenerate(request, response) {
  const body = await readJsonBody(request);
  const artifacts = dedupeServerArtifacts(body.artifacts || {});
  const retrievedKnowledge = await retrieveKnowledge(artifacts);
  const base = toFullGenerationOnly(buildFallbackAgentResult(artifacts, retrievedKnowledge));
  const requirementUnits = artifacts.review?.requirementUnits || [];
  base.generationSummary = buildGenerationSummary(
    requirementUnits,
    [
      {
        chunkId: "RULE-FALLBACK-001",
        status: "fallback",
        unitIds: requirementUnits.map((item) => item.id),
        result: base,
      },
    ],
    base.agentGeneratedAssets,
    base.reviewFindings,
    base.additionalTestIdeas,
  );

  if (!llmConfig.apiKey) {
    sendJson(response, 200, {
      ...base,
      mode: "rule_fallback_with_rag",
      model: null,
      llmEnabled: false,
      provider: llmConfig.provider,
      note: `${llmConfig.envKey} is not set; returned deterministic RAG-backed fallback.`,
    });
    return;
  }

  try {
    const llmResult = await callChunkedFullGeneration(artifacts, retrievedKnowledge);
    const mode =
      llmResult.llmEnabled && llmResult.generationSummary?.failedChunks
        ? "llm_rag_agent_enhanced_chunked_partial"
        : llmResult.llmEnabled
          ? "llm_rag_agent_enhanced_chunked"
          : "llm_failed_rule_fallback_with_rag";
    sendJson(response, 200, {
      ...base,
      ...llmResult,
      mode,
      provider: llmConfig.provider,
      retrievedKnowledge,
    });
  } catch (error) {
    sendJson(response, 200, {
      ...base,
      mode: "llm_failed_rule_fallback_with_rag",
      llmEnabled: false,
      provider: llmConfig.provider,
      llmError: error.message,
      note: "LLM call failed; returned deterministic RAG-backed fallback.",
    });
  }
}

async function callChunkedRequirementAnalysis(artifacts, retrievedKnowledge) {
  const candidateUnits = dedupeServerRequirementUnits(artifacts.review?.requirementUnits || []);
  const rawTextLength = (artifacts.intake?.texts || []).reduce((total, item) => total + String(item.content || "").length, 0);
  const shouldChunk = candidateUnits.length > 20 || rawTextLength > 12000;
  if (!shouldChunk || !candidateUnits.length) {
    const result = await callOpenAI(artifacts, retrievedKnowledge, "requirement_analysis");
    return {
      ...result,
      llmEnabled: true,
      analysisSummary: {
        strategy: "single_requirement_analysis",
        chunkCount: 1,
        succeededChunks: 1,
        failedChunks: 0,
        candidateRequirementUnits: candidateUnits.length,
        analyzedRequirementUnits: result.requirementAnalysis?.requirementUnits?.length || 0,
      },
    };
  }

  const chunks = chunkAnalysisRequirementUnits(candidateUnits);
  const chunkResults = await runWithConcurrency(chunks, 2, async (chunk, index) => {
    const chunkArtifacts = buildRequirementAnalysisChunkArtifacts(artifacts, chunk, index, chunks.length);
    try {
      const result = await callOpenAI(chunkArtifacts, retrievedKnowledge, "requirement_analysis");
      return {
        chunkId: chunkArtifacts.analysisChunk.id,
        status: "llm",
        unitIds: chunk.map((item) => item.id),
        result,
      };
    } catch (error) {
      const fallback = toRequirementAnalysisOnly(buildFallbackAgentResult(chunkArtifacts, retrievedKnowledge));
      return {
        chunkId: chunkArtifacts.analysisChunk.id,
        status: "fallback",
        unitIds: chunk.map((item) => item.id),
        error: error.message,
        result: fallback,
      };
    }
  });

  const succeededChunks = chunkResults.filter((item) => item.status === "llm").length;
  if (!succeededChunks) {
    throw new Error(chunkResults.map((item) => `${item.chunkId}: ${item.error || "unknown"}`).join("; "));
  }
  const merged = mergeRequirementAnalysisChunkResults(candidateUnits, chunkResults);
  return {
    ...merged,
    llmEnabled: true,
    analysisSummary: {
      strategy: "chunked_requirement_analysis",
      chunkCount: chunkResults.length,
      succeededChunks,
      failedChunks: chunkResults.length - succeededChunks,
      candidateRequirementUnits: candidateUnits.length,
      analyzedRequirementUnits: merged.requirementAnalysis?.requirementUnits?.length || 0,
      chunkErrors: chunkResults
        .filter((item) => item.error)
        .map((item) => ({ chunkId: item.chunkId, unitIds: item.unitIds, error: item.error.slice(0, 300) })),
    },
  };
}

function chunkAnalysisRequirementUnits(requirementUnits) {
  const preferredSize = 6;
  const maxChunks = 40;
  const size = Math.max(preferredSize, Math.ceil(requirementUnits.length / maxChunks));
  const chunks = [];
  for (let index = 0; index < requirementUnits.length; index += size) {
    chunks.push(requirementUnits.slice(index, index + size));
  }
  return chunks;
}

function buildRequirementAnalysisChunkArtifacts(artifacts, chunk, index, total) {
  const chunkText = chunk.map((item) => `${item.id}: ${item.content || item.requirement || item.title || ""}`).join("\n");
  return {
    ...artifacts,
    intake: {
      ...(artifacts.intake || {}),
      texts: [
        {
          id: `ANALYSIS-CHUNK-TEXT-${String(index + 1).padStart(3, "0")}`,
          sourceType: "requirement_candidate_chunk",
          content: chunkText,
        },
      ],
    },
    review: {
      ...(artifacts.review || {}),
      requirementUnits: chunk,
    },
    analysisChunk: {
      id: `ANALYSIS-CHUNK-${String(index + 1).padStart(3, "0")}`,
      index: index + 1,
      total,
      unitIds: chunk.map((item) => item.id),
    },
  };
}

function mergeRequirementAnalysisChunkResults(candidateUnits, chunkResults) {
  const requirementUnits = [];
  const businessCapabilities = [];
  const ambiguities = [];
  const riskSignals = [];
  const productClarifications = [];
  const agentFindings = [];
  const suggestedClarifications = [];
  const seen = {
    units: new Set(),
    capabilities: new Set(),
    ambiguities: new Set(),
    risks: new Set(),
    productClarifications: new Set(),
    findings: new Set(),
    suggestedClarifications: new Set(),
  };

  for (const chunk of chunkResults) {
    const result = chunk.result || {};
    const analysis = result.requirementAnalysis || {};
    for (const item of analysis.requirementUnits || []) {
      const text = item.requirement || item.content || item.title || "";
      const key = buildServerRequirementFingerprint(text);
      if (!key || seen.units.has(key)) continue;
      if (Array.from(seen.units).some((existingKey) => areServerFingerprintsSimilar(key, existingKey))) continue;
      seen.units.add(key);
      requirementUnits.push({
        id: `LLM-REQ-${String(requirementUnits.length + 1).padStart(3, "0")}`,
        sourceRef: item.sourceRef || chunk.unitIds[0] || "REQ-SENT-UNKNOWN",
        title: item.title || text.slice(0, 36),
        requirement: text,
        type: item.type || inferRequirementUnitType(text),
        priority: item.priority || classifyServerPriority(text),
        rationale: item.rationale || "",
      });
    }

    pushMergedAnalysisItems(businessCapabilities, analysis.businessCapabilities || [], seen.capabilities, (item) => `${item.sourceRef || ""}:${item.capability || ""}`);
    pushMergedAnalysisItems(ambiguities, analysis.ambiguities || [], seen.ambiguities, (item) => `${item.sourceRef || ""}:${item.issue || ""}:${item.suggestedClarification || ""}`);
    pushMergedAnalysisItems(riskSignals, analysis.riskSignals || [], seen.risks, (item) => `${item.sourceRef || ""}:${item.signal || ""}:${item.reason || ""}`);
    pushMergedAnalysisItems(productClarifications, result.agentGeneratedAssets?.productClarifications || [], seen.productClarifications, (item) => `${item.sourceRef || ""}:${item.question || ""}:${item.acceptanceImpact || ""}`);
    pushMergedAnalysisItems(agentFindings, result.agentFindings || [], seen.findings, (item) => `${item.agent || ""}:${item.finding || ""}`);
    pushMergedAnalysisItems(suggestedClarifications, result.suggestedClarifications || [], seen.suggestedClarifications, (item) => `${item.sourceRef || ""}:${item.question || ""}:${item.reason || ""}`);
  }

  if (!requirementUnits.length) {
    candidateUnits.forEach((unit) => {
      const text = unit.content || unit.requirement || unit.title || "";
      requirementUnits.push({
        id: `LLM-REQ-${String(requirementUnits.length + 1).padStart(3, "0")}`,
        sourceRef: unit.id,
        title: unit.title || text.slice(0, 36),
        requirement: text,
        type: inferRequirementUnitType(text),
        priority: classifyServerPriority(text),
        rationale: "LLM 分片未返回需求单元，使用候选需求单元兜底。",
      });
    });
  }

  return {
    requirementAnalysis: {
      sourceSummary: `分片分析 ${chunkResults.length} 个需求候选批次，生成 ${requirementUnits.length} 个去重后的需求单元。`,
      requirementUnits,
      businessCapabilities,
      ambiguities,
      riskSignals,
    },
    agentGeneratedAssets: {
      productClarifications,
      developmentImpacts: [],
      testPoints: [],
      testCases: [],
      harnessGates: [],
    },
    agentFindings,
    suggestedClarifications,
    additionalTestIdeas: [],
    reviewFindings: [],
  };
}

function pushMergedAnalysisItems(target, items, seen, getKey) {
  for (const item of items) {
    const key = buildServerRequirementFingerprint(getKey(item));
    if (!key) continue;
    if (seen.has(key)) continue;
    if (Array.from(seen).some((existingKey) => areServerFingerprintsSimilar(key, existingKey))) continue;
    seen.add(key);
    target.push(item);
  }
}

async function callOpenAI(artifacts, retrievedKnowledge, stage) {
  const prompt = buildAgentPrompt(artifacts, retrievedKnowledge, stage);
  const response = await fetch(`${llmConfig.baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model,
      input: [
        {
          role: "system",
          content:
            "You are a Robotaxi passenger miniapp test-development multi-agent orchestrator. Return one valid JSON object only. Do not use markdown, code fences, comments, explanations, or trailing commas.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      text: {
        format: {
          type: "json_object",
        },
      },
      max_output_tokens: 30000,
      store: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  const outputText = data.output_text || extractOutputText(data);
  const parsed = parseLlmJson(outputText);
  return {
    provider: llmConfig.provider,
    model: llmConfig.model,
    requirementAnalysis: stage === "requirement_analysis" ? parsed.requirementAnalysis || null : null,
    agentGeneratedAssets: parsed.agentGeneratedAssets || null,
    agentFindings: parsed.agentFindings || [],
    agentWorkflow: Array.isArray(parsed.agentWorkflow) ? parsed.agentWorkflow : [],
    suggestedClarifications: parsed.suggestedClarifications || [],
    additionalTestIdeas: parsed.additionalTestIdeas || [],
    reviewFindings: parsed.reviewFindings || [],
  };
}

async function callChunkedFullGeneration(artifacts, retrievedKnowledge) {
  const requirementUnits = dedupeServerRequirementUnits(artifacts.review?.requirementUnits || []);
  if (!requirementUnits.length) {
    return {
      provider: llmConfig.provider,
      model: llmConfig.model,
      requirementAnalysis: null,
      ...toFullGenerationOnly(buildFallbackAgentResult(artifacts, retrievedKnowledge)),
      generationSummary: buildGenerationSummary(requirementUnits, [], [], [], []),
      llmEnabled: false,
    };
  }

  const chunks = chunkRequirementUnits(requirementUnits);
  const chunkResults = await runWithConcurrency(chunks, 2, async (chunk, index) => {
    const chunkArtifacts = buildChunkArtifacts(artifacts, chunk, index, chunks.length);
    try {
      const result = await callOpenAI(chunkArtifacts, retrievedKnowledge, "full_generation");
      return {
        chunkId: chunkArtifacts.generationChunk.id,
        status: "llm",
        unitIds: chunk.map((item) => item.id),
        result,
      };
    } catch (error) {
      const fallback = toFullGenerationOnly(buildFallbackAgentResult(chunkArtifacts, retrievedKnowledge));
      return {
        chunkId: chunkArtifacts.generationChunk.id,
        status: "fallback",
        unitIds: chunk.map((item) => item.id),
        error: error.message,
        result: {
          provider: llmConfig.provider,
          model: llmConfig.model,
          ...fallback,
        },
      };
    }
  });

  let merged = mergeChunkedGenerationResults(requirementUnits, chunkResults);
  const initialCoverage = computeRequirementTraceabilityCoverage(requirementUnits, merged.agentGeneratedAssets);
  let repairRounds = 0;
  const repairChunkResults = [];
  if (initialCoverage.uncoveredRequirementUnitIds.length) {
    const repairUnits = requirementUnits.filter((item) => initialCoverage.uncoveredRequirementUnitIds.includes(item.id));
    try {
      const repairArtifacts = buildRepairArtifacts(artifacts, repairUnits);
      const repairResult = await callOpenAI(repairArtifacts, retrievedKnowledge, "full_generation");
      repairRounds = 1;
      repairChunkResults.push({
        chunkId: repairArtifacts.generationChunk.id,
        status: "llm_repair",
        unitIds: repairUnits.map((item) => item.id),
        result: repairResult,
      });
      merged = mergeChunkedGenerationResults(requirementUnits, [...chunkResults, ...repairChunkResults]);
    } catch (error) {
      repairRounds = 1;
      repairChunkResults.push({
        chunkId: "REPAIR-ROUND-001",
        status: "fallback_repair",
        unitIds: repairUnits.map((item) => item.id),
        error: error.message,
        result: null,
      });
    }
  }

  const preCompensationCoverage = computeRequirementTraceabilityCoverage(requirementUnits, merged.agentGeneratedAssets);
  const closure = enforceTraceabilityClosure(requirementUnits, merged.agentGeneratedAssets);
  merged.agentGeneratedAssets = closure.assets;
  const agentReflectionFindings = buildAgentReflectionFindings(requirementUnits, merged.agentGeneratedAssets, artifacts.review, {
    initialCoverage,
    preCompensationCoverage,
    compensatedAssets: closure.compensatedAssets,
  });
  appendReflectionGates(merged.agentGeneratedAssets, agentReflectionFindings, closure.compensatedAssets);
  merged.reviewFindings.push(...agentReflectionFindings.map((item) => ({
    gate: item.type,
    status: item.severity === "blocker" ? "blocked" : item.severity === "warning" ? "warning" : "passed",
    finding: item.finding,
  })));

  const successfulChunks = chunkResults.filter((item) => item.status === "llm").length;
  const failedChunks = chunkResults.length - successfulChunks;
  const allChunkResults = [...chunkResults, ...repairChunkResults];
  const generationSummary = buildGenerationSummary(requirementUnits, allChunkResults, merged.agentGeneratedAssets, merged.reviewFindings, merged.additionalTestIdeas, agentReflectionFindings, {
    initialCoverage,
    preCompensationCoverage,
    repairRounds,
    compensatedAssets: closure.compensatedAssets,
  });
  const agentWorkflow = normalizeAgentWorkflow(merged.agentWorkflow, {
    stage: "full_generation",
    llmEnabled: successfulChunks > 0,
    requirementUnits,
    agentGeneratedAssets: merged.agentGeneratedAssets,
    agentFindings: merged.agentFindings,
    suggestedClarifications: merged.suggestedClarifications,
    reviewFindings: merged.reviewFindings,
    agentReflectionFindings,
    generationSummary,
  });
  return {
    provider: llmConfig.provider,
    model: llmConfig.model,
    requirementAnalysis: null,
    agentGeneratedAssets: merged.agentGeneratedAssets,
    agentFindings: merged.agentFindings,
    agentWorkflow,
    suggestedClarifications: merged.suggestedClarifications,
    additionalTestIdeas: merged.additionalTestIdeas,
    reviewFindings: merged.reviewFindings,
    agentReflectionFindings,
    generationSummary,
    llmEnabled: successfulChunks > 0,
    chunkErrors: allChunkResults
      .filter((item) => item.error)
      .map((item) => ({ chunkId: item.chunkId, unitIds: item.unitIds, error: item.error.slice(0, 500) })),
    note: failedChunks ? `${failedChunks} 个分片使用规则回退，其余分片使用 LLM 生成。` : "所有分片均完成 LLM 生成。",
  };
}

function chunkRequirementUnits(requirementUnits) {
  const maxChunks = 20;
  const preferredSize = 6;
  const size = Math.max(preferredSize, Math.ceil(requirementUnits.length / maxChunks));
  const chunks = [];
  for (let index = 0; index < requirementUnits.length; index += size) {
    chunks.push(requirementUnits.slice(index, index + size));
  }
  return chunks;
}

function buildChunkArtifacts(artifacts, chunk, index, total) {
  return {
    ...artifacts,
    review: {
      ...(artifacts.review || {}),
      requirementUnits: chunk,
    },
    testPoints: { ...(artifacts.testPoints || {}), points: [] },
    cases: [],
    generationChunk: {
      id: `GEN-CHUNK-${String(index + 1).padStart(3, "0")}`,
      index: index + 1,
      total,
      unitIds: chunk.map((item) => item.id),
    },
  };
}

function buildRepairArtifacts(artifacts, repairUnits) {
  return {
    ...artifacts,
    review: {
      ...(artifacts.review || {}),
      requirementUnits: repairUnits,
    },
    testPoints: { ...(artifacts.testPoints || {}), points: [] },
    cases: [],
    generationChunk: {
      id: "REPAIR-ROUND-001",
      index: 1,
      total: 1,
      unitIds: repairUnits.map((item) => item.id),
    },
    repairContext: {
      reason: "critic_agent_found_requirement_coverage_gap",
      targetCoverage: 100,
      uncoveredRequirementUnitIds: repairUnits.map((item) => item.id),
    },
  };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function mergeChunkedGenerationResults(requirementUnits, chunkResults) {
  const unitIds = new Set(requirementUnits.map((item) => item.id));
  const assets = {
    productClarifications: [],
    developmentImpacts: [],
    testPoints: [],
    testCases: [],
    harnessGates: [],
  };
  const agentFindings = [];
  const agentWorkflow = [];
  const suggestedClarifications = [];
  const additionalTestIdeas = [];
  const reviewFindings = [];
  const seen = {
    productClarifications: new Set(),
    developmentImpacts: new Set(),
    testPoints: new Set(),
    testCases: new Set(),
    harnessGates: new Set(),
    suggestedClarifications: new Set(),
    additionalTestIdeas: new Set(),
    reviewFindings: new Set(),
  };
  let clarifySeq = 1;
  let techSeq = 1;
  let tpSeq = 1;
  let caseSeq = 1;
  let gateSeq = 1;

  for (const chunk of chunkResults) {
    const result = chunk.result || {};
    const generatedAssets = result.agentGeneratedAssets || {};
    const chunkUnitIds = new Set(chunk.unitIds || []);
    const pointIdMap = new Map();

    for (const item of generatedAssets.productClarifications || []) {
      const sourceRef = coerceRequirementRef(item.sourceRef, unitIds, chunkUnitIds);
      const key = stableKey([sourceRef, item.question, item.acceptanceImpact]);
      if (seen.productClarifications.has(key)) continue;
      seen.productClarifications.add(key);
      assets.productClarifications.push({
        id: `LLM-CLARIFY-${String(clarifySeq++).padStart(3, "0")}`,
        sourceRef,
        question: item.question || "补充需求验收口径。",
        acceptanceImpact: item.acceptanceImpact || "影响测试设计和验收标准。",
      });
    }

    for (const item of generatedAssets.developmentImpacts || []) {
      const sourceRef = coerceRequirementRef(item.sourceRef, unitIds, chunkUnitIds);
      const key = stableKey([sourceRef, item.domain, item.impact]);
      if (seen.developmentImpacts.has(key)) continue;
      seen.developmentImpacts.add(key);
      assets.developmentImpacts.push({
        id: `LLM-TECH-${String(techSeq++).padStart(3, "0")}`,
        sourceRef,
        domain: item.domain || inferDomainFromRiskSignal(""),
        impact: item.impact || item.summary || "验证该需求涉及的接口、状态和数据一致性影响。",
        testability: item.testability || "needs_probe",
      });
    }

    for (const item of generatedAssets.testPoints || []) {
      const sourceRef = coerceRequirementRef(item.sourceRef, unitIds, chunkUnitIds);
      const key = stableKey([sourceRef, item.priority, item.title, item.risk]);
      if (seen.testPoints.has(key)) continue;
      seen.testPoints.add(key);
      const newId = `LLM-TP-${String(tpSeq++).padStart(3, "0")}`;
      if (item.id) pointIdMap.set(item.id, newId);
      assets.testPoints.push({
        id: newId,
        sourceRef,
        priority: normalizePriority(item.priority),
        title: item.title || item.description || "LLM 生成测试点",
        risk: item.risk || "",
      });
    }

    for (const item of generatedAssets.testCases || []) {
      const sourceRefs = normalizeCaseSourceRefs(item.sourceRefs, pointIdMap, unitIds, chunkUnitIds);
      const key = stableKey([sourceRefs.join("|"), item.priority, item.title, (item.steps || []).join("|")]);
      if (seen.testCases.has(key)) continue;
      seen.testCases.add(key);
      assets.testCases.push({
        id: `LLM-CASE-${String(caseSeq++).padStart(3, "0")}`,
        sourceRefs,
        priority: normalizePriority(item.priority),
        title: item.title || "LLM 生成候选用例",
        preconditions: normalizeStringArray(item.preconditions, ["测试账号、订单、车辆、站点或仿真状态已准备。"]),
        steps: normalizeStringArray(item.steps, ["触发对应业务链路。", "采集客户端、服务端和状态流转证据。"]),
        expectedResults: normalizeStringArray(item.expectedResults, ["系统行为、状态、数据和用户可见反馈符合需求。"]),
      });
    }

    for (const item of generatedAssets.harnessGates || []) {
      const key = stableKey([item.status, item.finding, item.evidence]);
      if (seen.harnessGates.has(key)) continue;
      seen.harnessGates.add(key);
      assets.harnessGates.push({
        id: `LLM-GATE-${String(gateSeq++).padStart(3, "0")}`,
        status: ["passed", "warning", "blocked"].includes(item.status) ? item.status : "warning",
        finding: item.finding || "LLM 分片生成结果需要 Harness Gate 复核。",
        evidence: item.evidence || chunk.chunkId,
      });
    }

    pushUniqueObjects(agentFindings, result.agentFindings || [], (item) => stableKey([item.agent, item.finding]));
    pushUniqueObjects(agentWorkflow, result.agentWorkflow || [], (item) => stableKey([item.agent || item.id, item.stage, item.summary]));
    pushUniqueObjects(suggestedClarifications, result.suggestedClarifications || [], (item) => {
      item.sourceRef = coerceRequirementRef(item.sourceRef, unitIds, chunkUnitIds);
      return stableKey([item.sourceRef, item.question, item.reason]);
    }, seen.suggestedClarifications);
    pushUniqueObjects(additionalTestIdeas, result.additionalTestIdeas || [], (item) => {
      item.sourceRef = coerceRequirementRef(item.sourceRef, unitIds, chunkUnitIds);
      item.priority = normalizePriority(item.priority);
      return stableKey([item.sourceRef, item.priority, item.title, item.reason]);
    }, seen.additionalTestIdeas);
    pushUniqueObjects(reviewFindings, result.reviewFindings || [], (item) => stableKey([item.gate, item.status, item.finding]), seen.reviewFindings);
  }

  return {
    agentGeneratedAssets: assets,
    agentFindings,
    agentWorkflow,
    suggestedClarifications,
    additionalTestIdeas,
    reviewFindings,
  };
}

function buildGenerationSummary(requirementUnits, chunkResults, assets, reviewFindings, additionalTestIdeas, agentReflectionFindings = [], meta = {}) {
  const coverage = computeRequirementTraceabilityCoverage(requirementUnits, assets || {});
  const openReflectionFindings = agentReflectionFindings.filter((item) => item.status !== "closed" && item.severity !== "info").length;
  return {
    strategy: "chunked_requirement_unit_generation",
    chunkSize: chunkResults[0]?.unitIds?.length || requirementUnits.length || 0,
    chunkCount: chunkResults.length,
    succeededChunks: chunkResults.filter((item) => item.status?.startsWith("llm")).length,
    failedChunks: chunkResults.filter((item) => !item.status?.startsWith("llm")).length,
    totalRequirementUnits: coverage.totalRequirementUnits,
    coveredRequirementUnits: coverage.coveredRequirementUnits,
    coverageRate: coverage.coverageRate,
    requirementCoverageRate: coverage.requirementCoverageRate,
    testPointCoverageRate: coverage.testPointCoverageRate,
    uncoveredRequirementUnitIds: coverage.uncoveredRequirementUnitIds,
    generatedTestPoints: assets?.testPoints?.length || 0,
    generatedTestCases: assets?.testCases?.length || 0,
    reviewFindings: reviewFindings?.length || 0,
    additionalTestIdeas: additionalTestIdeas?.length || 0,
    reflectionStatus: coverage.uncoveredRequirementUnitIds.length
      ? "coverage_gap"
      : openReflectionFindings
        ? "needs_human_review"
        : "closed",
    repairRounds: meta.repairRounds || 0,
    compensatedAssets: meta.compensatedAssets || 0,
    initialRequirementCoverageRate: meta.initialCoverage?.requirementCoverageRate ?? meta.initialCoverage?.coverageRate ?? coverage.requirementCoverageRate,
    preCompensationRequirementCoverageRate:
      meta.preCompensationCoverage?.requirementCoverageRate ?? meta.preCompensationCoverage?.coverageRate ?? coverage.requirementCoverageRate,
    reflectionFindings: agentReflectionFindings.length,
    chunks: chunkResults.map((item) => ({
      chunkId: item.chunkId,
      status: item.status,
      unitIds: item.unitIds,
      testPoints: item.result?.agentGeneratedAssets?.testPoints?.length || 0,
      testCases: item.result?.agentGeneratedAssets?.testCases?.length || 0,
      error: item.error ? item.error.slice(0, 240) : "",
    })),
  };
}

function normalizeAgentWorkflow(workflow, context) {
  const source = Array.isArray(workflow) ? workflow : [];
  const normalized = source
    .map((item) => ({
      agent: item.agent || item.id || "unknown-agent",
      stage: item.stage || context.stage || "unknown",
      role: item.role || "",
      input: normalizeStringArray(item.input, []),
      output: normalizeStringArray(item.output, []),
      findings: normalizeStringArray(item.findings, item.finding ? [item.finding] : []),
      handoffTo: item.handoffTo || "",
      status: item.status || "done",
      summary: item.summary || item.finding || "",
    }))
    .filter((item) => item.agent !== "unknown-agent");
  const requiredAgents =
    context.stage === "requirement_analysis"
      ? ["product-agent"]
      : ["product-agent", "development-agent", "testing-agent", "review-agent", "critic-agent"];
  const byAgent = new Map(normalized.map((item) => [item.agent, item]));
  for (const agent of requiredAgents) {
    if (!byAgent.has(agent)) byAgent.set(agent, buildDefaultAgentWorkflowItem(agent, context));
  }
  return requiredAgents.map((agent) => byAgent.get(agent));
}

function buildDefaultAgentWorkflowItem(agent, context) {
  const assets = context.agentGeneratedAssets || {};
  const requirementUnits = context.requirementUnits || context.requirementAnalysis?.requirementUnits || [];
  const findings = (context.agentFindings || []).filter((item) => item.agent === agent).map((item) => item.finding);
  if (agent === "product-agent") {
    const clarificationCount = (assets.productClarifications || []).length + (context.suggestedClarifications || []).length;
    return {
      agent,
      stage: context.stage,
      role: "需求拆解、风险识别、澄清项提出",
      input: ["PRD 正文", "RAG 知识", "人工补充"],
      output: [`需求单元 ${requirementUnits.length} 个`, `澄清建议 ${clarificationCount} 个`],
      findings: findings.length ? findings : [`Product Agent 完成 ${requirementUnits.length} 个需求单元的结构化处理。`],
      handoffTo: context.stage === "requirement_analysis" ? "human-reviewer" : "development-agent",
      status: requirementUnits.length || clarificationCount ? "done" : "needs_review",
      summary: context.stage === "requirement_analysis" ? "完成一阶段需求解析与待澄清项沉淀。" : "复用一阶段需求单元并补充产品澄清项。",
    };
  }
  if (agent === "development-agent") {
    return {
      agent,
      stage: context.stage,
      role: "技术影响、接口/状态/数据测试性分析",
      input: ["需求单元", "澄清项"],
      output: [`技术影响 ${assets.developmentImpacts?.length || 0} 个`],
      findings: findings.length ? findings : [`Development Agent 产出 ${assets.developmentImpacts?.length || 0} 个技术影响。`],
      handoffTo: "testing-agent",
      status: assets.developmentImpacts?.length ? "done" : "needs_review",
      summary: "将需求映射到可测试的业务域、接口、状态和数据一致性影响。",
    };
  }
  if (agent === "testing-agent") {
    return {
      agent,
      stage: context.stage,
      role: "测试点、测试策略、测试用例生成",
      input: ["需求单元", "技术影响", "澄清项"],
      output: [`测试点 ${assets.testPoints?.length || 0} 个`, `测试用例 ${assets.testCases?.length || 0} 条`],
      findings: findings.length ? findings : [`Testing Agent 生成 ${assets.testPoints?.length || 0} 个测试点和 ${assets.testCases?.length || 0} 条用例。`],
      handoffTo: "review-agent",
      status: assets.testPoints?.length && assets.testCases?.length ? "done" : "needs_review",
      summary: "围绕风险优先级生成可追溯测试点和候选用例。",
    };
  }
  if (agent === "review-agent") {
    return {
      agent,
      stage: context.stage,
      role: "质量门禁、准出检查、人工评审建议",
      input: ["测试资产", "追溯矩阵", "覆盖指标"],
      output: [`门禁 ${assets.harnessGates?.length || 0} 个`, `评审发现 ${context.reviewFindings?.length || 0} 个`],
      findings: findings.length ? findings : [`Review Agent 汇总 ${context.reviewFindings?.length || 0} 个门禁发现。`],
      handoffTo: "critic-agent",
      status: context.reviewFindings?.some((item) => item.status === "blocked") ? "blocked" : "done",
      summary: "检查测试资产是否满足 Harness 门禁、追溯和人工评审要求。",
    };
  }
  return {
    agent: "critic-agent",
    stage: context.stage,
    role: "反思评审、覆盖缺口识别、repair/补偿触发",
    input: ["需求闭环覆盖率", "测试点覆盖率", "澄清项", "P0/P1 用例"],
    output: [`反思发现 ${context.agentReflectionFindings?.length || 0} 个`, `修复轮次 ${context.generationSummary?.repairRounds || 0} 次`, `补偿资产 ${context.generationSummary?.compensatedAssets || 0} 个`],
    findings: (context.agentReflectionFindings || []).map((item) => item.finding).slice(0, 5),
    handoffTo: "human-reviewer",
    status: context.generationSummary?.reflectionStatus === "closed" ? "done" : "needs_review",
    summary: "对覆盖、追溯、质量和澄清缺口进行反思，并触发修复或兜底补偿。",
  };
}

function computeRequirementTraceabilityCoverage(requirementUnits, assets) {
  const unitIds = new Set(requirementUnits.map((item) => item.id));
  const pointIds = new Set((assets.testPoints || []).map((item) => item.id));
  const pointRequirementMap = new Map();
  for (const point of assets.testPoints || []) {
    const requirementRef = collectRequirementRefs([point.sourceRef], unitIds)[0];
    if (requirementRef) pointRequirementMap.set(point.id, requirementRef);
  }
  const coveredPoints = new Set();
  const coveredRequirements = new Set();
  for (const testCase of assets.testCases || []) {
    const sourceRefs = testCase.sourceRefs || [];
    collectPointRefs(sourceRefs, pointIds).forEach((pointId) => {
      coveredPoints.add(pointId);
      const requirementRef = pointRequirementMap.get(pointId);
      if (requirementRef) coveredRequirements.add(requirementRef);
    });
  }
  const uncoveredRequirementUnitIds = requirementUnits.map((item) => item.id).filter((id) => !coveredRequirements.has(id));
  const totalRequirementUnits = requirementUnits.length;
  const testPointCoverageRate = pointIds.size ? Math.round((coveredPoints.size / pointIds.size) * 100) : 0;
  const requirementCoverageRate = totalRequirementUnits ? Math.round((coveredRequirements.size / totalRequirementUnits) * 100) : 0;
  return {
    totalRequirementUnits,
    coveredRequirementUnits: coveredRequirements.size,
    coverageRate: requirementCoverageRate,
    requirementCoverageRate,
    testPointCoverageRate,
    uncoveredRequirementUnitIds,
    uncoveredTestPointIds: Array.from(pointIds).filter((id) => !coveredPoints.has(id)),
  };
}

function coerceRequirementRef(ref, unitIds, chunkUnitIds) {
  const refs = collectRequirementRefs([ref], unitIds);
  if (refs.length) return refs[0];
  return chunkUnitIds.values().next().value || "LLM-REQ-UNKNOWN";
}

function collectRequirementRefs(refs, unitIds) {
  const found = [];
  for (const rawRef of refs || []) {
    const text = String(rawRef || "");
    for (const id of unitIds) {
      if (text === id || text.includes(id)) found.push(id);
    }
  }
  return Array.from(new Set(found));
}

function collectPointRefs(refs, pointIds) {
  const found = [];
  for (const rawRef of refs || []) {
    const text = String(rawRef || "");
    for (const id of pointIds) {
      if (text === id || text.includes(id)) found.push(id);
    }
  }
  return Array.from(new Set(found));
}

function normalizeCaseSourceRefs(refs, pointIdMap, unitIds, chunkUnitIds) {
  const sourceRefs = [];
  for (const ref of refs || []) {
    if (pointIdMap.has(ref)) sourceRefs.push(pointIdMap.get(ref));
    collectRequirementRefs([ref], unitIds).forEach((id) => sourceRefs.push(id));
  }
  if (!collectRequirementRefs(sourceRefs, unitIds).length) {
    sourceRefs.push(chunkUnitIds.values().next().value || "LLM-REQ-UNKNOWN");
  }
  return Array.from(new Set(sourceRefs));
}

function enforceTraceabilityClosure(requirementUnits, assets) {
  const normalized = {
    productClarifications: [...(assets.productClarifications || [])],
    developmentImpacts: [...(assets.developmentImpacts || [])],
    testPoints: (assets.testPoints || []).map((item) => ({ ...item })),
    testCases: (assets.testCases || []).map((item) => ({ ...item, sourceRefs: [...(item.sourceRefs || [])] })),
    harnessGates: [...(assets.harnessGates || [])],
  };
  const unitIds = new Set(requirementUnits.map((item) => item.id));
  let compensatedAssets = 0;

  for (const unit of requirementUnits) {
    let points = normalized.testPoints.filter((point) => collectRequirementRefs([point.sourceRef], unitIds).includes(unit.id));
    if (!points.length) {
      const point = {
        id: nextAssetId("LLM-TP", normalized.testPoints.length + 1),
        sourceRef: unit.id,
        priority: normalizePriority(unit.priority),
        title: `${unit.title || unit.content || unit.id} 验证`,
        risk: unit.rationale || "Critic Agent 发现该需求缺少测试点，已补偿生成。",
      };
      normalized.testPoints.push(point);
      points = [point];
      compensatedAssets += 1;
    }

    const pointIds = points.map((point) => point.id);
    const linkedCases = normalized.testCases.filter((testCase) => {
      const refs = testCase.sourceRefs || [];
      return collectRequirementRefs(refs, unitIds).includes(unit.id) || refs.some((ref) => pointIds.includes(ref));
    });

    if (!linkedCases.length) {
      normalized.testCases.push({
        id: nextAssetId("LLM-CASE", normalized.testCases.length + 1),
        sourceRefs: [pointIds[0], unit.id],
        priority: normalizePriority(unit.priority),
        title: `${unit.title || unit.content || unit.id} 闭环验证`,
        preconditions: ["测试账号、订单、车辆、站点或仿真状态已准备。"],
        steps: [
          `触发 ${unit.title || unit.content || unit.id} 对应的主流程。`,
          "分别验证成功、失败和边界条件下的客户端反馈、服务端状态和关键数据。",
        ],
        expectedResults: [
          "需求对应功能可按验收口径完成。",
          "异常或边界路径有明确提示、日志和可追溯证据。",
        ],
      });
      compensatedAssets += 1;
      continue;
    }

    for (const testCase of linkedCases) {
      testCase.sourceRefs = Array.from(new Set([...(testCase.sourceRefs || []), pointIds[0], unit.id]));
    }
  }

  for (const point of normalized.testPoints) {
    const linkedCase = normalized.testCases.find((testCase) => (testCase.sourceRefs || []).includes(point.id));
    if (linkedCase) continue;

    const requirementRef = collectRequirementRefs([point.sourceRef], unitIds)[0];
    const reusableCase = normalized.testCases.find((testCase) => {
      const refs = testCase.sourceRefs || [];
      return requirementRef && collectRequirementRefs(refs, unitIds).includes(requirementRef);
    });
    if (reusableCase) {
      reusableCase.sourceRefs = Array.from(new Set([...(reusableCase.sourceRefs || []), point.id, requirementRef]));
      continue;
    }

    const unit = requirementUnits.find((item) => item.id === requirementRef) || {
      id: requirementRef || point.sourceRef,
      title: point.title,
      content: point.title,
      priority: point.priority,
    };
    normalized.testCases.push({
      id: nextAssetId("LLM-CASE", normalized.testCases.length + 1),
      sourceRefs: Array.from(new Set([point.id, unit.id].filter(Boolean))),
      priority: normalizePriority(point.priority || unit.priority),
      title: `${point.title || unit.title || unit.content || point.id} 覆盖验证`,
      preconditions: ["测试账号、订单、车辆、站点或仿真状态已准备。"],
      steps: [
        `触发 ${point.title || unit.title || unit.content || point.id} 对应测试点。`,
        "采集客户端反馈、服务端状态和关键数据证据。",
      ],
      expectedResults: [
        "测试点对应行为符合需求和验收口径。",
        "异常或边界路径具备明确提示和可追溯证据。",
      ],
    });
    compensatedAssets += 1;
  }

  return { assets: normalized, compensatedAssets };
}

function buildAgentReflectionFindings(requirementUnits, assets, review, meta) {
  const findings = [];
  const finalCoverage = computeRequirementTraceabilityCoverage(requirementUnits, assets);
  const unitIds = new Set(requirementUnits.map((item) => item.id));
  const pointIds = new Set((assets.testPoints || []).map((item) => item.id));
  let seq = 1;

  for (const id of meta.initialCoverage.uncoveredRequirementUnitIds || []) {
    findings.push({
      id: `CRITIC-${String(seq++).padStart(3, "0")}`,
      agent: "critic-agent",
      type: "coverage_gap",
      severity: "warning",
      sourceRef: id,
      finding: "初次生成未形成需求单元到测试用例的闭环覆盖。",
      recommendation: "已触发一轮 repair；若仍未覆盖，则使用确定性补偿资产兜底。",
      status: finalCoverage.uncoveredRequirementUnitIds.includes(id) ? "open" : "closed",
    });
  }

  const initialUncoveredTestPoints = meta.initialCoverage.uncoveredTestPointIds || [];
  const finalUncoveredTestPoints = new Set(finalCoverage.uncoveredTestPointIds || []);
  for (const id of initialUncoveredTestPoints.slice(0, 20)) {
    findings.push({
      id: `CRITIC-${String(seq++).padStart(3, "0")}`,
      agent: "critic-agent",
      type: "test_point_gap",
      severity: "warning",
      sourceRef: id,
      finding: "初次生成存在未被任何测试用例引用的测试点。",
      recommendation: "已将测试点挂接到同需求用例；无可复用用例时生成补偿用例。",
      status: finalUncoveredTestPoints.has(id) ? "open" : "closed",
    });
  }

  for (const testCase of assets.testCases || []) {
    const pointRefs = collectPointRefs(testCase.sourceRefs || [], pointIds);
    const requirementRefs = collectRequirementRefs(testCase.sourceRefs || [], unitIds);
    if (!pointRefs.length || !requirementRefs.length) {
      findings.push({
        id: `CRITIC-${String(seq++).padStart(3, "0")}`,
        agent: "critic-agent",
        type: "traceability_gap",
        severity: "warning",
        sourceRef: testCase.id,
        finding: "用例缺少测试点或需求单元引用，影响 Harness 追溯。",
        recommendation: "补齐 sourceRefs 中的 LLM-TP 与 LLM-REQ 引用。",
        status: "open",
      });
    }
  }

  const highRiskUnits = new Map(requirementUnits.filter((item) => normalizePriority(item.priority) !== "P2").map((item) => [item.id, item]));
  for (const testCase of assets.testCases || []) {
    const refs = collectRequirementRefs(testCase.sourceRefs || [], unitIds);
    if (!refs.some((ref) => highRiskUnits.has(ref))) continue;
    const text = [...(testCase.steps || []), ...(testCase.expectedResults || []), testCase.title || ""].join("");
    if (!hasServerAny(text, ["异常", "失败", "边界", "超时", "降级", "无车", "拒绝"])) {
      findings.push({
        id: `CRITIC-${String(seq++).padStart(3, "0")}`,
        agent: "critic-agent",
        type: "quality_gap",
        severity: "warning",
        sourceRef: testCase.id,
        finding: "P0/P1 用例缺少明确的异常或边界验证表述。",
        recommendation: "补充失败、超时、边界或降级场景。",
        status: "open",
      });
    }
  }

  const unresolvedClarifications = (review?.clarificationItems || []).filter((item) => item.status !== "resolved_by_human" && item.status !== "closed");
  for (const item of unresolvedClarifications) {
    findings.push({
      id: `CRITIC-${String(seq++).padStart(3, "0")}`,
      agent: "critic-agent",
      type: "clarification_gap",
      severity: "info",
      sourceRef: item.sourceRef,
      finding: item.question || "仍存在未澄清项，可能影响用例精度。",
      recommendation: "由用户补充验收阈值、触发条件或异常口径后再迭代。",
      status: "open",
    });
  }

  if (meta.compensatedAssets > 0) {
    findings.push({
      id: `CRITIC-${String(seq++).padStart(3, "0")}`,
      agent: "critic-agent",
      type: "coverage_gap",
      severity: "warning",
      sourceRef: "deterministic_compensation",
      finding: `Critic 兜底补偿 ${meta.compensatedAssets} 个测试资产以保证需求与测试点双闭环覆盖。`,
      recommendation: "人工复核补偿资产质量后再进入正式资产库。",
      status: "closed",
    });
  }

  if (!findings.length) {
    findings.push({
      id: "CRITIC-001",
      agent: "critic-agent",
      type: "coverage_gap",
      severity: "info",
      sourceRef: "all",
      finding: "Critic Agent 未发现需求覆盖、测试点覆盖或追溯闭环缺口。",
      recommendation: "继续进行 P0/P1 人工评审。",
      status: "closed",
    });
  }

  return findings;
}

function appendReflectionGates(assets, findings, compensatedAssets) {
  const openWarnings = findings.filter((item) => item.status !== "closed" && item.severity !== "info").length;
  assets.harnessGates.push({
    id: nextAssetId("LLM-GATE", (assets.harnessGates || []).length + 1),
    status: openWarnings ? "warning" : "passed",
    finding: openWarnings ? `Critic Agent 仍有 ${openWarnings} 个质量或追溯提示。` : "Critic Agent 反思检查已闭环。",
    evidence: findings.map((item) => `${item.id}:${item.type}:${item.status}`).join("; "),
  });
  if (compensatedAssets > 0) {
    assets.harnessGates.push({
      id: nextAssetId("LLM-GATE", (assets.harnessGates || []).length + 1),
      status: "warning",
      finding: `存在 ${compensatedAssets} 个确定性补偿测试资产。`,
      evidence: "deterministic_compensation_requires_human_review",
    });
  }
}

function nextAssetId(prefix, seq) {
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

function normalizePriority(priority) {
  return ["P0", "P1", "P2"].includes(priority) ? priority : "P2";
}

function normalizeStringArray(value, fallback) {
  return Array.isArray(value) && value.length ? value.map((item) => String(item)) : fallback;
}

function pushUniqueObjects(target, items, keyFn, seenSet = new Set()) {
  for (const original of items) {
    const item = { ...original };
    const key = keyFn(item);
    if (seenSet.has(key)) continue;
    seenSet.add(key);
    target.push(item);
  }
}

function stableKey(parts) {
  return parts.map((item) => String(item || "").replace(/\s+/g, "")).join("|").slice(0, 500);
}

function buildServerRequirementFingerprint(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, "")
    .replace(/icon/g, "图标")
    .replace(/页面/g, "页")
    .replace(/新增/g, "增加")
    .replace(/[\s:：,，.。;；、_\-—/\\()[\]{}<>《》【】]+/g, "")
    .trim();
}

function areServerFingerprintsSimilar(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length) >= 0.72;
  }
  const leftChars = new Set(Array.from(left));
  const rightChars = new Set(Array.from(right));
  const intersection = Array.from(leftChars).filter((char) => rightChars.has(char)).length;
  const union = new Set([...leftChars, ...rightChars]).size || 1;
  if (intersection / union >= 0.92) return true;
  const leftBigrams = buildServerBigrams(left);
  const rightBigrams = buildServerBigrams(right);
  const bigramIntersection = Array.from(leftBigrams).filter((token) => rightBigrams.has(token)).length;
  const bigramUnion = new Set([...leftBigrams, ...rightBigrams]).size || 1;
  return bigramIntersection / bigramUnion >= 0.82;
}

function buildServerBigrams(text) {
  const chars = Array.from(text);
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`));
}

function parseLlmJson(outputText) {
  const text = String(outputText || "").trim();
  const candidates = [
    text,
    text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(),
    extractJsonObject(text),
    repairPossiblyTruncatedJson(extractJsonObject(text) || text),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = candidate
      .replace(/^\uFEFF/, "")
      .replace(/,\s*([}\]])/g, "$1")
      .trim();
    try {
      return JSON.parse(normalized);
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(`LLM returned non-JSON output: ${text.slice(0, 500) || "<empty>"}`);
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "";
  return text.slice(start, end + 1);
}

function repairPossiblyTruncatedJson(text) {
  const source = String(text || "").trim();
  if (!source.startsWith("{")) return "";
  let repaired = source
    .replace(/,\s*$/, "")
    .replace(/,\s*([}\]])/g, "$1");
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const char of repaired) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{" || char === "[") stack.push(char);
    if (char === "}" || char === "]") stack.pop();
  }
  if (inString) repaired += '"';
  while (stack.length) {
    repaired += stack.pop() === "{" ? "}" : "]";
  }
  return repaired;
}

function resolveLlmConfig() {
  const provider = process.env.LLM_PROVIDER || process.env.MODEL_PROVIDER || "openai";
  if (provider === "volcengine-coding-plan") {
    return {
      provider,
      wireApi: "responses",
      envKey: "ARK_API_KEY",
      apiKey: process.env.ARK_API_KEY || "",
      model: process.env.ARK_MODEL || process.env.OPENAI_MODEL || "glm-5.2",
      baseUrl:
        process.env.ARK_BASE_URL ||
        process.env.OPENAI_BASE_URL ||
        "https://ark.cn-beijing.volces.com/api/coding/v3",
    };
  }
  return {
    provider,
    wireApi: "responses",
    envKey: "OPENAI_API_KEY",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  };
}

function buildAgentPrompt(artifacts, retrievedKnowledge, stage) {
  const requirementUnits = artifacts.review?.requirementUnits || [];
  const isChunkedFullGeneration = stage === "full_generation" && artifacts.generationChunk;
  const unitLimit = stage === "full_generation" ? 220 : 80;
  const assetLimit = isChunkedFullGeneration
    ? Math.min(Math.max(requirementUnits.length, 6), 14)
    : stage === "full_generation"
      ? Math.min(Math.max(Math.ceil((requirementUnits.length || 8) / 3), 8), 24)
      : 8;
  const compact = {
    intake: {
      texts: artifacts.intake?.texts?.slice(0, 30) || [],
      files: artifacts.intake?.files || [],
      documentStats: artifacts.intake?.documentStats || {},
      humanClarifications: artifacts.intake?.humanClarifications || [],
    },
    requirementUnits: requirementUnits.slice(0, unitLimit),
    requirementUnitCount: requirementUnits.length,
    clarificationItems: artifacts.review?.clarificationItems || [],
    technical: artifacts.technical || {},
    testPoints: artifacts.testPoints?.points?.slice(0, 60) || [],
    cases: artifacts.cases?.slice(0, 60) || [],
    releaseReadiness: artifacts.releaseReadiness || {},
    generationChunk: artifacts.generationChunk || null,
    analysisChunk: artifacts.analysisChunk || null,
    repairContext: artifacts.repairContext || null,
  };
  const requirementAnalysisShape = {
    sourceSummary: "string",
    requirementUnits: [
      {
        id: "string",
        sourceRef: "string",
        title: "string",
        requirement: "string",
        type: "function|state|data|integration|notification|ui|rule|nonfunctional",
        priority: "P0|P1|P2",
        rationale: "string",
      },
    ],
    businessCapabilities: [{ sourceRef: "string", capability: "string", rationale: "string" }],
    ambiguities: [{ sourceRef: "string", issue: "string", suggestedClarification: "string" }],
    riskSignals: [{ sourceRef: "string", priority: "P0|P1|P2", signal: "string", reason: "string" }],
  };
  const requiredJsonShape =
    stage === "requirement_analysis"
      ? {
          requirementAnalysis: requirementAnalysisShape,
          agentGeneratedAssets: {
            productClarifications: [{ id: "string", sourceRef: "string", question: "string", acceptanceImpact: "string" }],
            developmentImpacts: [],
            testPoints: [],
            testCases: [],
            harnessGates: [],
          },
          agentFindings: [{ agent: "product-agent", finding: "string" }],
          agentWorkflow: [
            {
              agent: "product-agent",
              stage: "requirement_analysis",
              role: "string",
              input: ["string"],
              output: ["string"],
              findings: ["string"],
              handoffTo: "human-reviewer|development-agent",
              status: "done|needs_review|blocked",
              summary: "string",
            },
          ],
          suggestedClarifications: [{ sourceRef: "string", question: "string", reason: "string" }],
          additionalTestIdeas: [],
          reviewFindings: [],
        }
      : {
          agentGeneratedAssets: {
            productClarifications: [{ id: "string", sourceRef: "string", question: "string", acceptanceImpact: "string" }],
            developmentImpacts: [{ id: "string", sourceRef: "string", domain: "string", impact: "string", testability: "automatable|manual|needs_probe" }],
            testPoints: [{ id: "string", sourceRef: "string", priority: "P0|P1|P2", title: "string", risk: "string" }],
            testCases: [
              {
                id: "string",
                sourceRefs: ["string"],
                priority: "P0|P1|P2",
                title: "string",
                preconditions: ["string"],
                steps: ["string"],
                expectedResults: ["string"],
              },
            ],
            harnessGates: [{ id: "string", status: "passed|warning|blocked", finding: "string", evidence: "string" }],
          },
          agentFindings: [{ agent: "product-agent|development-agent|testing-agent|review-agent", finding: "string" }],
          agentWorkflow: [
            {
              agent: "product-agent|development-agent|testing-agent|review-agent|critic-agent",
              stage: "full_generation",
              role: "string",
              input: ["string"],
              output: ["string"],
              findings: ["string"],
              handoffTo: "string",
              status: "done|needs_review|blocked",
              summary: "string",
            },
          ],
          suggestedClarifications: [{ sourceRef: "string", question: "string", reason: "string" }],
          additionalTestIdeas: [{ sourceRef: "string", priority: "P0|P1|P2", title: "string", reason: "string" }],
          reviewFindings: [{ gate: "string", status: "passed|warning|blocked", finding: "string" }],
        };
  const fullGenerationTask = [
    "Generate downstream test-development assets only.",
    "Do not perform requirement analysis again.",
    "Do not return requirementAnalysis.",
    "Treat artifacts.requirementUnits as the authoritative first-stage requirement split.",
    artifacts.generationChunk
      ? "This request is one generation chunk; only generate assets for artifacts.generationChunk.unitIds and do not infer assets for units outside this chunk."
      : "Generate assets for the provided requirement units.",
    artifacts.repairContext
      ? "This is a Critic repair pass. Generate only the missing test points and test cases needed to close artifacts.repairContext.uncoveredRequirementUnitIds."
      : "This is an initial generation pass.",
    "For every P0/P1 requirement unit in this chunk, include at least one testPoint or testCase sourceRef that directly references the requirement id. For P2 units, cover them individually or group them only when the behavior is truly the same.",
    "Every developmentImpact, testPoint, testCase, clarification, idea, and gate must reference existing requirement unit ids from artifacts.requirementUnits whenever possible.",
    "Test cases must derive from those requirement unit ids, not from a new summarized or compressed analysis.",
    "Populate agentWorkflow with one concise item for product-agent, development-agent, testing-agent, review-agent, and critic-agent, showing each agent's input, output, findings, status, and handoff.",
    `Keep output compact but broad enough for coverage: max 4 productClarifications, max ${assetLimit} developmentImpacts, max ${assetLimit} testPoints, max ${assetLimit} testCases, max 5 harnessGates.`,
    "Each test case may use 1 precondition, 2-3 steps, and 1-2 expectedResults. Keep every string short.",
    "Return minified valid JSON only; use short strings and avoid verbose explanations.",
  ].join(" ");
  const requirementAnalysisTask = artifacts.analysisChunk
    ? [
        "Focus on Product Agent requirement analysis only for this analysis chunk.",
        "Use artifacts.requirementUnits and artifacts.analysisChunk.unitIds as candidate requirement rows.",
        "Return one compact requirementUnits item for each candidate row unless two rows are truly duplicates.",
        "Split only genuinely compound rows and preserve atomic feature rows.",
        "Do not analyze units outside this chunk. Do not generate final test cases in this stage.",
        "Keep sourceSummary under 60 Chinese chars, title under 18 Chinese chars, rationale under 24 Chinese chars.",
        "Return at most 4 ambiguities, at most 6 riskSignals, and at most 4 suggestedClarifications for this chunk.",
        "Populate agentWorkflow with one concise product-agent participation record.",
        "Return minified valid JSON only.",
      ].join(" ")
    : [
        "Focus on Product Agent requirement analysis only.",
        "Use raw intake and RAG knowledge to split the PRD into atomic, testable requirement units.",
        "Do not summarize, merge, or convert detailed requirements into broad capabilities.",
        "Preserve feature-list rows as separate requirement units when they describe different functions, pages, states, integrations, prompts, controls, notifications, or data rules.",
        "List pending clarifications before downstream test generation. Do not generate final test cases in this stage.",
        "Keep sourceSummary under 80 Chinese chars, title under 18 Chinese chars, rationale under 24 Chinese chars.",
        "Return compact valid JSON only and populate agentWorkflow with the product-agent participation record.",
      ].join(" ");
  return JSON.stringify(
    {
      task:
        stage === "requirement_analysis"
          ? requirementAnalysisTask
          : fullGenerationTask,
      stage,
      requiredJsonShape,
      retrievedKnowledge,
      artifacts: compact,
      outputLimits: {
        requirementUnits: stage === "requirement_analysis" ? Math.min(Math.max(requirementUnits.length, 1), unitLimit) : 80,
        productClarifications: 4,
        developmentImpacts: stage === "full_generation" ? assetLimit : 6,
        testPoints: stage === "full_generation" ? assetLimit : 8,
        testCases: stage === "full_generation" ? assetLimit : 8,
        harnessGates: 5,
      },
    },
    null,
    2,
  );
}

function buildFallbackAgentResult(artifacts, retrievedKnowledge) {
  const pending = artifacts.cases?.filter((item) => item.reviewStatus === "pending_human_review").length || 0;
  return {
    artifactId: "LLM-RAG-AGENT-ENHANCEMENT-001",
    retrievedKnowledge,
    requirementAnalysis: buildFallbackRequirementAnalysis(artifacts, retrievedKnowledge),
    agentGeneratedAssets: buildFallbackAgentGeneratedAssets(artifacts, retrievedKnowledge),
    agentFindings: [
      {
        agent: "product-agent",
        finding: `已解析 ${artifacts.review?.requirementUnits?.length || 0} 个需求单元；建议对含糊表达继续补充可测阈值。`,
      },
      {
        agent: "development-agent",
        finding: `已识别 ${artifacts.technical?.domains?.length || 0} 个业务/技术域；建议补齐接口、状态机和数据一致性证据。`,
      },
      {
        agent: "testing-agent",
        finding: `已生成 ${artifacts.testPoints?.points?.length || 0} 个测试点和 ${artifacts.cases?.length || 0} 条用例。`,
      },
      {
        agent: "review-agent",
        finding: pending ? `${pending} 条 P0/P1 用例仍需人工评审。` : "P0/P1 人工评审已完成。",
      },
    ],
    suggestedClarifications: (artifacts.review?.clarificationItems || [])
      .filter((item) => item.status !== "resolved_by_human")
      .map((item) => ({
        sourceRef: item.sourceRef,
        question: item.question,
        reason: "规则链路识别到未闭环澄清项。",
      })),
    additionalTestIdeas: buildFallbackTestIdeas(artifacts),
    reviewFindings: [
      {
        gate: "release_readiness",
        status: artifacts.releaseReadiness?.status === "ready" ? "passed" : "blocked",
        finding: `当前准出状态：${artifacts.releaseReadiness?.status || "unknown"}`,
      },
    ],
  };
}

function buildFallbackRequirementAnalysis(artifacts, retrievedKnowledge) {
  const requirementUnits = artifacts.review?.requirementUnits || [];
  const rawTexts = artifacts.intake?.texts || [];
  const sourceSummary = rawTexts.length
    ? `已读取 ${rawTexts.length} 个需求输入源，规则链路拆解出 ${requirementUnits.length} 个需求单元。`
    : `规则链路拆解出 ${requirementUnits.length} 个需求单元。`;
  const riskKeywords = [
    { token: "登录", priority: "P0", reason: "登录链路影响用户身份与准入。" },
    { token: "支付", priority: "P0", reason: "支付链路影响资金与订单闭环。" },
    { token: "计费", priority: "P0", reason: "计费链路影响结算准确性。" },
    { token: "车辆控制", priority: "P0", reason: "车辆控制影响车云协同安全边界。" },
    { token: "Push", priority: "P0", reason: "通知失败会影响行程状态感知。" },
    { token: "短信", priority: "P0", reason: "短信失败会影响关键通知触达。" },
    { token: "站点", priority: "P1", reason: "站点推荐影响上下车点选择和调度体验。" },
    { token: "途经点", priority: "P1", reason: "途经点影响路线和订单状态流转。" },
  ];

  return {
    sourceSummary,
    requirementUnits: requirementUnits.map((item, index) => ({
      id: `REQ-UNIT-${String(index + 1).padStart(3, "0")}`,
      sourceRef: item.id,
      title: item.content.slice(0, 36),
      requirement: item.content,
      type: inferRequirementUnitType(item.content),
      priority: classifyServerPriority(item.content),
      rationale: "由需求正文拆分得到，可作为测试点和验收标准的追溯锚点。",
    })),
    businessCapabilities: requirementUnits.slice(0, 12).map((item) => ({
      sourceRef: item.id,
      capability: item.content,
      rationale: "由需求正文拆分得到，可作为测试点和验收标准的追溯锚点。",
    })),
    ambiguities: (artifacts.review?.clarificationItems || []).map((item) => ({
      sourceRef: item.sourceRef,
      issue: item.question,
      suggestedClarification: "补充可测试阈值、触发条件、失败提示或验收口径。",
    })),
    riskSignals: requirementUnits.flatMap((item) =>
      riskKeywords
        .filter((risk) => item.content.includes(risk.token))
        .map((risk) => ({
          sourceRef: item.id,
          priority: risk.priority,
          signal: risk.token,
          reason: risk.reason,
        })),
    ),
    knowledgeRefs: retrievedKnowledge.map((item) => item.path),
  };
}

function inferRequirementUnitType(text) {
  if (hasServerAny(text, ["Push", "短信", "消息", "通知"])) return "notification";
  if (hasServerAny(text, ["接口", "接入", "云", "服务商"])) return "integration";
  if (hasServerAny(text, ["状态", "同步", "流转"])) return "state";
  if (hasServerAny(text, ["页面", "弹窗", "展示", "列表", "入口"])) return "ui";
  if (hasServerAny(text, ["规则", "阈值", "条件", "排序", "推荐"])) return "rule";
  if (hasServerAny(text, ["数据", "记录", "埋点"])) return "data";
  return "function";
}

function classifyServerPriority(text) {
  if (hasServerAny(text, ["安全", "登录", "支付", "计费", "结算", "订单", "车辆控制", "座椅控制", "空调", "短信", "Push", "消息模板"])) {
    return "P0";
  }
  if (hasServerAny(text, ["调度", "派单", "匹配", "状态", "实时", "站点", "行程", "途经点", "推荐", "分享", "反馈", "弹窗"])) {
    return "P1";
  }
  return "P2";
}

function hasServerAny(text, keywords) {
  return keywords.some((keyword) => String(text).includes(keyword));
}

function buildFallbackAgentGeneratedAssets(artifacts, retrievedKnowledge) {
  const analysis = buildFallbackRequirementAnalysis(artifacts, retrievedKnowledge);
  const productClarifications = analysis.ambiguities.map((item, index) => ({
    id: `AGENT-CLARIFY-${String(index + 1).padStart(3, "0")}`,
    sourceRef: item.sourceRef,
    question: item.issue,
    acceptanceImpact: item.suggestedClarification,
  }));
  const developmentImpacts = analysis.riskSignals.map((item, index) => ({
    id: `AGENT-TECH-${String(index + 1).padStart(3, "0")}`,
    sourceRef: item.sourceRef,
    domain: inferDomainFromRiskSignal(item.signal),
    impact: `需要验证 ${item.signal} 对应链路的状态流转、异常处理和数据一致性。`,
    testability: "automatable",
  }));
  const testPoints = analysis.riskSignals.map((item, index) => ({
    id: `AGENT-TP-${String(index + 1).padStart(3, "0")}`,
    sourceRef: item.sourceRef,
    priority: item.priority,
    title: `${item.signal} 核心链路验证`,
    risk: item.reason,
  }));
  const ideaPoints = buildFallbackTestIdeas(artifacts).map((item, index) => ({
    id: `AGENT-RAG-TP-${String(index + 1).padStart(3, "0")}`,
    sourceRef: item.sourceRef,
    priority: item.priority,
    title: item.title,
    risk: item.reason,
  }));
  const allPoints = [...testPoints, ...ideaPoints].slice(0, 12);
  const testCases = allPoints.map((point, index) => ({
    id: `AGENT-CASE-${String(index + 1).padStart(3, "0")}`,
    sourceRefs: [point.id, point.sourceRef],
    priority: point.priority,
    title: point.title,
    preconditions: ["存在可用的乘客端测试账号、测试订单数据和可控仿真/测试环境。"],
    steps: [
      `准备覆盖 ${point.title} 的需求输入、测试数据和状态前置条件。`,
      "触发乘客端对应功能链路，并采集客户端、服务端和消息/状态流转证据。",
      "注入成功、失败和边界条件，观察用户可见反馈和后台数据一致性。",
    ],
    expectedResults: [
      "核心业务状态符合需求和业务规则。",
      "失败或异常路径有明确提示、日志和可追溯证据。",
      "测试结果可被 Harness 报告、追溯矩阵和质量门禁消费。",
    ],
  }));
  const harnessGates = [
    {
      id: "AGENT-GATE-RAG",
      status: retrievedKnowledge.length ? "passed" : "warning",
      finding: `RAG 命中文档 ${retrievedKnowledge.length} 个。`,
      evidence: retrievedKnowledge.map((item) => item.path).join(", ") || "no_knowledge_hit",
    },
    {
      id: "AGENT-GATE-TRACEABILITY",
      status: testCases.every((item) => item.sourceRefs.length >= 2) ? "passed" : "blocked",
      finding: `Agent 候选用例 ${testCases.length} 条，均需保留需求/测试点来源。`,
      evidence: testCases.map((item) => `${item.id}:${item.sourceRefs.join("|")}`).join("; "),
    },
    {
      id: "AGENT-GATE-HUMAN-REVIEW",
      status: testCases.some((item) => item.priority === "P0" || item.priority === "P1") ? "warning" : "passed",
      finding: "P0/P1 Agent 候选用例进入主资产前必须人工评审。",
      evidence: `high_risk_agent_cases=${testCases.filter((item) => item.priority === "P0" || item.priority === "P1").length}`,
    },
  ];

  return {
    productClarifications,
    developmentImpacts,
    testPoints: allPoints,
    testCases,
    harnessGates,
  };
}

function inferDomainFromRiskSignal(signal) {
  if (["支付", "计费"].includes(signal)) return "billing_settlement";
  if (["车辆控制", "Push", "短信"].includes(signal)) return "vehicle_cloud";
  if (["站点", "途经点"].includes(signal)) return "mobile_passenger";
  if (signal === "登录") return "identity";
  return "mobile_passenger";
}

function buildFallbackTestIdeas(artifacts) {
  const text = JSON.stringify(artifacts.review?.requirementUnits || []);
  const ideas = [];
  if (text.includes("站点")) {
    ideas.push({ sourceRef: "RAG-STATION", priority: "P1", title: "站点推荐排序与选择后目的地一致性", reason: "RAG 命中站点推荐核心规则。" });
  }
  if (text.includes("Push") || text.includes("短信")) {
    ideas.push({ sourceRef: "RAG-NOTIFY", priority: "P0", title: "通知发送失败降级与用户可见提示", reason: "RAG 命中 Push/短信高风险链路。" });
  }
  return ideas;
}

async function retrieveKnowledge(artifacts) {
  const docs = await loadKnowledgeDocs(knowledgeRoot);
  const query = [
    JSON.stringify(artifacts.intake?.texts || []),
    JSON.stringify(artifacts.intake?.humanClarifications || []),
    JSON.stringify(artifacts.review?.requirementUnits || []),
    JSON.stringify(artifacts.testPoints?.points || []),
  ].join("\n");
  const queryTokens = tokenize(query);
  return docs
    .map((doc) => ({
      path: relative(repoRoot, doc.path),
      title: doc.title,
      score: scoreDoc(queryTokens, doc),
      excerpt: doc.content.slice(0, 900),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

async function loadKnowledgeDocs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const docs = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      docs.push(...(await loadKnowledgeDocs(path)));
      continue;
    }
    if (!/\.(md|yaml|yml|json)$/i.test(entry.name)) continue;
    const content = await readFile(path, "utf8");
    docs.push({
      path,
      title: content.match(/^#\s+(.+)$/m)?.[1] || entry.name,
      content,
      tokens: tokenize(content),
    });
  }
  return docs;
}

function scoreDoc(queryTokens, doc) {
  let score = 0;
  queryTokens.forEach((token) => {
    if (doc.tokens.has(token)) score += token.length > 1 ? 2 : 1;
  });
  return score;
}

function tokenize(text) {
  const tokens = new Set(String(text).toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fa5]{2,}/g) || []);
  ["订单", "登录", "站点", "推荐", "车辆", "控制", "短信", "push", "消息", "途经点", "分享", "反馈", "弹窗"].forEach((token) => {
    if (String(text).toLowerCase().includes(token.toLowerCase())) tokens.add(token.toLowerCase());
  });
  return tokens;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requested = normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  const filePath = resolve(rootDir, `.${requested}`);
  if (!filePath.startsWith(rootDir)) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  const type = mimeTypes.get(extname(filePath)) || "application/octet-stream";
  response.writeHead(200, { "content-type": type });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).on("error", () => response.destroy()).pipe(response);
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

function extractOutputText(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || "")
    .join("");
}
