// The 5 curated upstream patterns; generator scripts vendored verbatim (MIT) in ./patterns.
import { generateDeepResearchWorkflow, generateCodebaseAuditWorkflow } from './patterns/deep-research.js'
import { generateCodeReviewWorkflow } from './patterns/code-review.js'
import { generateAdversarialReviewWorkflow, generateMultiPerspectiveWorkflow } from './patterns/adversarial-review.js'

export const DEFAULT_MULTI_PERSPECTIVES = ['technical', 'product', 'security', 'user experience', 'maintainability']
const rec = (a) => (a && typeof a === 'object' ? a : {})
const str = (v, k, p) => { if (typeof v !== 'string' || !v.trim()) throw new Error(`Built-in workflow "${p}" requires args.${k} to be a non-empty string.`); return v }
const arr = (v, k, p) => { if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === 'string' && x.trim())) throw new Error(`Built-in workflow "${p}" requires args.${k} to be a non-empty array of strings.`); return v }

export const BUILTINS = [
  { name: 'deep-research', description: 'Source-checked web research. args: { question }', resolve: (a) => (str(rec(a).question, 'question', 'deep-research'), generateDeepResearchWorkflow()) },
  { name: 'adversarial-review', description: 'Findings challenged by skeptical reviewers. args: { task, reviewers?, threshold? }', resolve: (a) => (str(rec(a).task, 'task', 'adversarial-review'), generateAdversarialReviewWorkflow()) },
  { name: 'code-review', description: '7 parallel review angles + verify. args: { diff, diffSource? }', resolve: (a) => (str(rec(a).diff, 'diff', 'code-review'), generateCodeReviewWorkflow()) },
  { name: 'multi-perspective', description: 'Independent angles then synthesis. args: { topic, perspectives? }', resolve: (a) => { const r = rec(a); const t = str(r.topic, 'topic', 'multi-perspective'); return generateMultiPerspectiveWorkflow(t, Array.isArray(r.perspectives) && r.perspectives.length >= 2 ? arr(r.perspectives, 'perspectives', 'multi-perspective') : DEFAULT_MULTI_PERSPECTIVES) } },
  { name: 'codebase-audit', description: 'Parallel checks + cross-validation. args: { scope, checks[] }', resolve: (a) => { const r = rec(a); return generateCodebaseAuditWorkflow(str(r.scope, 'scope', 'codebase-audit'), arr(r.checks, 'checks', 'codebase-audit')) } },
]
export const findBuiltin = (n) => BUILTINS.find((b) => b.name === n)
