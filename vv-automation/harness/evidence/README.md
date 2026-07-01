# Harness Evidence

Evidence 存放测试执行证据、日志、trace、接口响应、状态快照和 validator 结果。

第一版执行链路由 `execution-runner.mjs` 生成：

```text
output/harness/<run>/evidence/execution-evidence.json
output/harness/<run>/evidence/execution-evidence.yaml
output/harness/<run>/evidence/validator-results.json
```

最小 evidence 必须包含：

- `run_id`
- `case_id`
- source assets：Case、Fixture、Validators
- operation log
- state snapshot
- request log
- validator results
- privacy policy：是否含 PII、是否脱敏
- integrity checksum
- retention policy

mock adapter 产物只能证明 Harness 执行链路可用，不能作为真实系统发布准入依据。真实 adapter 接入后，Evidence 应补充真实接口响应、客户端截图、服务日志、trace id 和执行环境版本。
