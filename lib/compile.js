// Turn a pi-dynamic-workflows script (with `export const meta`, tier/retries/etc.
// agent options, and the extended runtime helpers) into a dsh native workflow
// body that only uses dsh's guest globals: agent/parallel/pipeline/phase/log/args.
import vm from 'node:vm'

const META_RE = /export\s+const\s+meta\s*=\s*\{/

/** Extract `export const meta = {...}` (balanced braces, string-aware) and strip it. */
export function splitMeta(script) {
  const m = META_RE.exec(script)
  if (!m) return { meta: undefined, body: script }
  let i = m.index + m[0].length - 1, depth = 0, q = null
  for (; i < script.length; i++) {
    const c = script[i]
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue }
    if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) break
  }
  const lit = script.slice(m.index + m[0].length - 1, i + 1)
  let end = i + 1
  while (/[\s;]/.test(script[end] ?? '') && script[end] !== '\n') end++
  const meta = vm.runInNewContext('(' + lit + ')', Object.create(null), { timeout: 200 })
  return { meta: JSON.parse(JSON.stringify(meta)), body: script.slice(0, m.index) + script.slice(end) }
}

export function normalizeMeta(meta, fallbackName) {
  const name = String(meta?.name || fallbackName || 'workflow').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64)
  const out = { name, description: String(meta?.description || name) }
  if (meta?.whenToUse) out.whenToUse = String(meta.whenToUse)
  if (Array.isArray(meta?.phases)) out.phases = meta.phases.filter((p) => p && p.title).map((p) => ({ title: String(p.title), ...(p.detail ? { detail: String(p.detail) } : {}) }))
  return out
}

/** Names referenced as workflow('name' ...) literals. */
export function referencedWorkflows(body) {
  return [...body.matchAll(/\bworkflow\(\s*(['"])([\w.-]+)\1/g)].map((m) => m[2])
}

/** Runtime prelude evaluated inside the dsh guest realm. */
export function prelude(opts) {
  const cfg = JSON.stringify({
    tiers: opts.tiers ?? {}, agentRetries: opts.agentRetries ?? 0, tokenBudget: opts.tokenBudget ?? null,
    cwd: opts.cwd ?? '/', maxAgents: opts.maxAgents ?? 1000,
  })
  return String.raw`
const __cfg = ${cfg};
const __agent = agent, __parallel = parallel, __pipeline = pipeline, __phase = phase, __log = log;
const __NATIVE = new Set(['label', 'phase', 'schema', 'provider', 'model']);
const __IGNORED = new Set(['isolation', 'keepWorktree', 'agentType', 'effort', 'timeoutMs', 'tools', 'thinking']);
let __spent = 0;
const __warned = new Set();
function __splitModel(spec) {
  const s = String(spec).replace(/:(off|minimal|low|medium|high|xhigh)$/, '');
  const i = s.indexOf('/');
  return i > 0 ? { provider: s.slice(0, i), model: s.slice(i + 1) } : { model: s };
}
async function __agentX(prompt, options) {
  const o = options || {};
  const native = {};
  for (const [k, v] of Object.entries(o)) {
    if (__NATIVE.has(k)) { if (v !== undefined) native[k] = v; }
    else if (k === 'tier' || k === 'retries') {}
    else if (__IGNORED.has(k)) { if (!__warned.has(k)) { __warned.add(k); __log('[dsh-workflows] agent option "' + k + '" not supported on dsh; ignored'); } }
    else throw new Error('agent(): unknown option "' + k + '"');
  }
  if (native.model) Object.assign(native, __splitModel(native.model));
  else if (o.tier && __cfg.tiers[o.tier]) Object.assign(native, __splitModel(__cfg.tiers[o.tier]));
  const attempts = 1 + Math.max(0, Number(o.retries ?? __cfg.agentRetries) || 0);
  let r = null;
  for (let a = 0; a < attempts; a++) {
    r = await __agent(String(prompt), native);
    if (r !== null && r !== undefined) break;
  }
  __spent += Math.ceil((String(prompt).length + JSON.stringify(r ?? '').length) / 4);
  return r;
}
const __budget = Object.freeze({
  total: __cfg.tokenBudget ?? Infinity,
  spent: () => __spent,
  remaining: () => (__cfg.tokenBudget ?? Infinity) - __spent,
});
function __phaseX(title, _opts) { __phase(String(title)); }
async function __retry(thunk, opts) {
  const n = Math.max(1, (opts && opts.attempts) || 3), until = opts && opts.until;
  let last;
  for (let a = 0; a < n; a++) {
    last = await thunk(a);
    if (!until || until(last)) return last;
  }
  return last;
}
async function __gate(thunk, validator, opts) {
  const n = (opts && opts.attempts) || 3;
  let feedback, value, attempt = 0;
  for (; attempt < n; attempt++) {
    value = await thunk(feedback, attempt);
    const v = await validator(value);
    if (v && v.ok) return { ok: true, value, attempts: attempt + 1 };
    feedback = v && v.feedback;
  }
  return { ok: false, value, attempts: attempt, feedback };
}
const __VOTE = { type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['real'] };
async function __verify(item, opts) {
  const o = opts || {}, n = o.reviewers ?? 2;
  const lenses = Array.isArray(o.lens) ? o.lens : o.lens ? [o.lens] : [];
  const text = typeof item === 'string' ? item : JSON.stringify(item, null, 2);
  const votes = (await __parallel(Array.from({ length: n }, (_, i) => () => __agentX(
    'Adversarially review whether the following is REAL/correct. Try to refute it; default to real=false if unsure.' +
    (lenses.length ? ' Focus lens: ' + lenses[i % lenses.length] + '.' : '') + '\n\nFinding:\n' + text,
    { label: 'verify ' + (i + 1), schema: __VOTE })))).filter(Boolean);
  const realCount = votes.filter((v) => v && v.real).length;
  const threshold = o.threshold ?? 0.5;
  return { real: votes.length > 0 && realCount / votes.length >= threshold, realCount, total: votes.length, votes };
}
const __SCORE = { type: 'object', properties: { score: { type: 'number' }, reason: { type: 'string' } }, required: ['score'] };
async function __judgePanel(attempts, opts) {
  if (!attempts || !attempts.length) return undefined;
  const o = opts || {}, judges = o.judges ?? 3;
  const scored = await __parallel(attempts.map((att, idx) => async () => {
    const js = (await __parallel(Array.from({ length: judges }, (_, j) => () => __agentX(
      'Score this attempt from 0 to 10.' + (o.rubric ? '\nRubric: ' + o.rubric : '') + '\n\nAttempt:\n' + (typeof att === 'string' ? att : JSON.stringify(att, null, 2)),
      { label: 'judge ' + (idx + 1) + '.' + (j + 1), schema: __SCORE })))).filter(Boolean);
    const score = js.length ? js.reduce((s, x) => s + Number(x.score || 0), 0) / js.length : 0;
    return { index: idx, attempt: att, score, judgments: js };
  }));
  return scored.filter(Boolean).sort((a, b) => b.score - a.score)[0];
}
async function __loopUntilDry(opts) {
  const key = opts.key || ((x) => typeof x === 'string' ? x : JSON.stringify(x));
  const need = opts.consecutiveEmpty ?? 1, max = opts.maxRounds ?? 10;
  const seen = new Set(), all = [];
  let empty = 0;
  for (let r = 0; r < max && empty < need; r++) {
    const items = (await opts.round(r)) || [];
    let fresh = 0;
    for (const it of items) { const k = key(it); if (!seen.has(k)) { seen.add(k); all.push(it); fresh++; } }
    empty = fresh ? 0 : empty + 1;
  }
  return all;
}
async function __completenessCheck(taskArgs, results) {
  return __agentX('Given the task and the results gathered so far, list what is still MISSING (modalities not covered, claims unverified, gaps). Be specific and concise.\n\nTask:\n' +
    JSON.stringify(taskArgs, null, 2) + '\n\nResults:\n' + JSON.stringify(results, null, 2),
    { label: 'completeness', schema: { type: 'object', properties: { complete: { type: 'boolean' }, missing: { type: 'array', items: { type: 'string' } } }, required: ['complete'] } });
}
async function __checkpoint(prompt, opts) {
  const o = (prompt && typeof prompt === 'object') ? prompt : (opts || {});
  __log('[checkpoint] ' + (typeof prompt === 'string' ? prompt : (o.checkpointId || o.kind || 'checkpoint')) + ' -> headless default');
  if (o.headless === 'abort') throw new Error('checkpoint aborted (headless)');
  return o.default !== undefined ? o.default : true;
}
const __process = Object.freeze({ cwd: () => __cfg.cwd });
`
}

/**
 * Compile a script (+ nested saved/builtin workflows) into a dsh body.
 * @param resolveNamed (name) => script | undefined
 */
export function compile(script, opts = {}, resolveNamed = () => undefined) {
  const { meta, body } = splitMeta(script)
  const nested = new Map()
  const visit = (b, depth) => {
    for (const n of referencedWorkflows(b)) {
      if (nested.has(n)) continue
      if (depth > 4) throw new Error(`workflow nesting too deep at "${n}"`)
      const s = resolveNamed(n)
      if (s === undefined) throw new Error(`workflow("${n}"): no saved or built-in workflow with that name`)
      const inner = splitMeta(s).body
      nested.set(n, inner)
      visit(inner, depth + 1)
    }
  }
  visit(body, 0)
  const scope = (inner) => `(async (agent, parallel, pipeline, phase, log, args, verify, judgePanel, loopUntilDry, completenessCheck, retry, gate, checkpoint, budget, cwd, process, workflow) => {\n${inner}\n})`
  const call = `(f, a) => f(__agentX, __parallel, __pipeline, __phaseX, __log, a, __verify, __judgePanel, __loopUntilDry, __completenessCheck, __retry, __gate, __checkpoint, __budget, __cfg.cwd, __process, __workflow)`
  const parts = [prelude(opts), `const __call = ${call};`, 'const __wf = {};']
  for (const [n, b] of nested) parts.push(`__wf[${JSON.stringify(n)}] = ${scope(b)};`)
  parts.push(`async function __workflow(name, a) { const f = __wf[name]; if (!f) throw new Error('workflow(' + name + '): not embedded (use a string literal name)'); __log('[workflow] ' + name); return __call(f, a); }`)
  parts.push(`return await __call(${scope(body)}, args);`)
  return { meta, body: parts.join('\n') }
}
