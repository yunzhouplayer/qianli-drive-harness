# Common Contracts

本目录存放跨契约复用的通用字典、枚举和基础对象定义。

这些定义供 `contracts/test-assets/`、`contracts/agent-artifacts/`、Harness quality gates、Agent workflows 共同引用，避免同一概念在不同契约中重复定义。

## 当前字典

- `domain-taxonomy.yaml`：业务域分类字典。
- `source-taxonomy.yaml`：追溯来源分类字典。
- `risk-taxonomy.yaml`：风险等级与影响标签字典。
- `review-status.yaml`：评审状态字典。
- `execution-type.yaml`：执行类型和执行环境字典。
- `artifact-lifecycle.yaml`：测试资产生命周期字典。
