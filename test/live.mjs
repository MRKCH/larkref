import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rpcClient } from './rpc-client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const codex = process.env.FEISHU_TEST_CODEX || (existsSync(desktop) ? desktop : 'codex');
const client = rpcClient(codex, ['app-server', '--listen', 'stdio://'], { cwd: root });

try {
  await client.request('initialize', {
    clientInfo: { name: 'feishu-acceptance', title: '飞书只读验收', version: '1' },
    capabilities: { experimentalApi: true },
  });
  client.notify('initialized');
  const { thread } = await client.request('thread/start', { cwd: root, ephemeral: true, sandbox: 'read-only' });
  const threadId = thread.id;
  const inventory = await client.request('mcpServerStatus/list', { threadId, serverName: 'feishu' });
  const server = inventory.data.find(s => s.pluginId === 'larkref@larkref');
  assert.ok(server, '请先安装并启用 larkref@larkref');
  assert.equal(server.name, 'feishu');
  const capability = server.serverCapabilities.experimental?.['openai/mentions'] ??
    server.serverCapabilities.extensions?.['openai/mentions'];
  assert.equal(capability?.searchTool, 'search_mentions');
  const mentionTool = server.tools[capability.searchTool];
  assert.equal(mentionTool._meta?.connector_name ?? server.serverInfo?.title, '飞书');
  const call = (tool, args) => client.request('mcpServer/tool/call', { threadId, server: server.name, tool, arguments: args });
  const search = async query => {
    const response = await call(capability.searchTool, { query });
    assert.ok(!response.isError, '提及搜索调用失败');
    return response.structuredContent.items;
  };
  const recent = await search('');
  // Avoid logging names, message bodies, document contents, identifiers or access tokens.
  for (const category of ['chat', 'contact', 'document', 'base']) {
    const kind = category === 'base' ? 'document' : category;
    const keyword = process.env['FEISHU_TEST_' + category.toUpperCase() + '_QUERY'];
    const candidates = keyword ? await search(keyword) : recent;
    const example = candidates.find(item => new URL(item.uri).host === kind &&
      (kind !== 'document' || item.description.startsWith(category === 'base' ? '多维表格' : '文档')));
    assert.ok(example, '请通过 FEISHU_TEST_' + category.toUpperCase() + '_QUERY 指定一个可见的验收对象');
    const matches = await search(example.title);
    const chosen = matches.find(item => item.uri === example.uri);
    assert.ok(chosen, kind + ' 名称搜索未返回同一对象');
    assert.equal(chosen.type, 'resource_link');
    const { contents } = await client.request('mcpServer/resource/read', { threadId, server: server.name, uri: chosen.uri });
    assert.equal(contents[0].uri, chosen.uri);
    const result = JSON.parse(contents[0].text);
    assert.equal(result.source_uri, chosen.uri);
    assert.equal(result.kind, kind);
    if (category === 'base') {
      assert.equal(result.format, 'bitable');
      assert.ok(result.tables.length > 0, '验收多维表格应有数据表');
      const tableURI = result.tables[0].uri;
      const sample = await client.request('mcpServer/resource/read', { threadId, server: server.name, uri: tableURI });
      const table = JSON.parse(sample.contents[0].text);
      assert.equal(table.source_uri, tableURI);
      assert.ok(Array.isArray(table.records) && Array.isArray(table.fields));
      console.log('多维表格搜索、目录和记录读取通过。数据表数', result.tables.length, '样本行数', table.records.length);
    } else if (kind === 'document') {
      assert.equal(typeof result.content, 'string');
      assert.ok(result.content.length > 0, '验收文档应有正文');
      console.log('文档名称搜索、资源引用和正文读取通过。正文字符数', Array.from(result.content).length);
    } else {
      assert.ok(Array.isArray(result.messages) && result.messages.length > 0, '验收会话应有消息');
      console.log((kind === 'chat' ? '群聊' : '联系人') + '名称搜索、资源引用和聊天记录读取通过。消息数', result.messages.length);
    }
    if (result.next_cursor) {
      const page = await call('read_context', { uri: chosen.uri, cursor: result.next_cursor });
      assert.ok(!page.isError, '翻页失败');
      const more = JSON.parse(page.content[0].text);
      assert.equal(more.source_uri, result.source_uri);
      if (more.messages) {
        const previous = new Set(result.messages.map(m => m.message_id));
        assert.ok(more.messages.every(m => !previous.has(m.message_id)), '翻页出现重复消息');
      }
      console.log(kind, '续页通过');
    }
  }
} finally {
  client.close();
}
