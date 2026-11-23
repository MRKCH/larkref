#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const account = readFileSync(process.env.TEST_FEISHU_ACCOUNT, 'utf8');
const [group, command] = args;
appendFileSync(process.env.TEST_FEISHU_CALLS, group + ' ' + command + '\n');
let data;
if (group === 'auth' && command === 'status') {
  if (account === 'unknown') {
    console.error('identity temporarily unavailable');
    process.exit(1);
  }
  data = { brand: 'feishu', appId: 'app_fixture', identities: { user: { openId: 'ou_' + account, available: true } } };
} else {
  if (args[args.indexOf('--as') + 1] !== 'user') process.exit(2);
  if (command === '+chat-list') {
    data = { chats: [{ chat_id: 'oc_recent_' + account, name: '近期群' }] };
  } else if (command === '+chat-search') {
    data = { chats: ['north', 'south', 'west'].map(id => ({
      chat_id: 'oc_' + id, name: '同名群', description: '分部 ' + id,
    })) };
  } else if (group === 'contact') data = { users: [] };
  else if (group === 'drive') data = { results: [] };
  else if (command === 'chats') data = { name: '同名群' };
  else if (command === '+chat-messages-list') data = {
    messages: [{ message_id: 'om_fake', content: '虚构的群聊正文仅用于读取验收' }],
  };
  else process.exit(3);
}
console.log(JSON.stringify({ ok: true, data }));
