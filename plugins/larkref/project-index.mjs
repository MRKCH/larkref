import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { indexAccounts } from './cli.mjs';
import { parseReference, searchMentions } from './context.mjs';
import { indexEntry, removeWorkspace, render, workspace } from './index-files.mjs';
import { withIndexLock, writeJson } from './index-storage.mjs';

export const refreshInterval = 5 * 60_000;
const savedLimit = 50;
const kinds = ['chat', 'contact', 'document'];
const inaccessible = reason => ['auth', 'permission', 'missing'].includes(reason);
const kindOf = entry => parseReference(entry.uri).kind;
const keyOf = accounts => createHash('sha256').update(JSON.stringify(accounts)).digest('hex');
export const currentAccount = async signal => keyOf(await indexAccounts(signal));

const defaultSources = { accounts: indexAccounts, recent: signal => searchMentions('', signal) };

function mergeResults(previous, items, accounts) {
  const errors = {};
  const entries = [];
  for (const item of items) {
    const ref = parseReference(item.uri);
    if (ref.kind === 'status') {
      const [kind, reason] = ref.id.split('/');
      errors[kind] = reason;
    } else entries.push(indexEntry(item));
  }
  if (!accounts[0]) errors.chat = errors.contact = 'auth';
  if (!accounts[1]) errors.document = 'auth';
  const recent = kinds.flatMap(kind => {
    if (errors[kind] === 'service') return previous.filter(item => kindOf(item) === kind);
    return errors[kind] ? [] : entries.filter(item => kindOf(item) === kind);
  });
  return { recent, errors };
}

async function readSnapshot(path) {
  const empty = { checkedAt: 0, recent: [], errors: {} };
  let json;
  try {
    json = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return empty;
    throw error;
  }
  try {
    const cached = JSON.parse(json);
    if (Number.isFinite(cached.checkedAt) && cached.errors && Array.isArray(cached.recent) &&
        cached.recent.every(entry => typeof entry.title === 'string' && kinds.includes(kindOf(entry)))) return cached;
  } catch { /* A cache can always be rebuilt from the account's recent list. */ }
  return empty;
}

export async function syncProject(root, options = {}, sources = defaultSources) {
  const started = Date.now();
  const { enable = false, force = false, selected, observedAt, expectedAccount, signal } = options;
  return withIndexLock(async cache => {
    const folder = await workspace(root, enable);
    const accounts = await sources.accounts(signal);
    const account = keyOf(accounts);
    const path = join(cache, account + '.json');
    let snapshot = await readSnapshot(path);
    const sameAccount = folder.state.account === account;
    let saved = sameAccount ? folder.state.saved : [];
    const now = Date.now();
    const shouldFetch = force ? snapshot.checkedAt < started || snapshot.checkedAt > now :
      !selected && (now - snapshot.checkedAt >= refreshInterval || snapshot.checkedAt > now);
    if (!sameAccount || (shouldFetch && snapshot.checkedAt)) {
      await render(folder, account, snapshot.recent, saved);
    }
    if (expectedAccount && expectedAccount !== account) throw new Error('飞书账号已切换，请用当前账号重新搜索。');
    if (shouldFetch) {
      const rows = accounts.some(Boolean) ? await sources.recent(signal) : [];
      if (account !== keyOf(await sources.accounts(signal))) {
        await render(folder, null, [], []);
        throw new Error('刷新期间飞书账号已切换，请重新刷新。');
      }
      snapshot = { checkedAt: Date.now(), ...mergeResults(snapshot.recent, rows, accounts) };
      await writeJson(path, snapshot);
    }
    const recent = new Map(snapshot.recent.map(item => [item.uri, item]));
    saved = saved.filter(item => item.selectedAt > snapshot.checkedAt || !inaccessible(snapshot.errors[kindOf(item)]))
      .map(item => recent.has(item.uri) && snapshot.checkedAt > item.selectedAt ?
        { ...recent.get(item.uri), selectedAt: item.selectedAt } : item);
    if (selected) {
      const entry = indexEntry(selected);
      if (!entry || !accounts[kindOf(entry) === 'document' ? 1 : 0]) throw new Error('当前账号无法收录该引用。');
      if (selected.preferKnownTitle) {
        const known = recent.get(entry.uri) || saved.find(item => item.uri === entry.uri);
        if (known) entry.title = known.title;
      }
      if (observedAt <= snapshot.checkedAt && inaccessible(snapshot.errors[kindOf(entry)])) {
        throw new Error('该类型的访问权限已变化，请重新搜索并确认引用。');
      }
      // A successful live search authorizes this particular result even if an
      // earlier listing for the same category failed.
      saved = [{ ...entry, selectedAt: Date.now() }, ...saved.filter(item => item.uri !== entry.uri)].slice(0, savedLimit);
    }
    const total = await render(folder, account, snapshot.recent, saved);
    return { total, saved: saved.length, cached: !shouldFetch, updatedAt: snapshot.checkedAt, errors: snapshot.errors };
  }, signal);
}

export function disableProject(root) {
  return withIndexLock(() => removeWorkspace(root));
}
