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

## 准入策略

默认策略：

- `P0`、`P1` 风险资产必须人工评审。
- Agent 生成资产必须通过 Agent Artifact Gate。
- Tool 必须通过 Tool Safety Gate。
- Case 必须引用 Fixture 和 Validator。
- Fixture 必须声明数据隔离和清理动作。
- Validator 必须包含确定性规则，不能只依赖人工观察。
- Report 必须关联 Evidence 和 Validator 结果。

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

## 后续实现建议

当前文件是规则定义。后续可以实现：

- YAML/JSON Schema 校验器。
- 资产引用完整性检查器。
- 敏感数据扫描。
- Tool 权限和环境策略检查。
- Agent 产物自检和人工评审状态检查。
- CI/CT 中的门禁执行器。
