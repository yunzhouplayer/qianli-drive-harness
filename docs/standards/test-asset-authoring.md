# 测试资产编写规范

## 结论

测试资产必须按统一契约编写，并优先引用 `contracts/common/` 中的公共字典。

这份规范同时约束人工和 Agent，目标是让测试资产可追溯、可评审、可执行、可度量。

## 适用范围

适用于：

- Scenario
- Case
- Fixture
- Validator
- Tool
- Report
- Agent 生成产物

## 编写顺序

推荐顺序：

```text
确认来源
  -> 选择 domain
  -> 评估 risk
  -> 编写 Scenario
  -> 拆分 Case
  -> 设计 Fixture
  -> 设计 Validator
  -> 声明 Tool
  -> 定义 Evidence 和 Report
  -> 进入 Quality Gates
```

## 必须使用公共字典

| 概念 | 字典 |
|---|---|
| 业务域 | `contracts/common/domain-taxonomy.yaml` |
| 来源类型 | `contracts/common/source-taxonomy.yaml` |
| 风险等级和影响标签 | `contracts/common/risk-taxonomy.yaml` |
| 评审状态 | `contracts/common/review-status.yaml` |
| 执行类型和环境 | `contracts/common/execution-type.yaml` |
| 生命周期 | `contracts/common/artifact-lifecycle.yaml` |

## Scenario 编写要求

Scenario 描述业务级测试场景，不直接描述每一步执行细节。

必须包含：

- 业务域 `domain`
- 来源 `source`
- 风险 `risk`
- 覆盖目标 `coverage`
- 至少一个 Case 引用
- 评审状态 `review`

不建议：

- 把多个无关业务流程塞进一个 Scenario。
- 只写测试标题，没有风险和覆盖目标。
- 不关联 Case。

## Case 编写要求

Case 是可执行测试用例。

必须包含：

- 所属 Scenario。
- 执行类型和环境。
- Fixture 引用。
- Validator 引用。
- 预期结果。
- 超时和重试策略。

不建议：

- 只有步骤，没有 Validator。
- 直接写死环境数据。
- 用人工观察代替确定性校验。

## Fixture 编写要求

Fixture 管测试数据和环境上下文。

必须包含：

- 数据来源 `data_scope`。
- 隔离策略 `isolation`。
- 实体和初始状态。
- 清理动作 `cleanup`。
- 数据安全声明。

禁止：

- 写入明文密钥。
- 写入未脱敏用户数据。
- 使用真实车辆敏感轨迹。
- 不声明清理动作就写入测试数据。

## Validator 编写要求

Validator 必须是确定性规则。

必须包含：

- 输入。
- 规则。
- 通过条件。
- 失败输出。
- 证据字段。

推荐规则类型：

- equality
- latency
- state_machine
- existence
- range
- schema
- consistency
- data_quality

不允许只有：

```text
人工检查是否正确
观察页面是否正常
确认结果符合预期
```

## Tool 编写要求

Tool 描述测试工具能力和安全边界。

必须包含：

- 输入 schema。
- 输出 schema。
- 依赖系统。
- 权限声明。
- 安全等级。
- 是否支持 dry-run。
- 是否允许生产环境。
- 是否支持回滚或清理。

默认原则：

- `production_allowed` 默认为 `false`。
- 写操作必须支持 dry-run。
- 高风险工具必须人工评审。

## Report 编写要求

Report 聚合执行结果和证据。

必须包含：

- run_id。
- 执行环境。
- 触发方式。
- 汇总状态。
- Case 结果。
- Validator 结果。
- Evidence 引用。
- 风险和建议。

## Agent 生成要求

Agent 生成测试资产时，必须：

- 使用 `contracts/agent-artifacts/` 包装生成产物。
- 记录 Agent 角色和版本。
- 记录 source_task。
- 记录 target_asset。
- 记录 assumptions。
- 记录 quality_checks。
- 标记 review 状态。

Agent 不得：

- 编造不存在的业务规则。
- 省略来源。
- 省略风险等级。
- 直接生成可执行高风险工具并绕过评审。

## 质量门禁

资产进入 Harness 执行前必须通过：

- Schema Gate
- Traceability Gate
- Fixture Gate
- Validator Gate
- Tool Safety Gate
- Evidence Gate
- Agent Artifact Gate
- Review Gate

详见：

```text
vv-automation/harness/quality-gates/
```

## 评审清单

评审测试资产时，至少检查：

- 来源是否可追溯。
- domain 是否来自公共字典。
- risk 是否合理。
- Case 是否引用 Fixture 和 Validator。
- Fixture 是否有隔离和清理。
- Validator 是否是确定性规则。
- Tool 是否声明权限和安全边界。
- Evidence 是否能支持问题复现。
- Agent 产物是否记录假设和自检结果。
