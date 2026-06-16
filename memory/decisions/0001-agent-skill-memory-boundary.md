# ADR 0001: Agent、Skill、Memory、Knowledge 边界

## 状态

Accepted

## 背景

本项目需要通过多 Agent 协同支撑测试资产生成、测试工具开发、仿真故事生成、缺陷分析和持续回归。

如果把角色、能力、记忆、知识和执行框架全部放在 `agents/` 下，后续会导致职责混乱，难以复用和治理。

## 决策

采用以下边界：

- `agents/` 管协作：角色、Prompt、Workflow、Policy、Eval、Skill 绑定。
- `skills/` 管能力：测试设计、测试开发、缺陷分析、仿真故事、数据质量、报告生成等可复用能力包。
- `memory/` 管长期经验：平台共识、架构决策、复盘、Agent 反馈。
- `knowledge/` 管业务事实：业务规则、状态机、测试策略、历史缺陷、数据质量规则。
- `vv-automation/harness/` 管工程约束和执行验证。

## 影响

Agent 不直接拥有能力主体，而是通过 `agents/skill-bindings/` 绑定 Skill。

长期项目共识不混入 Prompt，优先进入 `memory/`、`docs/` 或 `AGENTS.md`。

敏感信息、密钥、生产账号、未脱敏数据不得进入 `memory/` 或 `knowledge/`。
