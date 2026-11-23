import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rpcClient } from './rpc-client.mjs';
import { checkLiveReferences } from './check-live-references.mjs';

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
  const read = uri => client.request('mcpServer/resource/read', { threadId, server: server.name, uri });
  await checkLiveReferences({ search, read, call });
} finally {
  client.close();
}
