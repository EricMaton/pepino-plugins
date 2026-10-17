// Snippets (#53): the ones that come with it for the open file's language,
// and your own, kept in api.storage. In a body, `\t` is one indent (the
// editor's own) and `$0` is where the cursor ends.

/** The language of a file, by its extension. */
const LANGUAGES = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
};

const NAMES = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  html: 'HTML',
  css: 'CSS',
  markdown: 'Markdown',
  python: 'Python',
};

const JAVASCRIPT = [
  { name: 'console.log', body: 'console.log($0);' },
  { name: 'function', body: 'function $0() {\n\t\n}' },
  { name: 'arrow function', body: 'const $0 = () => {\n\t\n};' },
  { name: 'async function', body: 'async function $0() {\n\t\n}' },
  { name: 'if', body: 'if ($0) {\n\t\n}' },
  { name: 'if / else', body: 'if ($0) {\n\t\n} else {\n\t\n}' },
  { name: 'for…of', body: 'for (const item of $0) {\n\t\n}' },
  { name: 'try / catch', body: 'try {\n\t$0\n} catch (error) {\n\tconsole.error(error);\n}' },
  { name: 'import', body: "import { $0 } from '';" },
  { name: 'class', body: 'class $0 {\n\tconstructor() {\n\t\t\n\t}\n}' },
];

/** What comes with it, per language. */
const BUILT_IN = {
  javascript: JAVASCRIPT,
  typescript: [
    ...JAVASCRIPT,
    { name: 'interface', body: 'interface $0 {\n\t\n}' },
    { name: 'type', body: 'type $0 = ;' },
  ],
  html: [
    {
      name: 'HTML page',
      body: '<!doctype html>\n<html lang="en">\n<head>\n\t<meta charset="utf-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1">\n\t<title>$0</title>\n</head>\n<body>\n\t\n</body>\n</html>',
    },
    { name: 'link a stylesheet', body: '<link rel="stylesheet" href="$0">' },
    { name: 'script', body: '<script src="$0"></script>' },
    { name: 'div', body: '<div>$0</div>' },
  ],
  css: [
    { name: 'media query (phones)', body: '@media (max-width: 600px) {\n\t$0\n}' },
    { name: 'flex row', body: 'display: flex;\nalign-items: center;\ngap: $0;' },
    { name: 'grid', body: 'display: grid;\ngrid-template-columns: repeat($0, 1fr);\ngap: ;' },
    { name: 'dark mode', body: '@media (prefers-color-scheme: dark) {\n\t$0\n}' },
  ],
  markdown: [
    { name: 'code block', body: '```\n$0\n```' },
    { name: 'link', body: '[$0]()' },
    { name: 'table', body: '| $0 |  |\n|---|---|\n|  |  |' },
    { name: 'task list', body: '- [ ] $0\n- [ ] ' },
  ],
  python: [
    { name: 'def', body: 'def $0():\n\tpass' },
    { name: 'main', body: "if __name__ == '__main__':\n\t$0" },
    { name: 'class', body: 'class $0:\n\tdef __init__(self):\n\t\tpass' },
    { name: 'for', body: 'for item in $0:\n\tpass' },
  ],
};

/** Where your own are kept: [{ name, language, body }], language null for any file. */
const MINE = 'snippets';

function languageOf(path) {
  const name = path.split('/').pop();
  const dot = name.lastIndexOf('.');
  return (dot > 0 && LANGUAGES[name.slice(dot + 1).toLowerCase()]) || null;
}

/** [body]'s first line, to show under its name. */
const preview = (body) => body.replace(/\$0/g, '').split('\n')[0].trim();

const indentOf = (line) => /^[ \t]*/.exec(line)[0];

/**
 * Selected code as a snippet's body: without the indentation its lines
 * share, and each step of the indent it uses (the smallest one, in spaces)
 * as a `\t`, so that it takes the editor's own indent where it goes.
 */
function toBody(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const written = lines.filter((line) => line.trim() !== '');
  const common = written.length ? Math.min(...written.map((line) => indentOf(line).length)) : 0;
  const dedented = lines.map((line) => line.slice(Math.min(common, indentOf(line).length)));
  const steps = dedented.map((line) => indentOf(line).length).filter((size) => size > 0);
  const step = steps.length && dedented.every((line) => !indentOf(line).includes('\t')) ? Math.min(...steps) : 0;
  return dedented
    .map((line) => {
      if (!step) return line;
      const size = indentOf(line).length;
      return '\t'.repeat(Math.floor(size / step)) + ' '.repeat(size % step) + line.slice(size);
    })
    .join('\n')
    .trim();
}

plugin.onActivate((api) => {
  const mine = async () => (await api.storage.get(MINE)) || [];

  api.commands.register('insert', async () => {
    const language = languageOf(await api.editor.getPath());
    const own = (await mine()).filter((snippet) => snippet.language === null || snippet.language === language);
    const offered = [
      ...own.map((snippet) => ({ ...snippet, detail: `Mine · ${preview(snippet.body)}` })),
      ...(BUILT_IN[language] || []).map((snippet) => ({ ...snippet, detail: preview(snippet.body) })),
    ];
    if (offered.length === 0) {
      await api.window.showMessage('No snippets for this file yet: select some code and save it as one');
      return;
    }
    const chosen = await api.window.showQuickPick(
      offered.map((snippet) => ({ label: snippet.name, detail: snippet.detail })),
      { title: language ? `${NAMES[language]} snippets` : 'Your snippets' },
    );
    if (chosen === null) return;
    await api.editor.insertSnippet(offered[chosen].body);
  });

  api.commands.register('save', async () => {
    const selection = await api.editor.getSelection();
    if (selection.trim() === '') {
      await api.window.showMessage('Select the code to save first');
      return;
    }
    const language = languageOf(await api.editor.getPath());
    const name = await api.window.showInput({
      title: 'Name the snippet',
      placeholder: 'fetch json',
      value: preview(selection).slice(0, 40),
    });
    if (name === null || name.trim() === '') return;
    const body = toBody(selection);
    const saved = (await mine()).filter((snippet) => !(snippet.name === name.trim() && snippet.language === language));
    await api.storage.set(MINE, [...saved, { name: name.trim(), language, body }]);
    await api.window.showMessage(
      `Saved "${name.trim()}"${language ? ` for ${NAMES[language]}` : ''}: Insert snippet offers it`,
    );
  });

  api.commands.register('delete', async () => {
    const own = await mine();
    if (own.length === 0) {
      await api.window.showMessage('You have no snippets of your own');
      return;
    }
    const chosen = await api.window.showQuickPick(
      own.map((snippet) => ({
        label: snippet.name,
        detail: `${snippet.language ? NAMES[snippet.language] : 'Any file'} · ${preview(snippet.body)}`,
      })),
      { title: 'Delete which?' },
    );
    if (chosen === null) return;
    await api.storage.set(
      MINE,
      own.filter((_, index) => index !== chosen),
    );
    await api.window.showMessage(`Deleted "${own[chosen].name}"`);
  });
});
