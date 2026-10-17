# 🥒 Pepino plugins

The plugins you can install in [Pepino](https://github.com/EricMaton/pepino-ide), the mobile IDE. Pepino reads
`index.json` from this repository and downloads a plugin's files from here when you install it: no server of
its own.

| Plugin        | What it does                                                         | Permissions                  |
| ------------- | -------------------------------------------------------------------- | ---------------------------- |
| Formatter     | Formats the open JavaScript, CSS or HTML file (js-beautify)          | editor.read, editor.write    |
| Pickle themes | Two themes in pickle green: Pickle night (dark), Pickle brine (light) | —                            |
| Snippets      | Inserts snippets for the open file's language, and keeps your own    | editor.read, editor.write    |

## Layout

```
index.json              ← what Pepino lists: generated, do not edit by hand
plugins/<folder>/
├── plugin.json         ← the manifest
└── main.js             ← the script (not needed by a plugin without commands, such as a theme)
scripts/build-index.mjs ← builds index.json
```

Each entry of `index.json` has the plugin's id, name, version, API version, description, permissions, its
folder, and the SHA-256 of each of its files. Pepino checks them after downloading, and shows the
permissions before installing.

## Writing a plugin

The API is in [the spec](https://github.com/EricMaton/pepino-ide/blob/main/docs/plugin-api/v1-spec.md). To add
one here:

1. Make a folder in `plugins/` with its `plugin.json` (and `main.js`).
2. Run `node scripts/build-index.mjs` (Node 22) to update `index.json`.
3. Open a pull request. CI checks the manifests and that `index.json` is up to date.

A new version of a plugin is the same: change its files, raise `version` in `plugin.json`, rebuild the index.
