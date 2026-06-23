# 五 Agent 敏捷式测试用例生成架构

## 结论

本分支验证一个面向测试开发的最小闭环：

```text
Product Agent
  -> Development Agent
  -> Testing Agent
  -> Review Agent / Harness Gate
  -> Critic Agent
  -> 测试用例网页工具
  -> 中间产物追溯
  -> 用例评审门禁
```

第一阶段已经从纯确定性规则升级为“两阶段 LLM/RAG 推理 + 规则兜底”。无 `OPENAI_API_KEY` 时，工具会用本地知识库检索和规则链路兜底；配置 Key 后，先由 LLM 基于原始需求 intake 拆分可测试需求单元并列出待澄清项，用户补充澄清后，再由 LLM/RAG 推理技术影响、测试点、测试用例、Harness Gate 和 Critic 反思结果。

## 参考实践

本设计参考了以下原则：

- Scrum 的透明、检视、调整，以及 Product Owner / Developers 的职责边界。
- 需求驱动测试用例生成研究中强调的歧义处理、追溯、评估和幻觉控制风险。
- 企业 Agent 落地中的治理、可观测、可评估、可人工接管要求。

参考资料：

- Scrum Guide: https://scrumguides.org/scrum-guide.html
- AI-Driven Test Case Generation from Natural Language Requirements: https://arxiv.org/abs/2606.06563

## 五 Agent 职责

| Agent | 敏捷角色映射 | 核心职责 |
|---|---|---|
| Product Agent | Product Owner | 需求导入、需求评审、澄清问题、验收标准 |
| Development Agent | Developers | 技术影响、系统边界、接口候选、数据依赖、可测性 |
| Testing Agent | 测试专家 | 测试点、测试策略、测试用例、覆盖率预测 |
| Review Agent / Harness Gate | 质量门禁 | 高风险用例评审、追溯完整性、资产 Schema 和准出状态 |
| Critic Agent | Retrospective / Independent Review | 覆盖缺口、重复项、追溯缺口、澄清缺口、repair 范围 |

## MVP 流程

```text
需求导入
  -> Product Agent / LLM 需求单元拆分
  -> 待澄清项展示
  -> 用户人工澄清 / 补充说明
  -> Development Agent / LLM 技术影响分析
  -> Testing Agent / LLM 测试点提取
  -> Testing Agent / LLM 测试策略生成
  -> Testing Agent / LLM 功能测试用例生成
  -> Review Agent / Harness Gate 质量校验
  -> Critic Agent 反思评审与 repair 建议
  -> 自动评审 + P0/P1 人工评审提示
  -> 追溯矩阵
```

## 本期网页工具

位置：

```text
vv-automation/test-preparation/testcase-generator-web/
```

能力：

- 多文本需求输入。
- PDF / 文本文件解析。
- 图片、截图、扫描件的人工转写入口。
- 需求分析评审。
- 澄清问题生成。
- 人工澄清/补充说明输入并重新生成。
- RAG 业务知识检索。
- 可选 LLM 需求解析和后续 Agent 推理。
- 两阶段交互：先分析需求和澄清项，再生成后续测试资产。
- Agent 资产视图，展示 Product / Dev / Test / Review / Critic Agent 的结构化输出。
- 技术影响分析。
- 测试点提取。
- 功能测试策略生成。
- 功能测试用例生成。
- P0/P1 人工评审提示。
- P0/P1 用例人工通过/退回。
- 覆盖率和采纳率预测。
- 追溯矩阵。
- 中间产物 JSON 面板。
- Harness 测试资产面板。
- JSON 导出。

## 质量目标

- 需求清晰时，采纳率目标高于 90%。
- 需求清晰时，需求闭环覆盖率目标为 100%。
- 需求清晰时，测试点覆盖率目标高于 95%。
- 中间产物必须可追溯和查看。
- P0/P1 用例必须人工评审。
- Critic 发现的覆盖缺口必须触发 repair 或确定性补偿。

## 当前验证结果

使用以下需求进行本地浏览器验证：

```text
乘客可以在乘客端发起 Robotaxi 叫车，系统需要在可服务区域内匹配最近的空闲车辆。
车辆接驾过程中需要实时展示订单状态，并在车辆到达上车点后同步为 ARRIVED。
若没有可用车辆，需要给出明确失败提示。
```

验证结果：

- 页面可打开。
- 点击生成后可渲染中间产物。
- 生成 9 条功能测试用例。
- 追溯矩阵生成 9 行。
- 中间产物 JSON 面板可查看。
- P1 用例可人工通过，评审后采纳率保持高于 90%。
- 生成用例可转换为 `contracts/test-assets/case.schema.yaml` 风格资产。
- 测试资产可通过最小 Harness quality gates runner 校验。
- 需求闭环覆盖率预测：100%。
- 采纳率预测：92%。

## 当前限制

- LLM 当前优先驱动需求解析和后续资产生成；无 `OPENAI_API_KEY` 或调用失败时自动回退为 RAG + 规则链路。
- LLM 生成的 P0/P1 用例进入主测试资产后仍需要人工评审和 Harness Gate 通过。
- 覆盖率和采纳率是 MVP 级启发式预测，不是生产评估；P0/P1 人工评审作为准入门禁单独提示，不直接等价为采纳率扣分。
- 图片、扫描件和图片型 PDF 尚未接 OCR，需要人工转写。
- 没有后端持久化。
- 已具备最小 Harness quality gates runner，尚未抽取为通用 runtime/devkit。

## 下一步

建议下一步做最小持久化和 LLM 评测层：

- 保存每次生成 run。
- 保存每个中间产物。
- 支持人工评审 P0/P1 用例。
- 为 LLM 需求拆分、用例生成和 Critic 反思结果建立离线评测集和采纳率统计。
- 将最小 quality gates runner 抽取为 Harness runtime/devkit 可复用模块。
