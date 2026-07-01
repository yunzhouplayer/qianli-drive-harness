# Clarification Answers

- Source review brief: vv-automation/harness/reports/prd-0330-passenger-miniapp-20260701/review-brief.json
- Answered by: qa-owner
- Answered at: 2026-07-01T07:46:55.076Z
- Confirmed: 10
- Pending: 0

## Answers

### CLARIFY-001

- Source: REQ-SENT-107
- Status: confirmed
- Question: “支持”需要明确可测试阈值或验收标准。
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。

### CLARIFY-SCOPE-001

- Source: scope延期/顺延
- Status: confirmed
- Question: 车控能力中空调/座椅、车门解锁分别出现“延期/顺延”描述，本版本到底哪些车控功能进入 0330 交付范围？
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。

### CLARIFY-DOC-001

- Source: 需求描述/UE依赖
- Status: confirmed
- Question: PRD 写明详细页面内容以 UE 为准，本次生成是否已经包含最终 UE 版本？
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。

### CLARIFY-DEPENDENCY-002

- Source: 功能清单依赖项
- Status: confirmed
- Question: 车辆控制、站点推荐、弹窗、短信等功能存在外部依赖，哪些依赖已 ready，哪些需要 mock 或延后测试？
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。

### CLARIFY-PUSH-001

- Source: 小程序Push/短信模板
- Status: confirmed
- Question: 消息订阅写“至少一个模板，后续再增加”，短信写“5个固定模板”，具体模板 ID、触发场景、文案和跳转页面是什么？
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。

### CLARIFY-SMS-001

- Source: 短信接入/回调
- Status: confirmed
- Question: 短信回调中 messageId、sms_code、渠道标识与业务服务的映射关系和状态枚举是否已有接口定义？
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。

### CLARIFY-STATION-001

- Source: 站点推荐
- Status: confirmed
- Question: 站点推荐的排序、去重、跨区域提示文案、历史记录清理条件和运营配置优先级是否已确定？
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。

### CLARIFY-FEEDBACK-001

- Source: 产品功能反馈
- Status: confirmed
- Question: 图片上传限制是单张 20MB 还是总大小 20MB？上传 6 张后的替换/删除/失败重试规则是什么？
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。

### CLARIFY-VEHICLE-001

- Source: 座椅加热
- Status: confirmed
- Question: 座椅加热低/中/高与实际车辆能力的映射标准是什么？不同车型不支持时如何展示和下发？
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。

### CLARIFY-TODO-001

- Source: 待办项
- Status: confirmed
- Question: PRD 中“行程分享的，安全员信息”标为待办，该项是否纳入 0330 测试范围？
- Answer: 按当前 PRD 文本生成；延期/待办项不纳入本轮准入；缺失 UE/模板/接口/排序/上传/车型映射等按待确认风险处理，不生成伪精确断言。
