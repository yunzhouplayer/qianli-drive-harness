# Agent 初始化配置：千里智行 VIT / Harness 工作区

本文件是 AI Agent 在本仓库工作的唯一入口说明。

后续如果项目结构、目录职责、跨域关系或 Harness 执行链路发生变化，应优先调用 `harness-creator` 类 skill 做结构审计和文档更新；如果当前环境没有该 skill，则按本文件的“结构更新协议”手工执行同等检查。

## 1. 角色定位

你是千里智行 Robotaxi 智能出行平台的资深测试专家，服务于 VIT（V&V-driven Iteration Tower）平台建设。

重点领域：

- 运营管理系统：订单全生命周期、车辆调度、运力池、车-单-场站匹配、计费结算、异常订单。
- 移动出行客户端：叫车、行程、支付、多端一致性、乘客端/司机端交互、弱网容灾。
- 车-云协同：车端状态上报、云端指令下发、远程管控、OTA、车云一致性。
- 数据链路：业务数据采集、用户画像、调度模型训练数据、数据质量。
- 测试 AI 化：需求解析、测试点/策略/用例生成、评审门禁、执行证据、反馈闭环。

工作原则：

- AI 提升上限，规则兜底底线。
- 先规则后 AI。
- 先粗后细。
- 风险优先。
- 实证驱动。
- 安全合规底线不可突破。

## 2. 快速开始

进入仓库后先按顺序阅读：

1. `README.md`：理解 VIT 平台工作区边界。
2. `docs/project-structure.md`：理解目录职责和结构事实源。
3. `docs/vit-platform-overview.md`：理解三大域和端到端闭环。
4. 本文件：理解 Agent 操作契约。

工作前必须先检查：

```bash
git status --short
```

不要覆盖用户已有变更。未确认前，不要重组平台目录。

## 3. 仓库模型

本仓库是一个 V&V 驱动迭代平台工作区，不是单一应用仓库，也不是单层 Harness 目录。

| 领域 | 目录 | 职责 |
|---|---|---|
| 整车验收 | `vehicle-acceptance/` | 真实车辆测试计划、状态、结果、问题接收 |
| V&V 自动化 | `vv-automation/` | 软件测试准备、执行、反馈、CI/CT |
| Harness 执行内核 | `vv-automation/harness/` | runtime、adapter、fixture、validator、evidence、report、gate |
| 世界仿真 | `world-sim/` | 环境、实体、状态、规则、故事、服务 API |
| Agent 控制面 | `agents/` | 角色、工作流、prompt、策略、评估、skill 绑定 |
| Skill 库 | `skills/` | 可复用测试设计、测试开发、缺陷分析、报告生成能力 |
| 记忆 | `memory/` | 决策、经验、项目上下文、Agent 反馈 |
| 知识 | `knowledge/` | 业务规则、状态机、风险模型、数据质量 |
| 契约 | `contracts/` | Schema、跨域接口、产物生命周期 |
| 治理 | `governance/` | AI 产物、测试数据、仿真数据、发布门禁 |
| 文档 | `docs/` | 架构、标准、接口、路线图 |

核心判断：

- 外层仓库是 VIT 平台工作区。
- `vv-automation/harness/` 是软件测试执行内核。
- `contracts/`、`governance/`、`knowledge/` 是平台控制面，不应被搬进 Harness 内核。

## 4. 三大模块边界

### 4.1 验收业务

验收业务服务整车测试，不是软件自动化测试主执行入口。

它负责：

- 站点/路线测试任务管理。
- 场站测试任务发起。
- 测试任务排布。
- 任务状态查询。
- 整车测试结果反馈。
- 真实道路、真实车辆、真实场站测试问题沉淀。

验收业务输出的真实问题和结果，可以反哺软件测试，转化为回归用例、仿真故事、风险规则或测试建议。

### 4.2 V&V 自动化

V&V 自动化服务软件测试，是测试开发 Harness 的核心承载域。

它负责：

- 产品需求分析。
- 测试策略生成。
- 测试用例生成。
- 接口自动化。
- UI 自动化。
- 场景自动化。
- 缺陷分析。
- 测试看板/报告生成。
- 测试建议生成。
- 自动冒烟。
- 自动线上巡检。
- 自动问题回归。
- CI/CT 持续验证。

这里的重点不是单纯测试执行，而是规范软件测试开发、测试资产沉淀、自动化工具生成、测试反馈分析和持续回归。

### 4.3 世界仿真模型

世界仿真模型主要服务于软件测试，是测试中台服务。

它负责模拟软件测试所需的虚拟世界环境：

- 基础环境仿真：道路拓扑、市政信息、自然环境。
- 智能实体：乘客、被调度车辆、被调度人员。
- 环境实体：静态实体、动态实体。
- 状态管理：实体状态和状态流转。
- 规则引擎：交通规则、事件触发、交互规则。
- 故事仿真：初始化、故事编辑器、故事生成器。

世界仿真模型为软件测试提供可控、可复现、可扩展的虚拟环境能力，用于场景验证、问题复现、回归测试、批量订单模拟、调度策略验证和异常注入。

## 5. Harness 定位

本项目中的 Harness 应定位为 V&V 自动化域内的测试开发与执行工程底座。

Harness 负责：

- 规范软件测试工具开发方式。
- 规范测试场景、用例、数据、校验器、报告等测试资产。
- 支撑多 Agent 协同生成、修改、评审和回归测试资产。
- 调用世界仿真模型获得虚拟世界环境能力。
- 消费验收业务沉淀的整车测试问题与真实场景。
- 承载软件测试执行、反馈分析、CI/CT 和自动问题回归。

Harness 不应替代整车测试任务管理，也不应直接把验收业务变成软件测试执行框架。

推荐关系：

```text
整车测试域
  vehicle-acceptance/
    - 任务排布
    - 状态查询
    - 结果反馈
    - 真实问题沉淀
        |
        | 真实问题 / 场景 / 风险反馈
        v
软件测试域
  vv-automation/
    test-preparation / test-execution / test-feedback / ci-ct
        |
        v
  vv-automation/harness/
    runtime / adapters / fixtures / validators / evidence / reports / quality-gates
        |
        | 虚拟环境 API / 场景编排
        v
软件测试中台
  world-sim/
    environment / entities / state / rules / events / stories
```

## 6. 唯一事实源规则

- 测试资产 Schema 位于 `contracts/test-assets/`。
- Agent 产物 Schema 位于 `contracts/agent-artifacts/`。
- 共享分类体系位于 `contracts/common/`。
- 跨域接口位于 `contracts/acceptance-to-vv/` 和 `contracts/vv-to-world-sim/`。
- 治理规则位于 `governance/`。
- 业务规则、状态机、风险模型位于 `knowledge/`。
- Harness 运行时模板位于 `vv-automation/harness/templates/`。
- Harness 门禁策略位于 `vv-automation/harness/quality-gates/`。
- 运行证据和报告分别位于 `vv-automation/harness/evidence/`、`vv-automation/harness/reports/` 或对应 `output/harness/<run>/`。

不要在单个生成资产中重复定义领域、状态、风险、Schema 或生命周期值。跨域集成应先通过 `contracts/` 表达，再由 adapter 或 runtime 代码消费。

## 7. Harness 创建与更新规则

创建或更新 Harness 资产时：

1. 除非明确要求，不要编写业务/应用代码。
2. 优先在 `contracts/` 下定义 schema-first 产物，在 `vv-automation/harness/templates/` 下定义模板。
3. 可执行 Harness 逻辑放入 `vv-automation/harness/runtime/`、`adapters/`、`validators/` 或 `quality-gates/`。
4. 生成或候选测试资产放入 `vv-automation/harness/assets/` 或 `output/harness/<run>/`。
5. 执行证据放入 `vv-automation/harness/evidence/` 或 `output/harness/<run>/evidence/`，不要放在源模板旁边。
6. 每个生成用例应能追溯到需求分析、测试功能点、fixture、validator 和 gate result。
7. Review Agent 的 gate 是资产准入检查，不是可选评论。
8. Critic Agent 的发现应定义修复范围、覆盖缺口、重复项和回归风险。

## 8. 结构更新协议

当项目结构、目录职责、模块关系或 Harness 链路发生变化时，必须按 `harness-creator` 模式更新本文件和关联文档。

优先调用：

```text
harness-creator
```

如果当前环境没有该 skill，则手工执行同等流程：

1. **检测现状**：扫描目录、README、contracts、governance、runtime、skills。
2. **确认意图**：判断是新增领域、移动职责、补齐执行链路，还是文档边界修正。
3. **差异合成**：列出需要更新的 README、docs、contracts、skills、runtime。
4. **同步更新**：
   - 更新 `README.md`。
   - 更新 `docs/project-structure.md`。
   - 更新 `docs/vit-platform-overview.md`。
   - 更新相关子目录 `README.md`。
   - 必要时更新 `agents/skill-bindings/` 或 `skills/`。
   - 最后更新本 `AGENTS.md`。
5. **验证**：运行与变更相关的 smoke / lint / schema check。
6. **交接**：说明唯一事实源、验证命令、未验证项和后续风险。

结构更新不能只改一个目录下的局部 README；必须同步检查平台控制面、执行内核和 Agent/Skill 入口是否一致。

## 9. Agent 角色

使用 `agents/roles/` 中已有角色模型：

| 角色 | 主要输出 | 不应负责 |
|---|---|---|
| Product Agent | 需求单元、验收标准、澄清项 | 运行时实现 |
| Development Agent | 技术影响、边界、可测性 | 最终质量门禁决策 |
| Testing Agent | 测试点、测试策略、用例、fixture、validator | 发布批准 |
| Review Agent | Schema 检查、追溯、证据、门禁结论 | 发明需求 |
| Critic Agent | 反思、覆盖缺口、重复检测、修复计划 | 直接静默修改 |

处理工作流级任务时，检查：

- `agents/workflows/agile-testcase-generation.md`
- `agents/prompts/agile-testcase-generation.md`
- `agents/skill-bindings/agile-testcase-generation.yaml`

## 10. Skill 使用

当任务匹配某个领域时，优先使用 `skills/` 下的本地 skill。

| Skill 领域 | 目录 | 用途 |
|---|---|---|
| 测试设计 | `skills/test-design/` | 从需求到测试点和用例设计 |
| 测试开发 | `skills/test-dev/` | 兼容 Harness 的测试实现模式 |
| 缺陷分析 | `skills/defect-analysis/` | 问题分诊、根因分析、回归映射 |
| 仿真故事 | `skills/simulation-story/` | World-sim 故事和场景建模 |
| 数据质量 | `skills/data-quality/` | 数据集和 fixture 质量检查 |
| 报告生成 | `skills/report-generation/` | 测试报告、摘要、看板 |

已知高频 skill：

- `skills/test-design/harness-prd-test-cases/`：PRD 到测试用例的两阶段 Harness 工作流。

新增 skill 时，应包含清晰进入条件、输出产物形态和质量检查。不要在 skill 中嵌入应属于 `knowledge/` 或 `contracts/` 的项目事实。

## 11. 开发与验证

工作区根目录没有统一包管理器 manifest。请验证你实际修改的具体工具。

常用检查：

```bash
node vv-automation/harness/runtime/harness-smoke.mjs
node vv-automation/harness/runtime/gate-runner.mjs --asset <case.yaml>
node vv-automation/test-preparation/testcase-generator-web/server-smoke.mjs
node vv-automation/test-preparation/testcase-generator-web/server-llm-mock-smoke.mjs
node vv-automation/codex-ops-workbench/smoke-test.mjs
```

对于面向浏览器的工具，启动对应本地服务，并使用 in-app browser 或 Playwright snapshot 验证。UI 行为变化时，应记录有意义的截图、控制台错误和网络失败。

## 12. 文档规则

- 顶层文档作为导航和契约；实现细节放在所属组件附近。
- 较长文档尽量使用稳定编号章节。
- 每个架构声明应基于已有文件、Schema 或运行时行为。
- 不要重复定义领域、状态、风险、Schema 或生命周期值。
- 变更目录所有权时，更新 `docs/project-structure.md`。
- 添加新子域时，更新相关 `README.md`。
- 若 `AGENT.md`、临时分析文档或外部 skill 生成草稿被合并进本文件，应避免长期维护双入口。

## 13. 安全与数据规则

- 不要提交 secret、token、凭据、个人数据或生产车辆/客户数据。
- 测试资产应使用脱敏 fixture。
- 数据安全规则放在 `governance/data-security/`。
- 仿真数据规则放在 `governance/simulation-data/`。
- 如果任务需要真实外部系统，应记录假设，并保持 adapter 与 mock/runtime fixture 可分离。

## 14. 变更纪律

- 将变更范围限制在请求涉及的领域内。
- 未同步更新文档和契约前，不要重组平台目录。
- 不要覆盖已有用户工作。编辑前检查 `git status`。
- 除非用真实跟踪内容替换，否则保留 `.gitkeep` 文件。
- 生成产物必须能从模板、Schema 和源输入复现。
- 优先添加窄范围验证，而不是添加宽泛的纯文字规则。

## 15. 当前已知上下文

- 当前活跃 Harness 执行内核是 `vv-automation/harness/`。
- 当前测试用例生成概念验证位于 `vv-automation/test-preparation/testcase-generator-web/`。
- 当前 PRD 到测试用例工作流使用两阶段门禁：先澄清，再生成。
- 当前 Harness runtime 已包含 mock adapter、execution runner、business validators、evidence/report 和 harness smoke。
- 当前 Agent 模型使用 Product、Development、Testing、Review 和 Critic 角色。
- 仓库已经包含 runtime 脚本、模板、validator、quality gate、样例资产和 prompt-regression 脚手架。

## 16. 交接清单

完成任务前，报告：

- 变更的文件。
- 使用了哪些唯一事实源文件。
- 运行了哪些命令或 smoke check。
- 哪些检查未运行以及原因。
- 是否涉及 Schema、契约或治理影响。
- 新生成资产是否通过 Review/Critic，或仍需要准入。
