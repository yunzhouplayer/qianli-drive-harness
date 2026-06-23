# Test Case Generator Web MVP

## 定位

这是测试用例自动生成工具的静态网页 MVP。

当前版本以“真实需求文档解析 + 两阶段 Agent 协作 + 规则兜底 + RAG + 可选 LLM 推理”为主。Product、Development、Testing、Review/Harness Gate、Critic 会产出可审计的中间产物和交接状态；配置 `OPENAI_API_KEY` 后，后端会先调用真实 LLM 做需求单元拆分和待澄清项识别，再在用户补充澄清后调用 LLM 推理技术影响、测试点、测试用例和 Harness Gate。它用于验证需求导入、文档解析、澄清、测试点、测试策略、用例生成、用例评审、反思修复、门禁和追溯查看的端到端体验。

## 运行方式

推荐用本地 Node 服务打开；该服务同时提供静态页面、RAG 检索、需求分析接口和可选 LLM Agent 推理：

```bash
node server.mjs
```

然后访问 `http://127.0.0.1:8766/`。

如果配置了 `OPENAI_API_KEY`，后端会调用 LLM 做需求分析和后续资产生成；否则自动回退为本地 RAG + 规则链路：

```bash
OPENAI_API_KEY=... OPENAI_MODEL=... node server.mjs
```

火山 Coding Plan / Ark Responses-compatible 配置：

```bash
LLM_PROVIDER=volcengine-coding-plan \
ARK_API_KEY=... \
ARK_MODEL=glm-5.2 \
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3 \
node server.mjs
```

本地 smoke test：

```bash
node smoke-test.js
node prd-fixture-smoke.js
node server-smoke.mjs
node server-llm-mock-smoke.mjs
```

`OPENAI_BASE_URL` 可用于本地 mock 或企业代理网关验证，默认值为 `https://api.openai.com/v1`。

真实 LLM 调用链路 smoke：

```bash
OPENAI_API_KEY=... node server-real-llm-smoke.mjs
```

如果需要临时指定模型或代理网关：

```bash
OPENAI_API_KEY=... OPENAI_MODEL=gpt-4.1-mini OPENAI_BASE_URL=https://api.openai.com/v1 node server-real-llm-smoke.mjs
```

火山 Coding Plan 真实链路 smoke：

```bash
LLM_PROVIDER=volcengine-coding-plan \
ARK_API_KEY=... \
ARK_MODEL=glm-5.2 \
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3 \
node server-real-llm-smoke.mjs
```

## 当前能力

- 多文本需求导入。
- 工作流架构图见 [testcase-generator-workflow.md](../../../docs/architecture/testcase-generator-workflow.md)。
- Agent 敏捷协作看板，展示 Product、Development、Testing、Review/Harness Gate、Critic 五类角色的产物、交接对象和状态。
- 两阶段生成流程：先“分析需求”并列出待澄清项；用户补充澄清后，再“生成后续测试资产”。
- LLM/RAG Agent 推理入口：后端基于原始需求 intake 和知识库检索业务规则，可选调用 LLM，输出需求解析发现、Product Agent 澄清项、Dev Agent 技术影响、Test Agent 测试点/用例、Review Agent / Harness Gate 门禁、Critic 反思发现；失败或无 Key 时回退到本地 RAG 同构产物。
- PDF 文档正文解析，产物中记录解析文件数、页数、字符数和解析器。
- 文本类文件正文解析。
- 图片、截图、扫描件支持通过“多模态转写 / 图片说明”人工转写后进入同一需求分析链路。
- PRD 功能清单拆解，尽量保留“功能名 + 描述”的追溯锚点。
- 需求单元视图，展示需求单元向验收标准、测试点和用例的映射。
- 需求分析和澄清问题生成。
- Agent 资产视图，展示后端生成的澄清项、技术影响、测试点、用例和门禁结果。
- 人工澄清/补充说明输入并重新生成，匹配到澄清关键词和量化口径时会将澄清项标记为 resolved。
- 技术影响分析。
- 测试点、测试策略和功能测试用例生成。
- 针对叫车/订单、登录、车辆控制、站点推荐、途经点、Push、短信、分享、反馈、弹窗等常见乘客端功能生成领域化步骤和预期。
- 基于风险关键词自动标记 P0/P1/P2，登录、安全、订单、支付、车辆控制、Push、短信等核心链路会进入 P0。
- P0/P1 用例人工评审提示。
- P0/P1 用例人工通过/退回。
- 人工评审证据记录，保留 reviewer、reviewedAt、note，并写入测试资产 review history。
- 准出门禁视图，集中判断覆盖率、采纳率、P0/P1 人工评审、追溯完整性和资产质量门禁。
- 中间产物可查看。
- 追溯矩阵可查看。
- 中间产物 JSON 面板。
- JSON 导出。
- `contracts/test-assets/case.schema.yaml` 风格测试资产导出。
- 最小 Harness quality gates runner。

## 当前限制

- 默认不调用真实 LLM；未配置当前 provider 对应的 key，例如 `OPENAI_API_KEY` 或 `ARK_API_KEY` 时，只展示本地 RAG + 规则回退结果。
- 配置 `OPENAI_API_KEY` 后，后续阶段会优先采用 LLM/RAG 结构化测试点和用例作为主产物；P0/P1 仍必须人工评审后才能准出。
- 不做后端持久化。
- PDF 解析依赖浏览器文本层；扫描件、图片型 PDF 和图片文件当前需要人工转写，后续可接 OCR。
- 无 Key 或 LLM 调用失败时仍会退回规则化需求拆解，质量低于真实 LLM 推理。
- 不计算真实覆盖率，只基于测试点映射进行 MVP 级估算。
- 暂只生成函数式功能测试用例。
