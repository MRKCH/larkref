import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { disableProject, refreshInterval, syncProject } from '../plugins/larkref/project-index.mjs';
import { cacheDirectory, withIndexLock } from '../plugins/larkref/index-storage.mjs';

const item = (uri, title, description = '不应写入引用正文') => ({ uri: 'feishu://' + uri, title, description });
const initial = [item('chat/oc_a', '发布'), item('contact/ou_a', '清禾'),
  item('document/example.feishu.cn/wiki/abc', '计划', '多维表格 · 示例')];

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'larkref-files-'));
  const root = join(dir, '项目');
  await mkdir(root);
  execFileSync('git', ['init', '-q', root]);
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(dir, 'cache');
  t.after(async () => {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const data = { rows: initial.slice(), account: 'A', calls: 0 };
  const sources = {
    accounts: async () => [data.account, data.account],
    recent: async () => { data.calls++; await delay(12); return data.rows; },
  };
  const sync = options => syncProject(root, options, sources);
  const refs = async () => {
    const folder = join(root, '飞书');
    const names = (await readdir(folder)).filter(n => !n.startsWith('.'));
    return new Map(await Promise.all(names.map(async n => [n.normalize('NFC'), await readFile(join(folder, n), 'utf8')])));
  };
  return { dir, root, folder: join(root, '飞书'), data, sync, sources, refs };
}

test('并发启用共享近期快照，引用仅含 URI，刷新不改写未变化的文件', async t => {
  const f = await fixture(t);
  const second = join(f.dir, '其他项目');
  await mkdir(second);
  f.data.rows.push(item('chat/oc_b', '发布'), item('chat/oc_c', '../目录/坏\n名称'),
    item('chat/oc_long', '海'.repeat(500)));
  const [one, two] = await Promise.all([f.sync({ enable: true }), syncProject(second, { enable: true }, f.sources)]);
  assert.equal(f.data.calls, 1);
  assert.equal(one.total, 6);
  assert.equal(two.total, 6);
  const names = await f.refs();
  assert.equal(names.get('发布（群聊）'), 'feishu://chat/oc_a\n');
  assert.equal(names.get('发布（群聊·oc_b）'), 'feishu://chat/oc_b\n');
  assert.equal(names.get('计划（多维表格）'), 'feishu://document/example.feishu.cn/wiki/abc\n');
  assert.ok([...names.keys()].every(name => Buffer.byteLength(name) <= 255 && name.endsWith('）')));
  assert.equal(execFileSync('git', ['-C',f.root,'status','--porcelain','--untracked-files=all']).toString(), '');
  const path = join(f.folder, '发布（群聊）');
  const before = await stat(path);
  f.data.rows.reverse();
  await f.sync({ force: true });
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
  const duplicate = join(f.folder, '发布（群聊·oc_b）');
  const duplicateTime = (await stat(duplicate)).mtimeMs;
  f.data.rows = f.data.rows.filter(entry => entry.uri !== 'feishu://chat/oc_a');
  await f.sync({ force: true });
  await f.sync({});
  assert.equal((await stat(duplicate)).mtimeMs, duplicateTime);
  await f.sync({ selected: item('chat/oc_extra','项目专属') });
  assert.ok([...await readdir(join(second,'飞书'))].every(n => !n.includes('项目专属')));
});

test('分类失败保留上次成功数据，撤权或账号变化不沿用旧候选', async t => {
  const f = await fixture(t);
  await f.sync({ enable: true });
  await f.sync({ selected: item('chat/oc_saved','已选群') });
  await f.sync({ selected: item('contact/ou_saved','已选人') });
  f.data.rows = [item('status/chat/service','临时错误'), item('status/contact/permission','缺权限')];
  const partial = await f.sync({ force: true });
  assert.deepEqual(partial.errors, { chat: 'service', contact: 'permission' });
  assert.deepEqual(new Set((await f.refs()).values()), new Set(['feishu://chat/oc_a\n','feishu://chat/oc_saved\n']));
  f.data.account = 'B';
  f.data.rows = [item('contact/ou_b','新账号')];
  await f.sync({});
  assert.deepEqual([...(await f.refs()).values()], ['feishu://contact/ou_b\n']);
  await assert.rejects(f.sync({ selected: initial[0], expectedAccount: 'old' }), /账号已切换/);
});

test('拒绝接管现有目录及跟踪文件，保留被用户编辑的引用和符号链接', async t => {
  const f = await fixture(t);
  await mkdir(f.folder);
  await writeFile(join(f.folder,'私有.md'),'用户内容');
  await assert.rejects(f.sync({ enable: true }), /无法接管/);
  execFileSync('git',['-C',f.root,'add','飞书']);
  await rename(f.folder,join(f.root,'原目录'));
  await assert.rejects(f.sync({ enable: true }), /Git 已跟踪/);
  execFileSync('git',['-C',f.root,'rm','--cached','-r','飞书']);
  await symlink(join(f.root,'原目录'),f.folder,'dir');
  await assert.rejects(f.sync({ enable: true }), /占用/);
  await rm(f.folder);
  await f.sync({ enable: true });
  const edited = join(f.folder,'发布（群聊）');
  await writeFile(edited,'用户的批注');
  await symlink(join(f.root,'原目录','私有.md'),join(f.folder,'同名（群聊）'));
  f.data.rows.push(item('chat/oc_link','同名'));
  await f.sync({ force: true });
  assert.equal(await readFile(edited,'utf8'),'用户的批注');
  assert.equal((await disableProject(f.root)).preserved,2);
  assert.equal(await readFile(join(f.root,'原目录','私有.md'),'utf8'),'用户内容');
  assert.equal(await readFile(edited,'utf8'),'用户的批注');
});

test('旧项目去掉 .md 后缀，保留重名对象的对应关系、已选对象和用户文件', async t => {
  const f = await fixture(t);
  f.data.rows.push(item('chat/oc_b', '发布'));
  await f.sync({ enable: true });
  await f.sync({ selected: item('chat/oc_saved', '版本 v1.2') });
  const marker = join(f.folder, '.larkref-index.json');
  const current = JSON.parse(await readFile(marker, 'utf8'));
  const legacy = {
    '发布（群聊）.md': 'feishu://chat/oc_b',
    '发布（群聊·oc_a）.md': 'feishu://chat/oc_a',
    '清禾（联系人）.md': initial[1].uri,
    '计划（多维表格）.md': initial[2].uri,
    '版本 v1.2（群聊）.md': 'feishu://chat/oc_saved',
  };
  for (const name of Object.keys(current.files)) await rm(join(f.folder, name));
  for (const [name, uri] of Object.entries(legacy)) await writeFile(join(f.folder, name), uri + '\n');
  await writeFile(marker, JSON.stringify({ ...current, version: 1, files: legacy }));
  await writeFile(join(f.folder, '计划（多维表格）.md'), '手写批注');
  // This unrelated file already occupies the new name, even with identical bytes.
  await writeFile(join(f.folder, '清禾（联系人）'), initial[1].uri + '\n');

  assert.ok((await f.sync({})).cached);
  const upgraded = JSON.parse(await readFile(marker, 'utf8'));
  assert.equal(upgraded.version, 2);
  assert.deepEqual(upgraded.saved, current.saved);
  assert.deepEqual(upgraded.files, {
    '发布（群聊）': 'feishu://chat/oc_b',
    '发布（群聊·oc_a）': 'feishu://chat/oc_a',
    '清禾（联系人·ou_a）': initial[1].uri,
    '计划（多维表格）': initial[2].uri,
    '版本 v1.2（群聊）': 'feishu://chat/oc_saved',
  });
  for (const [name, uri] of Object.entries(upgraded.files)) {
    assert.equal(await readFile(join(f.folder, name), 'utf8'), uri + '\n');
  }
  assert.deepEqual((await readdir(f.folder)).filter(n => n.endsWith('.md')), ['计划（多维表格）.md']);
  await f.sync({});
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), upgraded);
  assert.equal((await disableProject(f.root)).preserved, 2);
  assert.equal(await readFile(join(f.folder, '计划（多维表格）.md'), 'utf8'), '手写批注');
  assert.equal(await readFile(join(f.folder, '清禾（联系人）'), 'utf8'), initial[1].uri + '\n');
});

test('已中断的索引发布可以重试，已退出进程的锁不会阻塞新窗口', async t => {
  const f = await fixture(t);
  await f.sync({ enable: true });
  const marker = join(f.folder,'.larkref-index.json');
  const journal = JSON.parse(await readFile(marker,'utf8'));
  journal.files['旧名（群聊）.md'] = 'feishu://chat/oc_old';
  journal.files['发布（群聊）.md'] = initial[0].uri;
  await writeFile(marker,JSON.stringify(journal));
  await writeFile(join(f.folder,'旧名（群聊）.md'),'feishu://chat/oc_old\n');
  await writeFile(join(f.folder,'发布（群聊）.md'), initial[0].uri + '\n');
  await rm(join(f.folder,'清禾（联系人）'));
  const dead = join(cacheDirectory(), 'locks','2147483646-dead');
  await mkdir(dead);
  await f.sync({});
  assert.deepEqual(new Set((await f.refs()).values()),new Set(initial.map(e=>e.uri+'\n')));
  assert.deepEqual((await readdir(f.folder)).filter(n => n.endsWith('.md')), []);
  await assert.rejects(stat(dead),{code:'ENOENT'});
  await assert.rejects(withIndexLock(() => { throw new Error('模拟中断'); }),/模拟中断/);
  assert.equal(await withIndexLock(() => 1),1);
});

test('新项目可先使用过期快照，然后按最新结果更新目录', async t => {
  const f = await fixture(t);
  await f.sync({ enable: true });
  const cache = cacheDirectory();
  const snapshot = join(cache, (await readdir(cache)).find(name => name.endsWith('.json')));
  const previous = JSON.parse(await readFile(snapshot, 'utf8'));
  previous.checkedAt = Date.now() - 2 * refreshInterval;
  await writeFile(snapshot, JSON.stringify(previous));
  const second = join(f.dir, '新项目');
  await mkdir(second);
  const sources = {
    ...f.sources,
    recent: async () => {
      const stub = await readFile(join(second, '飞书', '发布（群聊）'), 'utf8');
      assert.equal(stub, initial[0].uri + '\n');
      return [item('chat/oc_new', '新群')];
    },
  };
  const result = await syncProject(second, { enable: true }, sources);
  assert.equal(result.total, 1);
  assert.equal(await readFile(join(second, '飞书', '新群（群聊）'), 'utf8'), 'feishu://chat/oc_new\n');
  await assert.rejects(stat(join(second, '飞书', '发布（群聊）')), { code: 'ENOENT' });
});

test('项目保留最近确认的 50 个不同对象，重复选择会更新顺序', async t => {
  const f = await fixture(t);
  await f.sync({ enable: true });
  const choose = id => f.sync({ selected: item('chat/oc_saved' + id, '群' + id) });
  for (let i = 0; i < 50; i++) await choose(i);
  await choose(0);
  const result = await choose(50);
  assert.equal(result.saved, 50);
  const refs = await f.refs();
  assert.equal(refs.size, 50 + initial.length);
  assert.ok(refs.has('群0（群聊）') && refs.has('群50（群聊）') && !refs.has('群1（群聊）'));
});
