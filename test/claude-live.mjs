import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLiveReferences } from './check-live-references.mjs';
import { rpcClient } from './rpc-client.mjs';

const archive = fileURLToPath(new URL('../dist/larkref.mcpb', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'larkref-mcpb-'));
let client;
try {
  execFileSync('python3', ['-m', 'zipfile', '-e', archive, dir]);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const config = manifest.server.mcp_config;
  assert.equal(config.command, 'node');
  client = rpcClient(process.execPath, config.args.map(a => a.replace('${__dirname}', dir)), { cwd: dir });
  const hello = await client.request('initialize', { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'larkref-mcpb-acceptance', version: '1' } });
  assert.equal(hello.serverInfo.version, manifest.version);
  client.notify('notifications/initialized');
  const call = (name, args) => client.request('tools/call', { name, arguments: args });
  const read = uri => client.request('resources/read', { uri });
  const search = async query => {
    const result = await call('search_mentions', { query });
    assert.ok(!result.isError, '飞书名称搜索失败');
    return result.structuredContent.items;
  };
  const { resources } = await client.request('resources/list');
  const example = resources.find(r => r.uri.startsWith('feishu://chat/')) ??
    resources.find(r => !r.uri.startsWith('feishu://status/'));
  assert.ok(example, '近期列表需要至少一个可见对象');
  const { prompts: [prompt] } = await client.request('prompts/list');
  const { completion } = await client.request('completion/complete', {
    ref: { type: 'ref/prompt', name: prompt.name }, argument: { name: 'reference', value: '' },
  });
  const reference = completion.values.find(v => v.endsWith('〈' + example.uri + '〉'));
  assert.ok(reference, '近期引用应可通过补全选中');
  const selected = await client.request('prompts/get', { name: prompt.name, arguments: { reference } });
  assert.ok(selected.messages[0].content.text.includes(example.uri));
  console.log('Claude 安装包启动、近期资源、名称补全和稳定引用通过。');
  await checkLiveReferences({ search, read, call });
} finally {
  client?.close();
  await rm(dir, { recursive: true, force: true });
}
