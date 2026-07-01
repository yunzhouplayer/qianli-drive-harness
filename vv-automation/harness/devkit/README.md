# Harness Devkit

Harness Devkit 提供本地开发、冒烟和回归入口。

当前最小入口：

| 命令 | 用途 |
|---|---|
| `node vv-automation/harness/runtime/harness-smoke.mjs` | 项目级 mock adapter 冒烟，验证 runtime、validator、evidence、report、gate 闭环 |
| `node vv-automation/harness/runtime/execution-runner.mjs --case <case> --adapter mock --out-dir <out> --gate true` | 执行单个 Case，并生成 evidence/report/gate result |
| `node vv-automation/harness/runtime/gate-runner.mjs --asset <case>` | 单独运行 Harness 质量门禁 |

## 当前边界

- 只提供 mock adapter，不接真实系统。
- 执行结果用于验证 Harness 工程链路，不作为真实发布准入。
- 真实 adapter 接入后，应保持 execution runner 的输出目录和 evidence/report 结构不变。
