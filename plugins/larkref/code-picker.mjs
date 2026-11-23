import { directMention, parseReference, searchMentions } from './context.mjs';
import { currentAccount, refreshInterval, syncProject } from './project-index.mjs';

export const searchPrompt = {
  name: 'feishu-search', title: '在线查找飞书引用',
  description: '按关键词列出飞书候选，选定后加入当前项目。',
  arguments: [{ name: 'query', description: '群聊、联系人或文档关键词', required: true }],
};

export function getSearchPrompt(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 2048) throw new Error('请填写飞书搜索关键词。');
  return { messages: [{ role: 'user', content: { type: 'text', text:
    '请用本项目 LarkRef 的 search_mentions 搜索以下关键词，按类型列出候选并等待我选定。' +
    '选定后使用 save_reference 收录，需要正文时再用 read_context。搜索关键词为 ' + JSON.stringify(query) } }] };
}

export function codePicker(root) {
  const candidates = new Map();
  const lifecycle = new AbortController();
  let started = false;
  let timer;

  async function tick() {
    let wait = refreshInterval;
    try {
      const result = await syncProject(root, { signal: lifecycle.signal });
      wait = Math.max(1000, result.updatedAt + refreshInterval - Date.now());
    } catch (error) {
      if (!lifecycle.signal.aborted) console.error('LarkRef 后台刷新：' + error.message);
    } finally {
      if (!lifecycle.signal.aborted) timer = setTimeout(tick, wait).unref();
    }
  }

  async function search(query, signal) {
    // The online picker can still return useful results while the local identity
    // command is unavailable. Only verified candidates can enter an account's index.
    let account;
    try { account = await currentAccount(signal); }
    catch { signal?.throwIfAborted(); }
    const items = await searchMentions(query, signal);
    const observedAt = Date.now();
    const direct = Boolean(directMention((query || '').trim()));
    for (const item of items) {
      if (item.uri.startsWith('feishu://status/')) continue;
      const old = candidates.get(item.uri);
      if (direct && old && old.account === account && !old.direct) continue;
      candidates.delete(item.uri);
      candidates.set(item.uri, { item, account, observedAt, direct });
    }
    while (candidates.size > 200) candidates.delete(candidates.keys().next().value);
    return items;
  }

  async function remember(uri, signal, query) {
    uri = parseReference(uri).uri;
    if (query && !(await search(query, signal)).some(item => item.uri === uri)) {
      throw new Error('当前搜索没有返回该引用，请重新确认候选。');
    }
    const hit = candidates.get(uri);
    if (!hit) throw new Error('请先用本项目的 search_mentions 搜索并确认候选，或同时提供原搜索词 query。');
    if (!hit.account) throw new Error('无法确认搜索结果所属的飞书账号，请检查本机授权后重新搜索。');
    if (hit.direct) throw new Error('直接输入的链接或 ID 需要先用 read_context 确认可访问，或通过名称搜索后收录。');
    return syncProject(root, { selected: hit.item, observedAt: hit.observedAt, expectedAccount: hit.account, signal });
  }

  return {
    search, remember,
    refresh: signal => syncProject(root, { force: true, signal }),
    async afterRead(data, signal) {
      const hit = candidates.get(data.source_uri);
      if (!hit) return;
      if (hit.direct) {
        hit.direct = false;
        hit.observedAt = Date.now();
        const hasTitle = data.title && data.title !== parseReference(data.source_uri).id;
        hit.item = { ...hit.item, ...(hasTitle ? { title: data.title } : { preferKnownTitle: true }),
          ...(data.format === 'bitable' ? { description: '多维表格' } : {}) };
      }
      try { await remember(data.source_uri, signal); } catch (error) { return error.message; }
    },
    start() { if (!started) { started = true; void tick(); } },
    close() { lifecycle.abort(); clearTimeout(timer); },
  };
}
