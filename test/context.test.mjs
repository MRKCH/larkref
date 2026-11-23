import assert from 'node:assert/strict';
import test from 'node:test';
import { readContext, searchMentions } from '../plugins/feishu/context.mjs';
import { FeishuError } from '../plugins/feishu/cli.mjs';

// Use invented records with the lark-cli JSON shapes, including two namesakes.
const docURL = 'https://example.feishu.cn/wiki/WikiExample';
const docURI = 'feishu://document/example.feishu.cn/wiki/WikiExample';
const catalog = {
  im: { chats: [{ chat_id: 'oc_group', name: '策划组' }] },
  contact: { users: [
    { open_id: 'ou_one', localized_name: '林青', department: '一部' },
    { open_id: 'ou_two', localized_name: '林青', department: '二部' },
  ] },
  drive: { results: [
    { title_highlighted: '<h>秋季</h>计划', result_meta: { url: docURL, owner_name: '许明' } },
    { title: '重复命中', result_meta: { url: docURL } },
    { title: '无效链接', result_meta: { url: 'https://example.invalid/docx/x' } },
  ] },
};

test('空查询按最近会话、已联系的人和最近打开的文档列出候选', async () => {
  const calls = [];
  const items = await searchMentions('', undefined, async (domain, args) => {
    calls.push(args);
    return catalog[args[0]];
  });
  assert.ok(calls[0].includes('ByActiveTimeDesc'));
  assert.ok(calls[1].includes('--has-chatted'));
  assert.ok(calls[2].includes('open_time'));
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(i => new URL(i.uri).host), ['chat', 'contact', 'contact', 'document']);
  assert.equal(items[3].title, '秋季计划');
  assert.notEqual(items[1].uri, items[2].uri);
  assert.notEqual(items[1].description, items[2].description);
});

test('关键词按单个参数传入，只检索名称，查找阶段不读取内容', async () => {
  const calls = [];
  const query = '- 秋季 A 组';
  await searchMentions(query, undefined, async (domain, args) => {
    calls.push(args);
    return catalog[args[0]];
  });
  assert.ok(calls.every(args => args.includes('--query=' + query)));
  assert.deepEqual(calls.map(args => args[1]), ['+chat-search', '+search-user', '+search']);
  assert.ok(calls[0].includes('--disable-search-by-user'));
  assert.ok(calls[2].includes('--only-title'));
  assert.ok(!calls[1].includes('--has-chatted'));
});

test('单类授权失效仍可选其他来源，空结果可以与授权失败区分', async () => {
  const items = await searchMentions('策划', undefined, async (_, args) => {
    if (args[0] === 'contact') throw new FeishuError('auth', '需要登录');
    return args[0] === 'im' ? catalog.im : { results: [] };
  });
  assert.deepEqual(items.map(i => i.uri), ['feishu://chat/oc_group', 'feishu://status/contact/auth']);
  const status = await readContext(items[1].uri);
  assert.equal(status.source, '联系人');
  const empty = await searchMentions('空', undefined, async (_, args) =>
    ({ im: { chats: [] }, contact: { users: [] }, drive: { results: null } })[args[0]]);
  assert.deepEqual(empty, []);
});

test('直接粘贴云文档链接或会话 ID，只生成相应引用', async () => {
  const unexpected = () => assert.fail('直接引用不需要执行搜索');
  const [doc] = await searchMentions(docURL + '?from=search#heading', undefined, unexpected);
  assert.equal(doc.uri, docURI);
  assert.equal((await searchMentions('ou_one', undefined, unexpected))[0].uri, 'feishu://contact/ou_one');
  assert.equal((await searchMentions('oc_group', undefined, unexpected))[0].uri, 'feishu://chat/oc_group');
});

test('群记录按时间展示并保留分页，撤回消息清除残留正文，长消息标记截断', async () => {
  const calls = [];
  const value = await readContext('feishu://chat/oc_group', 'earlier', undefined, async (_, args) => {
    calls.push(args);
    if (args[1] === 'chats') return { name: '策划组', user_count: '8' };
    return { has_more: true, page_token: 'next', messages: [
      { message_id: 'new', sender: { name: '甲' }, content: '已删除的数据', deleted: true },
      { message_id: 'old', sender: { id: 'ou_one' }, content: '蓝'.repeat(1300), thread_id: 'omt_example' },
    ] };
  });
  assert.ok(calls[1].includes('--chat-id') && calls[1].includes('oc_group') && calls[1].includes('earlier'));
  assert.deepEqual(value.messages.map(m => m.message_id), ['old', 'new']);
  assert.equal(value.messages[0].thread_id, 'omt_example');
  assert.equal(value.messages[0].text.length, 1200);
  assert.ok(value.messages[0].truncated);
  assert.ok(!JSON.stringify(value).includes('已删除的数据'));
  assert.equal(value.next_cursor, 'next');
  assert.equal(value.about.members, '8');
});

test('同名联系人只解析所选 open_id 的私聊', async () => {
  const value = await readContext('feishu://contact/ou_two', '', undefined, async (_, args) => {
    if (args[0] === 'contact') return { users: [
      { open_id: 'ou_one', localized_name: '林青', p2p_chat_id: 'oc_first' },
      { open_id: 'ou_two', localized_name: '林青', p2p_chat_id: 'oc_second', department: '二部' },
    ] };
    assert.equal(args[args.indexOf('--chat-id') + 1], 'oc_second');
    return { messages: [], has_more: false };
  });
  assert.equal(value.about.department, '二部');
});

test('从未私聊的联系人返回资料及空对话', async () => {
  const result = await readContext('feishu://contact/ou_new', '', undefined, async (_, args) => {
    assert.equal(args[0], 'contact');
    return { users: [{ open_id: 'ou_new', localized_name: '尚未联系', has_chatted: false }] };
  });
  assert.deepEqual(result.messages, []);
  assert.equal(result.has_more, false);
});

test('桌面输入框序列化的提及链接可以直接作为本轮读取工具的输入', async () => {
  const uri = 'mcp-resource://feishu/' + encodeURIComponent(docURI);
  const result = await readContext(uri, '', undefined, async (_, args) => {
    assert.ok(args.includes(docURL));
    if (args[0] === 'wiki') return { obj_type: 'docx' };
    return { document: { content: '引用内容', revision_id: 1 } };
  });
  assert.equal(result.source_uri, docURI);
  assert.equal(result.content, '引用内容');
});

test('群资料权限独立于消息权限，资料读取失败时仍可返回消息', async () => {
  const source = await readContext('feishu://chat/oc_group', '', undefined, async (_, args) => {
    if (args[1] === 'chats') throw new FeishuError('permission', '需要群信息权限');
    return { messages: [{ content: '明天开会' }] };
  });
  assert.equal(source.messages[0].text, '明天开会');
  assert.equal(source.metadata_warning, '需要群信息权限');
});

test('Wiki 引用保留原链接，文档后续页面固定版本、按完整字符切分', async () => {
  const content = '📘'.repeat(12000) + '后续正文';
  const calls = [];
  const run = async (domain, args) => {
    assert.equal(domain, 'docs');
    if (args[0] === 'wiki') {
      assert.ok(args.includes(docURL));
      return { title: '秋季计划', obj_type: 'docx' };
    }
    assert.ok(args.includes(docURL) && args.includes('v2'));
    calls.push(args);
    return { document: { document_id: 'docExample', revision_id: 7, content } };
  };
  const first = await readContext(docURI, '', undefined, run);
  assert.ok(first.has_more);
  const second = await readContext(docURI, first.next_cursor, undefined, run);
  assert.equal(second.content, '后续正文');
  assert.equal(first.content + second.content, content);
  assert.equal(first.title, '秋季计划');
  assert.equal(second.has_more, false);
  assert.ok(calls[1].includes('--revision-id') && calls[1].includes('7'));
});

test('多维表格返回可引用的数据表；记录读取保留指定视图及分页', async () => {
  const base = 'https://example.feishu.cn/base/BaseDemo';
  const [item] = await searchMentions(base);
  const root = await readContext(item.uri, '', undefined, async (_, args) => {
    assert.ok(args.includes('+table-list') && args.includes('BaseDemo'));
    return { tables: [{ id: 'tblFirst', name: '进度', records_count: 9 }], total: 1 };
  });
  assert.equal(root.tables[0].name, '进度');
  assert.equal(root.tables[0].uri, item.uri + '?table=tblFirst');
  const [specific] = await searchMentions(base + '?from=share&table=tblFirst&view=vewDemo');
  const run = async (_, args) => {
    assert.ok(args.includes('+record-list') && args.includes('tblFirst') && args.includes('vewDemo'));
    const first = args[args.indexOf('--offset') + 1] === '0';
    return { fields: ['标题', '数量'], data: [[first ? '阶段一' : '阶段二', 4]], has_more: first };
  };
  const first = await readContext(specific.uri, '', undefined, run);
  assert.equal(first.records[0][0], '阶段一');
  const next = await readContext(specific.uri, first.next_cursor, undefined, run);
  assert.equal(next.records[0][0], '阶段二');
  assert.equal(next.has_more, false);
});

test('知识库里的多维表格使用节点解析后的 Base token', async () => {
  const result = await readContext(docURI, '', undefined, async (_, args) => {
    if (args[0] === 'wiki') {
      assert.equal(args[args.indexOf('--token') + 1], docURL);
      return { obj_type: 'bitable', obj_token: 'BaseResolved' };
    }
    assert.ok(args.includes('BaseResolved') && !args.includes('WikiExample'));
    return { tables: [], total: 0 };
  });
  assert.equal(result.format, 'bitable');
  assert.deepEqual(result.tables, []);
});

test('普通知识库云文档可以在独立节点元信息权限不足时继续读取', async () => {
  const result = await readContext(docURI, '', undefined, async (_, args) => {
    if (args[0] === 'wiki') throw new FeishuError('permission', '节点信息不可用');
    return { document: { content: '正文', revision_id: 1 } };
  });
  assert.equal(result.content, '正文');
});

test('无效引用和分页参数在访问飞书之前被拒绝', async () => {
  const run = () => assert.fail('无效引用不能产生请求');
  for (const value of ['https://invalid.example', 'feishu://chat/ou_other', 'feishu://chat/oc_group?x=1',
    'feishu://document/app.feishu.cn.example.org/docx/abc', 'feishu://document/name@app.feishu.cn/docx/abc',
    'feishu://document/example.feishu.cn/docx/abc/extra', 'feishu://document/example.feishu.cn/docx/%2F',
    'feishu://status/unknown/auth']) {
    await assert.rejects(readContext(value, '', undefined, run));
  }
  await assert.rejects(readContext(docURI, 'invalid', undefined, run));
});
