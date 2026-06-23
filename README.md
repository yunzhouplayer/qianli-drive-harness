# qianli-drive-harness

千里智行 V&V 驱动迭代平台（VIT）的测试开发工程仓库。

本项目用于沉淀软件测试侧的测试开发 Harness、多 Agent 协同配置、测试资产规范，以及与整车验收业务、世界仿真模型之间的标准接口。

如果需要快速理解整个平台全貌，优先阅读：

- [docs/vit-platform-overview.md](docs/vit-platform-overview.md)
- [docs/architecture/testcase-generator-workflow.md](docs/architecture/testcase-generator-workflow.md)

## 核心边界

- `vehicle-acceptance/`：整车测试验收域，负责任务排布、状态查询、结果反馈和真实问题沉淀。
- `vv-automation/`：软件测试 V&V 自动化域，是测试开发 Harness 的核心承载区。
- `world-sim/`：软件测试中台服务，提供虚拟世界环境、实体、规则、事件、故障和故事仿真能力。
- `agents/`：多 Agent 协同配置，服务于软件测试资产生成、评审、执行反馈和持续迭代。
- `skills/`：可复用能力包，沉淀测试设计、测试开发、缺陷分析、仿真故事、数据质量等技能。
- `memory/`：项目长期记忆，沉淀平台共识、架构决策、经验复盘和 Agent 反馈。
- `knowledge/`：业务规则、测试策略、状态机、历史缺陷和数据质量知识库。
- `contracts/`：跨域对象模型、Schema、接口契约和测试资产契约。
- `governance/`：AI 产物、测试数据、仿真数据、安全合规和发布门禁治理。
- `docs/`：平台架构、目录规范、接口协议和演进规划。

## 设计原则

- 验收业务服务整车测试，不替代软件自动化测试执行。
- V&V 自动化服务软件测试，Harness 主阵地在这里。
- 世界仿真模型是软件测试中台，通过标准 API 被 Harness 调用。
- Agent 产物必须经过 Harness 的 Schema、模板、规则和质量门禁约束。
- 当前 V&V 测试开发 Agent 体系采用 Product、Development、Testing、Review、Critic 五类通用角色。
- Review Agent 负责资产准入和 Harness Gate，Critic Agent 负责反思评审、覆盖缺口、重复项和 repair 范围。
- 整车测试反馈应转化为软件测试回归场景、仿真故事、风险规则和测试建议。
- `agents/` 管协作，`skills/` 管能力，`memory/` 管长期经验，`knowledge/` 管业务事实。
- 跨域协作优先通过 `contracts/` 定义稳定对象和接口，避免验收、自动化、仿真各自定义一套数据。
- Harness 必须沉淀执行证据、结构化日志、指标和链路追踪，支撑问题复现和质量度量。

## 当前重点工具

测试用例自动生成工具位于：

```text
vv-automation/test-preparation/testcase-generator-web/
```

它验证了从需求导入、需求单元拆分、人工澄清、测试点/用例生成、Review Gate、Critic 反思、追溯矩阵到测试资产导出的最小闭环。

当前工具沉淀出的通用 Agent 配置位于：

```text
agents/roles/
agents/workflows/agile-testcase-generation.md
agents/prompts/agile-testcase-generation.md
agents/skill-bindings/agile-testcase-generation.yaml
```
