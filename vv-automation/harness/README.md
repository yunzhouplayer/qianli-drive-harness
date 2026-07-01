# V&V 自动化 Harness 执行内核

本目录是 V&V 自动化域内的软件测试执行内核。

它负责规范软件测试工具、测试资产、Agent 产物、执行反馈和质量门禁，并通过适配器调用 mock、真实业务系统和世界仿真模型。

外层 `contracts/`、`governance/`、`knowledge/` 等目录是平台控制面，不归入本目录，避免 Harness 执行内核承担跨域治理职责。

## 与外层平台目录的边界

| 外层目录 | 与 Harness 的关系 |
|---|---|
| `contracts/` | 定义唯一 Schema 和跨域接口；Harness 只消费和校验，不重复定义事实源 |
| `governance/` | 定义发布、安全、AI 产物和数据治理规则；Harness 在 gate/runtime 中执行这些规则 |
| `knowledge/` | 沉淀业务规则、状态机、风险模型；Harness validator 和测试策略可引用 |
| `agents/` / `skills/` | 生成和评审测试资产；Harness 负责准入、执行和证据 |
| `world-sim/` | 提供仿真中台能力；Harness 通过 adapter/API 调用 |

## 与 Agent 的关系

Agent 负责生成、分析、评审和反思；Harness 负责约束、准入、执行和证据沉淀。

当前五类通用测试开发 Agent 的产物进入 Harness 时，应遵循：

```text
Product / Development / Testing Agent 生成候选资产
  -> Review Agent 执行 Schema、追溯、Evidence、Review Gate
  -> Critic Agent 检查覆盖缺口、重复项、质量缺口和澄清缺口
  -> Harness Quality Gates 统一准入
  -> 通过后进入 assets/runtime/ci-ct，未通过则回到 repair 或人工复核
```

Harness 不直接信任 LLM 或 Agent 输出。即使 Critic 通过确定性补偿补齐覆盖，也必须标记 warning 并进入人工复核。

## 子目录

- `devkit/`：Schema、脚手架、模板、Lint、开发规范。
- `templates/`：需求、功能点、策略、用例等阶段模板和准入/准出标准。
- `assets/`：Scenario、Case、Fixture、Tool、Workflow 等测试资产。
- `adapters/`：OMS、RAS、移动端、车云、世界仿真模型等适配器。
- `fixtures/`：测试数据准备、环境上下文、数据隔离、清理和复用机制。
- `runtime/`：Runner、Scheduler、Executor、Replay。
- `validators/`：状态机、订单、调度、计费、数据一致性校验器。
- `reports/`：报告、看板、指标、质量趋势。
- `observability/`：结构化日志、指标、链路追踪、执行诊断。
- `evidence/`：测试证据、截图、日志、trace、仿真轨迹、回归证明。
- `quality-gates/`：Schema、安全、数据污染、Agent 产物准入、Review/Critic 反思结果等门禁。

## 最小准入链路

测试资产进入执行链路前，至少需要满足：

- `Schema Gate`：字段和枚举符合 `contracts/`。
- `Traceability Gate`：可追溯到需求、澄清项、整车问题或仿真故事。
- `Agent Artifact Gate`：Agent 产物包含假设、风险、自检和目标资产。
- `Review Gate`：P0/P1 和高风险资产必须人工评审。
- `Reflection Gate`：Critic 未发现未处理的覆盖缺口、追溯缺口或阻断级质量问题。
- `Evidence Gate`：执行证据或证据计划可被报告和回归流程消费。
