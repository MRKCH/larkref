import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdtemp, open, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { parseReference } from './context.mjs';
import { writeJson } from './index-storage.mjs';

const exec = promisify(execFile);
const marker = '.larkref-index.json';
const manifestVersion = 2;
const referenceEnding = /（(?:群聊|联系人|文档|多维表格)(?:·[A-Za-z0-9_-]{1,64})?）$/u;
const ignore = '*\n';
const labels = { chat: '群聊', contact: '联系人', document: '文档' };
const folded = name => name.normalize('NFC').toLowerCase();

export function indexEntry(item) {
  const { kind, uri, id } = parseReference(item.uri);
  if (kind === 'status') return null;
  const base = kind === 'document' && (id.split('/')[1] === 'base' || item.description?.startsWith('多维表格'));
  return { uri, title: String(item.title || item.name || id).slice(0, 512), type: base ? '多维表格' : labels[kind] };
}

function stem(title) {
  const clean = title.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().replace(/^\.+|[. ]+$/gu, '');
  let result = '';
  for (const ch of clean) {
    if (Buffer.byteLength(result + ch) > 160) break;
    result += ch;
  }
  return result || '未命名';
}

async function smallText(path, limit = 4096) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    return stat.isFile() && stat.size <= limit ? await file.readFile('utf8') : null;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    if (['ELOOP', 'EMLINK', 'EISDIR', 'ENXIO'].includes(error.code)) return null;
    throw error;
  } finally { await file?.close(); }
}

async function checkTracked(root) {
  try {
    const { stdout } = await exec('git', ['-C', root, 'ls-files', '-z', '--', '飞书'], {
      env: { ...process.env, LC_ALL: 'C' },
    });
    if (stdout) throw new Error('Git 已跟踪此项目的「飞书」路径，请先为索引腾出本机专用目录。');
  } catch (error) {
    if (error.code !== 128 || !error.stderr?.includes('not a git repository')) throw error;
  }
}

function validateManifest(state) {
  if (![1, manifestVersion].includes(state?.version) || !state.files || Array.isArray(state.files) || typeof state.files !== 'object' ||
      !Array.isArray(state.saved) || !(state.account === null || /^[a-f0-9]{64}$/.test(state.account))) throw new Error();
  for (const [name, uri] of Object.entries(state.files)) {
    // A v2 migration journal can temporarily own both names for a reference.
    const validEnding = name.endsWith('.md') || (state.version === manifestVersion && referenceEnding.test(name));
    if (!validEnding || basename(name) !== name || /[\\/\0]/.test(name) || name.startsWith('.')) throw new Error();
    if (parseReference(uri).kind === 'status') throw new Error();
  }
  for (const entry of state.saved) {
    if (typeof entry.title !== 'string' || !['群聊','联系人','文档','多维表格'].includes(entry.type) ||
        parseReference(entry.uri).kind === 'status') throw new Error();
  }
  return state;
}

export async function workspace(rootPath, enable = false) {
  const root = await realpath(rootPath);
  const dir = join(root, '飞书');
  const stat = await lstat(dir).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!stat && !enable) throw new Error('该项目尚未启用飞书引用，请先运行 larkref enable。');
  if (stat && !stat.isDirectory()) throw new Error('项目的「飞书」路径已被占用。');
  await checkTracked(root);
  if (!stat) {
    const stage = await mkdtemp(join(root, '.larkref-init-'));
    try {
      await writeFile(join(stage, '.gitignore'), ignore, { mode: 0o600 });
      await writeJson(join(stage, marker), { version: manifestVersion, account: null, files: {}, saved: [] });
      await rename(stage, dir);
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  let state;
  try {
    state = validateManifest(JSON.parse(await smallText(join(dir, marker), 1024 * 1024)));
  } catch {
    throw new Error('「飞书」目录已有其他内容或管理清单损坏，无法接管。');
  }
  if (await smallText(join(dir, '.gitignore')) !== ignore) {
    throw new Error('「飞书/.gitignore」已变更，请恢复为单独一行 * 后重试。');
  }
  return { dir, state };
}

function* possibleNames(entry) {
  const prefix = stem(entry.title) + '（' + entry.type;
  yield prefix + '）';
  const id = parseReference(entry.uri).id.split('?')[0].split('/').at(-1);
  yield prefix + '·' + id.slice(-8) + '）';
  const hash = createHash('sha256').update(entry.uri).digest('hex');
  for (let length = 8; length <= hash.length; length += 4) {
    yield prefix + '·' + hash.slice(0, length) + '）';
  }
}

function fileName(entry, reserved) {
  let available;
  for (const name of possibleNames(entry)) {
    const owner = reserved.get(folded(name));
    if (owner === entry.uri) return name;
    if (owner === undefined) available ??= name;
  }
  if (available) return available;
  throw new Error('本机引用文件名冲突，请检查「飞书」目录。');
}

async function createReference(dir, name, uri) {
  const tmp = join(dir, '.larkref-' + randomUUID() + '.tmp');
  try {
    await writeFile(tmp, uri + '\n', { flag: 'wx', mode: 0o600 });
    // Publish a complete file without overwriting a concurrently created user file.
    await link(tmp, join(dir, name));
  } finally { await rm(tmp, { force: true }); }
}

export async function render(folder, account, recent, saved) {
  const { dir, state } = folder;
  const reserved = new Map();
  const present = new Map();
  for (const name of await readdir(dir)) {
    const uri = state.files[name.normalize('NFC')];
    const owned = uri && await smallText(join(dir, name)) === uri + '\n';
    reserved.set(folded(name), owned ? uri : false);
    if (owned) present.set(folded(name), name.normalize('NFC'));
  }
  // Keep each legacy item's disambiguation, even if the source now returns its
  // namesakes in another order. An existing extensionless path takes precedence.
  for (const [key, name] of present) {
    if (!name.endsWith('.md')) continue;
    const target = folded(name.slice(0, -3));
    if (!reserved.has(target)) reserved.set(target, reserved.get(key));
  }
  const entries = new Map([...recent, ...saved].map(e => [e.uri, e]));
  const files = {};
  // Existing owners get first choice even if two search results change order.
  for (const [uri, entry] of entries) {
    const proposed = fileName(entry, reserved);
    const name = present.get(folded(proposed)) || proposed;
    files[name] = uri;
    reserved.set(folded(name), uri);
  }
  const next = { version: manifestVersion, account, files, saved };
  const changed = JSON.stringify(state) !== JSON.stringify(next);
  // Journal additions before publishing. After a crash the next run can reclaim
  // any complete file that was created or retired partway through this update.
  if (changed) await writeJson(join(dir, marker), { ...next, files: { ...state.files, ...files } });
  for (const [name, uri] of Object.entries(files)) {
    if (!present.has(folded(name))) await createReference(dir, name, uri);
  }
  const keep = new Set(Object.keys(files).map(folded));
  for (const [name, uri] of Object.entries(state.files)) {
    if (!keep.has(folded(name)) && await smallText(join(dir, name)) === uri + '\n') await unlink(join(dir, name));
  }
  if (changed) await writeJson(join(dir, marker), next);
  folder.state = next;
  return Object.keys(files).length;
}

export async function removeWorkspace(root) {
  const folder = await workspace(root);
  await render(folder, null, [], []);
  const others = (await readdir(folder.dir)).filter(name => name !== marker && name !== '.gitignore');
  await unlink(join(folder.dir, marker));
  if (!others.length) {
    await unlink(join(folder.dir, '.gitignore'));
    await rmdir(folder.dir);
  }
  return { preserved: others.length };
}
