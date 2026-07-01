# 项目目录结构设计

## 结论

本项目采用“平台控制面清晰、Harness 执行内核内聚、Agent 外挂协同”的目录结构。

外层仓库是 VIT 平台工作区，不是单一 Harness 目录。`vv-automation/harness/` 是软件测试侧的 Harness 执行内核；外层 `contracts/`、`governance/`、`knowledge/`、`agents/`、`skills/` 是平台控制面和协作层。

推荐将目录分为 10 个一级域：

| 一级目录 | 定位 |
|---|---|
| `vehicle-acceptance/` | 整车测试验收业务域 |
| `vv-automation/` | 软件测试 V&V 自动化域，包含测试准备、执行、反馈、CI/CT 和 Harness 执行内核 |
| `world-sim/` | 世界仿真模型，中台服务域 |
| `agents/` | 多 Agent 协同配置域 |
| `skills/` | 可复用 Agent 能力包 |
| `memory/` | 项目长期记忆与经验沉淀 |
| `knowledge/` | 业务、测试、数据质量知识库 |
| `contracts/` | 跨域对象模型、Schema 和接口契约 |
| `governance/` | 安全、合规、AI 产物和数据治理 |
| `docs/` | 架构、规范、接口与演进文档 |

## 推荐结构

```text
qianli-drive-harness/
├── AGENTS.md
├── README.md
├── docs/
│   ├── project-structure.md
│   ├── architecture/
│   ├── interfaces/
│   ├── standards/
│   └── roadmap/
│
├── vehicle-acceptance/
│   ├── README.md
│   ├── task-planning/
│   ├── task-status/
│   ├── result-feedback/
│   ├── issue-intake/
│   └── adapters/
│
├── vv-automation/
│   ├── README.md
│   ├── harness/
│   │   ├── devkit/
│   │   ├── assets/
│   │   ├── adapters/
│   │   ├── fixtures/
│   │   ├── runtime/
│   │   ├── validators/
│   │   ├── reports/
│   │   ├── observability/
│   │   ├── evidence/
│   │   └── quality-gates/
│   ├── test-preparation/
│   ├── test-execution/
│   ├── test-feedback/
│   └── ci-ct/
│
├── world-sim/
│   ├── README.md
│   ├── environment/
│   ├── intelligent-entities/
│   ├── environment-entities/
│   ├── state-manager/
│   ├── rule-engine/
│   ├── story-simulation/
│   └── service-api/
│
├── agents/
│   ├── README.md
│   ├── roles/
│   ├── workflows/
│   ├── prompts/
│   ├── policies/
│   ├── evals/
│   └── skill-bindings/
│
├── skills/
│   ├── README.md
│   ├── test-design/
│   ├── test-dev/
│   ├── defect-analysis/
│   ├── simulation-story/
│   ├── data-quality/
│   └── report-generation/
│
├── memory/
│   ├── README.md
│   ├── project/
│   ├── decisions/
│   ├── lessons/
│   └── agent-feedback/
│
├── contracts/
│   ├── README.md
│   ├── acceptance-to-vv/
│   ├── vv-to-world-sim/
│   ├── agent-artifacts/
│   ├── test-assets/
│   └── telemetry/
│
├── governance/
│   ├── README.md
│   ├── ai-output/
│   ├── data-security/
│   ├── simulation-data/
│   └── release-gates/
│
└── knowledge/
    ├── README.md
    ├── business-rules/
    ├── state-machines/
    ├── test-strategies/
    ├── risk-models/
    ├── historical-defects/
    └── data-quality/
```

## 目录职责

### `vehicle-acceptance/`

面向整车测试，管理真实车辆、真实场站、真实路线下的测试任务和结果反馈。

它不负责软件自动化测试代码，也不承载软件测试 Harness。

建议职责：

- `task-planning/`：整车测试计划、路线/站点任务排布。
- `task-status/`：任务状态模型、状态查询接口定义。
- `result-feedback/`：测试结果回传、验收结论、发布准入信息。
- `issue-intake/`：真实问题沉淀，供软件测试转化为回归场景。
- `adapters/`：对接已有整车验收系统或任务系统。

### `vv-automation/`

面向软件测试，是本项目最核心的工程域。

其中 `vv-automation/harness/` 是测试开发 Harness 执行内核，用于规范测试开发、执行、反馈和质量门禁。

`vv-automation/` 不替代外层平台控制面：

- 测试资产 Schema 的唯一事实源在 `contracts/test-assets/`。
- AI 产物治理、数据安全和发布准入规则的唯一事实源在 `governance/`。
- 业务规则、状态机和风险模型的长期知识源在 `knowledge/`。
- Harness 通过 runtime、validator 和 quality gates 消费这些外层约束，而不是在内层重复维护一套规则源。

建议职责：

- `harness/devkit/`：Schema、脚手架、模板、Lint、开发规范。
- `harness/assets/`：Scenario、Case、Fixture、Tool、Workflow 等测试资产。
- `harness/adapters/`：OMS、RAS、移动端、车云、世界仿真模型等适配器。
- `harness/fixtures/`：测试数据准备、环境上下文、数据隔离、清理和复用机制。
- `harness/runtime/`：Runner、Scheduler、Executor、Replay。
- `harness/validators/`：状态机、订单、调度、计费、数据一致性校验器。
- `harness/reports/`：报告、看板、指标、质量趋势。
- `harness/observability/`：结构化日志、指标、链路追踪、执行诊断。
- `harness/evidence/`：测试证据、截图、日志、trace、仿真轨迹、回归证明。
- `harness/quality-gates/`：Schema 检查、安全检查、数据污染检查、Agent 产物准入、Review/Critic 结果准入。
- `test-preparation/`：需求分析、测试策略、用例生成。
- `test-execution/`：接口/UI/场景自动化执行组织。
- `test-feedback/`：缺陷分析、测试建议、结果归因。
- `ci-ct/`：自动冒烟、线上巡检、自动问题回归、持续测试。

## 控制面与执行面的事实源

| 类型 | 唯一事实源 | Harness 中的使用方式 |
|---|---|---|
| 测试资产结构 | `contracts/test-assets/` | `quality-gates/` 和 `runtime/` 校验、执行、报告 |
| 跨域接口 | `contracts/acceptance-to-vv/`、`contracts/vv-to-world-sim/` | `adapters/` 对接整车验收反馈和世界仿真 |
| 发布/安全治理 | `governance/` | `quality-gates/` 执行准入、阻断和 warning |
| 业务规则/状态机 | `knowledge/` | `validators/` 引用或沉淀为确定性校验器 |
| Agent 协作 | `agents/`、`skills/` | 生成候选资产，进入 Harness 评审和执行 |
| 执行证据/报告 | `vv-automation/harness/evidence/`、`vv-automation/harness/reports/` | Harness 运行时产物 |

### `world-sim/`

面向软件测试的测试中台服务，负责提供虚拟世界环境。

它不是普通测试用例目录，而是可被 Harness 调用的仿真服务能力。

建议职责：

- `environment/`：道路拓扑、市政信息、自然环境。
- `intelligent-entities/`：乘客、被调度车辆、被调度人员。
- `environment-entities/`：静态实体、动态实体。
- `state-manager/`：实体状态、状态流转、时间推进。
- `rule-engine/`：交通规则、事件触发、交互规则。
- `story-simulation/`：初始化、故事编辑器、故事生成器。
- `service-api/`：供 V&V 自动化调用的仿真 API、协议和 SDK。
- `scenario-registry/`：可复用仿真故事、场景模板、异常注入模板。
- `simulation-traces/`：仿真状态流、事件流、实体轨迹和回放索引。

### `agents/`

面向多 Agent 协同，不直接替代 Harness。

Agent 负责生成、修改、评审、分析测试资产；Harness 负责约束、执行和验证这些产物。

建议职责：

- `roles/`：Product、Development、Testing、Review、Critic 等通用测试开发 Agent。
- `workflows/`：需求到用例、用例到工具、缺陷到回归、验收反馈到仿真故事等协作流程。
- `prompts/`：Prompt 模板。
- `policies/`：安全合规、数据边界、环境权限、输出约束。
- `evals/`：Agent 产物采纳率、修改后通过率、覆盖率提升等评估集。
- `skill-bindings/`：Agent 与 Skill 的绑定关系，声明不同角色可调用哪些能力。

建议在 `evals/` 下优先建立 `prompt-regression/`，避免 Prompt 变更后只看输出是否“像样”，却没有回归基线。

当前已沉淀的通用角色：

- Product Agent：需求解析、验收标准和澄清项。
- Development Agent：技术影响、系统边界和可测性。
- Testing Agent：测试点、测试策略和测试用例。
- Review Agent：Schema、追溯、Evidence 和准出门禁。
- Critic Agent：反思评审、覆盖缺口、重复项和 repair 范围。

这些角色不绑定单一网页工具，可复用于需求到测试资产、缺陷到回归、整车验收问题到软件回归、仿真故事生成和 CI/CT 准入评审。

### `skills/`

面向可复用能力包，不绑定单一 Agent。

Skill 是“会什么能力”，Agent 是“谁来做”。一个 Skill 可以被多个 Agent 复用。

建议职责：

- `test-design/`：测试分析、风险识别、策略设计、用例设计。
- `test-dev/`：测试工具开发、Harness 资产生成、适配器/校验器开发。
- `defect-analysis/`：缺陷归因、影响面分析、回归建议。
- `simulation-story/`：整车问题到仿真故事、虚拟场景编排。
- `data-quality/`：数据质量检查、脏数据识别、投毒风险分析。
- `report-generation/`：测试报告、质量看板、测试建议生成。

### `memory/`

面向长期项目记忆和经验沉淀。

Memory 记录项目共识、架构决策、经验复盘和 Agent 使用反馈；敏感信息、密钥、生产数据、未脱敏用户数据不应进入该目录。

建议职责：

- `project/`：平台定位、模块边界、长期共识。
- `decisions/`：架构决策记录 ADR。
- `lessons/`：测试开发、仿真、Agent 协作的经验复盘。
- `agent-feedback/`：Agent 产物采纳率、失败模式、Prompt/Skill 改进建议。

### `knowledge/`

沉淀 Agent 和 Harness 都需要消费的知识。

建议职责：

- `business-rules/`：订单、车辆、场站、调度、支付、结算规则。
- `state-machines/`：订单状态机、车辆状态机、任务状态机。
- `test-strategies/`：风险驱动、组合测试、探索性测试、回归策略。
- `risk-models/`：发布风险、脏数据风险、仿真偏差风险。
- `historical-defects/`：历史缺陷、根因、回归建议。
- `data-quality/`：数据采集、脱敏、清洗、投毒检测、血缘追溯。

### `contracts/`

面向跨域对象模型、Schema 和接口契约。

建议职责：

- `acceptance-to-vv/`：整车验收反馈转软件测试资产的对象契约。
- `vv-to-world-sim/`：V&V 自动化调用世界仿真模型的请求/响应契约。
- `agent-artifacts/`：Agent 生成场景、用例、工具、校验器的产物契约。
- `test-assets/`：Scenario、Case、Fixture、Validator、Tool、Report 的资产契约。
- `telemetry/`：日志、指标、trace、证据索引、执行结果的遥测契约。

### `governance/`

面向平台级治理。

建议职责：

- `ai-output/`：AI 生成代码、用例、报告、建议的审核和准入规则。
- `data-security/`：敏感数据、脱敏、权限、密钥、生产数据隔离规则。
- `simulation-data/`：仿真数据真实性、偏差、污染、可追溯性治理。
- `release-gates/`：发布准入、质量门禁、风险升级和人工复核规则。

## 关键接口边界

### 验收业务到 V&V 自动化

```text
整车测试任务/结果/问题
  -> 软件测试风险
  -> 回归用例
  -> 仿真故事
  -> 测试建议
```

建议在后续定义统一对象：

- `AcceptanceResult`
- `VehicleTestIssue`
- `RealWorldScenario`
- `RegressionCandidate`

### V&V 自动化到世界仿真模型

```text
测试场景请求
  -> 虚拟环境初始化
  -> 实体创建
  -> 规则/事件/故障注入
  -> 状态推进
  -> 结果采集
```

建议在后续定义统一对象：

- `SimulationScenario`
- `SimEntity`
- `SimEvent`
- `SimFault`
- `StateSnapshot`
- `SimulationTrace`

### Agent 到 Harness

```text
Agent 生成资产
  -> Schema 校验
  -> 安全策略校验
  -> 单测/示例校验
  -> Harness 执行或入库
```

建议在后续定义统一对象：

- `GeneratedScenario`
- `GeneratedCase`
- `GeneratedFixture`
- `GeneratedValidator`
- `GeneratedTool`
- `AgentEvalResult`

### Agent 到 Skill / Memory

```text
Agent 角色
  -> skill-bindings 声明可调用能力
  -> skills 提供任务方法、模板、检查清单
  -> memory 提供项目长期共识和历史经验
  -> knowledge 提供业务事实和测试规则
```

建议在后续定义统一对象：

- `AgentRole`
- `SkillBinding`
- `SkillSpec`
- `MemoryRecord`
- `DecisionRecord`

## 演进优先级

| 优先级 | 建议先做 |
|---|---|
| P0 | `vv-automation/harness/devkit/` 的 Schema 和模板 |
| P0 | `contracts/test-assets/` 的核心测试资产契约 |
| P0 | `vv-automation/harness/adapters/` 的仿真服务适配器 |
| P0 | `vv-automation/harness/fixtures/` 的数据准备和清理规范 |
| P0 | `vv-automation/harness/validators/` 的确定性校验器 |
| P0 | `vv-automation/harness/observability/` 的日志、指标、trace 基线 |
| P0 | `agents/skill-bindings/` 的 Agent 与 Skill 绑定规范 |
| P0 | `agents/evals/prompt-regression/` 的 Prompt 回归评估 |
| P0 | `memory/project/` 的平台共识沉淀 |
| P1 | `vehicle-acceptance/issue-intake/` 到回归场景的转化规范 |
| P1 | `world-sim/service-api/` 的最小 API 协议 |
| P1 | `world-sim/scenario-registry/` 的仿真故事模板库 |
| P1 | `agents/workflows/` 的需求到用例、问题到回归流程 |
| P1 | `skills/test-design/`、`skills/test-dev/`、`skills/simulation-story/` 的首批技能 |
| P1 | `governance/ai-output/` 和 `governance/data-security/` 的审核规则 |
| P2 | Agent Eval、仿真故事自动生成、大规模 CI/CT 调度 |
