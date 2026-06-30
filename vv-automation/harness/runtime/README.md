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

如果输入已经是文本，可使用：

```bash
node vv-automation/harness/runtime/prd-to-harness.mjs \
  --text-file tmp/pdfs/prd-0330/extracted-clean.txt \
  --work-dir output/harness/prd-0330-auto \
  --out-dir vv-automation/harness/assets/prd-0330-passenger-miniapp/from-prd-auto \
  --feature "0330 乘客端小程序 PRD"
```

PDF 抽取默认优先使用 Codex bundled Python；也可以通过 `--python /path/to/python3` 或 `PRD_TO_HARNESS_PYTHON` 指定包含 `pdfplumber` 的 Python。

### 2. 单独调用生成工具前端规则链路

```bash
node vv-automation/harness/runtime/generator-runpipeline.mjs \
  --text-file tmp/pdfs/prd-0330/extracted-clean.txt \
  --out output/harness/prd-0330/generator-frontend-runpipeline-artifacts.json
```

说明：如果输入是 PDF，当前由 Codex 或外部 PDF 工具先抽取文本，再传给该命令。生成工具页面上传 PDF 时仍走原有 PDFJS 解析链路。

### 3. 将生成工具候选收敛为 Harness 资产

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
