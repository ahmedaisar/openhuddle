// Terminal-native, read-only coordination views over the existing authenticated hub API.
import { byId, byKey, clip, eventLine } from './format.js';
import { executeTuiCommand } from './tui-actions.js';

const ESC = '\x1b[';
const clean = (value, max = 72) => clip(value ?? '', max).replace(/[\r\n\t]/g, ' ');
const status = (member) => {
  const detail = member?.status && typeof member.status === 'object' ? member.status : {};
  const value = String(detail.state || detail.status || detail.text || member?.state || '').toLowerCase();
  if (/wait|block|ask/.test(value)) return 'WAITING';
  if (member?.online && (/work|active|busy/.test(value) || detail.task || detail.current_task)) return 'WORKING';
  return member?.online ? 'ONLINE' : 'OFFLINE';
};
const pad = (value, width) => { const text = clean(value, Math.max(0, width)); return text + ' '.repeat(Math.max(0, width - text.length)); };
const bar = (width) => '─'.repeat(Math.max(0, width));
const label = (value) => clean(value, 90);

export function renderDashboard(state, events = [], columns = 100, view = 'team', selected = 0) {
  const width = Math.max(50, Math.min(120, Number(columns) || 100));
  const inner = width - 4;
  const title = clean(state?.team?.name || state?.team_name || 'OpenHuddle', inner - 24);
  const tabs = ['team', 'tasks', 'inbox', 'huddles', 'claims', 'prompt'];
  const rows = [];
  const members = state?.members || [];
  const tasks = state?.tasks || [];
  if (view === 'team') {
    for (const m of members) {
      const key = (m.current_tasks || [])[0];
      const task = tasks.find((t) => t.key === key);
      rows.push(status(m) + '  ' + clean(m.name || m.id, 22) + (task ? ' · ' + clean(task.key, 10) + ' ' + clean(task.title, 32) : ''));
    }
  } else if (view === 'tasks') {
    const order = ['in_progress', 'assigned', 'proposed', 'open', 'done'];
    for (const stateName of order) {
      const group = tasks.filter((t) => t.status === stateName);
      if (group.length) rows.push('[' + stateName.toUpperCase() + ']');
      for (const t of group) {
        const owner = members.find((m) => m.id === t.assignee_id || m.id === t.proposed_id);
        rows.push(t.key + '  ' + clean(t.title, 48) + (owner ? ' · ' + owner.name : '') + (t.ready === false ? ' · BLOCKED' : ''));
      }
    }
  } else if (view === 'inbox') {
    for (const q of state?.asks_for_me || []) rows.push(q.id + '  ' + clean(q.from_name, 18) + ': ' + clean(q.question, 64));
    if (!rows.length) rows.push('No unanswered questions for you.');
  } else if (view === 'huddles') {
    for (const h of state?.huddles || []) rows.push(h.id + '  [' + h.status + '] ' + clean(h.kind, 12) + ' · ' + clean(h.topic, 60) + ' · ' + h.post_count + ' posts');
    if (!rows.length) rows.push('No huddles yet.');
  } else if (view === 'claims') {
    for (const c of state?.claims || []) rows.push(clean(c.path, 58) + ' · ' + clean(c.member_name || c.member_id, 20) + ' · ' + clean(c.task_key || 'unassigned', 12));
    if (!rows.length) rows.push('No active file claims.');
  } else if (view === 'prompt') {
    const p = state?.prompt;
    if (!p) rows.push('Master prompt has not been started.');
    else {
      rows.push('STATE: ' + clean(p.state, 24) + '    VERSION: ' + (p.version ?? '—'));
      if (p.locked_version) rows.push('LOCKED VERSION: ' + p.locked_version);
      for (const section of p.sections || []) rows.push(clean(section.title || section.key, 26) + '  ' + clean(section.body || '(empty)', 64));
      if (p.votes) rows.push('VOTES: ' + Object.keys(p.votes).length);
    }
  }
  const activity = events.slice(-6).reverse().map((event) => eventLine(event, byId(members), byKey(tasks)));
  const lines = [
    '┌' + bar(inner + 2) + '┐',
    '│ ' + pad('OPENHUDDLE  /  ' + title, inner) + ' │',
    '├' + bar(inner + 2) + '┤',
    '│ ' + pad(tabs.map((t, i) => (t === view ? '[' + (i + 1) + ' ' + t.toUpperCase() + ']' : ' ' + (i + 1) + ' ' + t)).join('   '), inner) + ' │',
    '├' + bar(inner + 2) + '┤',
    '│ ' + pad(view.toUpperCase() + '  (' + rows.length + ')', inner) + ' │',
    '│ ' + bar(inner) + ' │',
  ];
  const visible = rows.length ? rows : ['No entries.'];
  for (let i = 0; i < Math.min(visible.length, 12); i++) lines.push('│ ' + pad((i === selected ? '› ' : '  ') + visible[i], inner) + ' │');
  lines.push('├' + bar(inner + 2) + '┤', '│ ' + pad('RECENT ACTIVITY', inner) + ' │');
  for (const line of activity) lines.push('│ ' + pad(line, inner) + ' │');
  lines.push('├' + bar(inner + 2) + '┤', '│ ' + pad('1 Team  2 Tasks  3 Inbox  4 Huddles  5 Claims  6 Prompt   ↑↓ Select   : Command   r Refresh   q Quit', inner) + ' │', '└' + bar(inner + 2) + '┘');
  return lines.join('\n');
}

export async function runTui(api, { stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('The terminal command center needs an interactive TTY. Try openhuddle status or openhuddle watch instead.');
  let state = await api.get('/api/state');
  let events = [];
  let since = Math.max(0, (state.last_event_id ?? 0) - 20);
  const recent = await api.get('/api/events?since=' + since + '&limit=20');
  events = recent.events || [];
  since = recent.last_event_id ?? state.last_event_id ?? since;
  let view = 'team';
  let selected = 0;
  let commandMode = false;
  let commandBuffer = '';
  let notice = '';
  const controller = new AbortController();
  const draw = () => {
    stdout.write(ESC + '2J' + ESC + 'H' + renderDashboard(state, events, stdout.columns, view, selected));
    if (commandMode) stdout.write('\n: ' + commandBuffer + '█');
    else if (notice) stdout.write('\n' + clip(notice, 100));
  };
  const refresh = async () => { state = await api.get('/api/state'); draw(); };
  const onData = (chunk) => {
    const key = String(chunk);
    if (commandMode) {
      if (key === '\r' || key === '\n') {
        const input = commandBuffer;
        commandBuffer = '';
        commandMode = false;
        executeTuiCommand(api, input).then((result) => {
          notice = result?.ask_id ? 'Question sent: ' + result.ask_id : 'Command completed.';
          return refresh();
        }).catch((error) => { notice = 'Command failed: ' + clip(error.message, 90); draw(); });
        draw();
      } else if (key === '\u001b' || key === '\u0003') { commandMode = false; commandBuffer = ''; draw(); }
      else if (key === '\u007f' || key === '\b') { commandBuffer = commandBuffer.slice(0, -1); draw(); }
      else if (key.length === 1 && key >= ' ' && key <= '~' && commandBuffer.length < 240) { commandBuffer += key; draw(); }
      return;
    }
    if (key === 'q' || key === '\u0003') controller.abort();
    else if (key === ':') { commandMode = true; commandBuffer = ''; notice = ''; draw(); }
    else if (/^[1-6]$/.test(key)) { view = ['team','tasks','inbox','huddles','claims','prompt'][Number(key) - 1]; selected = 0; draw(); }
    else if (key === '\u001b[A') { selected = Math.max(0, selected - 1); draw(); }
    else if (key === '\u001b[B') { selected = Math.min(11, selected + 1); draw(); }
    else if (key.toLowerCase() === 'r') refresh().catch(() => {});
    else if (key === '?') stdout.write('\n: command · 1-6 switch views · arrows select · r refresh · q quit\n');
  };
  stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
  const stop = () => controller.abort(); process.once('SIGINT', stop); draw();
  let backoff = 1000;
  try {
    while (!controller.signal.aborted) {
      try {
        await api.stream(since, async (event) => { since = Math.max(since, event.id ?? since); events.push(event); events = events.slice(-30); await refresh().catch(() => {}); }, { signal: controller.signal });
        backoff = 1000;
      } catch { if (controller.signal.aborted) break; stdout.write('\nConnection lost; retrying…\n'); }
      if (!controller.signal.aborted) {
        await new Promise((resolve) => { const timer = setTimeout(resolve, backoff); controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
        backoff = Math.min(backoff * 2, 15000);
      }
    }
  } finally { stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause(); process.removeListener('SIGINT', stop); stdout.write(ESC + '0m\n'); }
  return 0;
}