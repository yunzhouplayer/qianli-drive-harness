# Test Assets 契约

## 目标

本目录定义 V&V 自动化 Harness 中测试资产的标准契约。

这些契约用于约束人工和 Agent 生成的测试资产，使测试场景、用例、数据、校验器、工具和报告具备统一结构、可追溯、可复用、可执行、可度量。

## 核心资产

| 资产 | 文件 | 定位 |
|---|---|---|
| Scenario | `scenario.schema.yaml` | 业务级测试场景 |
| Case | `case.schema.yaml` | 可执行测试用例 |
| Fixture | `fixture.schema.yaml` | 测试数据和环境上下文 |
| Validator | `validator.schema.yaml` | 确定性校验规则 |
| Tool | `tool.schema.yaml` | 测试工具能力描述 |
| Report | `report.schema.yaml` | 执行结果和证据聚合 |

## 资产关系

```text
Scenario
  ├── references one or more Case
  ├── references optional simulation story
  └── defines business risk and coverage target

Case
  ├── references one Fixture
  ├── references one or more Validator
  ├── may invoke one or more Tool
  └── produces Report and Evidence

Fixture
  ├── prepares data
  ├── prepares environment context
  └── defines cleanup actions

Validator
  ├── consumes execution result, trace, logs, snapshots
  └── outputs deterministic pass/fail result

Tool
  ├── declares input/output schema
  ├── declares permissions and safety constraints
  └── is invoked by Case or Workflow

Report
  ├── aggregates execution result
  ├── links evidence
  └── feeds dashboard, CI/CT and quality gates
```

## 统一字段

所有测试资产建议包含以下字段：

| 字段 | 说明 |
|---|---|
| `id` | 全局唯一资产 ID |
| `version` | 契约版本或资产版本 |
| `title` | 简短标题 |
| `description` | 资产说明 |
| `domain` | 业务域，统一引用 `contracts/common/domain-taxonomy.yaml` |
| `source` | 追溯来源 |
| `risk` | 风险等级和影响标签 |
| `owner` | 责任人或责任团队 |
| `tags` | 检索标签 |
| `created_by` | human 或 agent |
| `review` | 评审状态 |

## 追溯来源

`source.type` 默认支持：

- `requirement`
- `defect`
- `vehicle_acceptance_issue`
- `online_issue`
- `exploratory_test`
- `regression_gap`
- `manual_design`
- `simulation_discovery`
- `agent_suggestion`

统一引用：

```text
contracts/common/source-taxonomy.yaml
```

## 风险等级

默认使用：

- `P0`：核心链路阻断、严重安全或合规风险。
- `P1`：核心业务异常、用户体验或运营效率明显受损。
- `P2`：一般功能异常、局部影响、可规避。
- `P3`：低风险、体验细节、非核心问题。

统一引用：

```text
contracts/common/risk-taxonomy.yaml
```

`impact_tags` 默认支持：

- `passenger_experience`
- `driver_experience`
- `dispatch_quality`
- `order_lifecycle`
- `billing_settlement`
- `vehicle_cloud_consistency`
- `oms_operation`
- `data_quality`
- `security_compliance`
- `release_gate`
- `station_acceptance`
- `simulation_fidelity`
- `ci_ct_stability`

## 业务域字典

`domain` 字段统一引用：

```text
contracts/common/domain-taxonomy.yaml
```

当前默认包含：

- `order`
- `dispatch`
- `vehicle`
- `vehicle_cloud`
- `station`
- `mobile_passenger`
- `mobile_driver`
- `oms`
- `ras`
- `payment`
- `billing_settlement`
- `data_quality`
- `simulation`
- `ci_ct`

## Agent 生成要求

Agent 生成测试资产时必须满足：

- 必须声明 `created_by: agent`。
- 必须填写 `source`，不能生成无来源资产。
- 必须填写 `risk.level` 和 `risk.impact_tags`。
- Scenario 必须至少关联一个 Case。
- Case 必须关联 Fixture 和 Validator。
- Fixture 必须声明数据来源、隔离方式和清理动作。
- Validator 必须包含确定性规则，不能只写人工检查。
- Tool 必须声明输入、输出、权限、安全等级和 dry-run 支持情况。
- Report 必须关联 evidence 和 validator 结果。

## Harness 准入要求

进入 Harness 执行链路前，测试资产必须通过：

- Schema Check：字段结构完整。
- Traceability Check：来源可追溯。
- Fixture Check：数据隔离和清理动作完整。
- Validator Check：存在确定性断言。
- Safety Check：工具权限、安全等级、dry-run 声明完整。
- Evidence Check：执行证据可留存。
- Review Check：高风险资产需要人工评审。

## 命名建议

资产 ID 建议格式：

```text
SCN-{DOMAIN}-{TOPIC}-{SEQ}
CASE-{DOMAIN}-{TOPIC}-{SEQ}
FIXTURE-{DOMAIN}-{TOPIC}-{SEQ}
VALIDATOR-{DOMAIN}-{TOPIC}-{SEQ}
TOOL-{DOMAIN}-{TOPIC}-{SEQ}
REPORT-{DOMAIN}-{TOPIC}-{SEQ}
```

示例：

```text
SCN-ORDER-ARRIVAL-STATUS-SYNC-001
CASE-ORDER-ARRIVAL-STATUS-SYNC-NORMAL-001
FIXTURE-ORDER-ARRIVAL-STATUS-SYNC-001
VALIDATOR-ORDER-ARRIVAL-STATUS-SYNC-001
```
