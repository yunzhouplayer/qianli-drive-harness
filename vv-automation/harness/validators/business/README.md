# Business Validators

本目录存放 Harness 可复用的业务确定性校验器。

当前已提供：

| Validator | 文件 | 覆盖风险 |
|---|---|---|
| 订单状态流转 | `order-status-transition.validator.yaml` | 到站、完成等核心订单状态缺失、延迟或回退 |
| 站点推荐质量 | `station-recommendation.validator.yaml` | 推荐数量不足、重复、历史/热门/附近来源缺失 |
| 短信和 Push 触达 | `notification-delivery.validator.yaml` | 模板缺失、渠道未触达、provider message id 不可追溯 |

`business-validators.mjs` 是第一版本地执行器，支持以下规则类型：

- `existence`
- `equality`
- `latency`
- `state_machine`
- `consistency`
- `data_quality`

这些 validator 可以被 mock adapter 消费，也可以在后续真实 adapter 接入后复用。真实 adapter 只需要产出相同语义的 `state_snapshot`、`timelines`、`requests` 和业务事件即可。
