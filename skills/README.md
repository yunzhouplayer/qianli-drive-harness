# Skills 能力包

本目录用于存放可复用 Agent 能力包。

Skill 是能力，不是角色。一个 Skill 可以被多个 Agent 复用，例如测试策略 Agent、测试开发 Agent、评审 Agent 都可能调用同一个测试设计 Skill。

## 子目录

- `test-design/`：测试分析、风险识别、策略设计、用例设计。
- `test-dev/`：测试工具开发、Harness 资产生成、适配器/校验器开发。
- `defect-analysis/`：缺陷归因、影响面分析、回归建议。
- `simulation-story/`：整车问题到仿真故事、虚拟场景编排。
- `data-quality/`：数据质量检查、脏数据识别、投毒风险分析。
- `report-generation/`：测试报告、质量看板、测试建议生成。

## 原则

- Skill 不绑定单一 Agent。
- Skill 应提供明确的适用场景、输入、输出和质量检查点。
- Skill 可以包含模板、检查清单、示例和脚本。
- Skill 不能包含密钥、生产账号、未脱敏数据或不可共享的敏感信息。
