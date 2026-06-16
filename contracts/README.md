# Contracts 跨域契约

本目录用于沉淀 VIT 平台跨域协作的对象模型、Schema 和接口契约。

跨域协作优先通过稳定契约进行，避免整车验收、V&V 自动化、世界仿真模型、Agent 产物各自定义一套数据结构。

## 子目录

- `acceptance-to-vv/`：整车验收反馈转软件测试资产的对象契约。
- `vv-to-world-sim/`：V&V 自动化调用世界仿真模型的请求/响应契约。
- `agent-artifacts/`：Agent 生成场景、用例、工具、校验器的产物契约。
- `test-assets/`：Scenario、Case、Fixture、Validator、Tool、Report 的资产契约。
- `telemetry/`：日志、指标、trace、证据索引、执行结果的遥测契约。

## 原则

- 契约先于实现。
- 契约变更必须可追踪、可评审、可回滚。
- Agent 生成产物必须符合契约后才能进入 Harness 执行或资产库。
- 仿真结果必须符合遥测和证据契约，才能被断言、报告和回归流程消费。
