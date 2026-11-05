// Lightweight terminal-native command center. Kept dependency-free to preserve OpenHuddle's
// zero-runtime-dependency install. The hub remains the source of truth; this module is a view.
import { byId, byKey, clip, eventLine } from './format.js';

const ESC = '\x1b[';
const clean = (value, max = 72) => clip(value ?? '', max).replace(/[\r\n\t]/g, ' ');
const status = (member) => {
  const value = String(member?.status || member?.state || 'idle').toLowerCase();
  if (/work|active|busy/.test(value)) return 'WORKING';
  if (/wait|block|ask/.test(value)) return 'WAITING';
  return 'IDLE';
};
const pad = (value, width) => {
  const text = clean(value, Math.max(0, width));
  return text + ' '.repeat(Math.max(0, width - text.length));
};
const bar = (width) => '─'.repeat(Math.max(0, width));

export function renderDashboard(state, events = [], columns = 100) {
  const width = Math.max(50, Math.min(120, Number(columns) || 100));
  const inner = width - 4;
  const left = Math.max(20, Math.floor(inner * 0.38));
  const right = inner - left - 3;
  const title = clean(state?.team?.name || state?.team_name || 'OpenHuddle', inner - 24);
  const members = (state?.members || []).slice(0, 8);
  const tasks = (state?.tasks || []).slice(0, 8);
  const lines = [
    '┌' + bar(inner + 2) + '┐',
    '│ ' + pad('OPENHUDDLE  /  ' + title, inner) + ' │',
    '├' + bar(inner + 2) + '┤',
    '│ ' + pad('TEAM / AGENTS', left) + ' │ ' + pad('LIVE ACTIVITY', right) + ' │',
    '│ ' + bar(left) + ' │ ' + bar(right) + ' │',
  ];
  const activity = events.slice(-8).reverse().map((event) => eventLine(event, byId(state?.members), byKey(state?.tasks)));
  const roster = members.map((m) => {
    const task = tasks.find((t) => t.key === m.task_key || t.assignee_id === m.id);
    return status(m) + '  ' + clean(m.name || m.id, 18) + (task ? ' · ' + clean(task.key, 8) : '');
  });
  const count = Math.max(8, roster.length, activity.length);
  for (let i = 0; i < count; i++) {
    lines.push('│ ' + pad(roster[i] || '', left) + ' │ ' + pad(activity[i] || '', right) + ' │');
  }
  lines.push('├' + bar(inner + 2) + '┤');
  lines.push('│ ' + pad('TASK BOARD', inner) + ' │');
  lines.push('│ ' + bar(inner) + ' │');
  for (const task of tasks) {
    const owner = members.find((m) => m.id === task.assignee_id);
    const label = (task.key || '—') + '  ' + (task.title || '') + '  [' + (task.status || 'open') + ']' + (owner ? ' · ' + owner.name : '');
    lines.push('│ ' + pad(label, inner) + ' │');
  }
  lines.push('├' + bar(inner + 2) + '┤');
  lines.push('│ ' + pad('q quit   r refresh   ? help     Live updates from your OpenHuddle hub', inner) + ' │');
  lines.push('└' + bar(inner + 2) + '┘');
  return lines.join('\n');
}

export async function runTui(api, { stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('The terminal command center needs an interactive TTY. Try openhuddle status or openhuddle watch instead.');
  }
  let state = await api.get('/api/state');
  let events = [];
  let since = Math.max(0, (state.last_event_id ?? 0) - 20);
  const recent = await api.get('/api/events?since=' + since + '&limit=20');
  events = recent.events || [];
  since = recent.last_event_id ?? state.last_event_id ?? since;
  const controller = new AbortController();
  const draw = () => stdout.write(ESC + '2J' + ESC + 'H' + renderDashboard(state, events, stdout.columns));
  const refresh = async () => {
    state = await api.get('/api/state');
    draw();
  };
  const onData = (chunk) => {
    const key = String(chunk);
    if (key === 'q' || key === '\u0003') controller.abort();
    else if (key.toLowerCase() === 'r') refresh().catch(() => {});
    else if (key === '?') stdout.write('\nq quit · r refresh · Ctrl-C quit\n');
  };
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  draw();
  let backoff = 1000;
  try {
    while (!controller.signal.aborted) {
      try {
        await api.stream(since, async (event) => {
          since = Math.max(since, event.id ?? since);
          events.push(event);
          events = events.slice(-30);
          await refresh().catch(() => {});
        }, { signal: controller.signal });
        backoff = 1000;
      } catch {
        if (controller.signal.aborted) break;
        stdout.write('\nConnection lost; retrying…\n');
      }
      if (!controller.signal.aborted) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, backoff);
          controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        backoff = Math.min(backoff * 2, 15000);
      }
    }
  } finally {
    stdin.removeListener('data', onData);
    stdin.setRawMode(false);
    stdin.pause();
    process.removeListener('SIGINT', stop);
    stdout.write(ESC + '0m\n');
  }
  return 0;
}
