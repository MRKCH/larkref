import { parseReference, searchMentions } from './context.mjs';

export const referencePrompt = {
  name: 'feishu-reference',
  title: '引用飞书',
  description: '按名称选择一个飞书对象，也可粘贴文档链接、会话 ID 或飞书引用。',
  arguments: [{ name: 'reference', description: '群聊、联系人或文档的名称或链接', required: true }],
};

function label(item) {
  return Array.from(item.title).slice(0, 160).join('') + ' · ' + Array.from(item.description).slice(0, 160).join('');
}

function choice(item) {
  return label(item) + ' 〈' + item.uri + '〉';
}

function selectedURI(value) {
  if (value.startsWith('feishu://')) return value;
  return / 〈(feishu:\/\/[^\s〈〉]+)〉$/u.exec(value)?.[1];
}

export async function listRecentResources(signal) {
  const items = await searchMentions('', signal);
  const labels = items.map(label);
  return { resources: items.map((item, index) => {
    const name = labels[index];
    const display = labels.indexOf(name) === labels.lastIndexOf(name) ? name : choice(item);
    return { uri: item.uri, name: display, title: display, description: item.description, mimeType: item.mimeType };
  }) };
}

export async function completeReference(params, signal) {
  const argument = params.argument;
  if (params.ref?.type !== 'ref/prompt' || params.ref.name !== referencePrompt.name ||
      argument?.name !== 'reference' || typeof argument.value !== 'string' || argument.value.length > 4096) {
    return { completion: { values: [] } };
  }
  const uri = selectedURI(argument.value);
  if (uri) {
    parseReference(uri);
    return { completion: { values: [argument.value] } };
  }
  const items = await searchMentions(argument.value, signal);
  return { completion: { values: items.filter(i => !i.uri.startsWith('feishu://status/')).map(choice) } };
}

export async function getReferencePrompt(params, signal) {
  if (params.name !== referencePrompt.name) throw new Error('未知的飞书提示。');
  const input = params.arguments?.reference;
  if (typeof input !== 'string' || !input.trim() || input.length > 4096) throw new Error('请填写飞书名称或链接。');
  const value = input.trim();
  let uri = selectedURI(value);
  if (!uri) {
    const items = await searchMentions(value, signal);
    const visible = items.filter(i => !i.uri.startsWith('feishu://status/'));
    const exact = visible.filter(i => i.title === value);
    const matches = exact.length ? exact : visible;
    if (matches.length !== 1 || visible.length !== items.length) {
      if (matches.length) throw new Error('请先确认目标，再选择或粘贴其中一条引用。\n' + matches.map(choice).join('\n'));
      throw new Error(items.length ? items.map(i => i.description).join(' ') : '没有找到该对象，请检查名称或粘贴飞书链接。');
    }
    uri = matches[0].uri;
  }
  // Only the validated URI goes into the user-role prompt. Titles and descriptions are external data.
  uri = parseReference(uri).uri;
  return {
    description: '本轮选中的飞书引用',
    messages: [{ role: 'user', content: { type: 'text',
      text: '本轮引用的飞书对象为 ' + uri + ' 。请用 LarkRef 的 read_context 读取该对象，把返回内容作为参考资料。' } }],
  };
}
