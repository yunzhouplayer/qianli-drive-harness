# Agent Artifacts 契约

## 目标

本目录定义 Agent 生成产物的标准契约。

Agent 可以生成测试场景、用例、Fixture、Validator、Tool、报告草案和分析建议，但这些产物不能直接进入执行链路，必须先通过契约校验、质量门禁和必要的人工评审。

## 核心产物

| 产物 | 文件 | 定位 |
|---|---|---|
| Generated Scenario | `generated-scenario.schema.yaml` | Agent 生成的测试场景草案 |
| Generated Case | `generated-case.schema.yaml` | Agent 生成的可执行用例草案 |
| Generated Fixture | `generated-fixture.schema.yaml` | Agent 生成的数据和环境上下文草案 |
| Generated Validator | `generated-validator.schema.yaml` | Agent 生成的校验器草案 |
| Generated Tool | `generated-tool.schema.yaml` | Agent 生成的测试工具草案 |
| Agent Review | `agent-review.schema.yaml` | Agent 或人工对产物的评审记录 |

## Agent 产物生命周期

```text
Task Input
  -> Agent Generation
  -> Agent Artifact Contract Check
  -> Test Asset Contract Check
  -> Harness Quality Gates
  -> Human Review when required
  -> Accepted Test Asset
```

## 统一字段

所有 Agent 产物必须包含：

| 字段 | 说明 |
|---|---|
| `artifact_id` | Agent 产物唯一 ID |
| `artifact_type` | 产物类型 |
| `agent` | 生成 Agent 信息 |
| `source_task` | 输入任务来源 |
| `target_asset` | 目标测试资产类型和路径 |
| `generated_content` | 生成内容 |
| `assumptions` | Agent 明确作出的假设 |
| `risk` | 风险等级和影响面 |
| `quality_checks` | 自检结果 |
| `review` | 评审状态 |

## 生成原则

- Agent 必须显式记录假设，不能把假设伪装成事实。
- Agent 产物必须可追溯到需求、缺陷、整车验收问题或人工设计任务。
- Agent 产物必须声明目标资产类型，不能输出无归属文档。
- 高风险产物必须进入人工评审。
- 涉及工具、数据写入、仿真数据生成的产物必须声明安全边界。
- Agent 产物通过质量门禁后，才可以转存为正式测试资产。
