# Harness Runtime

本目录存放 Harness 本地执行与门禁工具。

## PRD 候选生成到 Harness 收敛

当前支持把测试用例生成工具的前端规则链路作为高召回候选生成器，再用 Harness 做去噪、归并、执行资产补齐和门禁。

### 1. 一键从 PRD 生成 Harness 资产

```bash
node vv-automation/harness/runtime/prd-to-harness.mjs \
  --pdf /path/to/prd.pdf \
  --work-dir output/harness/prd-0330-auto \
  --out-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/from-prd-auto \
  --feature "0330 乘客端小程序 PRD"
```

该入口会按顺序完成：

- PDF 文本抽取。
- 需求准入门禁，过滤开票信息、行政资料、空文档等非 PRD 输入。
- 需求澄清门禁，若存在待澄清需求项，则停止生成测试用例，先输出澄清清单。
- 调用测试用例生成工具的前端 `runPipeline()` 链路生成高召回候选。
- 调用 `candidate-to-harness.mjs` 做 Harness 资产收敛。
- 对生成的样例 Case 运行 `gate-runner.mjs`。
- 在 `--work-dir` 下输出 `run-summary.json`、`run-summary.md`、`review-brief.json` 和 `review-brief.md`。

如果需求准入门禁未通过，命令会停止生成测试用例，并输出：

- `intake-gate-result.json`
- `intake-gate-result.md`
- `review-brief.md`

如需强制对非 PRD 文档继续生成候选，可显式增加 `--allow-non-prd true`。默认不建议开启。

如果需求澄清门禁未通过，命令会停止生成测试用例，并输出：

- `clarification-gate-result.json`
- `clarification-gate-result.md`
- `review-brief.md`

确认澄清项后再运行：

```bash
node vv-automation/harness/runtime/prd-to-harness.mjs \
  --pdf /path/to/prd.pdf \
  --work-dir output/harness/prd-0330-auto \
  --out-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/from-prd-auto \
  --feature "0330 乘客端小程序 PRD" \
  --clarifications-confirmed true \
  --clarification-answers output/harness/prd-0330-auto/clarification-answers.md
```

`--clarification-answers` 可选；建议把产品/研发确认结论写入该文件，让澄清结论进入后续候选生成上下文。

也可以用 `clarification-answer.mjs` 从 `review-brief.json` 生成结构化澄清答案，并回写确认状态：

```bash
node vv-automation/harness/runtime/clarification-answer.mjs \
  --review-brief output/harness/prd-0330-auto/review-brief.json \
  --out output/harness/prd-0330-auto/clarification-answers.md \
  --default-answer "本轮按已明确范围生成；未明确规则不生成伪精确用例。" \
  --actor qa-owner
```

### 2. 人工评审用例状态流转

候选用例生成后，P0/P1 默认处于 `pending_review`。使用 `review-queue-update.mjs` 更新评审状态，并同步 `review-queue.json`、`accepted-test-cases.yaml` 和样例 case。

批准单条用例：

```bash
node vv-automation/harness/runtime/review-queue-update.mjs \
  --queue vv-automation/harness/assets/prd-0330-passenger-miniapp/final-generated/review-queue.json \
  --cases vv-automation/harness/assets/prd-0330-passenger-miniapp/final-generated/accepted-test-cases.yaml \
  --case-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/final-generated/case-samples \
  --action approve \
  --case CASE-HARNESS-001 \
  --actor qa-owner \
  --reason "QA reviewed"
```

驳回单条用例：

```bash
node vv-automation/harness/runtime/review-queue-update.mjs \
  --queue vv-automation/harness/assets/prd-0330-passenger-miniapp/final-generated/review-queue.json \
  --cases vv-automation/harness/assets/prd-0330-passenger-miniapp/final-generated/accepted-test-cases.yaml \
  --action reject \
  --case CASE-HARNESS-001 \
  --reason "需求范围已排除"
```

如果人工评审同时认可生成的 Scenario、Fixture、Validator，可增加 `--approve-related-assets true` 并传入相关资产路径。这样 Gate Runner 不会继续因为关联生成资产为 `draft` 而阻断高风险用例。

如果输入已经是文本，可使用：

```bash
node vv-automation/harness/runtime/prd-to-harness.mjs \
  --text-file tmp/pdfs/prd-0330/extracted-clean.txt \
  --work-dir output/harness/prd-0330-auto \
  --out-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/from-prd-auto \
  --feature "0330 乘客端小程序 PRD"
```

PDF 抽取默认优先使用 Codex bundled Python；也可以通过 `--python /path/to/python3` 或 `PRD_TO_HARNESS_PYTHON` 指定包含 `pdfplumber` 的 Python。

### 3. 单独调用生成工具前端规则链路

```bash
node vv-automation/harness/runtime/generator-runpipeline.mjs \
  --text-file tmp/pdfs/prd-0330/extracted-clean.txt \
  --out output/harness/prd-0330/generator-frontend-runpipeline-artifacts.json
```

说明：如果输入是 PDF，当前由 Codex 或外部 PDF 工具先抽取文本，再传给该命令。生成工具页面上传 PDF 时仍走原有 PDFJS 解析链路。

### 4. 将生成工具候选收敛为 Harness 资产

```bash
node vv-automation/harness/runtime/candidate-to-harness.mjs \
  --input output/harness/prd-0330/generator-frontend-runpipeline-artifacts.json \
  --out-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/from-generator \
  --feature "0330 乘客端小程序 PRD"
```

输出：

- `accepted-requirements.yaml`
- `accepted-function-points.yaml`
- `accepted-test-cases.yaml`
- `rejected-candidates.yaml`
- `candidate-quality-report.yaml`
- `runtime-fixture.asset.yaml`
- `runtime-validator.asset.yaml`
- `scenario.asset.yaml`
- `case-samples/*.case.yaml`

### Candidate Quality Gate

`candidate-to-harness.mjs` 当前包含以下收敛检查：

| Gate | 目标 |
|---|---|
| Noise Gate | 过滤背景、目标、章节标题、负责人、依赖说明等非测试对象 |
| Specificity Gate | 保留包含登录、车控、站点、途经点、短信、订阅等业务锚点的候选 |
| Traceability Gate | 要求候选能追溯到需求、验收标准或测试点 |
| Duplicate Gate | 合并高度相似候选 |
| Expected Result Gate | 要求候选具备可验证预期 |

## Gate Runner

`gate-runner.mjs` 是第一版 Harness 质量门禁 CLI，用于把测试资产从“可读 YAML”推进到“可准入检查”。

当前支持 `case` 资产，并会自动解析 Case 中引用的 Scenario、Fixture 和 Validator。

### 运行 smoke 示例

```bash
node vv-automation/harness/runtime/gate-runner.mjs \
  --asset vv-automation/harness/assets/cases/smoke-001-arrival-status-sync.case.yaml \
  --out vv-automation/harness/quality-gates/examples/generated-smoke-001-gate-result.yaml
```

当前 smoke 示例为 P1 且仍处于 `pending_review`，因此 Review Gate 会输出 `blocked`。这是预期结果：P0/P1 未人工评审前不能进入正式执行准入。

### 指定引用资产

```bash
node vv-automation/harness/runtime/gate-runner.mjs \
  --asset vv-automation/harness/assets/cases/smoke-001-arrival-status-sync.case.yaml \
  --scenario vv-automation/harness/assets/scenarios/smoke-001-arrival-status-sync.scenario.yaml \
  --fixture vv-automation/harness/fixtures/smoke-001-arrival-status-sync.fixture.yaml \
  --validator vv-automation/harness/validators/smoke-001-arrival-status-sync.validator.yaml
```

### 当前门禁

| Gate | 当前检查 |
|---|---|
| Schema Gate | Case、Fixture、Validator 的必填字段 |
| Traceability Gate | source、scenario、需求或来源追溯 |
| Fixture Gate | data_scope、isolation、cleanup、PII、明文密钥 |
| Validator Gate | validator 引用、确定性 rules、failure_output、evidence fields |
| Evidence Gate | expected_result.evidence、validator evidence 字段、运行时 evidence 引用 |
| Review Gate | P0/P1 人工评审状态 |
| Reflection Gate | Agent 生成资产是否提供 Critic reflection，未提供时 warning |

### 退出码

- `0`：全部通过或只有可接受的非阻断结果。
- `1`：存在 `failed` 或 `blocked`。
- `2`：命令参数或文件读取异常。

## Execution Runner

`execution-runner.mjs` 是第一版 Harness 执行入口，用于把已经准入的 Case 推进到 mock 执行、确定性校验、Evidence 留存和 Report 聚合。

当前支持 `--adapter mock`，不访问真实 OMS、RAS、乘客端或生产数据。

```bash
node vv-automation/harness/runtime/execution-runner.mjs \
  --case output/harness/harness-smoke/assets/mock-runtime-smoke.case.yaml \
  --adapter mock \
  --out-dir output/harness/harness-smoke \
  --gate true
```

输出：

- `evidence/execution-evidence.json`
- `evidence/execution-evidence.yaml`
- `evidence/validator-results.json`
- `reports/execution-report.json`
- `reports/execution-report.yaml`
- `gates/<case-id>.gate-result.yaml`，当 `--gate true` 时生成
- `execution-summary.json`

执行链路：

```text
Case
  -> Fixture
  -> mock adapter
  -> business validators
  -> Evidence
  -> Report
  -> optional Gate Runner
```

## Harness Smoke

`harness-smoke.mjs` 是项目级冒烟入口。它会在 `output/harness/harness-smoke/` 下生成一套临时 mock 资产，覆盖订单状态、站点推荐、短信/Push 三类 validator，并调用 `execution-runner.mjs` 跑完整执行闭环。

```bash
node vv-automation/harness/runtime/harness-smoke.mjs
```

通过标准：

- mock adapter 执行成功。
- 3 个业务 validator 全部 `passed`。
- Evidence 和 Report 均生成。
- Gate Runner 决策为 `passed`。

该 smoke 不依赖 PRD 生成链路，也不接真实系统，适合作为 Harness runtime/devkit 的基础回归入口。
