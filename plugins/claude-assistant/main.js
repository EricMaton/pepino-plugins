// Claude Assistant (pepino-ide #58): a chat with Claude about the open
// project, on its own page. It talks to Claude through the user's own
// account (#190): OpenRouter, signed in to in the browser, or an Anthropic
// API key; both take Anthropic's Messages API. Pepino adds the user's key:
// this plugin never sees it. It streams the
// answer to the page as it is written, and lets Claude read the project
// with tools (list, read, find, search, the open file). It changes nothing:
// edits come later as diffs the user accepts (#60).

const HEADERS = {
  'content-type': 'application/json',
  'anthropic-version': '2023-06-01',
};

/** Where Claude is reached, by the account the user connected; each takes the Messages API. */
const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/messages',
    // Who is asking, for the user's OpenRouter activity
    headers: { 'HTTP-Referer': 'https://github.com/EricMaton/pepino-ide', 'X-Title': 'Pepino' },
    // claude-opus-5-5 is anthropic/claude-opus-5.5 there
    model: (model) => `anthropic/${model.replace(/-(\d+)-(\d+)$/, '-$1.$2')}`,
    credit: 'Your OpenRouter credit has run out: add some at openrouter.ai/credits',
  },
  anthropic: {
    name: 'Anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    // Only for the web (development): on the phone the request goes natively
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    model: (model) => model,
    credit: 'Your Anthropic credit has run out: add some at console.anthropic.com',
  },
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
function apiError(provider, status, text) {
  const { name } = PROVIDERS[provider];
  let message = '';
  try {
    message = JSON.parse(text).error.message || '';
  } catch (e) {
    message = text.slice(0, 200);
  }
  if (status === 401) return `${name} refused your ${provider === 'openrouter' ? 'sign-in' : 'key'}: connect again`;
  if (status === 402 || /credit/i.test(message)) return PROVIDERS[provider].credit;
  if (status === 429) return 'Too many requests for your account right now: wait a moment and try again';
  if (status === 529 || status === 503) return `${name} is overloaded: try again in a moment`;
  return `${name} answered ${status}${message ? `: ${message}` : ''}`;
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

  /** The account to reach Claude with: the one connected last that is still there. */
  async function provider() {
    const chosen = await api.storage.get('provider');
    const connected = [];
    for (const name of Object.keys(PROVIDERS)) if (await api.secrets.has(name)) connected.push(name);
    return connected.includes(chosen) ? chosen : connected[0] || null;
  }

  const state = async () => {
    const using = await provider();
    return post({
      type: 'state',
      connected: using !== null,
      provider: using && PROVIDERS[using].name,
      project: await api.fs.root().catch(() => null),
      busy,
      view,
    });
  };

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
  async function ask(using, project, shown) {
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
    const target = PROVIDERS[using];
    current = api.network.stream(
      target.url,
      {
        method: 'POST',
        headers: { ...HEADERS, ...target.headers },
        body: JSON.stringify({
          model: target.model(api.settings.get('model')),
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
    if (answer.status !== 200) {
      const error = new Error(apiError(using, answer.status, answer.text));
      error.refused = answer.status === 401;
      throw error;
    }
    if (failure) throw new Error(`Claude stopped: ${failure}`);
    return { blocks: blocks.filter(Boolean), stop };
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    const using = await provider();
    if (!using) {
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
        const { blocks, stop } = await ask(using, project, shown);
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
      if (error.refused) await api.secrets.forget(using);
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
    } else if (message.type === 'connect' && PROVIDERS[message.provider]) {
      const connected =
        message.provider === 'openrouter'
          ? await api.secrets.signIn('openrouter')
          : await api.secrets.ask('anthropic');
      if (connected) await api.storage.set('provider', message.provider);
      await state();
    } else if (message.type === 'new' && !busy) {
      messages = [];
      view = [];
      await state();
    }
  });
});
