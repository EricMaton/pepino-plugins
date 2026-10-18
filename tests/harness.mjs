// Runs a plugin's main.js the way Pepino does, in a context of its own with
// only `plugin` and `console`, and gives it an `api` made of [calls]: what
// the host would answer (pepino-ide's docs/plugin-api/v1-spec.md). Values
// cross as JSON, as they do between Pepino and its sandbox.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const json = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Plugin [folder]'s main.js. run(command, calls) activates it and runs
 * [command]; start(calls) activates it and gives `page(pageId, data)`, a
 * message from one of its pages, for plugins driven by their page.
 */
export function plugin(folder) {
  const main = readFileSync(new URL(`../plugins/${folder}/main.js`, import.meta.url), 'utf8');

  async function start(calls, settings = {}) {
    let activate = null;
    const commands = new Map();
    const pageListeners = new Map();
    const context = vm.createContext({
      plugin: { onActivate: (run) => (activate = run), onDeactivate: () => undefined },
      console,
    });
    vm.runInContext(main, context, { filename: `${folder}/main.js` });
    const call =
      (name) =>
      async (...args) => {
        if (!calls[name]) throw new Error(`api has no ${name} in this test`);
        return json(await calls[name](...json(args)));
      };
    const api = {
      apiVersion: '1',
      commands: { register: (id, run) => commands.set(id, run), execute: call('commands.execute') },
      editor: {
        getPath: call('editor.getPath'),
        getText: call('editor.getText'),
        setText: call('editor.setText'),
        getSelection: call('editor.getSelection'),
        insert: call('editor.insert'),
        insertSnippet: call('editor.insertSnippet'),
      },
      settings: { get: (key) => settings[key] },
      window: {
        showMessage: call('window.showMessage'),
        showQuickPick: call('window.showQuickPick'),
        showInput: call('window.showInput'),
      },
      storage: { get: call('storage.get'), set: call('storage.set'), delete: call('storage.delete') },
      fs: {
        root: call('fs.root'),
        list: call('fs.list'),
        read: call('fs.read'),
        find: call('fs.find'),
        search: call('fs.search'),
      },
      secrets: {
        has: call('secrets.has'),
        ask: call('secrets.ask'),
        signIn: call('secrets.signIn'),
        forget: call('secrets.forget'),
      },
      pages: {
        postMessage: call('pages.postMessage'),
        onMessage: (pageId, listener) => pageListeners.set(pageId, listener),
      },
      network: {
        fetch: call('network.fetch'),
        // The test's network.stream gets onChunk to call with each part, and a cancel to answer
        stream(url, init, onChunk) {
          if (!calls['network.stream']) throw new Error('api has no network.stream in this test');
          let cancel = () => undefined;
          const answer = Promise.resolve(
            calls['network.stream'](json(url), json(init), (text) => onChunk(text), (run) => (cancel = run)),
          ).then(json);
          answer.cancel = async () => cancel();
          return answer;
        },
      },
    };
    if (activate) await activate(api);
    return {
      async run(command) {
        const run = commands.get(command);
        if (!run) throw new Error(`The plugin has no command "${command}"`);
        await run();
      },
      async page(pageId, data) {
        const listener = pageListeners.get(pageId);
        if (!listener) throw new Error(`Nothing listens to page "${pageId}"`);
        await listener(json(data));
      },
    };
  }

  return {
    start,
    async run(command, calls, settings = {}) {
      await (await start(calls, settings)).run(command);
    },
  };
}
