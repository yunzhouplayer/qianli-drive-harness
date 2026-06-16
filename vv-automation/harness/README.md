# 测试开发 Harness

Harness 是 V&V 自动化域内的测试开发与执行工程底座。

它负责规范软件测试工具、测试资产、Agent 产物、执行反馈和质量门禁，并通过适配器调用世界仿真模型。

## 子目录

- `devkit/`：Schema、脚手架、模板、Lint、开发规范。
- `assets/`：Scenario、Case、Fixture、Tool、Workflow 等测试资产。
- `adapters/`：OMS、RAS、移动端、车云、世界仿真模型等适配器。
- `fixtures/`：测试数据准备、环境上下文、数据隔离、清理和复用机制。
- `runtime/`：Runner、Scheduler、Executor、Replay。
- `validators/`：状态机、订单、调度、计费、数据一致性校验器。
- `reports/`：报告、看板、指标、质量趋势。
- `observability/`：结构化日志、指标、链路追踪、执行诊断。
- `evidence/`：测试证据、截图、日志、trace、仿真轨迹、回归证明。
- `quality-gates/`：Schema、安全、数据污染、Agent 产物准入等门禁。
