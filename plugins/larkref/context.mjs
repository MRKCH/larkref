import { FeishuError, runLark } from './cli.mjs';
import { baseContext } from './base.mjs';

const labels = { chat: '群聊', contact: '联系人', document: '文档' };
const chatId = /^oc_[A-Za-z0-9_-]+$/;
const userId = /^ou_[A-Za-z0-9_-]+$/;
const docPath = /^\/(docx|wiki|base)\/([A-Za-z0-9]+)\/?$/;
const docHost = /(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/;
const pageSize = 20;
const documentPage = 12_000;

function rows(data, key) {
  if (data?.[key] === null) return [];
  if (!Array.isArray(data?.[key])) throw new FeishuError('service', '飞书返回的数据格式发生了变化。');
  return data[key];
}

function documentURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !docHost.test(url.hostname) || !docPath.test(url.pathname)) return null;
    const canonical = new URL(url.origin + url.pathname.replace(/\/$/, ''));
    if (!url.pathname.startsWith('/docx/')) {
      const table = url.searchParams.get('table');
      const view = url.searchParams.get('view');
      if (table !== null && !/^tbl[A-Za-z0-9]+$/.test(table)) return null;
      if (view !== null && (!table || !/^vew[A-Za-z0-9]+$/.test(view))) return null;
      if (table) canonical.searchParams.set('table', table);
      if (view) canonical.searchParams.set('view', view);
    }
    return canonical.href;
  } catch {
    return null;
  }
}

function link(uri, title, description) {
  return { type: 'resource_link', uri, name: title, title, description, mimeType: 'text/plain' };
}

function documentLink(url, title, detail) {
  return link('feishu://document/' + url.slice('https://'.length), title, detail);
}

const diagnostics = {
  auth: '需要飞书用户授权',
  permission: '需要检查读取权限',
  config: '需要检查本机配置',
  missing: '对象不可见',
  service: '飞书读取失败',
};

function statusLink(kind, error) {
  const reason = Object.hasOwn(diagnostics, error?.kind) ? error.kind : 'service';
  return link('feishu://status/' + kind + '/' + reason, labels[kind] + ' · ' + diagnostics[reason],
    error instanceof FeishuError ? error.message : '请稍后重试。');
}

function displayTitle(value) {
  return String(value ?? '').replace(/<\/?hb?>/gi, '').replace(/\s+/g, ' ').trim();
}

export async function searchMentions(query = '', signal, run = runLark) {
  if (typeof query !== 'string' || query.length > 2048) throw new Error('请输入有效的飞书名称或链接。');
  const q = query.trim();
  const direct = documentURL(q);
  if (direct) return [documentLink(direct, '引用此飞书文档', new URL(direct).pathname)];
  if (chatId.test(q)) return [link('feishu://chat/' + q, q, '按会话 ID 引用')];
  if (userId.test(q)) return [link('feishu://contact/' + q, q, '按联系人 ID 引用')];
  const count = q ? '8' : '4';
  const size = ['--page-size', count];
  const chars = Array.from(q);
  const groups = async () => {
    if (chars.length > 64) return [];
    const args = q ? ['+chat-search', '--query=' + q, '--disable-search-by-user'] :
      ['+chat-list', '--sort-type', 'ByActiveTimeDesc'];
    const data = await run('im', ['im', ...args, ...size], signal);
    return rows(data, 'chats').filter(c => chatId.test(c.chat_id)).map(c =>
      link('feishu://chat/' + c.chat_id, c.name || c.chat_id,
        ['群聊', c.description?.slice(0, 60) || c.chat_id.slice(-8)].join(' · ')));
  };
  const contacts = async () => {
    if (chars.length > 50) return [];
    const args = q ? ['--query=' + q] : ['--has-chatted'];
    const data = await run('im', ['contact', '+search-user', ...args, ...size], signal);
    return rows(data, 'users').filter(u => userId.test(u.open_id)).map(u =>
      link('feishu://contact/' + u.open_id, u.localized_name || u.open_id,
        ['联系人', u.department, u.open_id.slice(-8)].filter(Boolean).join(' · ')));
  };
  const documents = async () => {
    const order = q ? [] : ['--sort', 'open_time'];
    const data = await run('docs', ['drive', '+search', '--query=' + q, '--doc-types', 'docx,bitable',
      '--only-title', ...order, ...size], signal);
    return rows(data, 'results').flatMap(item => {
      const meta = item.result_meta;
      const url = documentURL(meta?.url);
      if (!url) return [];
      const title = displayTitle(item.title_highlighted || item.title) || meta.token;
      const type = meta.doc_types === 'BITABLE' ? '多维表格' : '文档';
      return [documentLink(url, title || '飞书文档',
        [type, meta.owner_name, meta.update_time_iso?.slice(0, 10)].filter(Boolean).join(' · '))];
    });
  };
  const kinds = ['chat', 'contact', 'document'];
  const result = await Promise.allSettled([groups(), contacts(), documents()]);
  signal?.throwIfAborted();
  const items = result.flatMap((entry, index) =>
    entry.status === 'fulfilled' ? entry.value : [statusLink(kinds[index], entry.reason)]);
  const unique = new Map();
  for (const item of items) {
    if (!unique.has(item.uri)) unique.set(item.uri, item);
  }
  return [...unique.values()];
}

function messageList(data) {
  return rows(data, 'messages').slice().reverse().map(m => {
    const body = m.deleted ? '（已撤回）' : (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''));
    const excerpt = Array.from(body);
    return {
      time: m.create_time, sender: m.sender?.name || m.sender?.id || '未知',
      type: m.msg_type, text: excerpt.slice(0, 1200).join(''),
      ...(excerpt.length > 1200 ? { truncated: true } : {}),
      message_id: m.message_id, ...(m.thread_id ? { thread_id: m.thread_id } : {}),
    };
  });
}

async function conversation(kind, id, cursor, run, signal) {
  let title = id;
  let about;
  let metadataWarning;
  let target = [kind === 'chat' ? '--chat-id' : '--user-id', id];
  // Some conversations allow message access while the separate metadata API is restricted.
  try {
    if (kind === 'chat') {
      const info = await run('im', ['im', 'chats', 'get', '--params', JSON.stringify({ chat_id: id })], signal);
      title = info.name || id;
      about = { description: info.description?.slice(0, 1500), members: info.user_count };
    } else {
      const data = await run('im', ['contact', '+search-user', '--user-ids', id], signal);
      const person = rows(data, 'users').find(u => u.open_id === id);
      if (person) {
        title = person.localized_name || id;
        about = { department: person.department, external: person.is_cross_tenant };
        if (chatId.test(person.p2p_chat_id)) target = ['--chat-id', person.p2p_chat_id];
        else if (person.has_chatted === false) return { title, about, messages: [], has_more: false };
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    metadataWarning = error.message;
  }
  const args = ['im', '+chat-messages-list', ...target, '--sort', 'desc', '--page-size', String(pageSize)];
  if (cursor) args.push('--page-token', cursor);
  const data = await run('im', args, signal);
  return {
    title, about, ...(metadataWarning ? { metadata_warning: metadataWarning } : {}),
    messages: messageList(data), has_more: data.has_more === true,
    ...(data.has_more && data.page_token ? { next_cursor: data.page_token } : {}),
  };
}

async function documentContext(source, cursor, run, signal) {
  if (cursor && !/^(?:\d{1,15}:)?\d{1,9}$/.test(cursor)) throw new Error('无效的文档分页位置。');
  const url = new URL(source);
  const [, route, token] = url.pathname.split('/');
  if (route === 'base') return baseContext(url, token, cursor, signal, run);
  let wiki;
  if (route === 'wiki') {
    try {
      wiki = await run('docs', ['wiki', '+node-get', '--token', url.origin + url.pathname], signal);
    } catch (error) {
      signal?.throwIfAborted();
      // Docx fetch can resolve wiki URLs directly even without the separate node scope.
      if (url.searchParams.has('table')) throw error;
    }
    if (wiki?.obj_type === 'bitable') return baseContext(url, wiki.obj_token, cursor, signal, run);
    if (wiki?.obj_type && wiki.obj_type !== 'docx') throw new Error('此知识库节点为 ' + wiki.obj_type + '，请选择云文档或多维表格。');
  }
  let offset = 0;
  const args = ['docs', '+fetch', '--api-version', 'v2', '--doc', source, '--doc-format', 'markdown'];
  if (cursor) {
    const match = /^(\d{1,15}):(\d{1,9})$/.exec(cursor);
    if (!match) throw new Error('无效的文档分页位置。');
    args.push('--revision-id', match[1]);
    offset = Number(match[2]);
  }
  const data = await run('docs', args, signal);
  const doc = data.document;
  if (typeof doc?.content !== 'string') throw new FeishuError('service', '飞书未返回文档正文。');
  const characters = Array.from(doc.content);
  if (offset > characters.length) throw new Error('文档分页位置超出正文。');
  const end = Math.min(offset + documentPage, characters.length);
  const hasMore = end < characters.length;
  return {
    format: 'docx', url: source, title: wiki?.title, document_id: doc.document_id, revision: doc.revision_id,
    content: characters.slice(offset, end).join(''), offset, has_more: hasMore,
    ...(hasMore ? { next_cursor: String(doc.revision_id) + ':' + end } : {}),
  };
}

export async function readContext(uri, cursor = '', signal, run = runLark) {
  if (typeof uri !== 'string' || uri.length > 2048 || typeof cursor !== 'string' || cursor.length > 4096) {
    throw new Error('无效的飞书引用或分页参数。');
  }
  // The desktop composer serializes a selected resource as a Markdown link.
  const wrapped = /^mcp-resource:\/\/feishu\/([^/?#]+)$/.exec(uri);
  if (wrapped) uri = decodeURIComponent(wrapped[1]);
  const match = /^feishu:\/\/(chat|contact|document|status)\/([^#\s]+)$/u.exec(uri);
  if (!match) throw new Error('无法识别此飞书引用。');
  const [, kind, id] = match;
  let result;
  if (kind === 'document') {
    const url = documentURL('https://' + id);
    if (!url || url.slice(8) !== id) throw new Error('无效的飞书文档链接。');
    result = await documentContext(url, cursor, run, signal);
  } else if (kind === 'status') {
    const parts = id.split('/');
    const [source, reason] = parts;
    if (parts.length !== 2 || !Object.hasOwn(labels, source) || !Object.hasOwn(diagnostics, reason)) {
      throw new Error('无效的状态引用。');
    }
    result = { source: labels[source], status: diagnostics[reason], hint: '检查本机插件配置及飞书用户授权，然后重新搜索。' };
  } else {
    if (!(kind === 'chat' ? chatId : userId).test(id)) throw new Error('无效的飞书对象 ID。');
    result = await conversation(kind, id, cursor, run, signal);
  }
  return { source_uri: uri, kind, ...result };
}
