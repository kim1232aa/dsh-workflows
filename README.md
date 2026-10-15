# dsh-workflows

DeepSeek Harness 插件：把 [`@quintinshaw/pi-dynamic-workflows`](https://www.npmjs.com/package/@quintinshaw/pi-dynamic-workflows) 的动态多智能体 workflow 搬到 dsh（类 Claude Code workflows）。

详细对照与**平台无法实现项**见 [PORTING.md](./PORTING.md)。

## 安装

```bash
dsh plugin --profile <profile> add /path/to/dsh-workflows
# 或 npm pack 后 file:xxx.tgz
```

默认工具名：`dynamic_workflow`（避开 dsh-base 自带的 `workflow`）、`workflow_control`。

## 用法（模型侧）

```js
// dynamic_workflow 参数 script 示例（可含 export const meta，插件会拆掉）
export const meta = {
  name: 'auth_audit',
  description: 'Find routes missing auth',
  phases: [{ title: 'Scan' }, { title: 'Review' }],
}
phase('Scan')
const files = await agent('List route files', { tier: 'small' })
phase('Review')
return await parallel(files.split('\n').filter(Boolean).map((f) =>
  () => agent(`Audit ${f}`, { tier: 'medium' }),
))
```

或 `name: "deep-research"` + `args: { question }` 调内置模式。

## 配置

`tiers.small|medium|big` → `"provider/modelId"`；`savedDir`；`agentRetries`；`maxAgents`。

## 明确做不到的（请先读）

- **git worktree 隔离**（dsh 把 `isolation` 标为 deferred）
- **journaled resume**
- **Pi TUI / keyword trigger / ultracode / effort slash**
- **真实 per-agent token 账单**（仅启发式 `budget`）

证据与原因链接见 PORTING.md §1.C。

## License

MIT。内置模式生成器源码来自上游 MIT（`LICENSE.upstream`）。
