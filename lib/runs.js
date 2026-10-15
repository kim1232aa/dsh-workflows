// In-memory run registry for workflow_control (list/status/stop).
export class RunRegistry {
  constructor(max = 50) { this.runs = new Map(); this.max = max; this.lastScript = undefined }
  add(run, meta, script) {
    const rec = { id: run.id, name: meta.name, status: 'running', startedAt: new Date().toISOString(), run, script, phase: undefined, logs: [], agents: { started: 0, ended: 0 } }
    this.runs.set(run.id, rec); this.lastScript = script
    while (this.runs.size > this.max) this.runs.delete(this.runs.keys().next().value)
    run.result.then((r) => { rec.status = r.stopReason ?? 'done'; rec.result = r; rec.endedAt = new Date().toISOString() })
    return rec
  }
  get(id) { return this.runs.get(id) }
  onEvent(id, fn) { const r = this.runs.get(id); if (r) fn(r) }
  summary(r) {
    return { id: r.id, name: r.name, status: r.status, phase: r.phase, agents: r.agents, startedAt: r.startedAt, endedAt: r.endedAt,
      ...(r.result ? { agentsStarted: r.result.agentsStarted, value: r.result.value, error: r.result.error ? String(r.result.error.message ?? r.result.error) : undefined } : {}),
      recentLogs: r.logs.slice(-10) }
  }
}
