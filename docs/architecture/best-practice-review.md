# 行业最佳实践审视记录

## 信息来源

本次审视参考了以下方向：

- 测试金字塔和分层测试实践。
- pytest fixture 对显式、模块化、可扩展测试上下文的设计。
- Playwright 对用户可见行为、测试隔离和测试数据控制的建议。
- OpenTelemetry 对 trace、metric、log 三类遥测信号的定义。
- AI Agent 测试研究中对 Prompt 回归、工具/Workflow 测试和 AI 产物验证的风险提示。
- 自动驾驶数字孪生和仿真测试框架中对场景丰富度、可复现、边界场景探索和虚实结合的要求。

参考资料：

- Martin Fowler: The Practical Test Pyramid: https://martinfowler.com/articles/practical-test-pyramid.html
- pytest fixtures: https://docs.pytest.org/en/stable/explanation/fixtures.html
- Playwright Best Practices: https://playwright.dev/docs/best-practices
- OpenTelemetry Traces: https://opentelemetry.io/docs/concepts/signals/traces/
- OpenTelemetry Metrics: https://opentelemetry.io/docs/concepts/signals/metrics/
- OpenTelemetry Logs: https://opentelemetry.io/docs/concepts/signals/logs/
- Empirical Study of Testing Practices in Open Source AI Agent Frameworks and Agentic Applications: https://arxiv.org/abs/2509.19185
- Assessing the Quality and Security of AI-Generated Code: https://arxiv.org/abs/2508.14727
- ADDT Digital Twin Framework for Autonomous Driving Safety Validation: https://arxiv.org/abs/2504.09461
- From Code to Road: Vehicle-in-the-Loop and Digital Twin-Based Framework: https://arxiv.org/abs/2603.05279

## 对当前结构的判断

当前三大域划分是合理的：

- `vehicle-acceptance/` 继续聚焦整车测试验收业务。
- `vv-automation/` 继续承载软件测试 Harness。
- `world-sim/` 继续作为软件测试中台服务。

需要补强的是跨域契约、可观测性、测试数据生命周期、AI 产物治理和 Prompt 回归。

## 已采纳的结构优化

### 1. 增加 `contracts/`

原因：三大域之间必须通过稳定对象模型协作，否则会出现整车验收、软件测试、仿真服务、Agent 产物各定义一套数据的问题。

重点契约：

- 验收反馈到软件测试资产。
- V&V 自动化到世界仿真模型。
- Agent 生成产物。
- 测试资产。
- 遥测和执行证据。

### 2. 增加 `vv-automation/harness/fixtures/`

原因：测试数据和环境上下文需要成为 Harness 的一等公民，不能只混在 case 或脚本中。

重点能力：

- 数据准备。
- 环境上下文。
- 数据隔离。
- 清理机制。
- 可复用数据工厂。

### 3. 增加 `vv-automation/harness/observability/`

原因：测试平台需要能解释失败原因，而不仅是给出 pass/fail。

重点能力：

- 结构化日志。
- 指标。
- 链路追踪。
- 执行诊断。

### 4. 增加 `vv-automation/harness/evidence/`

原因：整车问题复现、仿真回归、AI 产物准入都需要可审计证据。

重点证据：

- 执行日志。
- trace。
- 截图或录屏。
- 仿真状态流。
- 实体轨迹。
- 回归证明。

### 5. 增加 `agents/evals/prompt-regression/`

原因：Agent 体系不能只评估最终工具或用例，也要评估 Prompt 变更是否破坏稳定输出。

重点指标：

- 输出结构稳定性。
- 关键覆盖点保持率。
- 幻觉率。
- Harness 准入通过率。
- 人工修改量。

### 6. 增加 `governance/`

原因：AI 生成测试资产、仿真数据、真实整车问题和测试数据都存在质量、安全和合规风险，需要平台级治理。

重点治理：

- AI 产物审核。
- 数据安全。
- 仿真数据真实性与偏差。
- 发布质量门禁。

### 7. 增加 `world-sim/scenario-registry/` 和 `world-sim/simulation-traces/`

原因：世界仿真模型需要支撑可复用场景和可回放结果。

重点能力：

- 仿真故事模板。
- 异常注入模板。
- 状态流。
- 事件流。
- 实体轨迹。
- 回放索引。

## 后续优先级

P0：

- 定义 `contracts/test-assets/` 中的核心测试资产契约。
- 定义 `contracts/vv-to-world-sim/` 的最小仿真调用协议。
- 定义 `vv-automation/harness/fixtures/` 的数据准备与清理规范。
- 定义 `vv-automation/harness/observability/` 的 trace/log/metric 最小字段。
- 定义 `agents/evals/prompt-regression/` 的首批回归样本。

P1：

- 建立 `world-sim/scenario-registry/` 的仿真故事模板规范。
- 建立 `governance/ai-output/` 的 AI 产物准入规则。
- 建立 `governance/data-security/` 的敏感数据边界。

P2：

- 将整车验收真实问题自动转化为回归候选和仿真故事。
- 将 Harness 执行证据与质量看板打通。
