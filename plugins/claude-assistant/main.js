// Claude Assistant (pepino-ide #58): a chat with Claude about the open
// project, on its own page. It talks to Anthropic's Messages API with the
// user's own key (Pepino adds it: this plugin never sees it), streams the
// answer to the page as it is written, and lets Claude read the project
// with tools (list, read, find, search, the open file). It changes nothing:
// edits come later as diffs the user accepts (#60).

const API = 'https://api.anthropic.com/v1/messages';
const HEADERS = {
  'content-type': 'application/json',
  'anthropic-version': '2023-06-01',
  // Only for the web (development): on the phone the request goes natively
  'anthropic-dangerous-direct-browser-access': 'true',
};
/** Rounds of tools Claude may use for one message. */
const MAX_TURNS = 12;
/** A tool's answer is cut to this. */
const MAX_TOOL_TEXT = 100000;

const TOOLS = [
  {
    name: 'list_files',
    description: 'List every file of the open project, with its size in bytes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_file',
    description: 'Read a text file of the open project (up to 1 MB).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative to the project, e.g. src/main.js' } },
      required: ['path'],
    },
  },
  {
    name: 'find_files',
    description: 'Find files of the open project whose path looks like the query (fuzzy, like a file picker).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'search_text',
    description: 'Search the open project for lines containing the text (case-insensitive).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'open_file',
    description: 'The file open in the editor right now: its path, the selected text, and its whole text.',
    input_schema: { type: 'object', properties: {} },
  },
];

const system = (project) =>
  [
    'You are Claude Assistant, a coding assistant inside Pepino, a code editor on a phone.',
    project
      ? `The user has the project "${project}" open. Read it with your tools before answering questions about it; do not guess what a file says.`
      : 'No project is open: you cannot read files until the user opens one.',
    'You cannot change files. When a change would help, show it as a short code block the user can apply, and say which file and where.',
    'Answers are read on a phone: keep them short and to the point, with small code blocks.',
  ].join('\n');

/** The plain words for what a tool did, as the page shows it. */
function summary(name, input) {
  switch (name) {
    case 'list_files':
      return 'Listed the files';
    case 'read_file':
      return `Read ${input.path}`;
    case 'find_files':
      return `Looked for files like "${input.query}"`;
    case 'search_text':
      return `Searched for "${input.query}"`;
    case 'open_file':
      return 'Looked at the open file';
    default:
      return name;
  }
}

/** What an API error means for the user. */
function apiError(status, text) {
  let message = '';
  try {
    message = JSON.parse(text).error.message || '';
  } catch (e) {
    message = text.slice(0, 200);
  }
  if (status === 401) return 'Anthropic refused your key: check it in PLUGINS → Claude Assistant → Manage, or add it again';
  if (/credit balance/i.test(message)) return 'Your Anthropic credit has run out: add some at console.anthropic.com';
  if (status === 429) return 'Too many requests for your account right now: wait a moment and try again';
  if (status === 529 || status === 503) return 'Anthropic is overloaded: try again in a moment';
  return `Anthropic answered ${status}${message ? `: ${message}` : ''}`;
}

plugin.onActivate((api) => {
  /** The conversation as the API takes it. */
  let messages = [];
  /** The conversation as the page shows it: { role: 'user', text } or { role: 'assistant', parts: [{ text } | { tool }], error? }. */
  let view = [];
  let busy = false;
  /** The stream in progress, to stop. */
  let current = null;
  let stopping = false;

  const post = (data) => api.pages.postMessage('chat', data);
  const state = async () =>
    post({
      type: 'state',
      connected: await api.secrets.has('anthropic'),
      project: await api.fs.root().catch(() => null),
      busy,
      view,
    });

  async function runTool(name, input) {
    switch (name) {
      case 'list_files': {
        const files = await api.fs.list();
        return files.map((file) => `${file.path} (${file.size} B)`).join('\n') || 'The project has no files';
      }
      case 'read_file':
        return api.fs.read(String(input.path));
      case 'find_files':
        return (await api.fs.find(String(input.query), 30)).join('\n') || 'No files match';
      case 'search_text': {
        const matches = await api.fs.search(String(input.query), { limit: 60 });
        return matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join('\n') || 'No matches';
      }
      case 'open_file': {
        const path = await api.editor.getPath();
        const selection = await api.editor.getSelection();
        const text = await api.editor.getText();
        return `Path: ${path}\nSelected: ${selection || '(nothing)'}\n---\n${text}`;
      }
      default:
        throw new Error(`No tool ${name}`);
    }
  }

  /** One request to Claude, streamed: its content blocks and why it stopped. */
  async function ask(project, shown) {
    const blocks = [];
    let stop = null;
    let failure = null;
    let buffer = '';
    const handle = (event) => {
      const line = event.split('\n').find((part) => part.startsWith('data:'));
      if (!line) return;
      const data = JSON.parse(line.slice(5));
      if (data.type === 'content_block_start') {
        const block = { ...data.content_block };
        if (block.type === 'tool_use') block.json = '';
        blocks[data.index] = block;
      } else if (data.type === 'content_block_delta') {
        const block = blocks[data.index];
        if (data.delta.type === 'text_delta') {
          block.text = (block.text || '') + data.delta.text;
          const last = shown.parts[shown.parts.length - 1];
          if (last && last.text !== undefined) last.text += data.delta.text;
          else shown.parts.push({ text: data.delta.text });
          post({ type: 'delta', text: data.delta.text });
        } else if (data.delta.type === 'input_json_delta') {
          block.json += data.delta.partial_json;
        }
      } else if (data.type === 'content_block_stop') {
        const block = blocks[data.index];
        if (block && block.type === 'tool_use') {
          block.input = block.json ? JSON.parse(block.json) : {};
          delete block.json;
        }
      } else if (data.type === 'message_delta') {
        stop = data.delta.stop_reason;
      } else if (data.type === 'error') {
        failure = data.error.message || data.error.type;
      }
    };
    current = api.network.stream(
      API,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          model: api.settings.get('model'),
          max_tokens: api.settings.get('maxTokens'),
          system: system(project),
          tools: TOOLS,
          messages,
          stream: true,
        }),
      },
      (text) => {
        buffer += text;
        for (let cut = buffer.indexOf('\n\n'); cut >= 0; cut = buffer.indexOf('\n\n')) {
          handle(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 2);
        }
      },
    );
    const answer = await current;
    current = null;
    if (answer.status !== 200) throw new Error(apiError(answer.status, answer.text));
    if (failure) throw new Error(`Claude stopped: ${failure}`);
    return { blocks: blocks.filter(Boolean), stop };
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    if (!(await api.secrets.has('anthropic'))) {
      await state();
      return;
    }
    const mark = messages.length;
    const project = await api.fs.root().catch(() => null);
    messages.push({ role: 'user', content: text });
    view.push({ role: 'user', text });
    const shown = { role: 'assistant', parts: [] };
    view.push(shown);
    busy = true;
    stopping = false;
    await state();
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const { blocks, stop } = await ask(project, shown);
        messages.push({
          role: 'assistant',
          content: blocks.map((block) =>
            block.type === 'tool_use'
              ? { type: 'tool_use', id: block.id, name: block.name, input: block.input }
              : { type: 'text', text: block.text || '' },
          ),
        });
        if (stop === 'refusal') {
          shown.error = 'Claude declined to answer this';
          break;
        }
        if (stop !== 'tool_use') break;
        const results = [];
        for (const block of blocks.filter((candidate) => candidate.type === 'tool_use')) {
          shown.parts.push({ tool: summary(block.name, block.input) });
          await post({ type: 'tool', summary: summary(block.name, block.input) });
          try {
            const result = String(await runTool(block.name, block.input));
            results.push({ type: 'tool_result', tool_use_id: block.id, content: result.slice(0, MAX_TOOL_TEXT) });
          } catch (error) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${error.message}`, is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (error) {
      // What did not finish is not kept: the next message starts from the last whole answer
      messages.length = mark;
      shown.error = stopping ? 'Stopped' : error.message;
      if (/refused your key/.test(error.message)) await api.secrets.forget('anthropic');
    }
    busy = false;
    current = null;
    await state();
  }

  api.pages.onMessage('chat', async (message) => {
    if (!message) return;
    if (message.type === 'ready') await state();
    else if (message.type === 'send') await send(String(message.text || ''));
    else if (message.type === 'stop' && current) {
      stopping = true;
      await current.cancel();
    } else if (message.type === 'connect') {
      await api.secrets.ask('anthropic');
      await state();
    } else if (message.type === 'new' && !busy) {
      messages = [];
      view = [];
      await state();
    }
  });
});
