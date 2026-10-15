import http from 'node:http'
import { appendFileSync, readFileSync } from 'node:fs'
const LOG = process.env.MOCK_LOG ?? '/tmp/mock-llm.log'
const SCRIPT = readFileSync(new URL('./wf-script.js', import.meta.url), 'utf8')
const write = (s, obj) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify(obj)) }
const flat = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x.text ?? '')).join('') : ''
const allText = (msgs) => msgs.map((m) => flat(m.content)).join('\n')
http.createServer((q, s) => {
  if (q.method === 'GET' && q.url.includes('/models')) return write(s, { data: [{ id: 'mock-1', object: 'model' }] })
  let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    let req = {}; try { req = JSON.parse(b || '{}') } catch {}
    const msgs = req.messages ?? []
    const tools = (req.tools ?? []).map((t) => t.function?.name ?? t.name).filter(Boolean)
    const textAll = allText(msgs)
    const last = msgs[msgs.length - 1] ?? {}
    appendFileSync(LOG, JSON.stringify({ n: msgs.length, tools: tools.slice(0, 8), lastRole: last.role, hasRUN: textAll.includes('RUN_WF'), hasTool: last.role === 'tool', stream: !!req.stream }) + '\n')
    const base = { id: 'chatcmpl-mock', object: 'chat.completion', created: Date.now() / 1000 | 0, model: 'mock-1', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }
    const msg = (content, tool_calls) => write(s, { ...base, choices: [{ index: 0, message: { role: 'assistant', content: content ?? null, ...(tool_calls ? { tool_calls } : {}) }, finish_reason: tool_calls ? 'tool_calls' : 'stop' }] })
    // streaming: emit one-shot non-stream anyway by writing SSE of the same completion
    const reply = (content, tool_calls) => {
      if (!req.stream) return msg(content, tool_calls)
      s.writeHead(200, { 'content-type': 'text/event-stream' })
      if (tool_calls) {
        const tc = tool_calls[0]
        s.write('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } }] }, finish_reason: null }] }) + '\n\n')
        s.write('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: tc.function.arguments } }] }, finish_reason: null }] }) + '\n\n')
        s.write('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + '\n\n')
      } else {
        s.write('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] }) + '\n\n')
        s.write('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
      }
      s.end('data: [DONE]\n\n')
    }
    // title / no-tools
    if (!tools.length) return reply('mock-title')
    // after tool result
    if (last.role === 'tool') return reply('FINAL: ' + flat(last.content).slice(0, 2000))
    // subagent child turns
    if (/ITEM:/.test(textAll)) {
      const m = /ITEM:([^\n]+)/.exec(textAll)
      return reply('processed-' + (m?.[1] ?? 'x').trim())
    }
    if (/skeptical reviewer|Score this attempt|completely covered/.test(textAll)) {
      // structured via JSON in text if no submit tool
      return reply(JSON.stringify({ real: true, reason: 'mock', score: 8, complete: true, missing: [] }))
    }
    if (textAll.includes('RUN_WF') && tools.includes('dynamic_workflow')) {
      return reply(null, [{ id: 'call_wf1', type: 'function', function: { name: 'dynamic_workflow', arguments: JSON.stringify({ script: SCRIPT, args: { items: ['alpha', 'beta', 'gamma'] } }) } }])
    }
    return reply('ok (no RUN_WF)')
  })
}).listen(18191, '127.0.0.1', () => console.log('mock on 18191'))
