# P0-1 / P0-2 / P0-3 进展

## 结论

当前已完成 P0-1、P0-2、P0-3 的第一版可评审草案。

| 编号 | 任务 | 状态 | 产物 |
|---|---|---|---|
| P0-1 | 核心测试资产契约 | Done | `contracts/test-assets/` |
| P0-2 | Agent 产物契约 | Done | `contracts/agent-artifacts/` |
| P0-3 | Harness 质量门禁 | Done | `vv-automation/harness/quality-gates/` |

## P0-1：核心测试资产契约

定义了 6 类核心资产：

- Scenario
- Case
- Fixture
- Validator
- Tool
- Report

关键判断：

- Scenario 面向业务场景。
- Case 面向可执行用例。
- Fixture 管测试数据和环境上下文。
- Validator 管确定性断言。
- Tool 管测试工具能力和安全边界。
- Report 管执行结果和证据聚合。

## P0-2：Agent 产物契约

定义了 Agent 生成产物的统一包装层。

核心要求：

- 必须记录生成 Agent。
- 必须记录输入任务来源。
- 必须声明目标测试资产。
- 必须记录假设。
- 必须记录风险。
- 必须记录自检结果。
- 必须经过评审状态流转。

## P0-3：Harness 质量门禁

定义了 8 类门禁：

- Schema Gate
- Traceability Gate
- Fixture Gate
- Validator Gate
- Tool Safety Gate
- Evidence Gate
- Agent Artifact Gate
- Review Gate

这些门禁用于判断测试资产是否可以从草稿进入候选、评审、执行和报告链路。

## 后续建议

下一步建议进入 P0-4：

定义 `contracts/vv-to-world-sim/` 的最小仿真 API 契约，包括：

- 创建仿真场景。
- 初始化实体。
- 注入事件。
- 推进时间。
- 查询状态快照。
- 导出仿真 trace。

在 P0-4 之后，再用一个真实小需求做 smoke test，验证契约、门禁和仿真 API 是否能串起来。
