# Harness Adapters

Adapter 是 Harness 执行层和被测系统之间的边界。

当前已提供：

| Adapter | 位置 | 说明 |
|---|---|---|
| mock | `mock/mock-adapter.mjs` | 离线执行，不访问真实系统，用于验证 Harness runtime、validator、evidence 和 report 闭环。 |

## Mock Adapter

Mock adapter 会根据 Case、Fixture 和步骤文本生成可验证的执行结果：

- 订单状态时间线。
- OMS / 乘客端状态镜像。
- 站点推荐响应。
- 短信和小程序 Push 触达事件。
- 车辆控制命令回传。
- 操作日志、请求日志和状态快照。

它的目标不是替代真实系统测试，而是先稳定 Harness 工程骨架。后续接入真实 OMS、RAS、乘客端或车云系统时，应新增独立 adapter，并保持 `execution-runner.mjs` 消费的结果结构稳定。
