import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plugin } from './harness.mjs';

const formatter = plugin('formatter');

/** Formats [text] as file [path]: what it wrote, and what it said. */
async function format(path, text, indentSize = 2) {
  const messages = [];
  let written = null;
  await formatter.run(
    'format',
    {
      'editor.getPath': () => path,
      'editor.getText': () => text,
      'editor.setText': (next) => void (written = next),
      'window.showMessage': (message) => void messages.push(message),
    },
    { indentSize },
  );
  return { written, messages };
}

test('formats JavaScript, keeping one-line blocks and regular expressions as they are', async () => {
  const { written } = await format(
    'app/src/sum.js',
    "import {a,b} from './x.js';\nconst sum=(xs)=>xs.reduce((t,x)=>t+x,0);\nif(a){b()}else{\nreturn /[{}]/g\n}",
  );
  assert.equal(
    written,
    "import { a, b } from './x.js';\nconst sum = (xs) => xs.reduce((t, x) => t + x, 0);\nif (a) { b() } else {\n  return /[{}]/g\n}\n",
  );
});

test('formats CSS, with the indent its setting asks for', async () => {
  const { written } = await format('site/style.css', 'body{margin:0}@media (max-width:600px){.a{display:none}}', 4);
  assert.equal(written, 'body {\n    margin: 0\n}\n\n@media (max-width:600px) {\n    .a {\n        display: none\n    }\n}\n');
});

test('formats HTML, and the CSS and JavaScript inside it', async () => {
  const { written } = await format(
    'site/index.html',
    '<html><head><style>body{margin:0}</style></head><body><ul><li>a</li></ul><script>const x={a:1};go(x)</script></body></html>',
  );
  assert.equal(
    written,
    [
      '<html>',
      '<head>',
      '  <style>',
      '    body {',
      '      margin: 0',
      '    }',
      '  </style>',
      '</head>',
      '<body>',
      '  <ul>',
      '    <li>a</li>',
      '  </ul>',
      '  <script>',
      '    const x = { a: 1 };',
      '    go(x)',
      '  </script>',
      '</body>',
      '</html>',
      '',
    ].join('\n'),
  );
});

test('says so when the file is formatted already, and writes nothing', async () => {
  assert.deepEqual(await format('a.js', 'const a = 1;\n'), { written: null, messages: ['Already formatted'] });
});

test('leaves TypeScript and other files alone, and says why', async () => {
  assert.deepEqual(await format('app/use.ts', 'const [a, setA] = useState<number>(0);'), {
    written: null,
    messages: ['TypeScript is not supported yet'],
  });
  assert.deepEqual(await format('README.md', '# Hi'), { written: null, messages: ["It can't format README.md"] });
});
