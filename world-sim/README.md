# 世界仿真模型

本目录是面向软件测试的测试中台服务，用于模拟软件测试所需的虚拟世界环境。

它通过标准 API 被 V&V 自动化 Harness 调用，支撑场景验证、问题复现、回归测试、批量订单模拟、调度策略验证和异常注入。

## 子目录

- `environment/`：道路拓扑、市政信息、自然环境。
- `intelligent-entities/`：乘客、被调度车辆、被调度人员。
- `environment-entities/`：静态实体、动态实体。
- `state-manager/`：实体状态、状态流转、时间推进。
- `rule-engine/`：交通规则、事件触发、交互规则。
- `story-simulation/`：初始化、故事编辑器、故事生成器。
- `service-api/`：供 V&V 自动化调用的仿真 API、协议和 SDK。
- `scenario-registry/`：可复用仿真故事、场景模板、异常注入模板。
- `simulation-traces/`：仿真状态流、事件流、实体轨迹和回放索引。
