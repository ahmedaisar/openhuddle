import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard } from '../src/client/tui.js';

test('terminal dashboard renders team, agents, activity and tasks', () => {
  const state = {
    team: { name: 'Platform' },
    members: [{ id: 'm1', name: 'Michael', status: 'working', task_key: 'API' }],
    tasks: [{ key: 'API', title: 'Build endpoint', status: 'in_progress', assignee_id: 'm1' }],
  };
  const events = [{ id: 1, kind: 'joined', created_at: '2026-11-05T12:00:00Z', member_id: 'm1', data: { name: 'Michael', tool: 'codex' } }];
  const screen = renderDashboard(state, events, 100);
  assert.match(screen, /OPENHUDDLE/);
  assert.match(screen, /Platform/);
  assert.match(screen, /Michael/);
  assert.match(screen, /Build endpoint/);
  assert.match(screen, /joined the team/);
  assert.match(screen, /q quit/);
});

test('terminal dashboard handles missing state and narrow terminals', () => {
  const screen = renderDashboard({}, [], 20);
  assert.match(screen, /OpenHuddle/);
  assert.match(screen, /TASK BOARD/);
});
