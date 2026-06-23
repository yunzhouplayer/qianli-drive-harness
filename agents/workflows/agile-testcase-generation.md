# Workflow: 敏捷式测试用例自动生成

## 目标

通过 Product Agent、Development Agent、Testing Agent、Review Agent 和 Critic Agent 五类 Agent 的协作，实现从需求导入到测试资产准入的测试开发闭环。

## 敏捷映射

| 敏捷活动 | Agent 协作 |
|---|---|
| Backlog Refinement | Product Agent 分析需求，提出澄清项 |
| Sprint Planning | Product + Development + Testing 共同确认范围、风险和测试策略 |
| Development | Development Agent 输出技术影响和测试工具建议 |
| Testing | Testing Agent 生成测试点、策略和用例 |
| Review | Review Agent 执行资产准入、Schema、追溯、Evidence 和 Review Gate 检查 |
| Retrospective | Critic Agent 汇总覆盖缺口、重复项、澄清缺口和 repair 建议 |

## 阶段

### 1. 需求导入

输入：

- 多段文本。
- 文件、图片、接口文档等多模态输入元信息。

输出：

- 需求导入记录。
- 原始输入追溯 ID。

### 2. 需求分析评审

Product Agent 负责：

- 识别业务目标。
- 识别不清晰、冲突、缺失和不可测试表述。
- 生成澄清问题。

人工负责：

- 回答澄清问题。
- 确认需求范围。

### 3. 技术影响分析

Development Agent 负责：

- 识别涉及系统、接口、状态、数据依赖。
- 判断自动化可测性。
- 提出 Fixture、Validator、Tool 建议。

### 4. 测试点提取

Testing Agent 负责：

- 从需求、验收标准、澄清结果和技术影响中提取测试点。
- 识别正向、反向、边界、异常、权限、状态流转等测试点。

### 5. 测试策略生成

Testing Agent 负责：

- 先生成软件功能测试策略。
- 预留接口、性能、兼容性、安全、数据质量扩展点。
- 标记优先级和风险。

### 6. 测试用例生成

Testing Agent 负责：

- 生成结构化功能测试用例。
- 每条用例必须可追溯。
- 每条用例必须包含前置条件、步骤、预期结果、优先级和评审状态。

### 7. 用例评审

Review Agent 负责：

- 检查测试资产是否符合 `contracts/test-assets/`。
- 检查 Agent 产物是否符合 `contracts/agent-artifacts/`。
- 检查来源追溯、Fixture、Validator 和 Evidence 引用。
- 检查风险等级和人工评审状态。
- 输出 Harness Gate 结果和准出判断。

人工评审：

- P0/P1 用例必须人工评审。
- 需求澄清不足时必须人工确认。

### 8. Critic 反思与修复

Critic Agent 负责：

- 检查每个需求单元是否形成 `需求单元 -> 测试点 -> 测试用例` 闭环。
- 检查测试点和用例是否重复、过泛或缺少边界/异常路径。
- 检查澄清项是否被后续资产实际消费。
- 对未覆盖需求提出最小 repair 范围。
- 对确定性补偿资产标记 warning 和人工复核要求。

输出：

- `Reflection Findings`。
- `Coverage Gaps`。
- `Traceability Gaps`。
- `Quality Gaps`。
- `Clarification Gaps`。
- `Repair Scope`。

## 质量目标

- 需求清晰时，测试用例采纳率目标高于 90%。
- 需求清晰时，需求闭环覆盖率目标为 100%。
- 需求清晰时，测试点覆盖率目标高于 95%。
- 中间产物必须可查看、可追溯。
- Agent 产物必须进入质量门禁。
- Critic 发现的 `coverage_gap` 必须触发 repair 或确定性补偿。
- 确定性补偿资产必须标记为 warning，并进入人工复核。

## 参考实践

- Scrum 强调透明、检视和调整；Product Owner 负责 Product Backlog，Developers 负责可用增量和质量。
- 最新需求生成测试用例研究指出，自然语言需求存在歧义、幻觉、追溯不足和评估不一致风险，因此本流程把澄清、追溯和评审作为强制阶段。
