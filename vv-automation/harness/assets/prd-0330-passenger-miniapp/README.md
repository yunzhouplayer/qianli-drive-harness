# 0330 版本乘客端小程序 PRD Harness 资产包

来源：`/Users/langwen/Downloads/0330版本-乘客端小程序PRD.pdf`

本资产包基于 Harness 模板生成，覆盖需求解析、测试功能点、测试策略、测试用例、追溯矩阵、Fixture 和 Validator。

## 产物

- `requirement-analysis.yaml`：需求单元、澄清项、验收标准
- `test-function-points.yaml`：测试功能点清单
- `test-strategy.yaml`：测试策略
- `test-cases.yaml`：测试用例集合，共 40 条
- `traceability-matrix.yaml`：需求-功能点-用例追溯矩阵
- `fixture.yaml`：通用测试数据和环境上下文
- `validator.yaml`：通用确定性校验器

## 当前准入判断

- 需求覆盖率：100%（基于 PDF 文本层和抽样页面渲染）
- 功能点覆盖率：100%
- P0/P1 人工评审：未完成，进入执行前必须评审
- UE 源文件：PRD 声明已评审但未导入仓库，UI 精准验收需补充 UE 链接或截图
- world-sim/真实车云：本轮未接入，车控/短信/推荐类用例需在 mock 或联调环境执行

## 澄清项

1. 增加途经点是否纳入本轮正式上线范围，还是待导航准确性满足后再测。
2. 站点推荐不足 10 条时的展示和补齐规则。
3. 车控接口失败、超时、重复点击的兜底提示口径。
4. 首页弹窗后台配置优先级和频控规则。
