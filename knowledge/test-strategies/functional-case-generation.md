# Functional Case Generation Strategy

## Product Agent

- 从 PRD、UE 转写、会议纪要中拆分可测试需求单元。
- 标记含糊表述，例如实时、尽快、友好、合理、高效、适当、支持。
- 对含糊表述生成澄清问题，人工补充后形成验收标准。

## Development Agent

- 分析业务域、接口候选、数据依赖和可测性。
- 对订单、车辆、状态、Push、短信等链路补充数据一致性风险。

## Test Agent

- 每个验收标准至少生成正向、异常或状态一致性测试点。
- 用例必须关联需求单元、验收标准和测试点。
- 用例步骤应包含入口、动作、状态/接口/数据证据和明确预期。

## Review Agent / Harness Gate

- 检查覆盖率、采纳率、追溯完整性、P0/P1 人工评审和测试资产 schema。

