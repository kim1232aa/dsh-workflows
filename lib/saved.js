// Saved workflows: project (<cwd>/.dsh/workflows) beats user (~/.dsh-workflows/saved).
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SAFE = /^[a-zA-Z0-9_-]{1,64}$/
export class SavedStore {
  constructor({ userDir, projectDir } = {}) {
    this.userDir = userDir ?? join(homedir(), '.dsh-workflows', 'saved')
    this.projectDir = projectDir
  }
  dirs() { return [this.projectDir, this.userDir].filter(Boolean) }
  load(name) {
    if (!SAFE.test(name)) return undefined
    for (const d of this.dirs()) { const f = join(d, name + '.js'); if (existsSync(f)) return readFileSync(f, 'utf8') }
    return undefined
  }
  save(name, script, scope = 'user') {
    if (!SAFE.test(name)) throw new Error('invalid workflow name: ' + name)
    const d = scope === 'project' && this.projectDir ? this.projectDir : this.userDir
    mkdirSync(d, { recursive: true }); const f = join(d, name + '.js'); writeFileSync(f, script); return f
  }
  remove(name) {
    if (!SAFE.test(name)) return false
    for (const d of this.dirs()) { const f = join(d, name + '.js'); if (existsSync(f)) { rmSync(f); return true } }
    return false
  }
  list() {
    const out = new Map()
    for (const d of this.dirs().reverse()) { try { for (const f of readdirSync(d)) if (f.endsWith('.js')) out.set(f.slice(0, -3), join(d, f)) } catch {} }
    return [...out].map(([name, path]) => ({ name, path }))
  }
}
