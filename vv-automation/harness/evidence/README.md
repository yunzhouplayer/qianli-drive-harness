# Harness Evidence

Evidence 存放测试执行证据、日志、trace、接口响应、状态快照和 validator 结果。

证据类型和最小要求以 `evidence-standards.yaml` 为准。`gate-runner.mjs` 的 Evidence Gate 会检查：

- `expected_result.evidence` 中的证据类型是否在标准中定义。
- 执行类型、业务域、风险等级对应的最小证据是否齐全。
- Validator 如果声明 `evidence.required: true`，必须提供 `evidence.fields`。
- 未执行前只有 evidence plan 时给 warning；发布准入必须有运行时 evidence ref。

第一版执行链路由 `execution-runner.mjs` 生成：

```text
vv-automation/harness/reports/<run>/evidence/execution-evidence.json
vv-automation/harness/reports/<run>/evidence/execution-evidence.yaml
vv-automation/harness/reports/<run>/evidence/validator-results.json
```

最小 evidence 必须包含：

- `run_id`
- `case_id`
- source assets：Case、Fixture、Validators
- `operation_log` 或对应执行类型要求的执行日志
- `state_snapshot`
- `validator_result`
- privacy policy：是否含 PII、是否脱敏
- integrity checksum
- retention policy

mock adapter 产物只能证明 Harness 执行链路可用，不能作为真实系统发布准入依据。真实 adapter 接入后，Evidence 应补充真实接口响应、客户端截图、服务日志、trace id 和执行环境版本。
