// Runs a plugin's main.js the way Pepino does, in a context of its own with
// only `plugin` and `console`, and gives it an `api` made of [calls]: what
// the host would answer (pepino-ide's docs/plugin-api/v1-spec.md). Values
// cross as JSON, as they do between Pepino and its sandbox.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const json = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Plugin [folder]'s main.js; run(command, calls) activates it and runs [command]. */
export function plugin(folder) {
  const main = readFileSync(new URL(`../plugins/${folder}/main.js`, import.meta.url), 'utf8');
  return {
    async run(command, calls, settings = {}) {
      let activate = null;
      const commands = new Map();
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
      };
      if (activate) await activate(api);
      const run = commands.get(command);
      if (!run) throw new Error(`The plugin has no command "${command}"`);
      await run();
    },
  };
}
