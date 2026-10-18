import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plugin } from './harness.mjs';

const snippets = plugin('snippets');

/** A host that plays the editor, the user and the storage. */
function setUp(path) {
  const state = {
    path,
    selection: '',
    storage: {},
    snippets: [],
    messages: [],
    offered: [],
    title: undefined,
    choose: (items) => (items.length ? 0 : null),
    name: 'my snippet',
  };
  const calls = {
    'editor.getPath': () => state.path,
    'editor.getSelection': () => state.selection,
    'editor.insertSnippet': (body) => void state.snippets.push(body),
    'window.showMessage': (message) => void state.messages.push(message),
    'window.showQuickPick': (items, options) => {
      state.offered = items.map((item) => (typeof item === 'string' ? { label: item } : item));
      state.title = options?.title;
      return state.choose(state.offered);
    },
    'window.showInput': () => state.name,
    'storage.get': (key) => state.storage[key] ?? null,
    'storage.set': (key, value) => void (state.storage[key] = value),
  };
  return { state, run: (command) => snippets.run(command, calls) };
}

test('offers the open file’s language’s snippets, and inserts the one chosen', async () => {
  const { state, run } = setUp('app/src/main.ts');
  state.choose = (items) => items.findIndex((item) => item.label === 'interface');
  await run('insert');

  assert.equal(state.title, 'TypeScript snippets');
  assert.deepEqual(state.offered[0], { label: 'console.log', detail: 'console.log();' });
  assert.deepEqual(state.snippets, ['interface $0 {\n\t\n}']);
});

test('dismissed, inserts nothing; for a file with none of its own, says how to make one', async () => {
  const dismissed = setUp('a.css');
  dismissed.state.choose = () => null;
  await dismissed.run('insert');
  assert.deepEqual(dismissed.state.snippets, []);

  const unknown = setUp('notes.txt');
  await unknown.run('insert');
  assert.deepEqual(unknown.state.messages, ['No snippets for this file yet: select some code and save it as one']);
});

test('saves the selection, its shared indent dropped and its own as tabs, and offers it first', async () => {
  const { state, run } = setUp('app/a.js');
  state.selection = '    if (ok) {\n        go();\n    }\n';
  state.name = '  if ok ';
  await run('save');

  assert.deepEqual(state.storage.snippets, [{ name: 'if ok', language: 'javascript', body: 'if (ok) {\n\tgo();\n}' }]);
  assert.deepEqual(state.messages, ['Saved "if ok" for JavaScript: Insert snippet offers it']);

  await run('insert');
  assert.deepEqual(state.offered[0], { label: 'if ok', detail: 'Mine · if (ok) {' });
  assert.deepEqual(state.snippets, ['if (ok) {\n\tgo();\n}']);

  // Not offered in another language
  state.path = 'app/a.py';
  await run('insert');
  assert.ok(!state.offered.some((item) => item.label === 'if ok'));
});

test('needs a selection to save, and a name', async () => {
  const empty = setUp('a.js');
  await empty.run('save');
  assert.deepEqual(empty.state.messages, ['Select the code to save first']);

  const unnamed = setUp('a.js');
  unnamed.state.selection = 'x';
  unnamed.state.name = null;
  await unnamed.run('save');
  assert.deepEqual(unnamed.state.storage, {});
});

test('deletes one of your own', async () => {
  const { state, run } = setUp('a.js');
  state.storage.snippets = [
    { name: 'a', language: 'javascript', body: 'a()' },
    { name: 'b', language: null, body: 'b()' },
  ];
  state.choose = () => 1;
  await run('delete');

  assert.deepEqual(state.offered, [
    { label: 'a', detail: 'JavaScript · a()' },
    { label: 'b', detail: 'Any file · b()' },
  ]);
  assert.deepEqual(state.storage.snippets, [{ name: 'a', language: 'javascript', body: 'a()' }]);
  assert.deepEqual(state.messages, ['Deleted "b"']);
});
