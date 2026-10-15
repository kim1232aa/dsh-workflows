# dsh-workflows 移植对照

> 源：[`@quintinshaw/pi-dynamic-workflows`](https://github.com/QuintinShaw/pi-dynamic-workflows) **v3.14.0**  
> 目标：DeepSeek Harness (dsh) 插件 `/workspace/dsh-workflows`  
> 调研/实测：2026-10-15（Asia/Shanghai）  
> **硬约束：禁止占用/改动端口 3080**（web profile）；测试用独立 `wftest` profile + mock LLM `127.0.0.1:18191`。

证据目录：`test/evidence/`（`readme-matrix.json`、`dsh-e2e.out`、`pi-install.txt`、`unit.txt`）。

---

## 0. 调查摘要

### 0.1 源包（pi-dynamic-workflows）

| 项 | 证据 |
|---|---|
| 形态 | Pi **extension**（非 MCP）；`pi install npm:@quintinshaw/pi-dynamic-workflows` |
| 文档 | [README](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/main/README.md)、[workflow-authoring](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/main/docs/workflow-authoring.md)、[站点](https://quintinshaw.github.io/pi-dynamic-workflows/) |
| 与 Claude | 对齐 [Claude Code dynamic workflows](https://code.claude.com/docs/en/workflows) 的 `agent/parallel/pipeline/phase` 脚本编排；额外有 tier、journaled resume、`/ultracode`、TUI 进度面板等 |
| 本机 | 已安装：见 `test/evidence/pi-install.txt`（`pi list`） |

### 0.2 dsh 平台边界

| 项 | 证据 |
|---|---|
| 官方 workflow 子系统 | [docs/subsystems/workflow.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workflow.md)、[站点](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/workflow) |
| 引擎 | 一上下文 **一个** `ctx.workflowEngine`（`dsh-workflow-ptc`）；消费者 `dsh-tool-workflow` 已注册工具名 `workflow` |
| Guest 原生 globals | `agent` / `parallel` / `pipeline` / `phase` / `log` / `args` **仅这些** |
| `agent()` 支持选项 | 本机 `dsh-workflow-ptc`：`SUPPORTED_AGENT_OPTIONS = label|phase|schema|provider|model` |
| 明确 **Deferred**（会致命拒绝） | `effort` / `isolation` / `agentType`（同文件 `DEFERRED_AGENT_OPTIONS`） |
| 无 | guest 内无 `verify/judgePanel/checkpoint/budget/workflow()/tier/resume` —— 须由插件编译层注入或无法做 |

参考插件形状：`/workspace/dsh-web-access`（`defineTool` + `cordis.patch.yml` + `Config` Schema）。

---

## 1. 三栏清单

### A. 可完整移植（语义对齐 + 已实测）

| README / 能力 | 实现方式 | pi 实测 | dsh 实测 | 一致 |
|---|---|---|---|---|
| `agent(prompt)` | 编译到 dsh native `agent` | runWorkflow+mock ✅ | compile+mock ✅；wftest e2e ✅ | ✅ |
| `parallel(thunks)` | native | ✅ | ✅ | ✅ |
| `pipeline(items, …stages)` | native | ✅ | ✅ | ✅ |
| `phase(title)` / `log(msg)` | native（phase 预算选项忽略） | ✅ | ✅ | ✅ |
| `args` 全局 | `WorkflowStartRequest.args` | ✅ | ✅ | ✅ |
| `meta` 块 | 拆出后作 JSON `meta`（dsh 要求 meta 与 script 分离） | ✅ | ✅ | ✅ |
| `verify` / `judgePanel` / `loopUntilDry` / `completenessCheck` | 编译 prelude 用 `agent+schema+parallel` 复刻 | ✅ | ✅ | ✅ |
| `retry` / `gate` | prelude（**retry 不吞抛错**，与上游一致；用 `until` 重试） | ✅ | ✅ | ✅ |
| `checkpoint`（headless default/abort） | prelude 返回 `default` / abort | ✅ | ✅ | ✅ |
| `budget` / `cwd` / `process.cwd()` | 启发式 spent≈chars/4；cwd 注入 | ✅ | ✅ | ✅ |
| `agent({ label, phase, schema, model })` | 透传 native | ✅ | ✅ | ✅ |
| `agent({ tier })` | Config.tiers → provider/model | mock 映射 ✅ | ✅ | ✅ |
| `agent({ retries })` | prelude 循环 | ✅ | ✅ | ✅ |
| `workflow('name', args)`（字面量名） | 编译期嵌入 saved/builtin | dsh ✅；pi 需 saved 存储 | e2e nested ✅ | 适配见 B |
| 5 个内置模式脚本生成 | vendored generators（MIT） | 5 个 ✅ | 5 个 ✅ | ✅ |
| `dynamic_workflow` 工具 + `workflow_control` | defineTool | — | e2e 调用 ✅ | — |
| 后台 `background:true` | 返回 runId；control status/stop | — | API 已实现 | — |
| 保存/加载脚本 | `~/.dsh-workflows/saved` + `<cwd>/.dsh/workflows` | 对等路径不同 | unit ✅ | 适配路径 |

矩阵证据：`test/evidence/readme-matrix.json`（**17/17 consistent**）。  
dsh 集成证据：`test/evidence/dsh-e2e.out`。

### B. 需适配（能用，但不等同）

| 项 | 原因 | 我们的做法 |
|---|---|---|
| 工具名 | dsh-base 已占用 `workflow` | 默认 `dynamic_workflow`（可 Config 改名） |
| `export const meta` | dsh 引擎禁止 script 内导出 meta，要求请求侧 JSON | `compile()` 拆 meta + 改写 body |
| `workflow('x')` 动态名 | 编译期需静态字面量才能嵌入 | 仅支持字符串字面量；动态名报错 |
| saved 路径 | pi：`~/.pi/...`；dsh：`~/.dsh-workflows/saved` + 项目 `.dsh/workflows` | 文档说明；project > user |
| `tokenBudget` / `budget` | pi 用真实 subagent usage；dsh guest 无 usage API | 字符启发式 + `~` 语义说明 |
| `concurrency` 工具入参 | dsh 引擎自管并发，脚本/工具无法设 16 封顶之外的同名旋钮 | 忽略/不暴露；依赖引擎默认 |
| `agentTimeoutMs` | deferred/非 SUPPORTED | 未透传；依赖宿主取消 |
| UI 进度面板 | pi TUI `/workflows` navigator | 用 `workflow/*` 事件写入 RunRegistry；无交互 TUI |
| slash 命令 `/deep-research` 等 | Pi 命令系统 | 通过 `name:` 调 builtin；无 slash（dsh 命令扩展未做） |
| keyword trigger / `/ultracode` / `/effort` | Pi editor 集成 | **未做**（见 C） |
| `isolation: "worktree"` | dsh 标为 **Deferred**，传入会致命 | **忽略并 log**（不抛），行为=共享 cwd |

### C. 因 dsh 平台限制无法完整实现（须告知用户）

| 项 | 原因（含证据） | 影响 |
|---|---|---|
| **`isolation: "worktree"` 真隔离** | `dsh-workflow-ptc` 将 `isolation` 列入 `DEFERRED_AGENT_OPTIONS`，guest 传入会 `UNSUPPORTED_OPTION` 致命错误。官方 workflow 文档未提供 worktree API。对比：pi 有 [`src/worktree.ts`](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/main/src/worktree.ts)；Claude 有 [worktrees](https://code.claude.com/docs/en/worktrees)。 | 并行改同一文件会冲突；我们吞选项并警告 |
| **`agentType` 命名角色** | 同上 Deferred；pi 扫 `.pi/agents/*.md` | 无法按 agentType 绑工具/人设 |
| **`effort` 选项** | Deferred | `/effort` 级 per-agent 努力度不可用 |
| **Journaled resume / `resumeFromRunId` / `resumeMode`** | dsh `WorkflowStartRequest` 仅有 `script, meta, args, parent, signal, maxTotalAgents, subagentProvider`（[workflow.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workflow.md)）；引擎不暴露 journal 钩子 | 中断后不能零成本重放已完成 agent |
| **真实 token/cost 计量** | guest 拿不到各 child session usage；仅有父侧 jobs/telemetry | `budget` 为启发式 |
| **替换/扩展 guest VM globals** | 一上下文一个 engine；第二引擎替换而非并存；插件不能给 PTC 注入新全局 | 只能 **预编译** 把 helpers 写进 script body |
| **Pi 专有 TUI/slash/keyword/ultracode** | 依赖 Pi coding-agent UI 与命令总线，非 dsh 插件 API | 无 `/workflows` 导航、无自动 keyword 武装、无 standing ultracode |
| **interactive checkpoint UI** | headless/web 无 pi 同款阻塞 UI；dsh 有 ask-user 但是另一套 | 仅 headless default/abort |
| **深嵌套 `workflow()` + 共享 journal** | pi 一帧嵌套 + journal 继承；我们编译期扁平嵌入 | 多级动态嵌套/跨 run resume 不可用 |

---

## 2. README 逐条实测表（摘要）

| README 项 | pi | dsh | 一致？ |
|---|---|---|---|
| agent / parallel / pipeline / phase / log / args | ✅ mock runWorkflow | ✅ compile + wftest | ✅ |
| verify / judgePanel / loopUntilDry / completenessCheck | ✅ | ✅ | ✅ |
| retry / gate / checkpoint / budget / cwd | ✅ | ✅ | ✅ |
| nested workflow('name') | 需 saved 存储（矩阵未挂 storage → pi fail） | ✅ 编译嵌入 | 适配 ✅ |
| isolation worktree | ✅ 在 git 仓创建 worktree | 忽略+日志 | **不等同**（C） |
| 5 builtins 生成器 | ✅ | ✅ vendored | ✅ |
| /workflows TUI、trigger、ultracode、effort | pi 扩展命令（未在本机交互跑） | **不实现** | ❌ 平台限制 |
| journal resume | pi 核心能力 | **不实现** | ❌ 平台限制 |

完整 JSON：`test/evidence/readme-matrix.json`。

---

## 3. 安装与测试

```bash
# 单元
cd /workspace/dsh-workflows && npm test

# README 矩阵（需 /tmp/pi-wf-harness 已 npm i 上游包）
node test/readme-matrix.mjs

# dsh 集成（mock LLM :18191，profile wftest，不动 3080）
node test/e2e/mock-llm.mjs &
dsh plugin --profile wftest add file:$(npm pack -q --pack-destination /tmp)
MOCK_API_KEY=mock dsh wftest "RUN_WF please"
```
