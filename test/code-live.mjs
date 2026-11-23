import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLiveReferences } from './check-live-references.mjs';
import { rpcClient } from './rpc-client.mjs';

const cli = fileURLToPath(new URL('../bin/larkref', import.meta.url));
const launcher = fileURLToPath(new URL('../plugins/larkref/launch', import.meta.url));
const dir = await realpath(await mkdtemp(join(tmpdir(), 'larkref-code-live-')));
const root = join(dir, 'project');
const env = { ...process.env, XDG_CACHE_HOME: join(dir, 'cache') };
const folder = join(root, '飞书');
let client;

async function catalog() {
  const result = new Map();
  for (const name of (await readdir(folder)).filter(n => !n.startsWith('.'))) {
    assert.ok(name.endsWith('）'), '引用应以对象类型标记结尾');
    const text = await readFile(join(folder, name), 'utf8');
    assert.ok(/^feishu:\/\/(chat|contact|document)\/[^\s]+\n$/.test(text), '每个引用文件只能含一个 URI');
    execFileSync('git', ['-C', root, 'check-ignore', '--quiet', '--', join('飞书', name)]);
    result.set(text.trimEnd(), name);
  }
  return result;
}

try {
  await mkdir(root);
  execFileSync('git', ['init', '-q', root]);
  const enable = () => {
    const start = performance.now();
    execFileSync(process.execPath, [cli, 'enable', root, '--files-only'], { env });
    return Math.round(performance.now() - start);
  };
  const cold = enable();
  const warm = enable();
  const recent = await catalog();
  assert.ok(recent.size, '需要至少一个近期飞书对象');
  console.log('临时 Code 项目已生成', recent.size, '项。首次生成', cold, 'ms，复用缓存', warm, 'ms。');
  client = rpcClient(launcher, ['--claude-code', root], { cwd: root, env });
  const hello = await client.request('initialize', { protocolVersion: '2025-11-25' });
  assert.equal(hello.serverInfo.version, JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version);
  client.notify('notifications/initialized');
  const call = (name, args) => client.request('tools/call', { name, arguments: args });
  const search = async query => {
    const res = await call('search_mentions', { query });
    assert.ok(!res.isError, 'Code 在线搜索失败');
    return res.structuredContent.items;
  };
  const read = async uri => {
    let selected = uri;
    if (!uri.includes('?table=')) {
      assert.ok(!(await call('save_reference', { uri })).isError, 'Code 收录已选对象失败');
      const name = (await catalog()).get(uri);
      assert.ok(name, '收录后应可按文件名找到该对象');
      selected = (await readFile(join(folder, name), 'utf8')).trimEnd();
    }
    const result = await call('read_context', { uri: selected });
    assert.ok(!result.isError && !JSON.parse(result.content[0].text).index_warning, 'Code 引用读取或收录失败');
    return { contents: [{ uri: selected, text: result.content[0].text }] };
  };
  await checkLiveReferences({ call, read, search });
  assert.ok(!(await call('refresh_index', {})).isError, 'Code 手动刷新失败');
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all']).length, 0);
  console.log('Code 本地选取、在线收录、刷新和 Git 忽略均已通过。');
} finally {
  client?.close();
  await rm(dir, { recursive: true, force: true });
}
