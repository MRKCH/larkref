import { FeishuError } from './cli.mjs';

// The Base list API expects serial requests, including when a turn selects two bases.
let lastList = Promise.resolve();
function list(run, args, signal) {
  const next = lastList.then(() => {
    signal?.throwIfAborted();
    return run('docs', ['base', ...args], signal);
  });
  lastList = next.catch(() => {});
  return next;
}

export async function baseContext(url, token, cursor, signal, run) {
  if (cursor && !/^\d{1,9}$/.test(cursor)) throw new Error('无效的多维表格分页位置。');
  if (!/^[A-Za-z0-9]+$/.test(token)) throw new Error('无效的多维表格 token。');
  const offset = Number(cursor) || 0;
  const table = url.searchParams.get('table');
  const args = ['--base-token', token, '--offset', String(offset)];
  if (!table) {
    const data = await list(run, ['+table-list', ...args, '--limit', '20'], signal);
    if (!Array.isArray(data.tables)) throw new FeishuError('service', '飞书未返回数据表目录。');
    const tables = data.tables.map(t => {
      const target = new URL(url);
      target.searchParams.set('table', t.id);
      return { name: t.name, records_count: t.records_count, uri: 'feishu://document/' + target.href.slice(8) };
    });
    const end = offset + tables.length;
    const hasMore = tables.length > 0 && end < Number(data.total);
    return { format: 'bitable', url: url.href, tables, total: data.total, has_more: hasMore,
      ...(hasMore ? { next_cursor: String(end) } : {}) };
  }
  const view = url.searchParams.get('view');
  const page = await list(run, ['+record-list', ...args, '--table-id', table,
    ...(view ? ['--view-id', view] : []), '--limit', '5'], signal);
  if (!Array.isArray(page.fields) || !Array.isArray(page.data)) throw new FeishuError('service', '飞书未返回记录。');
  const fields = page.fields.slice(0, 16);
  const records = page.data.map(row => row.slice(0, fields.length).map(cell => {
    const text = typeof cell === 'string' ? cell : JSON.stringify(cell);
    const chars = Array.from(text);
    return chars.length > 400 ? chars.slice(0, 400).join('') + '…（节选）' : cell;
  }));
  const hasMore = page.has_more === true && records.length > 0;
  return { format: 'bitable', url: url.href, fields, total_fields: page.fields.length, records, offset,
    has_more: hasMore, ...(hasMore ? { next_cursor: String(offset + records.length) } : {}) };
}
