import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { refreshInterval } from '../plugins/larkref/project-index.mjs';
import { rpcClient } from './rpc-client.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/larkref', import.meta.url));
const launch = fileURLToPath(new URL('../plugins/larkref/launch', import.meta.url));

test('Code 项目启用、多进程复用缓存、只收录选定候选、按 URI 读取及停用', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'larkref-code-')));
  const root = join(dir, '测试项目');
  const other = join(dir, '另一个项目');
  const config = join(dir, 'larkref');
  const fixture = join(dir, 'lark-cli.mjs');
  const account = join(dir, 'account');
  const calls = join(dir, 'calls');
  const env = { ...process.env, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: join(dir, 'cache'),
    TEST_FEISHU_ACCOUNT: account, TEST_FEISHU_CALLS: calls };
  let client;
  t.after(async () => { client?.close(); await rm(dir, { recursive: true, force: true }); });
  await Promise.all([mkdir(root), mkdir(other), mkdir(config)]);
  await copyFile(new URL('./fixtures/code-lark.mjs', import.meta.url), fixture);
  await chmod(fixture, 0o700);
  await writeFile(account, 'first');
  await writeFile(join(config, 'settings.json'), JSON.stringify({ cliPath: fixture }));
  const manage = (action, path) => exec(process.execPath, [cli, action, path, '--files-only'], { env });
  const listCalls = async () => (await readFile(calls, 'utf8')).split('\n').filter(c => c === 'im +chat-list').length;
  const folder = join(root, '飞书');
  async function references(path = folder) {
    const names = (await readdir(path)).filter(n => !n.startsWith('.'));
    assert.ok(names.every(name => name.endsWith('）')));
    return Promise.all(names.map(n => readFile(join(path, n), 'utf8')));
  }
  await Promise.all([manage('enable', root), manage('enable', other)]);
  assert.equal(await listCalls(), 1);
  const baseline = ['feishu://chat/oc_recent_first\n'];
  assert.deepEqual(await references(), baseline);
  const snapshots = join(env.XDG_CACHE_HOME, 'larkref', 'references-v1');
  const snapshot = join(snapshots, (await readdir(snapshots)).find(n => n.endsWith('.json')));
  const nearingExpiry = JSON.parse(await readFile(snapshot, 'utf8'));
  nearingExpiry.checkedAt = Date.now() - refreshInterval + 1200;
  await writeFile(snapshot, JSON.stringify(nearingExpiry));

  async function start() {
    client = rpcClient(launch, ['--claude-code', root], { cwd: other, env });
    const hello = await client.request('initialize', { protocolVersion: '2025-11-25' });
    client.notify('notifications/initialized');
    assert.match(hello.instructions, /飞书\/.*无后缀引用文件/);
  }
  await start();
  const tool = (name, args) => client.request('tools/call', { name, arguments: args });
  const tools = (await client.request('tools/list')).tools;
  assert.deepEqual(tools.map(item => item.name), ['search_mentions', 'read_context', 'save_reference', 'refresh_index']);
  assert.ok((await client.request('prompts/list')).prompts.some(p => p.name === 'feishu-search'));
  const prompt = await client.request('prompts/get', { name: 'feishu-search', arguments: { query: '同名' } });
  assert.match(prompt.messages[0].content.text, /等待我选定/);
  const search = await tool('search_mentions', { query: '同名' });
  const [north, south, west] = search.structuredContent.items;
  assert.equal(north.title, south.title);
  assert.notEqual(north.uri, south.uri);
  assert.deepEqual(await references(), baseline);
  assert.ok((await tool('save_reference', { uri: 'feishu://chat/oc_unseen' })).isError);
  assert.ok(!(await tool('save_reference', { uri: south.uri })).isError);
  assert.deepEqual(new Set(await references()), new Set([...baseline, south.uri + '\n']));
  // A running MCP refreshes when the shared snapshot expires, with no CLI
  // command, model request, or new session triggering that refresh.
  const deadline = Date.now() + 8000;
  while (await listCalls() < 2 && Date.now() < deadline) await delay(100);
  assert.equal(await listCalls(), 2);

  // A restarted MCP process can re-run the original search and recover a chosen URI.
  client.close();
  await start();
  assert.ok(!(await tool('save_reference', { uri: south.uri, query: '同名' })).isError);
  const chosen = await tool('read_context', { uri: north.uri });
  assert.equal(JSON.parse(chosen.content[0].text).messages[0].text, '虚构的群聊正文仅用于读取验收');
  assert.deepEqual(new Set(await references()), new Set([...baseline, north.uri + '\n', south.uri + '\n']));
  assert.deepEqual(await references(join(other, '飞书')), baseline);
  assert.doesNotMatch(await readFile(join(folder, '.larkref-index.json'), 'utf8'), /群聊正文/);
  const direct = (await tool('search_mentions', { query: 'oc_direct' })).structuredContent.items[0];
  assert.match((await tool('save_reference', { uri: direct.uri })).content[0].text, /先用 read_context/);
  assert.ok(!(await tool('read_context', { uri: direct.uri })).isError);
  assert.ok((await references()).includes(direct.uri + '\n'));
  const before = await listCalls();
  assert.ok(!(await tool('refresh_index', {})).isError);
  assert.equal(await listCalls(), before + 1);
  await writeFile(account, 'second');
  assert.match((await tool('save_reference', { uri: west.uri })).content[0].text, /账号已切换/);
  assert.ok(!(await tool('refresh_index', {})).isError);
  assert.deepEqual(await references(), ['feishu://chat/oc_recent_second\n']);
  await writeFile(account, 'unknown');
  assert.equal((await tool('search_mentions', { query: '同名' })).structuredContent.items.length, 3);
  assert.match((await tool('save_reference', { uri: north.uri })).content[0].text, /无法确认/);
  client.close();
  client = null;
  await manage('disable', root);
  await assert.rejects(readdir(folder), { code: 'ENOENT' });
});
