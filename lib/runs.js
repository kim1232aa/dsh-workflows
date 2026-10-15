// In-memory run registry for workflow_control (list/status/stop).
export class RunRegistry {
  constructor(max = 50) { this.runs = new Map(); this.max = max; this.lastScript = undefined }
  add(run, meta, script) {
    const rec = { id: run.id, name: meta.name, status: 'running', startedAt: new Date().toISOString(), run, script, phase: undefined, logs: [], agents: { started: 0, ended: 0 }, members: [] }
    this.runs.set(run.id, rec); this.lastScript = script
    while (this.runs.size > this.max) this.runs.delete(this.runs.keys().next().value)
    run.result.then((r) => { rec.status = r.stopReason ?? 'done'; rec.result = r; rec.endedAt = new Date().toISOString() })
    return rec
  }
  /** pi-style text tree: run → phases → members with status glyphs. */
  tree(r) {
    const g = { running: '◆', completed: '●', failed: '✗', cancelled: '■' }
    const head = `${g[r.status] ?? (r.status === 'running' ? '◆' : '●')} ${r.name}  ${r.id} · ${r.status} · ${r.agents.ended}/${r.agents.started} agents${r.phase ? ' · ' + r.phase : ''}`
    const phases = new Map()
    for (const m of r.members) { const k = m.phase ?? '(no phase)'; if (!phases.has(k)) phases.set(k, []); phases.get(k).push(m) }
    const lines = [head]
    let i = 0
    for (const [ph, ms] of phases) {
      const done = ms.filter((m) => m.outcome).length
      lines.push(`  ${++i} ${ph} ${done}/${ms.length}`)
      for (const m of ms) lines.push(`     ${m.outcome ? (m.outcome === 'completed' ? '●' : '✗') : '◌'} ${m.label}${m.outcome ? ' · ' + m.outcome : ' · running'}`)
    }
    for (const l of r.logs.slice(-5)) lines.push(`  log: ${l}`)
    return lines.join('\n')
  }
  get(id) { return this.runs.get(id) }
  onEvent(id, fn) { const r = this.runs.get(id); if (r) fn(r) }
  summary(r) {
    return { id: r.id, name: r.name, status: r.status, phase: r.phase, agents: r.agents, startedAt: r.startedAt, endedAt: r.endedAt,
      ...(r.result ? { agentsStarted: r.result.agentsStarted, value: r.result.value, error: r.result.error ? String(r.result.error.message ?? r.result.error) : undefined } : {}),
      recentLogs: r.logs.slice(-10) }
  }
}
