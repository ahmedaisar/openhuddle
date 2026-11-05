import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAgentRuntime, AGENT_PROVIDERS } from '../src/client/agent-runtime.js';

function fakePty() {
  const calls = [];
  return { calls, spawn: (file, args, options) => {
    const terminal = { writes: [], onExit(fn) { this.exit = fn; }, write(data) { this.writes.push(data); }, resize(cols, rows) { this.size = [cols, rows]; }, kill() { this.killed = true; } };
    calls.push({ file, args, options, terminal }); return terminal;
  } };
}

test('starts allowlisted agents in a PTY and supports input and resize', () => {
  const pty = fakePty(); const runtime = new LocalAgentRuntime({ pty, env: { PATH: '/bin' }, now: () => 123 });
  const session = runtime.start({ provider: 'codex', cwd: '/tmp/project', cols: 20, rows: 5 });
  assert.equal(pty.calls[0].file, AGENT_PROVIDERS.codex.executable);
  assert.equal(pty.calls[0].options.cols, 40);
  runtime.write(session.id, 'hello\r'); runtime.resize(session.id, 120, 40);
  assert.deepEqual(pty.calls[0].terminal.writes, ['hello\r']);
  assert.deepEqual(pty.calls[0].terminal.size, [120, 40]);
});

test('rejects unknown providers and prevents writes after exit', () => {
  const pty = fakePty(); const runtime = new LocalAgentRuntime({ pty });
  assert.throws(() => runtime.start({ provider: 'shell' }), /Unsupported agent provider/);
  const session = runtime.start({ provider: 'claude', cwd: '/tmp' });
  pty.calls[0].terminal.exit({ exitCode: 0 });
  assert.equal(runtime.list()[0].status, 'exited');
  assert.throws(() => runtime.write(session.id, 'x'), /not running/);
});

test('stop is idempotent for an active session and stopAll terminates remaining sessions', () => {
  const pty = fakePty(); const runtime = new LocalAgentRuntime({ pty });
  const first = runtime.start({ provider: 'claude', cwd: '/tmp' });
  runtime.stop(first.id); runtime.stop(first.id);
  assert.equal(pty.calls[0].terminal.killed, true);
  const second = runtime.start({ provider: 'codex', cwd: '/tmp' });
  runtime.stopAll();
  assert.equal(runtime.list().find((s) => s.id === second.id).status, 'stopping');
});