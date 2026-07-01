# 软件测试 V&V 自动化域

本目录服务于软件测试，是 V&V 自动化域的工程承载区。

它负责需求分析、测试策略生成、用例生成、自动化开发、执行反馈、CI/CT 和自动问题回归。

其中 `harness/` 是软件测试执行内核；`test-preparation/`、`test-execution/`、`test-feedback/`、`ci-ct/` 是围绕执行内核展开的业务流程目录。

## 子目录

- `harness/`：测试开发与执行工程底座，管理 runtime、adapter、fixture、validator、evidence、report 和质量门禁。
- `test-preparation/`：产品需求分析、测试策略生成、测试用例生成。
- `test-execution/`：接口自动化、UI 自动化、场景自动化执行组织。
- `test-feedback/`：缺陷分析、报告生成、测试建议。
- `ci-ct/`：自动冒烟、线上巡检、自动问题回归、持续测试。
