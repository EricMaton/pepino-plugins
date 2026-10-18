import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plugin } from './harness.mjs';

const assistant = plugin('claude-assistant');

/** Anthropic's streamed answer, as server-sent events, split at awkward places. */
const sse = (events) => {
  const text = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  return [text.slice(0, 37), text.slice(37, 120), text.slice(120)];
};
const text = (index, words) => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  ...words.map((word) => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: word } })),
  { type: 'content_block_stop', index },
];
const tool = (index, id, name, input) => [
  { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
  { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(0, 5) } },
  { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(5) } },
  { type: 'content_block_stop', index },
];
const end = (reason) => [{ type: 'message_delta', delta: { stop_reason: reason } }, { type: 'message_stop' }];

/** The assistant with a host that plays the user's key, the project and Anthropic ([answers], one per request). */
async function setUp(answers, { connected = true, status = 200 } = {}) {
  const state = { connected, posted: [], requests: [], forgotten: false };
  const calls = {
    'secrets.has': () => state.connected,
    'secrets.ask': () => (state.connected = true),
    'secrets.forget': () => {
      state.forgotten = true;
      state.connected = false;
    },
    'fs.root': () => 'shop',
    'fs.read': (path) => (path === 'src/cart.js' ? 'export const total = 0;\n' : Promise.reject(new Error(`Not found: ${path}`))),
    'pages.postMessage': (page, data) => void state.posted.push(data),
    'network.stream': (url, init, onChunk) => {
      state.requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      const parts = answers[state.requests.length - 1] ?? [];
      for (const part of parts) onChunk(part);
      return { status, headers: {}, text: status === 200 ? '' : '{"error":{"message":"invalid x-api-key"}}' };
    },
  };
  const running = await assistant.start(calls, { model: 'claude-opus-5-5', maxTokens: 1024 });
  return { state, page: (data) => running.page('chat', data) };
}

const lastState = (posted) => posted.filter((message) => message.type === 'state').at(-1);

test('asks Claude, streams its answer to the page, and lets it read the project with tools', async () => {
  const { state, page } = await setUp([
    sse([...text(0, ['Let me ', 'read it.']), ...tool(1, 'tu1', 'read_file', { path: 'src/cart.js' }), ...end('tool_use')]),
    sse([...text(0, ['It exports ', '`total`.']), ...end('end_turn')]),
  ]);
  await page({ type: 'send', text: 'What is in cart.js?' });

  const [first, second] = state.requests;
  assert.equal(first.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(first.headers['anthropic-version'], '2023-06-01');
  assert.equal(first.headers['x-api-key'], undefined); // Pepino adds the key, never the plugin
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.equal(first.body.stream, true);
  assert.match(first.body.system, /"shop"/);
  assert.deepEqual(
    first.body.tools.map((candidate) => candidate.name),
    ['list_files', 'read_file', 'find_files', 'search_text', 'open_file'],
  );
  assert.deepEqual(second.body.messages.at(-1), {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'export const total = 0;\n' }],
  });
  assert.deepEqual(second.body.messages.at(-2).content[1], {
    type: 'tool_use',
    id: 'tu1',
    name: 'read_file',
    input: { path: 'src/cart.js' },
  });

  const deltas = state.posted.filter((message) => message.type === 'delta').map((message) => message.text);
  assert.deepEqual(deltas, ['Let me ', 'read it.', 'It exports ', '`total`.']);
  assert.deepEqual(lastState(state.posted), {
    type: 'state',
    connected: true,
    project: 'shop',
    busy: false,
    view: [
      { role: 'user', text: 'What is in cart.js?' },
      { role: 'assistant', parts: [{ text: 'Let me read it.' }, { tool: 'Read src/cart.js' }, { text: 'It exports `total`.' }] },
    ],
  });
});

test('a tool that fails tells Claude, which goes on', async () => {
  const { state, page } = await setUp([
    sse([...tool(0, 'tu1', 'read_file', { path: 'nope.js' }), ...end('tool_use')]),
    sse([...text(0, ['There is no nope.js.']), ...end('end_turn')]),
  ]);
  await page({ type: 'send', text: 'Read nope.js' });
  assert.deepEqual(state.requests[1].body.messages.at(-1).content[0], {
    type: 'tool_result',
    tool_use_id: 'tu1',
    content: 'Error: Not found: nope.js',
    is_error: true,
  });
});

test('without a key it asks for none and sends nothing; connecting asks the app', async () => {
  const { state, page } = await setUp([], { connected: false });
  await page({ type: 'ready' });
  await page({ type: 'send', text: 'Hello' });
  assert.equal(state.requests.length, 0);
  assert.equal(lastState(state.posted).connected, false);

  await page({ type: 'connect' });
  assert.equal(lastState(state.posted).connected, true);
});

test('a refused key is forgotten, and the answer says what to do; what failed is not kept', async () => {
  const { state, page } = await setUp([[]], { status: 401 });
  await page({ type: 'send', text: 'Hello' });
  const shown = lastState(state.posted);
  assert.equal(state.forgotten, true);
  assert.equal(shown.connected, false);
  assert.match(shown.view[1].error, /Anthropic refused your key/);

  // The next message starts over: the failed one is not sent again
  state.connected = true;
  await page({ type: 'send', text: 'Again' });
  assert.deepEqual(state.requests[1].body.messages, [{ role: 'user', content: 'Again' }]);
});

test('a new chat forgets the conversation', async () => {
  const { state, page } = await setUp([sse([...text(0, ['Hi']), ...end('end_turn')]), sse([...text(0, ['Hi']), ...end('end_turn')])]);
  await page({ type: 'send', text: 'One' });
  await page({ type: 'new' });
  assert.deepEqual(lastState(state.posted).view, []);
  await page({ type: 'send', text: 'Two' });
  assert.deepEqual(state.requests[1].body.messages, [{ role: 'user', content: 'Two' }]);
});
