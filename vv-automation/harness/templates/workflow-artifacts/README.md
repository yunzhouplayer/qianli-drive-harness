# Workflow Artifact Templates

本目录存放需求到测试用例链路的工作项输出模板。

这些模板用于承接 `source-standards/` 中的准入、准出标准，并把流程要求落成可检查字段。它们不是最终 Schema，但字段应尽量与 `contracts/` 保持一致，便于后续升级为正式契约或被 Gate Runner 校验。

## 模板清单

| 模板 | 阶段 | 主要解决的问题 |
|---|---|---|
| `requirement-analysis-output.template.yaml` | 需求解析 | 固化需求单元、澄清项、验收标准、需求文档准入检查 |
| `test-function-point-list.template.yaml` | 测试功能点提取 | 固化功能点字段、需求/UI追溯、粒度评审和覆盖检查 |
| `test-strategy-output.template.yaml` | 测试策略生成 | 固化测试范围、风险、测试类型、覆盖策略、执行计划和不测范围 |
| `test-case.template.yaml` | 测试用例生成 | 对齐 Harness Case 契约和现有 xlsx 表头 |
| `traceability-matrix.template.yaml` | 追溯闭环 | 串联需求、功能点、策略、用例、Fixture、Validator 和 Evidence |
| `fixture.template.yaml` | 执行准备 | 固化测试数据、环境、隔离、初始化和清理 |
| `validator.template.yaml` | 执行校验 | 固化确定性断言、失败输出和证据字段 |
| `gate-result.template.yaml` | 质量门禁 | 固化 Gate 检查结果、发现项和准入决策 |
| `evidence.template.yaml` | 执行证据 | 固化执行证据、校验结果引用、脱敏和留存策略 |
| `report.template.yaml` | 执行报告 | 聚合执行结果、证据、门禁、风险和发布准入结论 |

## 使用顺序

```text
requirement-analysis-output
  -> test-function-point-list
  -> test-strategy-output
  -> test-case
  -> traceability-matrix
  -> fixture / validator
  -> gate-result
  -> evidence
  -> report
```

## 基本原则

- 每个输出必须有 `source`，不能产生无来源资产。
- 每个测试功能点必须关联需求，涉及 UI 时必须关联 UI 元素。
- 每条用例必须关联测试功能点、Fixture 和 Validator。
- P0/P1 资产必须进入人工评审。
- 所有模板都必须保留 `quality_checks`，用于承接 Review Agent 和 Harness Gate。
