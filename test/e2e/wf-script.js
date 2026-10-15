export const meta = {
  name: 'e2e_fanout',
  description: 'e2e: tier routing, parallel fan-out, retry, loopUntilDry, nested saved workflow',
  phases: [{ title: 'Fan out' }, { title: 'Combine' }],
}
phase('Fan out')
const outs = await parallel(args.items.map((it) => () => agent('ITEM:' + it, { tier: 'small', label: it, isolation: 'worktree', retries: 1 })))
log('fan-out done: ' + outs.length)
const dry = await loopUntilDry({ round: (r) => r < 2 ? ['a', 'b'] : [], maxRounds: 5 })
const g = await gate((fb, n) => n, (v) => ({ ok: v >= 1, feedback: 'again' }))
phase('Combine')
const sum = await workflow('e2e-child', { xs: outs })
return { outs, dry, gate: g, sum, cwd, budgetSpent: budget.spent() > 0, ck: await checkpoint('go?', { default: 'yes' }) }
