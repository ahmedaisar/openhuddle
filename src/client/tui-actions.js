// Explicit command palette actions for the terminal UI. All writes go through existing hub routes.
export function parseTuiCommand(input) {
  const line = String(input ?? '').trim();
  if (!line) return null;
  const match = /^(\S+)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/.exec(line);
  if (!match) return null;
  const [, verb, target, rest = ''] = match;
  if (verb === 'task' && target && /^(take|start|done|release|accept|decline)$/.test(rest.split(/\s+/, 1)[0])) {
    const [action, ...note] = rest.split(/\s+/);
    return { route: '/api/task', body: { action, key: target.toUpperCase(), note: note.join(' ') || undefined } };
  }
  if (verb === 'ask' && target && rest) return { route: '/api/ask', body: { to: target, question: rest } };
  if (verb === 'reply' && target && rest) return { route: '/api/reply', body: { ask_id: target.toUpperCase(), answer: rest } };
  if (verb === 'say' && target) return { route: '/api/post', body: { kind: 'update', text: [target, rest].filter(Boolean).join(' ') } };
  if (verb === 'prompt' && target === 'submit') return { route: '/api/prompt/submit', body: {} };
  if (verb === 'prompt' && target === 'vote' && /^(yes|no)$/.test(rest.split(/\s+/, 1)[0])) {
    const [vote, ...comment] = rest.split(/\s+/);
    return { route: '/api/prompt/vote', body: { approve: vote === 'yes', comment: comment.join(' ') || undefined } };
  }
  return null;
}

export async function executeTuiCommand(api, input) {
  const command = parseTuiCommand(input);
  if (!command) throw new Error('Unknown command. Use task take KEY, task start KEY, task done KEY, ask NAME QUESTION, reply QID ANSWER, say MESSAGE, prompt submit, or prompt vote yes|no.');
  return api.post(command.route, command.body);
}