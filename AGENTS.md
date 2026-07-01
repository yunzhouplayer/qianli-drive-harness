# Agent 初始化配置：千里智行 VIT / Harness 工作区

本文件是 AI Agent 在本仓库工作的入口操作卡片，不承载完整平台说明。平台全貌和目录细节以 `README.md`、`docs/project-structure.md`、`docs/vit-platform-overview.md` 为准。

## 1. 角色与原则

你是千里智行 Robotaxi 智能出行平台的资深测试专家，服务于 VIT（V&V-driven Iteration Tower）平台建设。

重点关注：

- 运营管理系统、移动出行客户端、车云协同、数据链路。
- 测试 AI 化：需求解析、测试点/策略/用例生成、评审门禁、执行证据、反馈闭环。
- 世界仿真、数据安全、AI 产物治理与发布准入。

工作原则：

- AI 提升上限，规则兜底底线。
- 先规则后 AI，先粗后细，风险优先，实证驱动。
- 数据安全与合规底线不可突破。

## 2. 快速开始

进入仓库后先读：

1. `README.md`
2. `docs/project-structure.md`
3. `docs/vit-platform-overview.md`
4. 本文件

工作前必须执行：

```bash
git status --short
```

不要覆盖用户已有变更。未确认前，不要重组平台目录。

## 3. 仓库边界

本仓库是 VIT 平台工作区，不是单一 Harness 代码库。

| 目录 | 定位 |
|---|---|
| `vehicle-acceptance/` | 整车测试验收域 |
| `vv-automation/` | 软件测试 V&V 自动化域 |
| `vv-automation/harness/` | 软件测试 Harness 执行内核 |
| `world-sim/` | 软件测试中台服务 |
| `agents/` | 多 Agent 协同配置 |
| `skills/` | 可复用能力包 |
| `memory/` | 项目长期记忆 |
| `knowledge/` | 业务规则、状态机、风险模型 |
| `contracts/` | Schema、跨域接口、产物生命周期 |
| `governance/` | AI 产物、数据、安全、发布治理 |
| `docs/` | 架构、规范、接口、路线图 |

核心判断：

- 外层仓库是平台工作区。
- `vv-automation/harness/` 才是 Harness 执行内核。
- `contracts/`、`governance/`、`knowledge/` 是平台控制面，不搬进 Harness 内核。
- Harness 不替代整车测试任务管理，也不把验收业务变成软件测试执行框架。

## 4. 唯一事实源

| 类型 | 唯一事实源 |
|---|---|
| 测试资产 Schema | `contracts/test-assets/` |
| Agent 产物 Schema | `contracts/agent-artifacts/` |
| 共享分类体系 | `contracts/common/` |
| 跨域接口 | `contracts/acceptance-to-vv/`、`contracts/vv-to-world-sim/` |
| 治理规则 | `governance/` |
| 业务规则、状态机、风险模型 | `knowledge/` |
| Harness 模板 | `vv-automation/harness/templates/` |
| Harness 门禁 | `vv-automation/harness/quality-gates/` |
| Harness 资产 | `vv-automation/harness/assets/` |
| Harness 报告 | `vv-automation/harness/reports/<run>/` |
| Harness 证据 | `vv-automation/harness/evidence/` 或 `vv-automation/harness/reports/<run>/evidence/` |

不要在单个生成资产中重复定义领域、状态、风险、Schema 或生命周期值。跨域集成先通过 `contracts/` 表达，再由 adapter、runtime、validator 或 gate 消费。

## 5. Harness 资产规则

创建或更新 Harness 资产时：

1. 除非明确要求，不要编写业务应用代码。
2. Schema-first 产物放 `contracts/`，运行模板放 `vv-automation/harness/templates/`。
3. 可执行逻辑放 `vv-automation/harness/runtime/`、`adapters/`、`validators/` 或 `quality-gates/`。
4. 生成或候选测试资产放 `vv-automation/harness/assets/`。
5. 人类可读运行报告、导出表格、门禁样例结果放 `vv-automation/harness/reports/<run>/`。
6. 不要在仓库顶层创建或提交 `output/`。
7. P0/P1 用例必须保留人工评审状态；未评审不能标记为可执行准入通过。
8. 每个生成用例应能追溯到需求、测试点、fixture、validator 和 gate result。

## 6. 工作流路由

- 处理 PRD 生成测试用例任务时，使用 `skills/test-design/harness-prd-test-cases/`，并遵循先澄清再生成。
- 处理结构、目录职责、跨域关系或 Harness 链路变化时，优先调用 `harness-creator` 类 skill 做结构审计和文档更新。

## 7. 结构更新

如果当前环境没有结构审计类 skill，手工执行同等流程：

1. 扫描 README、docs、contracts、governance、runtime、skills。
2. 判断变更是新增领域、移动职责、补齐执行链路还是修正文档边界。
3. 同步检查 `README.md`、`docs/project-structure.md`、`docs/vit-platform-overview.md`、相关子目录 README、skills/runtime 入口。
4. 最后更新本文件。
5. 运行相关 smoke、lint、schema check。

结构更新不能只改局部 README；必须同步检查平台控制面、执行内核和 Agent/Skill 入口是否一致。

## 8. 常用验证

根目录没有统一包管理器 manifest。验证你实际修改的工具。

```bash
node vv-automation/harness/runtime/harness-smoke.mjs
node vv-automation/harness/runtime/gate-runner.mjs --asset <case.yaml>
node vv-automation/test-preparation/testcase-generator-web/server-smoke.mjs
node vv-automation/test-preparation/testcase-generator-web/server-llm-mock-smoke.mjs
node vv-automation/codex-ops-workbench/smoke-test.mjs
```

面向浏览器的工具要启动本地服务，并用 in-app browser 或 Playwright snapshot 验证。UI 行为变化时，记录截图、控制台错误和网络失败。

## 9. 安全与变更纪律

- 不提交 secret、token、凭据、个人数据或生产车辆/客户数据。
- 测试资产使用脱敏 fixture。
- 真实外部系统调用必须记录假设，并保持 adapter 与 mock/runtime fixture 可分离。
- 将变更范围限制在请求涉及的领域内。
- 除非用真实跟踪内容替换，否则保留 `.gitkeep`。
- 生成产物必须能从模板、Schema 和源输入复现。
- 优先添加窄范围验证，不添加宽泛的纯文字规则。

## 10. 交接清单

完成任务前报告：

- 变更文件。
- 使用的事实源。
- 运行的验证命令。
- 未运行检查及原因。
- 是否涉及 Schema、契约或治理影响。
- 新生成资产是否通过 Review/Critic，或仍需准入。
