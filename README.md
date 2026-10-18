# 🥒 Pepino plugins

The plugins you can install in [Pepino](https://github.com/EricMaton/pepino-ide), the mobile IDE. Pepino reads
`index.json` from this repository and downloads a plugin's files from here when you install it: no server of
its own.

| Plugin        | What it does                                                         | Permissions                  |
| ------------- | -------------------------------------------------------------------- | ---------------------------- |
| Claude Assistant | Chat with Claude about the open project, with your own account (sign in with OpenRouter, or your Anthropic key); it reads your files to answer | network, fs.read, editor.read |
| Formatter     | Formats the open JavaScript, CSS or HTML file (js-beautify)          | editor.read, editor.write    |
| Pickle themes | Two themes in pickle green: Pickle night (dark), Pickle brine (light) | —                            |
| Snippets      | Inserts snippets for the open file's language, and keeps your own    | editor.read, editor.write    |

## Layout

```
index.json              ← what Pepino lists: generated, do not edit by hand
plugins/<folder>/
├── plugin.json         ← the manifest
├── main.js             ← the script (not needed by a plugin without commands, such as a theme)
└── *.html              ← its pages, if it has any
scripts/build-index.mjs ← builds index.json
tests/                  ← each plugin's tests (node --test), with a harness that plays Pepino's api
auth/openrouter.html    ← where OpenRouter's sign-in comes back to, on GitHub Pages: it hands the code to the app
```

Each entry of `index.json` has the plugin's id, name, version, API version, description, permissions, its
folder, and the SHA-256 of each of its files. Pepino checks them after downloading, and shows the
permissions before installing.

## Writing a plugin

The API is in [the spec](https://github.com/EricMaton/pepino-ide/blob/main/docs/plugin-api/v1-spec.md). To add
one here:

1. Make a folder in `plugins/` with its `plugin.json` (and `main.js`).
2. Run `node scripts/build-index.mjs` (Node 22) to update `index.json`.
3. Test it: `node --test "tests/*.test.mjs"` runs every plugin's tests; `tests/harness.mjs` runs a `main.js` with
   an `api` you answer.
4. Open a pull request. CI checks the manifests, that `index.json` is up to date, and the tests.

A new version of a plugin is the same: change its files, raise `version` in `plugin.json`, rebuild the index.
