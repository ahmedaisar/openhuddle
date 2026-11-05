import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTuiCommand, parseTuiCommand } from '../src/client/tui-actions.js';

test('parses task and messaging commands into existing API requests', () => {
  assert.deepEqual(parseTuiCommand('task take api-2'), { route: '/api/task', body: { action: 'take', key: 'API-2', note: undefined } });
  assert.deepEqual(parseTuiCommand('ask Pam Can you review this?'), { route: '/api/ask', body: { to: 'Pam', question: 'Can you review this?' } });
  assert.deepEqual(parseTuiCommand('reply q4 Looks good'), { route: '/api/reply', body: { ask_id: 'Q4', answer: 'Looks good' } });
  assert.equal(parseTuiCommand('not-a-command'), null);
});

test('executes only a parsed command through the hub API', async () => {
  const calls = [];
  const api = { post: async (route, body) => { calls.push({ route, body }); return { ok: true }; } };
  await executeTuiCommand(api, 'task start API-1');
  assert.deepEqual(calls, [{ route: '/api/task', body: { action: 'start', key: 'API-1', note: undefined } }]);
  await assert.rejects(() => executeTuiCommand(api, 'rm -rf /'), /Unknown command/);
});