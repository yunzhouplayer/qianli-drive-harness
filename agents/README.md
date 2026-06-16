# 多 Agent 协同配置域

本目录用于存放多 Agent 协同相关配置。

Agent 负责生成、修改、评审和分析测试资产；Harness 负责约束、执行和验证这些产物。

## 子目录

- `roles/`：需求 Agent、测试策略 Agent、测试开发 Agent、评审 Agent、分析 Agent。
- `workflows/`：需求到用例、用例到工具、缺陷到回归、验收反馈到仿真故事等协作流程。
- `prompts/`：Prompt 模板。
- `policies/`：安全合规、数据边界、环境权限、输出约束。
- `evals/`：Agent 产物采纳率、修改后通过率、覆盖率提升等评估集。
- `skill-bindings/`：Agent 与 Skill 的绑定关系。

## 边界

- Agent = 谁来做。
- Skill = 它会什么能力。
- Memory = 它长期记住什么。
- Knowledge = 它依据什么事实和规则。
- Harness = 它生成的东西如何被约束、执行和验证。

`agents/` 不直接存放 Skill 主体和长期记忆主体，只保存协作配置和绑定关系。
