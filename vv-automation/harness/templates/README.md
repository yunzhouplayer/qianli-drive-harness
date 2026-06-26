# Harness Templates

本目录存放 V&V 自动化 Harness 使用的受控模板和阶段标准。

模板分为两类：

- `source-standards/`：来自测试流程的准入、准出标准，用于约束 Agent 生成和人工评审。
- `workflow-artifacts/`：需求、测试功能点、测试策略、测试用例和追溯矩阵的结构化输出模板。
- `case-workbook/`：可交付给测试人员或导入用例管理系统的表格模板。

## 已导入模板

| 模板 | 来源文件 | Harness 阶段 | 当前用途 |
|---|---|---|---|
| `source-standards/requirement-document-entry-standard.md` | 需求文档准入标准.md | 需求导入 | 判断 PRD、接口文档、原型图等是否可进入需求解析和评审 |
| `source-standards/test-function-point-exit-standard-v2.md` | 测试功能点提取准出标准V2.0.md | 功能点提取 | 判断测试功能点是否满足覆盖、粒度、规范性和追溯要求 |
| `source-standards/test-strategy-generation-entry-standard.md` | 测试策略生成准入标准.md | 测试策略生成 | 判断功能点文档是否足以进入测试策略和用例设计 |
| `case-workbook/test-case-template.xlsx` | 测试用例模板_Sheet1_表格.xlsx | 测试用例交付 | 提供人工可读的测试用例表格格式 |

## 已制定输出模板

| 模板 | Harness 阶段 | 主要用途 |
|---|---|---|
| `workflow-artifacts/requirement-analysis-output.template.yaml` | 需求解析 | 输出需求单元、澄清项、验收标准和需求文档准入检查结果 |
| `workflow-artifacts/test-function-point-list.template.yaml` | 测试功能点提取 | 输出测试功能点清单、需求/UI追溯、粒度评审和覆盖检查 |
| `workflow-artifacts/test-strategy-output.template.yaml` | 测试策略生成 | 输出测试范围、风险分析、测试方法、覆盖目标和执行计划 |
| `workflow-artifacts/test-case.template.yaml` | 测试用例生成 | 输出对齐 Harness Case 契约和 xlsx 表头的结构化测试用例 |
| `workflow-artifacts/traceability-matrix.template.yaml` | 评审与门禁 | 串联需求、功能点、策略、用例、Fixture、Validator 和 Evidence |
| `workflow-artifacts/fixture.template.yaml` | 执行准备 | 输出测试数据、环境上下文、隔离策略和清理动作 |
| `workflow-artifacts/validator.template.yaml` | 执行校验 | 输出确定性断言、失败输出和证据字段 |
| `workflow-artifacts/gate-result.template.yaml` | 质量门禁 | 输出各 Gate 检查结果、发现项和准入决策 |
| `workflow-artifacts/evidence.template.yaml` | 执行证据 | 输出截图、日志、trace、请求响应、状态快照和校验结果引用 |
| `workflow-artifacts/report.template.yaml` | 执行报告 | 输出执行结果、覆盖率、风险、证据和发布准入结论 |

## 与 Harness Gate 的关系

这些模板不是替代 `contracts/` 的 Schema，而是作为阶段准入和人工评审规则：

```text
需求文档准入
  -> 需求解析 / requirement units
  -> 测试功能点提取准出
  -> 测试策略生成准入
  -> 测试用例生成 / case workbook
  -> 追溯矩阵
  -> Fixture / Validator
  -> Harness quality gates
  -> Evidence / Report
```

落地时建议分两层使用：

- 确定性字段和引用关系进入 `contracts/` 与 Gate Runner。
- 语义完整性、粒度合理性、截图标注质量等进入 Review Agent 和人工评审清单。

## 测试用例表格字段

`case-workbook/test-case-template.xlsx` 当前包含以下字段：

| 字段 | 对应 Harness 含义 |
|---|---|
| 用例ID | `case.id` |
| 所属模块-子模块 | `case.domain` / `case.tags` / `case.title` 辅助信息 |
| 测试点 | `case.traceability.test_point_id` 和 `case.title` |
| 优先级 | `case.risk.level` |
| 用例类型 | `case.execution.type` 或测试分类 |
| 前置条件 | `case.preconditions` |
| 测试步骤 | `case.steps` |
| 预期结果 | `case.expected_results` |
| 评审结果 | `case.review.status` |

## 后续处理建议

当前最小必需模板已覆盖需求到报告链路。后续可按实际落地节奏补充缺陷分析、回归建议、测试工具规格、CI/CT 任务和线上巡检模板；这些不应阻塞当前 Harness Gate Runner 和 smoke 闭环建设。
