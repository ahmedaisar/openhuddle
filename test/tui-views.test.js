import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard } from '../src/client/tui.js';

const state = {
  team: { name: 'Platform' },
  members: [{ id: 'm1', name: 'Michael', online: true, current_tasks: ['API'], status: { activity: 'Implementing endpoint' } }],
  tasks: [{ key: 'API', title: 'Build endpoint', status: 'in_progress', assignee_id: 'm1', ready: true }],
  asks_for_me: [{ id: 'Q4', from_name: 'Pam', question: 'Can you review the schema?' }],
  huddles: [{ id: 'H2', status: 'open', kind: 'design', topic: 'API shape', post_count: 3 }],
  claims: [{ path: 'src/api.js', member_name: 'Michael', task_key: 'API' }],
  prompt: { state: 'draft', version: 2, sections: [{ title: 'Goals', body: 'Ship the API' }] },
};
test('terminal coordination views render their hub state', () => {
  assert.match(renderDashboard(state, [], 100, 'team'), /Michael/);
  assert.match(renderDashboard(state, [], 100, 'tasks'), /Build endpoint/);
  assert.match(renderDashboard(state, [], 100, 'inbox'), /Q4/);
  assert.match(renderDashboard(state, [], 100, 'huddles'), /API shape/);
  assert.match(renderDashboard(state, [], 100, 'claims'), /src\/api.js/);
  assert.match(renderDashboard(state, [], 100, 'prompt'), /Ship the API/);
});
test('empty coordination collections have helpful placeholders', () => {
  const empty = renderDashboard({ team: { name: 'Empty' } }, [], 80, 'inbox');
  assert.match(empty, /No unanswered questions/);
});