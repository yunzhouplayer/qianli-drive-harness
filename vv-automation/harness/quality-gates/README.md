# Harness Quality Gates

## 目标

本目录定义 V&V 自动化 Harness 的质量门禁。

质量门禁用于判断测试资产、Agent 产物、测试工具和执行结果是否可以进入下一阶段：

```text
draft
  -> candidate
  -> approved
  -> executable
  -> reportable
```

## 门禁总览

| 门禁 | 目标 |
|---|---|
| Schema Gate | 检查资产字段结构完整 |
| Traceability Gate | 检查来源和链路可追溯 |
| Fixture Gate | 检查数据来源、隔离和清理机制 |
| Validator Gate | 检查确定性断言和失败输出 |
| Tool Safety Gate | 检查工具权限、安全等级、dry-run 和生产限制 |
| Evidence Gate | 检查执行证据可留存 |
| Agent Artifact Gate | 检查 Agent 产物假设、风险和自检记录 |
| Review Gate | 检查高风险资产是否经过人工评审 |
| Reflection Gate | 检查 Critic 反思发现是否已处理 |

## 准入策略

默认策略：

- `P0`、`P1` 风险资产必须人工评审。
- Case、Scenario、Fixture、Validator 必须符合 `contracts/test-assets/` 中的契约 Schema。
- Evidence 类型必须来自 `vv-automation/harness/evidence/evidence-standards.yaml`。
- Evidence 计划必须满足执行类型、业务域和风险等级的最小证据要求。
- Agent 生成资产必须通过 Agent Artifact Gate。
- Tool 必须通过 Tool Safety Gate。
- Case 必须引用 Fixture 和 Validator。
- Fixture 必须声明数据隔离和清理动作。
- Validator 必须包含确定性规则，不能只依赖人工观察。
- Report 必须关联 Evidence 和 Validator 结果。
- Critic 发现 `coverage_gap` 或 `traceability_gap` 时不得直接准出。
- 确定性补偿资产必须以 `warning` 进入人工复核，不能直接作为高质量最终资产。

## 门禁结果

门禁结果统一为：

- `passed`
- `failed`
- `warning`
- `blocked`
- `not_applicable`

失败处理建议：

- `failed`：不得进入执行链路。
- `blocked`：依赖外部信息或人工确认。
- `warning`：允许进入低风险试运行，但不能作为发布准入依据。

## 当前实现状态

`gate-runner.mjs` 已实现第一版可执行门禁：

- `Schema Gate`：消费 `contracts/test-assets/*.schema.yaml`，检查必填字段、嵌套必填字段、类型和枚举。
- `Traceability Gate`：检查 source、scenario 和需求/来源追溯。
- `Fixture Gate`：检查 data scope、隔离、清理、PII 和明文密钥。
- `Validator Gate`：检查确定性规则、失败输出和 evidence fields。
- `Evidence Gate`：检查 evidence 标准、最小证据类型、validator evidence 和运行证据引用。
- `Review Gate`：P0/P1 未人工评审时阻断；关联生成资产未评审时阻断高风险准入。
- `Reflection Gate`：Agent 生成资产缺 Critic reflection 时给 warning。

仍待补齐：

- Tool Safety Gate 的完整工具权限和生产限制检查。
- Agent Artifact Gate 的独立产物自检入口。
- Critic finding 的结构化 coverage gap、duplicate、repair scope 阻断规则。
- CI/CT 中的批量门禁执行器。
