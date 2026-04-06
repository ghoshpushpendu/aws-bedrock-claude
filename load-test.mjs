/**
 * Load test for bedrock-claude-proxy
 * Simulates Claude Code agent usage patterns:
 *   - Concurrent standard requests
 *   - Streaming requests
 *   - Multi-turn agent-style conversations
 *   - Rate limit behavior
 *   - Error recovery
 */

const BASE = 'https://aws-bedrock-claude.onrender.com';
const API_KEY = 'dev1-key';
const HEADERS = { 'Content-Type': 'application/json', 'x-api-key': API_KEY };

let passed = 0, failed = 0;
const timings = [];

function log(label, status, ms, note = '') {
  const icon = status === 'PASS' ? '✓' : '✗';
  console.log(`  ${icon} ${label.padEnd(42)} ${String(ms + 'ms').padStart(7)}${note ? '  ' + note : ''}`);
  if (status === 'PASS') passed++; else { failed++; }
}

async function post(path, body, opts = {}) {
  const t = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
    ...opts,
  });
  const ms = Date.now() - t;
  timings.push(ms);
  return { res, ms, body: res.headers.get('content-type')?.includes('text/event-stream') ? null : await res.json() };
}

// ── 1. Health ────────────────────────────────────────────────────────────────
console.log('\n── Health ──────────────────────────────────────────');
{
  const t = Date.now();
  const r = await fetch(`${BASE}/health`);
  const body = await r.json();
  const ms = Date.now() - t;
  log('GET /health', body.ok ? 'PASS' : 'FAIL', ms);
}

// ── 2. Concurrent standard requests ─────────────────────────────────────────
console.log('\n── Concurrent requests (10 parallel) ───────────────');
{
  const N = 10;
  const requests = Array.from({ length: N }, (_, i) =>
    post('/v1/messages', {
      messages: [{ role: 'user', content: `Reply with only the number ${i + 1}` }],
      max_tokens: 10,
    })
  );
  const results = await Promise.allSettled(requests);
  const durations = [];
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      log(`Concurrent req ${i + 1}`, 'FAIL', 0, r.reason?.message);
    } else {
      const { res, ms, body } = r.value;
      durations.push(ms);
      const ok = res.ok && body?.type === 'message';
      log(`Concurrent req ${i + 1}`, ok ? 'PASS' : 'FAIL', ms, ok ? body.content?.[0]?.text?.slice(0, 20) : JSON.stringify(body).slice(0, 60));
    }
  }
  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  const max = Math.max(...durations);
  const min = Math.min(...durations);
  console.log(`  → latency: avg=${avg}ms  min=${min}ms  max=${max}ms`);
}

// ── 3. Claude Code agent pattern: multi-turn ─────────────────────────────────
console.log('\n── Agent multi-turn conversation ───────────────────');
{
  const turns = [
    { role: 'user', content: 'I am writing a Node.js HTTP server. What module should I use?' },
  ];
  const { res, ms, body } = await post('/v1/messages', { messages: turns, max_tokens: 80 });
  log('Turn 1 (question)', res.ok && body?.type === 'message' ? 'PASS' : 'FAIL', ms);

  if (res.ok) {
    turns.push({ role: 'assistant', content: body.content[0].text });
    turns.push({ role: 'user', content: 'Show me a 5-line minimal example.' });
    const { res: res2, ms: ms2, body: body2 } = await post('/v1/messages', { messages: turns, max_tokens: 120 });
    log('Turn 2 (follow-up)', res2.ok && body2?.type === 'message' ? 'PASS' : 'FAIL', ms2,
      `${body2?.usage?.input_tokens ?? '?'} in / ${body2?.usage?.output_tokens ?? '?'} out tokens`);
  }
}

// ── 4. Streaming (SSE) ───────────────────────────────────────────────────────
console.log('\n── Streaming (SSE) ─────────────────────────────────');
{
  const t = Date.now();
  const res = await fetch(`${BASE}/v1/messages/stream`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }],
      max_tokens: 40,
    }),
  });

  const chunks = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  const ms = Date.now() - t;
  const raw = chunks.join('');
  const hasStart  = raw.includes('message_start');
  const hasDelta  = raw.includes('content_block_delta');
  const hasStop   = raw.includes('message_stop');
  const hasDone   = raw.includes('[DONE]');
  const eventCount = (raw.match(/^event:/gm) || []).length;
  log('SSE message_start',       hasStart  ? 'PASS' : 'FAIL', ms);
  log('SSE content_block_delta', hasDelta  ? 'PASS' : 'FAIL', 0);
  log('SSE message_stop',        hasStop   ? 'PASS' : 'FAIL', 0);
  log('SSE [DONE] sentinel',     hasDone   ? 'PASS' : 'FAIL', 0, `${eventCount} total SSE events`);
}

// ── 5. Large context (agent reads a big file) ────────────────────────────────
console.log('\n── Large context (~2k tokens) ──────────────────────');
{
  const bigContent = `Here is some source code to review:\n\n${`// line of code\nconst x = require('something');\n`.repeat(60)}\n\nSummarise in one sentence what this code does.`;
  const { res, ms, body } = await post('/v1/messages', {
    messages: [{ role: 'user', content: bigContent }],
    max_tokens: 60,
  });
  log('Large context request', res.ok && body?.type === 'message' ? 'PASS' : 'FAIL', ms,
    `${body?.usage?.input_tokens ?? '?'} input tokens`);
}

// ── 6. Rapid sequential (simulates agent tool loop) ──────────────────────────
console.log('\n── Rapid sequential requests (5 back-to-back) ──────');
{
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const { res, ms, body } = await post('/v1/messages', {
      messages: [{ role: 'user', content: `Tool call result ${i + 1}: {"status":"ok"}. Continue.` }],
      max_tokens: 20,
    });
    durations.push(ms);
    log(`Sequential req ${i + 1}`, res.ok && body?.type === 'message' ? 'PASS' : 'FAIL', ms);
  }
  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  console.log(`  → avg latency: ${avg}ms`);
}

// ── 7. Rate limit check ──────────────────────────────────────────────────────
console.log('\n── Rate limit header check ─────────────────────────');
{
  const r = await fetch(`${BASE}/health`);
  const remaining = r.headers.get('ratelimit-remaining');
  const limit = r.headers.get('ratelimit-limit');
  log('RateLimit headers present', limit ? 'PASS' : 'FAIL', 0, `limit=${limit} remaining=${remaining}`);
}

// ── 8. Error handling ────────────────────────────────────────────────────────
console.log('\n── Error handling ──────────────────────────────────');
{
  const r1 = await fetch(`${BASE}/v1/messages`, { method: 'POST', headers: HEADERS, body: 'not-json' });
  log('Malformed JSON → 400', r1.status === 400 ? 'PASS' : 'FAIL', 0, `status=${r1.status}`);

  const { res: r2, body: b2 } = await post('/v1/messages', { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4', max_tokens: 5 });
  log('Disallowed model → 400', r2.status === 400 && b2?.error ? 'PASS' : 'FAIL', 0);

  const r3 = await fetch(`${BASE}/v1/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
  });
  log('Wrong API key → 401', r3.status === 401 ? 'PASS' : 'FAIL', 0);
}

// ── 9. Health after load ─────────────────────────────────────────────────────
console.log('\n── Server health after load ────────────────────────');
{
  const t = Date.now();
  const r = await fetch(`${BASE}/health`);
  const body = await r.json();
  log('GET /health (post-load)', body.ok ? 'PASS' : 'FAIL', Date.now() - t);
}

// ── Summary ──────────────────────────────────────────────────────────────────
const allMs = timings.filter(Boolean);
const p50 = allMs.sort((a,b)=>a-b)[Math.floor(allMs.length * 0.5)];
const p95 = allMs[Math.floor(allMs.length * 0.95)];

console.log('\n════════════════════════════════════════════════════');
console.log(`  Results : ${passed} passed, ${failed} failed`);
console.log(`  Latency : p50=${p50}ms  p95=${p95}ms`);
console.log('════════════════════════════════════════════════════\n');
