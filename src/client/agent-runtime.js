// Local interactive agent sessions. PTY implementation is injected so tests and consumers can
// supply node-pty without forcing a native dependency on every OpenHuddle installation.
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

export const AGENT_PROVIDERS = Object.freeze({
  claude: Object.freeze({ executable: 'claude', args: [] }),
  codex: Object.freeze({ executable: 'codex', args: [] }),
  cursor: Object.freeze({ executable: 'cursor-agent', args: [] }),
});

export async function loadNodePty() {
  try { return await import('node-pty'); }
  catch { throw new Error('Interactive agent sessions require the optional native dependency node-pty. Install it with npm install node-pty.'); }
}

export class LocalAgentRuntime {
  constructor({ pty, env = process.env, now = Date.now } = {}) {
    if (!pty || typeof pty.spawn !== 'function') throw new TypeError('A PTY adapter with spawn() is required.');
    this.pty = pty;
    this.env = env;
    this.now = now;
    this.sessions = new Map();
    this.listeners = new Set();
    this.outputLimit = 200;
  }

  start({ provider, cwd = process.cwd(), cols = 100, rows = 30, env = {} } = {}) {
    const adapter = AGENT_PROVIDERS[provider];
    if (!adapter) throw new Error('Unsupported agent provider. Choose claude, codex, or cursor.');
    const directory = resolve(cwd);
    if (!isAbsolute(directory)) throw new Error('Agent working directory must be absolute.');
    const terminal = this.pty.spawn(adapter.executable, [...adapter.args], {
      name: 'xterm-256color', cols: Math.max(40, Number(cols) || 100), rows: Math.max(10, Number(rows) || 30),
      cwd: directory, env: { ...this.env, ...env }, encoding: 'utf8',
    });
    const session = { id: randomUUID().slice(0, 8), provider, cwd: directory, status: 'running', startedAt: this.now(), terminal, exitCode: null, output: [] };
    this.sessions.set(session.id, session);
    terminal.onData?.((data) => {
      session.output.push(String(data));
      if (session.output.length > this.outputLimit) session.output.splice(0, session.output.length - this.outputLimit);
      this.emit({ type: 'output', session: this.describe(session), data: String(data) });
    });
    terminal.onExit(({ exitCode }) => {
      session.status = 'exited'; session.exitCode = exitCode; session.endedAt = this.now();
      this.emit({ type: 'exit', session: this.describe(session) });
    });
    this.emit({ type: 'started', session: this.describe(session) });
    return this.describe(session);
  }

  emit(event) { for (const listener of this.listeners) { try { listener(event); } catch {} } }\n\n  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }\n\n  getOutput(id, limit = 80) {\n    const session = this.sessions.get(String(id));\n    if (!session) throw new Error('Unknown local agent session: ' + id);\n    return session.output.slice(-Math.max(1, Math.min(200, Number(limit) || 80))).join('');\n  }\n\n  describe(session) {
    return { id: session.id, provider: session.provider, cwd: session.cwd, status: session.status, startedAt: session.startedAt, endedAt: session.endedAt ?? null, exitCode: session.exitCode };
  }

  list() { return [...this.sessions.values()].map((session) => this.describe(session)); }

  write(id, data) {
    const session = this.requireRunning(id);
    session.terminal.write(String(data));
  }

  resize(id, cols, rows) {
    const session = this.requireRunning(id);
    session.terminal.resize(Math.max(40, Number(cols) || 100), Math.max(10, Number(rows) || 30));
  }

  stop(id) {
    const session = this.sessions.get(String(id));
    if (!session) throw new Error('Unknown local agent session: ' + id);
    if (session.status === 'running') { session.status = 'stopping'; this.emit({ type: 'stopping', session: this.describe(session) }); session.terminal.kill(); }
    return this.describe(session);
  }

  requireRunning(id) {
    const session = this.sessions.get(String(id));
    if (!session) throw new Error('Unknown local agent session: ' + id);
    if (session.status !== 'running') throw new Error('Agent session is not running: ' + id);
    return session;
  }

  stopAll() {
    for (const session of this.sessions.values()) if (session.status === 'running') this.stop(session.id);
  }
}
export async function runAgentInTerminal({ provider, cwd = process.cwd(), pty, stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Launching an interactive agent requires a real terminal.');
  }
  const runtime = new LocalAgentRuntime({ pty });
  const session = runtime.start({ provider, cwd, cols: stdout.columns, rows: stdout.rows });
  const terminal = runtime.sessions.get(session.id).terminal;
  let disposeData = null;
  let disposeExit = null;
  const onInput = (chunk) => terminal.write(String(chunk));
  const onResize = () => runtime.resize(session.id, stdout.columns, stdout.rows);
  const stop = () => { try { runtime.stop(session.id); } catch {} };
  const exit = new Promise((resolve) => {
    disposeData = terminal.onData((data) => stdout.write(data));
    disposeExit = terminal.onExit(({ exitCode }) => resolve(Number(exitCode) || 0));
  });
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onInput);
  stdout.on('resize', onResize);
  process.once('SIGTERM', stop);
  try {
    return await exit;
  } finally {
    stdin.removeListener('data', onInput);
    stdout.removeListener('resize', onResize);
    stdin.setRawMode(false);
    stdin.pause();
    process.removeListener('SIGTERM', stop);
    disposeData?.dispose?.();
    disposeExit?.dispose?.();
  }
}
