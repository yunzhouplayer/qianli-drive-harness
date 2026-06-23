# Smoke Test 001: 整车验收问题转软件回归资产

## 结论

本次冒烟测试验证了当前 P0 契约和质量门禁可以支撑一条最小链路：

```text
整车验收问题
  -> Agent 产物包装
  -> Scenario / Case / Fixture / Validator
  -> Quality Gates 判断
```

该链路能表达测试资产，但由于风险等级为 `P1` 且未经过人工评审，质量门禁结果应为 `blocked`，不能进入执行链路。

## 输入问题

车辆已到达乘客上车点，车端状态已进入 `ARRIVED`，但乘客端和 OMS 在 30 秒内仍显示 `PICKING_UP`。

输入文件：

```text
vehicle-acceptance/issue-intake/SMOKE-001-arrival-status-sync.md
```

## 产物清单

| 类型 | 文件 |
|---|---|
| 整车验收问题 | `vehicle-acceptance/issue-intake/SMOKE-001-arrival-status-sync.md` |
| Agent 产物 | `contracts/agent-artifacts/examples/smoke-001-generated-scenario.yaml` |
| Scenario | `vv-automation/harness/assets/scenarios/smoke-001-arrival-status-sync.scenario.yaml` |
| Case | `vv-automation/harness/assets/cases/smoke-001-arrival-status-sync.case.yaml` |
| Fixture | `vv-automation/harness/fixtures/smoke-001-arrival-status-sync.fixture.yaml` |
| Validator | `vv-automation/harness/validators/smoke-001-arrival-status-sync.validator.yaml` |
| Gate Result | `vv-automation/harness/quality-gates/examples/smoke-001-gate-result.yaml` |

## 验证点

### 1. 资产引用关系

Scenario 引用 Case：

```text
SCN-ORDER-ARRIVAL-STATUS-SYNC-001
  -> CASE-ORDER-ARRIVAL-STATUS-SYNC-NORMAL-001
```

Case 引用 Fixture 和 Validator：

```text
CASE-ORDER-ARRIVAL-STATUS-SYNC-NORMAL-001
  -> FIXTURE-ORDER-ARRIVAL-STATUS-SYNC-001
  -> VALIDATOR-ORDER-ARRIVAL-STATUS-SYNC-001
```

### 2. 来源追溯

Scenario、Case、Agent 产物都能追溯到：

```text
vehicle-acceptance/issue-intake/SMOKE-001-arrival-status-sync.md
```

### 3. Agent 产物约束

Agent 产物包含：

- `source_task`
- `target_asset`
- `generated_content`
- `assumptions`
- `risk`
- `quality_checks`
- `review`

### 4. Quality Gates 判断

本次门禁预期：

| Gate | 结果 | 原因 |
|---|---|---|
| Schema Gate | passed | 资产字段完整 |
| Traceability Gate | passed | 来源可追溯 |
| Fixture Gate | passed | 数据来源、隔离和清理已声明 |
| Validator Gate | passed | 存在确定性延迟、存在性、状态机断言 |
| Evidence Gate | warning | 尚无独立 evidence asset |
| Review Gate | blocked | P1 风险资产需要人工评审 |

## 暴露的问题

1. `vv-automation/harness/assets/` 需要正式保留 `scenarios/` 和 `cases/` 子目录。
2. Evidence 当前通过 Case 的 `expected_result.evidence` 表达，后续可能需要独立契约。
3. Quality Gates 目前是人工声明的结果，后续需要最小 gate runner。
4. 当前 schema 是说明型 YAML，后续需要升级为可机器强校验的 JSON Schema 或自定义校验器。

## 下一步建议

先做最小 gate runner 设计，不急着接真实系统。

目标：

```text
读取 YAML 资产
  -> 检查必填字段
  -> 检查引用文件存在
  -> 检查 source 可追溯
  -> 检查 P1/P0 是否 pending_review 或 approved
  -> 输出 gate result
```
