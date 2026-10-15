/**
 * dsh-workflows — DeepSeek Harness plugin porting @quintinshaw/pi-dynamic-workflows
 * onto dsh's native workflow engine (ctx.workflowEngine).
 */
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { compile, normalizeMeta } from './lib/compile.js'
import { BUILTINS, findBuiltin } from './lib/builtins.js'
import { SavedStore } from './lib/saved.js'
import { RunRegistry } from './lib/runs.js'

export const name = 'dsh-workflows'
export const inject = ['tools', 'workflowEngine']

export const Config = Schema.object({
  toolName: Schema.string().default('dynamic_workflow').description('Name of the workflow tool (dsh-base already ships `workflow`).'),
  controlToolName: Schema.string().default('workflow_control'),
  tiers: Schema.object({ small: Schema.string(), medium: Schema.string(), big: Schema.string() }).default({})
    .description('tier -> "provider/modelId" mapping; unmapped tiers use the parent model.'),
  agentRetries: Schema.natural().default(0),
  maxAgents: Schema.natural().default(1000),
  tokenBudget: Schema.natural().description('Default heuristic token budget exposed via `budget` (chars/4 estimate).'),
  savedDir: Schema.string().description('User saved-workflow dir (default ~/.dsh-workflows/saved).'),
  maxResultChars: Schema.natural().default(20000),
}).i18n({ 'zh-CN': { $description: '动态多智能体 workflow（移植自 pi-dynamic-workflows）。', tiers: '模型档位映射 small/medium/big -> provider/model。' } })

const DESCRIPTION = `Run a JavaScript orchestration script that fans work out across isolated subagents (pi-dynamic-workflows compatible).
Either pass \`script\` or \`name\` (a saved workflow or built-in: ${BUILTINS.map((b) => b.name).join(', ')}).
Script may start with \`export const meta = { name, description, phases: [{ title }] }\`; top-level await; end with \`return <json>\`.
Globals: agent(prompt, { label, phase, schema, model:'provider/id', tier:'small'|'medium'|'big', retries }), parallel([() => agent(..)]), pipeline(items, ...stages),
phase(title), log(msg), args, cwd, budget, verify(item,{reviewers,threshold,lens}), judgePanel(attempts,{judges,rubric}),
loopUntilDry({round,key,consecutiveEmpty,maxRounds}), completenessCheck(taskArgs, results), retry(thunk,{attempts,until}), gate(thunk, validator,{attempts}),
checkpoint(prompt,{default}) (headless: returns default), workflow('savedName', args) (name must be a string literal).
Use only when the user asks for a workflow / large multi-agent orchestration. Set background:true to return a runId immediately; poll with workflow_control.`

function clip(s, n) { return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s }

export function apply(ctx, config = {}) {
  const runs = new RunRegistry()
  const storeFor = (cwd) => new SavedStore({ userDir: config.savedDir, projectDir: cwd ? join(cwd, '.dsh', 'workflows') : undefined })
  const cwdOf = (exec) => exec?.agent?.session?.meta?.cwd ?? process.cwd()
  const resolveNamed = (store, args) => (n) => store.load(n) ?? findBuiltin(n)?.resolve(args)

  ctx.on?.('workflow/phase', (info, title) => runs.onEvent(info.id, (r) => { r.phase = title }))
  ctx.on?.('workflow/log', (info, msg) => runs.onEvent(info.id, (r) => { r.logs.push(msg); if (r.logs.length > 200) r.logs.shift() }))
  ctx.on?.('workflow/agent-start', (info) => runs.onEvent(info.id, (r) => { r.agents.started++ }))
  ctx.on?.('workflow/agent-end', (info) => runs.onEvent(info.id, (r) => { r.agents.ended++ }))

  ctx.tools.register(defineTool({
    name: config.toolName ?? 'dynamic_workflow',
    description: DESCRIPTION,
    parameters: {
      script: { type: 'string', description: 'Workflow JavaScript (pi-dynamic-workflows format).' },
      name: { type: 'string', description: 'Saved or built-in workflow name (used when script is omitted).' },
      args: { type: 'object', additionalProperties: true, description: 'JSON exposed to the script as `args`.' },
      background: { type: 'boolean', description: 'Return runId immediately (default false).' },
      maxAgents: { type: 'integer', description: 'Cap on total agent() calls.' },
      agentRetries: { type: 'integer', description: 'Retries for agent() returning null.' },
      tokenBudget: { type: 'integer', description: 'Heuristic budget exposed as `budget`.' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(input, exec) {
      const parent = exec.agent
      if (!parent) throw new Error('dynamic_workflow requires a calling agent')
      const cwd = cwdOf(exec), store = storeFor(cwd)
      let script = input.script
      if (!script) {
        if (!input.name) throw new Error('pass `script` or `name`')
        script = resolveNamed(store, input.args)(input.name)
        if (!script) throw new Error(`unknown workflow "${input.name}"`)
      }
      const { meta, body } = compile(script, {
        tiers: config.tiers, cwd, agentRetries: input.agentRetries ?? config.agentRetries,
        tokenBudget: input.tokenBudget ?? config.tokenBudget,
      }, resolveNamed(store, input.args))
      const m = normalizeMeta(meta, input.name)
      const run = ctx.workflowEngine.start({
        script: body, meta: m, parent,
        ...(input.args !== undefined ? { args: input.args } : {}),
        maxTotalAgents: input.maxAgents ?? config.maxAgents ?? 1000,
        ...(input.background ? {} : { signal: exec.signal }),
      })
      const rec = runs.add(run, m, script)
      if (input.background) {
        run.result.finally(() => run.dispose().catch(() => {}))
        return `workflow "${m.name}" started in background. runId=${run.id}. Check with ${config.controlToolName ?? 'workflow_control'} {action:"status", runId}.`
      }
      const onAbort = () => run.cancel('parent step aborted')
      exec.signal.addEventListener('abort', onAbort, { once: true })
      try {
        const r = await run.result
        if (r.stopReason !== 'completed') throw new Error(`workflow "${m.name}" ${r.stopReason}: ${r.error ?? ''}`)
        return clip(`workflow "${m.name}" completed (runId=${rec.id}, agents=${r.agentsStarted})\n` + JSON.stringify(r.value, null, 2), config.maxResultChars ?? 20000)
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
        await run.dispose().catch(() => {})
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: config.controlToolName ?? 'workflow_control',
    description: 'Manage dynamic workflows: list | status | stop (runs by runId); saved | save | rm (saved workflows); builtins.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'status', 'stop', 'saved', 'save', 'rm', 'builtins'] },
      runId: { type: 'string' },
      name: { type: 'string', description: 'Saved workflow name (save/rm).' },
      script: { type: 'string', description: 'Script to save (default: latest run script).' },
      scope: { type: 'string', enum: ['user', 'project'] },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(a, exec) {
      const store = storeFor(cwdOf(exec))
      const need = () => { const r = runs.get(a.runId); if (!r) throw new Error('unknown runId ' + a.runId); return r }
      switch (a.action) {
        case 'list': return JSON.stringify([...runs.runs.values()].map((r) => ({ id: r.id, name: r.name, status: r.status, phase: r.phase, agents: r.agents })), null, 2)
        case 'status': return clip(JSON.stringify(runs.summary(need()), null, 2), config.maxResultChars ?? 20000)
        case 'stop': { const r = need(); r.run.cancel('stopped by workflow_control'); return `stop requested for ${r.id}` }
        case 'saved': return JSON.stringify(store.list(), null, 2)
        case 'builtins': return JSON.stringify(BUILTINS.map(({ name, description }) => ({ name, description })), null, 2)
        case 'save': { const s = a.script ?? runs.lastScript; if (!s) throw new Error('no script to save'); return 'saved ' + store.save(a.name, s, a.scope) }
        case 'rm': return store.remove(a.name) ? 'removed ' + a.name : 'not found ' + a.name
      }
      throw new Error('unknown action')
    },
  }))
}
