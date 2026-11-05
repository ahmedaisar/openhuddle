import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAgentRuntime } from '../src/client/agent-runtime.js';

function fakePty() {
  const terminals = [];
  return { terminals, spawn: () => {
    const listeners = { data: [], exit: [] };
    const terminal = { onData(fn) { listeners.data.push(fn); }, onExit(fn) { listeners.exit.push(fn); }, write() {}, resize() {}, kill() {},
      emitData(data) { for (const fn of listeners.data) fn(data); }, emitExit(exitCode) { for (const fn of listeners.exit) fn({ exitCode }); } };
    terminals.push(terminal); return terminal;
  } };
}

test('captures bounded output and publishes lifecycle events', () => {
  const pty = fakePty(); const runtime = new LocalAgentRuntime({ pty }); const events = [];
  runtime.onEvent((event) => events.push(event.type));
  const session = runtime.start({ provider: 'claude', cwd: '/tmp' });
  const terminal = pty.terminals[0];
  terminal.emitData('first'); terminal.emitData('second');
  assert.equal(runtime.getOutput(session.id), 'firstsecond');
  terminal.emitExit(0);
  assert.deepEqual(events, ['started', 'output', 'output', 'exit']);
});

test('caps output retrieval and rejects unknown sessions', () => {
  const runtime = new LocalAgentRuntime({ pty: fakePty() });
  assert.throws(() => runtime.getOutput('missing'), /Unknown local agent session/);
});