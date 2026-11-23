import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rpcClient } from './rpc-client.mjs';

test('Claude 扩展按清单启动，支持资源附件、同名选择、提示补全和只读工具', async t => {
  const root = fileURLToPath(new URL('../plugins/larkref/', import.meta.url));
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const dir = await mkdtemp(join(tmpdir(), 'larkref-claude-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'larkref'));
  const cli = join(dir, 'lark-cli');
  await writeFile(join(dir, 'larkref/settings.json'), JSON.stringify({ cliPath: cli }));
  await writeFile(cli, [
    '#!/usr/bin/env node',
    "const a = process.argv.slice(2);",
    "if (a[a.indexOf('--as') + 1] !== 'user') process.exit(1);",
    "let data;",
    "if (a[1] === '+chat-list' || a[1] === '+chat-search') data = {chats: ['oc_demo','oc_other'].map(chat_id => ({name:'项目组', description:'同一简介', chat_id}))};",
    "else if (a[0] === 'contact') data = {users: [{localized_name:'林青', open_id:'ou_one',department:'一组'}, {localized_name:'林青',open_id:'ou_two',department:'二组'}]};",
    "else if (a[0] === 'drive') data = {results: [{title:'计划',result_meta:{url:'https://example.feishu.cn/docx/demo'}}]};",
    "else if (a[1] === 'chats') data = {name:'项目组'};",
    "else if (a[1] === '+chat-messages-list') data = {messages:[{message_id:'om_demo',content:'已选消息'}]};",
    "else process.exit(2);",
    "console.log(JSON.stringify({ok:true,data}));",
  ].join('\n'), { mode: 0o700 });
  const config = manifest.server.mcp_config;
  const args = config.args.map(a => a.replace('${__dirname}', root));
  const client = rpcClient(process.execPath, args, { cwd: dir, env: { ...process.env, XDG_CONFIG_HOME: dir } });
  t.after(() => client.close());
  const hello = await client.request('initialize', { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'test', version: '1' } });
  client.notify('notifications/initialized');
  assert.equal(hello.serverInfo.name, manifest.name);
  assert.equal(hello.serverInfo.version, manifest.version);
  assert.deepEqual(hello.capabilities, { tools: {}, resources: {}, prompts: {}, completions: {} });
  const { resources } = await client.request('resources/list');
  assert.equal(resources.length, 5);
  assert.equal(new Set(resources.map(r => r.name)).size, 5);
  assert.ok(resources.every(r => !('text' in r) && !('content' in r)));
  const group = resources.find(r => r.uri === 'feishu://chat/oc_demo');
  assert.match(group.name, /项目组/);
  assert.match(group.name, /oc_demo/);
  const { contents } = await client.request('resources/read', { uri: group.uri });
  assert.equal(JSON.parse(contents[0].text).messages[0].text, '已选消息');

  const { prompts: [prompt] } = await client.request('prompts/list');
  const get = reference => client.request('prompts/get', { name: prompt.name, arguments: { reference } });
  const complete = value => client.request('completion/complete', { ref: { type: 'ref/prompt', name: prompt.name },
    argument: { name: 'reference', value } });
  const { completion } = await complete('林青');
  const second = completion.values.find(v => v.includes('ou_two'));
  assert.match(second, /二组/);
  await assert.rejects(get('林青'), /请先确认目标/);
  const chosen = await get(second);
  assert.match(chosen.messages[0].content.text, /feishu:\/\/contact\/ou_two/);
  assert.doesNotMatch(chosen.messages[0].content.text, /ou_one|林青/);
  assert.match((await get('https://example.feishu.cn/docx/demo')).messages[0].content.text, /feishu:\/\/document/);
  await assert.rejects(get('飞书 〈feishu://chat/oc_demo?other=oops〉'));
  await assert.rejects(get(''));
  const { tools } = await client.request('tools/list');
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
  const read = await client.request('tools/call', { name: 'read_context', arguments: { uri: group.uri } });
  assert.deepEqual(JSON.parse(read.content[0].text), JSON.parse(contents[0].text));
});
