# 界面展示对照（pi TUI vs dsh）

证据均在本目录。pi 在 tmux 中运行（隔离 `PI_CODING_AGENT_DIR=/tmp/piagent`，mock LLM :18191）；dsh 在 `wftest` profile 用 `--port 3192`（**不用 3080**），headless Chrome 截图。

| pi 原包界面 | pi 证据 | dsh-workflows 实现 | dsh 证据 | 状态 |
|---|---|---|---|---|
| 工具结果卡（后台启动提示 + runId + /workflows 提示） | `pi-tui-running-2.txt` | 工具调用行 `dynamic_workflow` + 结果文本 | `dsh-web-done.png` | ✅ |
| 编辑器上方 **常驻进度 widget**「Workflows running (N): ◆ name x/y agents · phase」 | `pi-tui-running-2.txt`、`pi-tui-result.txt` | dsh 原生 **workflow-run 聊天节点**：运行名 · 成员数 · Running/Completed，按 phase 分组，成员实时转圈→完成 | `dsh-web-run-fanout.png`、`dsh-web-run-combine.png` | ✅ 等价（位置不同：在对话流里而非输入框上方） |
| `/workflows` 交互导航器（运行列表 ✗/● 状态、↑↓/过滤/p 暂停/x 停/r 重启/s 保存） | `pi-tui-navigator.txt` | `/workflows list|status|stop|save|builtins` 斜杠命令，输出 pi 同款文字树 | `dsh-web-slash-workflows.png`、`dsh-slash-workflows.txt` | ⚠ 文字版，非交互 |
| 运行详情：Phases 侧栏 + 每 agent 模型 + tok | `pi-tui-navigator-run.txt` | 节点内 phase→成员；成员可点开子 Session；顶部「N subagents」 | `dsh-web-run-fanout.png` | ⚠ 无每 agent 模型/tok 列 |
| 结果自动回投到对话 `[workflow-result]` | `pi-tui-running.ansi` | 前台模式直接作为工具结果返回 | `dsh-web-done.png` | ✅（后台模式无自动回投，见下） |

## 做不到 / 只能部分做（原因 + 证据）

| 项 | 原因 | 证据 |
|---|---|---|
| 输入框上方常驻 widget / 状态栏 | dsh 插件是 cordis 服务端插件；web UI 由 `dsh-client-ui-*` 前端包组成，第三方插件没有公开的「注入状态栏/面板」服务端 API；只能通过会话记录被已有前端节点渲染 | `dsh-client-ui-workflow-run/README.md`（"identities and statuses only; scripts, outputs, errors, logs, usage, topology, and controls remain outside this surface"） |
| 节点内显示 log / 每 agent tok / 模型 / 暂停按钮 | 同上 README 明确 logs/usage/controls 不在该节点 | 同上 |
| 交互式导航器（键盘选择、p/x/r） | dsh 命令 `CommandResult` 只有 `{kind, text}` | `dsh-commands/lib/types/types.d.ts` |
| 暂停/恢复 | `WorkflowRun` 只有 `cancel/dispose` | [workflow.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workflow.md) |
| 自写前端包 | 理论可写 `dsh-client-ui-*` 前端插件，但需 dsh 前端构建链/HMR 与内部 slot API（预览期未稳定），本轮未做 | `dsh-client-ui-slots` 等包 |

实现方式：插件以 `dsh-tool-workflow` 相同的协议写会话记录 `tool-workflow/run-start|agent-start|agent-end|run-end`（`index.js` recordStart），因此 dsh 自带 `dsh-client-ui-workflow-run` 直接渲染我们的运行。
