import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile, splitMeta, normalizeMeta } from '../lib/compile.js'
import { SavedStore } from '../lib/saved.js'
import { findBuiltin, BUILTINS } from '../lib/builtins.js'

test('splitMeta + normalize', () => {
  const { meta, body } = splitMeta("export const meta = { name: 'a', description: 'd', phases: [{ title: 'P' }] }\nreturn 1")
  assert.equal(meta.name, 'a')
  assert.ok(body.includes('return 1'))
  assert.equal(normalizeMeta(meta).phases[0].title, 'P')
})

test('compile nests workflow + maps tier', async () => {
  const child = "export const meta = { name: 'c' }\nreturn args.x"
  const parent = "export const meta = { name: 'p' }\nreturn await workflow('c', { x: 7 })"
  const { body, meta } = compile(parent, { tiers: { small: 'mock/m1' }, cwd: '/tmp' }, (n) => n === 'c' ? child : undefined)
  assert.equal(meta.name, 'p')
  const agentCalls = []
  const agent = async (p, o) => { agentCalls.push({ p, o }); return 'ok' }
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()))
  const pipeline = async () => []
  let phase = ''
  const logs = []
  const fn = new Function('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', `return (async () => { ${body} })()`)
  const r = await fn(agent, parallel, pipeline, (t) => { phase = t }, (m) => logs.push(m), {})
  assert.equal(r, 7)
})

test('builtins all resolve', () => {
  assert.equal(BUILTINS.length, 5)
  assert.ok(findBuiltin('deep-research').resolve({ question: 'q' }).includes('web_search'))
  assert.ok(findBuiltin('code-review').resolve({ diff: 'diff --git a' }).includes('verify'))
  assert.ok(findBuiltin('adversarial-review').resolve({ task: 't' }).includes('agent'))
  assert.ok(findBuiltin('multi-perspective').resolve({ topic: 't' }).includes('perspective'))
  assert.ok(findBuiltin('codebase-audit').resolve({ scope: 'src', checks: ['a'] }).includes('agent'))
})

test('SavedStore project beats user', () => {
  const u = mkdtempSync(join(tmpdir(), 'u-')), p = mkdtempSync(join(tmpdir(), 'p-'))
  const s = new SavedStore({ userDir: u, projectDir: p })
  writeFileSync(join(u, 'x.js'), 'user')
  writeFileSync(join(p, 'x.js'), 'proj')
  assert.equal(s.load('x'), 'proj')
  assert.ok(s.save('y', 'ok').endsWith('y.js'))
  assert.equal(s.remove('y'), true)
})
