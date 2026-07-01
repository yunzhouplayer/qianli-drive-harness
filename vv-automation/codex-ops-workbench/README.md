# Codex Ops Workbench

## 定位

Codex Ops Workbench 是一个本地运维控制台 MVP，用于管理当前 Codex 使用环境、项目 Agent 配置和自建服务运行状态。

它采用轻量 Node 服务 + 静态前端实现，不引入外部依赖。服务启停只允许执行 `services.json` 注册过的命令，前端不能传任意 shell 命令。

## 运行

```bash
cd vv-automation/codex-ops-workbench
node server.mjs
```

默认访问：

```text
http://127.0.0.1:8777/
```

## 首版能力

- 服务注册表：名称、领域、目录、启动命令、端口、健康检查、标签。
- 服务操作：启动、停止、重启、查看日志。
- 服务自启动：工作台启动后自动拉起启用自启动的业务服务。
- 崩溃拉起：服务异常退出后按注册表和运行时配置自动重启。
- 内存泄漏检查：采集 RSS，超过阈值或连续增长超过阈值时标记风险并重启。
- Codex 状态：读取 `CODEX_HOME`、config、plugins、skills、sessions、automations 和本机 Codex 进程线索。
- Agent 状态：读取项目内 Product、Development、Testing、Review、Critic 五类 Agent 配置。
- 用量估算：扫描本地 Codex 日志/会话里的 API 请求、模型和 token 字段。
- 工作台自启动：页面可安装 macOS LaunchAgent，使用 `RunAtLoad + KeepAlive` 保持工作台服务运行。

## 服务注册表

编辑：

```text
vv-automation/codex-ops-workbench/services.json
```

示例字段：

```json
{
  "id": "testcase-generator-web",
  "name": "测试用例生成器",
  "cwd": "vv-automation/test-preparation/testcase-generator-web",
  "command": ["node", "server.mjs"],
  "port": 8765,
  "healthCheck": "http://127.0.0.1:8765/",
  "autostartDefault": false,
  "autoRestartDefault": true,
  "memoryLimitMb": 512,
  "memoryGrowthThresholdMb": 128
}
```

运行时开关保存在：

```text
vv-automation/codex-ops-workbench/.runtime/service-overrides.json
```

该目录已加入 `.gitignore`。

## 自启动说明

“安装自启动”会写入：

```text
~/Library/LaunchAgents/com.qianli.codex-ops-workbench.plist
```

LaunchAgent 会在登录后启动工作台，并通过 `KeepAlive` 在工作台异常退出时拉起。工作台启动后，再根据服务注册表里启用的自启动项拉起业务服务。

如果需要卸载，可以调用：

```bash
curl -X POST http://127.0.0.1:8777/api/workbench/autostart \
  -H 'content-type: application/json' \
  -d '{"action":"uninstall"}'
```

## 验证

启动服务后运行：

```bash
node smoke-test.mjs
```

该测试只读取接口，不会启动、停止或修改业务服务。

## 当前限制

- 模型用量是本地日志估算，不等于官方账单或 workspace credit 统计。
- 精确 Codex usage 需要接入官方 Analytics API 或企业管理侧数据源。
- 服务命令必须是数组形式，且工作目录必须位于当前仓库内。
- 内存泄漏检查基于进程 RSS 采样，适合作为兜底保护，不替代 profiler。
