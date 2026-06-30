# PRD Review Brief

## Confirmation

9 个需求澄清项已确认；请继续评审 161 条 P0/P1 候选用例。

## Clarification Items

| ID | Source | Question | Impact | Recommended Action |
|---|---|---|---|---|
| CLARIFY-SCOPE-001 | scope延期/顺延 | 车控能力中空调/座椅、车门解锁分别出现“延期/顺延”描述，本版本到底哪些车控功能进入 0330 交付范围？ | 影响 P0 车控用例是否应纳入本版本准入，以及是否需要阻断发布。 | 请产品/项目确认本版本范围：空调、座椅、车门解锁分别标注为本期实现、延期、仅联调或不测试。 |
| CLARIFY-DOC-001 | 需求描述/UE依赖 | PRD 写明详细页面内容以 UE 为准，本次生成是否已经包含最终 UE 版本？ | 缺少 UE 会导致页面元素、文案、布局、跳转入口类用例只能按逻辑描述生成，无法完成 UI 验收。 | 请提供 UE 链接/版本号/关键截图，或确认当前 PRD 文本足以作为测试依据。 |
| CLARIFY-DEPENDENCY-002 | 功能清单依赖项 | 车辆控制、站点推荐、弹窗、短信等功能存在外部依赖，哪些依赖已 ready，哪些需要 mock 或延后测试？ | 影响测试环境准备、用例可执行性、缺陷归因和发布准出。 | 请输出依赖清单：接口负责人、联调环境、mock 策略、不可用时的准出判断。 |
| CLARIFY-PUSH-001 | 小程序Push/短信模板 | 消息订阅写“至少一个模板，后续再增加”，短信写“5个固定模板”，具体模板 ID、触发场景、文案和跳转页面是什么？ | 影响 Push/短信用例的覆盖矩阵、断言字段和验收口径。 | 请补充模板清单：模板 ID、触发事件、变量字段、文案、跳转目标、失败重试规则。 |
| CLARIFY-SMS-001 | 短信接入/回调 | 短信回调中 messageId、sms_code、渠道标识与业务服务的映射关系和状态枚举是否已有接口定义？ | 影响短信发送成功/失败统计、幂等、重试、数据一致性和异常回归用例。 | 请提供火山云回调字段说明、内部接口协议、状态枚举、幂等键和失败处理规则。 |
| CLARIFY-STATION-001 | 站点推荐 | 站点推荐的排序、去重、跨区域提示文案、历史记录清理条件和运营配置优先级是否已确定？ | 影响推荐列表正确性、边界条件和数据准备。 | 请确认推荐规则：历史/热门/附近站点数量、排序、去重、无数据兜底、跨区域提示文案。 |
| CLARIFY-FEEDBACK-001 | 产品功能反馈 | 图片上传限制是单张 20MB 还是总大小 20MB？上传 6 张后的替换/删除/失败重试规则是什么？ | 影响反馈页边界值、异常上传、弱网和数据完整性用例。 | 请确认图片大小口径、数量限制、删除/重传规则、失败后的缓存与提交策略。 |
| CLARIFY-VEHICLE-001 | 座椅加热 | 座椅加热低/中/高与实际车辆能力的映射标准是什么？不同车型不支持时如何展示和下发？ | 影响车云一致性断言、车型差异和兼容性测试。 | 请确认车型能力矩阵、温度档位映射、不可用状态展示和接口错误处理。 |
| CLARIFY-TODO-001 | 待办项 | PRD 中“行程分享的，安全员信息”标为待办，该项是否纳入 0330 测试范围？ | 影响分享用例是否需要覆盖安全员信息，以及待办未完成时是否影响准出。 | 请确认待办项归属版本、验收标准和未完成时的发布判断。 |

## Manual Review Cases

| ID | Risk | Review | Title | Traceability | Expected Result |
|---|---|---|---|---|---|
| CASE-HARNESS-001 | P0 | pending_review | 车控：对于空调、座椅移动端控制的能⼒ | REQ-SENT-002, TP-003 | 控制指令下发成功，用户可见反馈、云端接口返回和车端状态保持一致。 |
| CASE-HARNESS-002 | P0 | pending_review | push：能⼒，新增“短信”和小程序消息订阅能⼒的搭建 | REQ-SENT-004, TP-007 | 短信发送请求、服务商响应和用户收到内容一致，失败链路有记录或降级处理。 |
| CASE-HARNESS-003 | P0 | pending_review | 用户登录：登录页优化，登录 | REQ-SENT-005, TP-009 | 用户登录成功后进入正确页面，登录态稳定保存，失败场景有明确提示。 |
| CASE-HARNESS-004 | P0 | pending_review | 车辆控制：座椅控制、空调 | REQ-SENT-006, TP-011 | 控制指令下发成功，用户可见反馈、云端接口返回和车端状态保持一致。 |
| CASE-HARNESS-005 | P1 | pending_review | 功能反馈：产品功能反馈 | REQ-SENT-007, TP-013 | 系统行为与验收标准一致，关键状态和用户可见反馈正确。 |
| CASE-HARNESS-006 | P1 | pending_review | 增加途经点：智驾云接⼝ | REQ-SENT-008, TP-015 | 途经点被正确保存到行程路线和订单数据中，顺序及展示一致。 |
| CASE-HARNESS-007 | P1 | pending_review | 小程序所有页面的分享 | REQ-SENT-009, TP-017 | 系统行为与验收标准一致，关键状态和用户可见反馈正确。 |
| CASE-HARNESS-008 | P1 | pending_review | 站点推荐：下车站点推荐页面，列表的推荐（历 对 | REQ-SENT-010, TP-019 | 推荐列表展示正确，用户选择后目的地或下车点按推荐站点更新。 |
| CASE-HARNESS-009 | P1 | pending_review | 行程管理：基于目的地的增加途经点 | REQ-SENT-011, TP-021 | 途经点被正确保存到行程路线和订单数据中，顺序及展示一致。 |
| CASE-HARNESS-010 | P0 | pending_review | 小程序Push：消息模板（至少⼀个模板，先实 | REQ-SENT-012, TP-023 | 订阅授权和模板消息发送链路正常，消息内容、跳转和接收状态正确。 |
| CASE-HARNESS-011 | P0 | pending_review | 登录icon | REQ-SENT-015, TP-029 | 用户登录成功后进入正确页面，登录态稳定保存，失败场景有明确提示。 |
| CASE-HARNESS-012 | P1 | pending_review | 产品功能反馈页面 | REQ-SENT-016, TP-031 | 系统行为与验收标准一致，关键状态和用户可见反馈正确。 |
| CASE-HARNESS-013 | P1 | pending_review | 增加途经点-icon | REQ-SENT-017, TP-033 | 途经点被正确保存到行程路线和订单数据中，顺序及展示一致。 |
| CASE-HARNESS-014 | P1 | pending_review | 全局默认分享卡⽚信息 | REQ-SENT-020, TP-039 | 系统行为与验收标准一致，关键状态和用户可见反馈正确。 |
| CASE-HARNESS-015 | P1 | pending_review | 站点推荐：历史搜索记录 | REQ-SENT-021, TP-041 | 推荐列表展示正确，用户选择后目的地或下车点按推荐站点更新。 |
| CASE-HARNESS-016 | P0 | pending_review | 行程分享的，安全员信息 | REQ-SENT-026, TP-051 | 系统行为与验收标准一致，关键状态和用户可见反馈正确。 |
| CASE-HARNESS-017 | P0 | pending_review | 登录页优化： | REQ-SENT-027, TP-053 | 用户登录成功后进入正确页面，登录态稳定保存，失败场景有明确提示。 |
| CASE-HARNESS-018 | P0 | pending_review | 新增：登录icon | REQ-SENT-028, TP-055 | 用户登录成功后进入正确页面，登录态稳定保存，失败场景有明确提示。 |
| CASE-HARNESS-019 | P0 | pending_review | 点击：登录icon | REQ-SENT-029, TP-057 | 用户登录成功后进入正确页面，登录态稳定保存，失败场景有明确提示。 |
| CASE-HARNESS-020 | P0 | pending_review | "登录页-⼿机快捷登录" | REQ-SENT-030, TP-059 | 用户登录成功后进入正确页面，登录态稳定保存，失败场景有明确提示。 |
| CASE-HARNESS-021 | P0 | pending_review | 登录页-⼿ 【⾸页】 | REQ-SENT-031, TP-061 | 用户登录成功后进入正确页面，登录态稳定保存，失败场景有明确提示。 |
| CASE-HARNESS-022 | P0 | pending_review | ⼿机快捷登录按钮，向下移动 | REQ-SENT-032, TP-063 | 用户登录成功后进入正确页面，登录态稳定保存，失败场景有明确提示。 |
| CASE-HARNESS-023 | P0 | pending_review | 订单完成 【送驾页面】 | REQ-SENT-037, TP-073 | 订单创建成功，车辆匹配和订单状态展示正确，无车场景给出明确失败提示。 |
| CASE-HARNESS-024 | P1 | pending_review | 系统触发：车到了就触发解锁弹窗 | REQ-SENT-038, TP-075 | 系统行为与验收标准一致，关键状态和用户可见反馈正确。 |
| CASE-HARNESS-025 | P1 | pending_review | 主动点击解锁bat:触发解锁弹窗 | REQ-SENT-039, TP-077 | 系统行为与验收标准一致，关键状态和用户可见反馈正确。 |
| CASE-HARNESS-026 | P0 | pending_review | （订单结束后、空调为，关闭状态） | REQ-SENT-043, TP-085 | 订单创建成功，车辆匹配和订单状态展示正确，无车场景给出明确失败提示。 |
| CASE-HARNESS-027 | P1 | pending_review | 关闭：关闭后弹窗消失，不保存 | REQ-SENT-044, TP-087 | 系统行为与验收标准一致，关键状态和用户可见反馈正确。 |
| CASE-HARNESS-028 | P0 | pending_review | 点击：空调icon，进⼊座椅弹窗 | REQ-SENT-045, TP-089 | 控制指令下发成功，用户可见反馈、云端接口返回和车端状态保持一致。 |
| CASE-HARNESS-029 | P0 | pending_review | （订单结束后、座椅为，不加热状态） | REQ-SENT-046, TP-091 | 订单创建成功，车辆匹配和订单状态展示正确，无车场景给出明确失败提示。 |
| CASE-HARNESS-030 | P1 | pending_review | 5 产品功能反馈： | REQ-SENT-047, TP-093 | 系统行为与验收标准一致，关键状态和用户可见反馈正确。 |

