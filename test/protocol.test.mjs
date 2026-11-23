import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rpcClient } from './rpc-client.mjs';

test('已打包的启动入口完成 MCP 握手、名称搜索、资源读取及错误处理', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'feishu-protocol-'));
  const fixture = join(dir, 'lark-cli.mjs');
  await mkdir(join(dir, 'codex-feishu'));
  await writeFile(join(dir, 'codex-feishu/settings.json'), JSON.stringify({
    cliPath: fixture, imProfile: 'chat-test', docsProfile: 'docs-test',
  }));
  // This executable enforces the two profiles and user identity on every request.
  await writeFile(fixture, [
    '#!/usr/bin/env node',
    "import assert from 'node:assert/strict';",
    'const a = process.argv.slice(2);',
    "assert.equal(a[0], '--profile');",
    "assert.equal(a[a.indexOf('--as') + 1], 'user');",
    "assert.equal(a[a.indexOf('--format') + 1], 'json');",
    "assert.equal(a[1], ['docs','drive'].includes(a[2]) ? 'docs-test' : 'chat-test');",
    'let data;',
    "if (a[3] === '+chat-search') data = {chats:[{chat_id:'oc_demo',name:'计划'}]};",
    "else if (a[3] === '+search-user') {",
    "  console.error('CLI notice');",
    "  console.error(JSON.stringify({ok:false,error:{message:'need_user_authorization'}}));",
    '  process.exit(1);',
    '}',
    "else if (a[3] === '+search') data = {results:[]};",
    "else if (a[3] === 'chats') data = {name:'计划'};",
    "else if (a[3] === '+chat-messages-list') {",
    "  assert.equal(a[a.indexOf('--chat-id')+1],'oc_demo');",
    "  data={messages:[{message_id:'om_demo', content:'验收样本'}],has_more:false};",
    '} else process.exit(2);',
    'console.log(JSON.stringify({ok:true,data}));',
  ].join('\n'), { mode: 0o700 });
  const launch = fileURLToPath(new URL('../plugins/feishu/launch', import.meta.url));
  const client = rpcClient(launch, [], { cwd: dir, env: { ...process.env, XDG_CONFIG_HOME: dir } });
  t.after(async () => { client.close(); await rm(dir, { recursive: true, force: true }); });
  const hello = await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(hello.protocolVersion, '2025-06-18');
  const tool = hello.capabilities.experimental['openai/mentions'].searchTool;
  client.notify('notifications/initialized');
  assert.deepEqual(await client.request('ping'), {});
  const discovery = await client.request('tools/list');
  assert.deepEqual(discovery.tools.map(t => t.name), ['search_mentions', 'read_context']);
  assert.ok(discovery.tools.every(t => t.annotations.readOnlyHint));
  assert.ok(discovery.tools[0]._meta['openai/extensions']['mentions/search']);
  const lookup = await client.request('tools/call', { name: tool, arguments: { query: '计划', path: [] } });
  const [group, warning] = lookup.structuredContent.items;
  assert.equal(warning.uri, 'feishu://status/contact/auth');
  const ref = await client.request('resources/read', { uri: group.uri });
  const data = JSON.parse(ref.contents[0].text);
  assert.equal(data.title, '计划');
  assert.equal(data.messages[0].text, '验收样本');
  const fallback = await client.request('tools/call', { name: 'read_context', arguments: { uri: group.uri } });
  assert.deepEqual(JSON.parse(fallback.content[0].text), data);
  assert.deepEqual((await client.request('resources/list')).resources, []);
  assert.equal((await client.request('resources/templates/list')).resourceTemplates.length, 3);
  await assert.rejects(client.request('resources/read', { uri: 'bad-resource' }));
  await assert.rejects(client.request('tools/call', { name: 'unknown' }));
  assert.ok((await client.request('tools/call', { name: 'read_context', arguments: { uri: 'bad-resource' } })).isError);
});
