#!/usr/bin/env node
'use strict';
const net = require('net');
// Under the listener's 256 KB frame limit (core/hookServer.ts MAX_HOOK_FRAME_BYTES), with room for the office token.
const HOOK_FRAME_ROOM = 200 * 1024;
const HOOK_FRAME_KEEP = ['ping', 'hive_launch_agent', 'hive_hook_token', 'hook_event_name', 'agent_id', 'session_id', 'transcript_path', 'context_window', 'rate_limits', 'cwd', 'tool_name', 'stop_hook_active', 'prompt', 'source', 'notification_type', 'message', 'model', 'agent_type', 'input', 'output', 'cache_read', 'cache_creation'];
// UTF-8 bytes of the frame; counted by hand where a host gives no Buffer (an extension run in a bare context). A
// payload that cannot be written as JSON counts 0: it is left as it is, and its sender drops it as before.
function hookFrameBytes(p) {
  let s;
  try { s = JSON.stringify(p); } catch (e) { return 0; }
  if (typeof s !== 'string') return 0;
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(s);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
function fitFrame(p) {
  if (!p || typeof p !== 'object') return p;
  delete p.tool_response;
  if (hookFrameBytes(p) <= HOOK_FRAME_ROOM) return p;
  delete p.tool_input;
  ['prompt', 'prompt_response', 'last_assistant_message', 'message'].forEach(function (k) {
    if (typeof p[k] === 'string') p[k] = p[k].slice(-4096);
  });
  if (hookFrameBytes(p) <= HOOK_FRAME_ROOM) return p;
  Object.keys(p).forEach(function (k) {
    if (HOOK_FRAME_KEEP.indexOf(k) === -1) delete p[k];
    else if (typeof p[k] === 'string') p[k] = p[k].slice(-4096);
  });
  return p;
}
const event = process.argv[2] || 'Unknown';
const agentId = process.env.AGENT_ID || null;
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { data += d; });
process.stdin.on('end', () => {
  const sock = process.env.HIVE_SOCK;
  if (!agentId || !sock) { process.exit(0); } // not a hive worker → ignore
  let agy = {};
  try { agy = JSON.parse(data || '{}'); } catch (_) {}
  const tc = agy.toolCall || {};
  const payload = {
    hook_event_name: event,
    agent_id: agentId,
    session_id: agy.conversationId,
    transcript_path: agy.transcriptPath,
    cwd: Array.isArray(agy.workspacePaths) ? agy.workspacePaths[0] : undefined,
    tool_name: tc.name,
    tool_input: tc.args,
    model: typeof agy.modelName === 'string' ? agy.modelName : undefined
  };
  fitFrame(payload);
  // A Cloud Office starts each terminal with a token of its own; its listener takes an event only with it, for the
  // agent this terminal was started as (core/hookServer.ts admit), and refuses one without it (no-agent-token). The
  // office hands over the PATH of the file that holds it (MD_OFFICE_HOOK_TOKEN_FILE), never the token. Sent on the
  // socket alone. Absent on a laptop, where nothing is added (M30-426: every Grok event in an office was refused).
  let officeToken = process.env.MD_OFFICE_HOOK_TOKEN || '';
  if (!officeToken && process.env.MD_OFFICE_HOOK_TOKEN_FILE) {
    try { officeToken = require('fs').readFileSync(process.env.MD_OFFICE_HOOK_TOKEN_FILE, 'utf8').trim(); } catch (_) {}
  }
  if (officeToken) { payload.hive_launch_agent = agentId; payload.hive_hook_token = officeToken; }
  let resp = '';
  const done = () => {
    // Translate the HookServer's Claude-shaped reply into agy's contract. CRITICAL:
    // agy treats ANY object written to stdout as a decision and FAIL-CLOSES (an
    // empty/decision-less object = DENY). So emit JSON ONLY when there's a real
    // directive (deny/block/steer); otherwise write NOTHING — no output = allow.
    // Each event answers in its own words (agy's hooks guide, M30-186): a tool
    // is refused by "deny" and context goes in as an injected step; "block" is
    // no word of agy's. A Stop writes nothing: the HookServer never keeps an
    // agent going at Stop (its mail waits for the idle delivery).
    let out = null;
    try {
      const r = JSON.parse(resp || '{}');
      const h = r.hookSpecificOutput || {};
      const reason = r.reason || r.stopReason || h.permissionDecisionReason || undefined;
      if (event === 'PreToolUse') {
        if (r.decision === 'block' || h.permissionDecision === 'deny' || r.continue === false) out = { decision: 'deny', reason: reason };
      } else if (event === 'PreInvocation' || event === 'PostInvocation' || event === 'SessionStart') {
        const steps = h.additionalContext ? [{ ephemeralMessage: h.additionalContext }] : [];
        if (event === 'PostInvocation' && r.continue === false) out = { injectSteps: steps, terminationBehavior: 'terminate' };
        else if (steps.length) out = { injectSteps: steps };
      }
    } catch (_) {}
    if (out) { try { process.stdout.write(JSON.stringify(out)); } catch (_) {} }
    process.exit(0);
  };
  try {
    const c = net.createConnection(sock, () => c.write(JSON.stringify(payload) + '\n'));
    c.setEncoding('utf8');
    c.on('data', (d) => { resp += d; });
    c.on('end', done);
    c.on('error', () => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  } catch (_) { process.exit(0); }
});
