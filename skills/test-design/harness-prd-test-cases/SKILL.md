---
name: harness-prd-test-cases
description: Generate test cases from PRD PDFs or requirement text using the qianli-drive Harness workflow. Use when the user asks to process a PRD, requirement document, product requirement, passenger miniapp requirement, or similar input into test cases, especially requests like "用 Harness 生成测试用例", "根据 PRD 生成测试用例", "输出澄清项/人工评审清单/Excel 用例表", or "run the PRD-to-test-cases workflow".
---

# Harness PRD Test Cases

Use the local qianli-drive Harness workflow to turn a PRD into reviewable test assets and human-readable test-case tables.

## Project Location

Default project root:

```bash
/Users/langwen/Documents/00_workspace/01_qianli-drive-harness
```

If the current working directory is different, `cd` to the project root before running commands.

## Required Input

Accept either:

- `--pdf /absolute/path/to/prd.pdf`
- `--text-file /path/to/extracted-requirements.txt`

If the user gives a PDF with a suspicious title or non-PRD content, still run the intake gate and report the blocked result. Do not force generation unless the user explicitly asks to bypass intake with `--allow-non-prd true`.

## Main Workflow

Run the workflow in two phases. Never generate cases before unresolved clarification items are shown to the user.

### Phase 1: Intake And Clarification

Run first without `--clarifications-confirmed`:

```bash
node vv-automation/harness/runtime/prd-to-harness.mjs \
  --pdf /absolute/path/to/prd.pdf \
  --work-dir output/harness/<short-run-name> \
  --out-dir vv-automation/harness/assets/<short-run-name>/final-generated \
  --feature "<feature name>" \
  --sample-limit 5 \
  --review-limit 30
```

If the result contains `clarificationGate.decision: "blocked"` or `review-brief.md` lists clarification items, stop. Report the clarification items to the user and ask for confirmation. Do not run candidate generation, case export, or gate review yet.

### Phase 2: Generate After Confirmation

After the user answers the clarification items, write the answers to:

```text
output/harness/<short-run-name>/clarification-answers.md
```

Then rerun:

```bash
node vv-automation/harness/runtime/prd-to-harness.mjs \
  --pdf /absolute/path/to/prd.pdf \
  --work-dir output/harness/<short-run-name> \
  --out-dir vv-automation/harness/assets/<short-run-name>/final-generated \
  --feature "<feature name>" \
  --sample-limit 5 \
  --review-limit 30 \
  --clarifications-confirmed true \
  --clarification-answers output/harness/<short-run-name>/clarification-answers.md
```

Use stable, descriptive names:

- `output/harness/prd-0330-final`
- `vv-automation/harness/assets/prd-0330-passenger-miniapp/final-generated`

Avoid overwriting prior useful runs unless the user asks to refresh the same output.

## Output Export

Only after Phase 2 succeeds and `accepted-test-cases.yaml` exists, export readable tables:

```bash
python3 skills/test-design/harness-prd-test-cases/scripts/export_harness_cases.py \
  --input vv-automation/harness/assets/<short-run-name>/final-generated/accepted-test-cases.yaml \
  --out-dir output/harness/<short-run-name>
```

If `python3` lacks `openpyxl`, use the Codex bundled Python when available:

```bash
/Users/langwen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  skills/test-design/harness-prd-test-cases/scripts/export_harness_cases.py \
  --input vv-automation/harness/assets/<short-run-name>/final-generated/accepted-test-cases.yaml \
  --out-dir output/harness/<short-run-name>
```

The script writes:

- `test-cases.md`
- `test-cases.csv`
- `test-cases.xlsx` when `openpyxl` is available
- `test-cases-export-summary.json`

## Mandatory Review Behavior

Always inspect and report:

- `run-summary.md`
- `review-brief.md`
- `review-brief.json`
- `accepted-test-cases.yaml`
- `review-queue.json`

In Phase 1, inspect and report:

- `clarification-gate-result.md` if present
- `review-brief.md`
- `review-brief.json`

Do not state "no clarification needed" solely because the generator returned an empty clarification list. Use the pre-generation Harness clarification gate and review brief as the source of truth because it applies heuristic checks for signals such as:

- 延期 / 顺延
- UE 依赖
- 外部接口依赖
- 模板 ID / 消息模板未明确
- 第三方短信回调
- 站点推荐排序/去重/兜底规则
- 上传大小、数量、失败重试
- 车型能力差异
- 待办项

## Final Response

Answer in Chinese. Include:

- 需求准入是否通过
- 澄清门禁是否通过、阻断或已确认
- 澄清项数量和关键问题
- 原始候选用例数
- Harness 收敛后用例数
- P0/P1/P2 数量
- 人工评审数量
- Markdown/CSV/XLSX/原始 Harness 资产路径
- Whether gate samples are blocked only because of pending review/evidence

If intake is blocked, do not generate fake cases. Explain why and point to `intake-gate-result.md` and `review-brief.md`.

If clarification is blocked, do not generate fake cases. Explain that the next step is user confirmation, list the clarification items, and point to `clarification-gate-result.md` and `review-brief.md`.
