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
    const session = { id: randomUUID().slice(0, 8), provider, cwd: directory, status: 'running', startedAt: this.now(), terminal, exitCode: null };
    this.sessions.set(session.id, session);
    terminal.onExit(({ exitCode }) => { session.status = 'exited'; session.exitCode = exitCode; session.endedAt = this.now(); });
    return this.describe(session);
  }

  describe(session) {
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
    if (session.status === 'running') { session.status = 'stopping'; session.terminal.kill(); }
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