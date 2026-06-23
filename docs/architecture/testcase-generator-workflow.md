# 测试用例自动生成工具工作流

## 结论

当前工具采用“两阶段 LLM/RAG + Harness 规则兜底”的测试开发工作流：

```text
一阶段：需求导入 -> 需求单元拆分 -> 待澄清项 -> 人工澄清/跳过
二阶段：技术影响 -> 测试点 -> 测试用例 -> Critic 反思 -> 修复/补偿 -> 门禁/追溯/导出
```

它的核心不是直接执行测试，而是把需求文档转成可评审、可追溯、可门禁的测试开发资产。

## 总体架构

```mermaid
flowchart TB
  User["用户 / 测试专家"]

  subgraph Browser["浏览器端：testcase-generator-web"]
    UI["工作台 UI"]
    Intake["需求导入\n文本 / PDF / 文本文件 / 图片人工转写"]
    ReviewUI["需求评审 / 需求单元 / 澄清项"]
    AssetUI["技术影响 / 测试点 / 策略 / 用例"]
    GateUI["准出门禁 / 追溯矩阵 / 资产 JSON"]
    Export["JSON / 测试资产导出"]
  end

  subgraph Frontend["前端编排：app.js"]
    LocalDraft["本地规则草案\nproductIntake / productReview"]
    MergeAnalysis["合并一阶段需求分析\n去重 / 澄清项归并"]
    MergeAssets["合并二阶段资产\n技术影响 / 测试点 / 用例"]
    LocalReview["本地评审与门禁\ncoverage / gates / traceability"]
  end

  subgraph Server["Node 服务：server.mjs"]
    Static["静态资源服务"]
    AnalyzeAPI["POST /api/requirement-analyze"]
    GenerateAPI["POST /api/agent-generate"]
    RAG["本地知识库检索"]
    RuleFallback["确定性规则兜底"]
    Chunker["需求分片 / 并发调用 / 合并去重"]
    Critic["Critic 反思\ncoverage gap / traceability gap / quality gap"]
    Repair["repair generation\n+ deterministic compensation"]
  end

  subgraph Model["可选模型提供方"]
    OpenAI["OpenAI Responses API"]
    Ark["火山 Ark / Coding Plan\nResponses-compatible"]
  end

  User --> UI
  UI --> Intake
  Intake --> LocalDraft
  LocalDraft --> AnalyzeAPI
  AnalyzeAPI --> RAG
  AnalyzeAPI --> Chunker
  Chunker --> OpenAI
  Chunker --> Ark
  AnalyzeAPI --> RuleFallback
  AnalyzeAPI --> MergeAnalysis
  MergeAnalysis --> ReviewUI

  ReviewUI --> GenerateAPI
  GenerateAPI --> RAG
  GenerateAPI --> Chunker
  Chunker --> Critic
  Critic --> Repair
  Repair --> RuleFallback
  GenerateAPI --> MergeAssets
  MergeAssets --> LocalReview
  LocalReview --> AssetUI
  LocalReview --> GateUI
  GateUI --> Export
```

## 端到端流程

```mermaid
flowchart TD
  A["1. 导入需求\n文本、PDF、文本文件、图片人工转写"] --> B["2. 前端构建本地需求草案\n拆句、功能清单拆解、风险关键词识别"]
  B --> C["3. 调用 /api/requirement-analyze"]

  C --> D{"是否配置可用 LLM Key"}
  D -- 否 --> E["RAG + 规则兜底\n生成需求分析结果"]
  D -- 是 --> F["检索本地知识库\n补充业务规则上下文"]
  F --> G["按需求候选分片\n并发调用 LLM"]
  G --> H["合并分片结果\n需求单元去重、能力/风险/澄清项归并"]
  E --> I["4. 回写一阶段结果"]
  H --> I

  I --> J["5. 前端展示\n需求评审、需求单元、澄清项"]
  J --> K{"是否存在待澄清项"}
  K -- 是 --> L["用户逐项澄清\n或批量跳过"]
  L --> M["更新 humanClarifications\n澄清项状态变更"]
  K -- 否 --> N["允许生成后续测试资产"]
  M --> N

  N --> O["6. 调用 /api/agent-generate\n传入一阶段需求单元作为权威输入"]
  O --> P["按需求单元分片\nLLM/RAG 生成二阶段资产"]
  P --> Q["合并资产\nProduct 澄清、Dev 技术影响、Test 测试点/用例、Gate"]
  Q --> R["7. Critic 反思\n检查覆盖、追溯、质量、澄清缺口"]
  R --> S{"需求闭环覆盖率是否 100%"}
  S -- 否 --> T["只针对未覆盖需求单元 repair 一轮"]
  T --> U["仍未闭环时\n确定性补偿测试点/用例"]
  S -- 是 --> V["无需补偿"]
  U --> W["8. 生成反思发现和补偿标记"]
  V --> W

  W --> X["9. 前端转换主资产\n技术影响、测试点、测试策略、测试用例"]
  X --> Y["10. 本地评审\n需求覆盖率、测试点覆盖率、采纳率预测"]
  Y --> Z["11. Harness Gates\nSchema、追溯、Validator、Evidence、Review"]
  Z --> AA["12. 输出\n协作看板、准出门禁、追溯矩阵、JSON、测试资产"]
```

## Agent 分工

```mermaid
flowchart LR
  Product["Product Agent\n需求单元、业务目标、验收标准、澄清项"]
  Human["Human Reviewer\n逐项澄清 / 批量跳过 / P0-P1 评审"]
  Dev["Development Agent\n技术影响、系统边界、数据依赖、可测性"]
  Test["Testing Agent\n测试点、测试策略、测试用例"]
  Review["Review Agent / Harness Gate\nSchema、追溯、Evidence、Review Gate"]
  Critic["Critic Agent\n反思评审、覆盖缺口、repair 触发、补偿标记"]

  Product --> Human
  Human --> Dev
  Dev --> Test
  Test --> Review
  Review --> Critic
  Critic -- "coverage gap" --> Test
  Critic -- "clarification gap" --> Human
```

## 两阶段接口边界

| 阶段 | 入口 | 输入 | 输出 | 关键约束 |
|---|---|---|---|---|
| 需求分析 | `POST /api/requirement-analyze` | 原始 intake、本地规则草案、RAG 知识 | `requirementAnalysis`、`analysisSummary`、Product 侧澄清项 | 只做需求解析，不生成最终测试用例 |
| 资产生成 | `POST /api/agent-generate` | 一阶段 `review.requirementUnits`、人工澄清、RAG 知识 | `agentGeneratedAssets`、`generationSummary`、`agentReflectionFindings` | 不重新返回 `requirementAnalysis`，一阶段需求单元是权威输入 |

## 数据对象流转

```mermaid
flowchart TD
  Intake["intake\ntexts / files / multimodalTranscripts / humanClarifications"]
  Review["review\nbusinessGoals / requirementUnits / clarificationItems / acceptanceCriteria"]
  Technical["technical\ndomains / impacts"]
  Points["testPoints\npoints"]
  Strategy["strategy\nscope / approaches / risks"]
  Cases["cases\nsteps / expectedResult / reviewStatus"]
  ReviewResult["reviewResult\nrequirementCoverageRate / testPointCoverageRate / adoptionRate"]
  Gates["gateResults\nschema / traceability / validator / evidence / review"]
  Trace["traceability\ncase -> testPoint -> requirement -> clarification"]
  Assets["testAssets\ncontracts/test-assets style export"]

  Intake --> Review
  Review --> Technical
  Technical --> Points
  Review --> Points
  Points --> Strategy
  Strategy --> Cases
  Cases --> ReviewResult
  Cases --> Gates
  Review --> Trace
  Points --> Trace
  Cases --> Trace
  Gates --> Assets
  Trace --> Assets
```

## 质量闭环

```mermaid
flowchart TD
  A["LLM/RAG 生成资产"] --> B["合并去重\n补齐 requirementId -> testPointId -> caseId 链路"]
  B --> C["计算需求闭环覆盖率"]
  C --> D{"覆盖率 < 100%"}
  D -- 是 --> E["Critic 标记 coverage_gap"]
  E --> F["repair generation\n只修复未覆盖需求"]
  F --> G["再次计算覆盖率"]
  G --> H{"仍未 100%"}
  H -- 是 --> I["确定性补偿\n最小测试点 + 最小用例"]
  H -- 否 --> J["关闭覆盖缺口"]
  D -- 否 --> J
  I --> K["reviewFindings 标记 warning\n需要人工复核"]
  J --> L["Harness Gates\n准出判断"]
  K --> L
```

## 当前工作流特点

- 需求分析和资产生成被明确拆成两阶段，避免“生成后续资产”时重新覆盖一阶段需求拆分结果。
- 二阶段以一阶段 `requirementUnits` 为权威输入，服务端 prompt 明确要求不重新做需求分析。
- 待澄清项在一阶段后展示，用户可以逐项提交，也可以批量跳过；后续资产生成会读取人工补充。
- LLM 失败、无 Key 或分片失败时会退回 RAG + 规则链路，保证工具可用。
- Critic 负责发现覆盖、追溯、质量和澄清缺口；覆盖不足时先 repair，再用确定性补偿兜底。
- 前端最终仍会做本地 review、quality gates、traceability 和资产导出，避免直接把 LLM 输出当成可准出资产。

