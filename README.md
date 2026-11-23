# 飞书上下文

在 Codex 桌面端的对话输入框输入 **@飞书**，打开「飞书」，搜索并选中群聊、联系人、云文档或多维表格。引用会出现在光标处。可以在同一条消息里选中多个对象，再输入「根据这两个引用，整理决定和待办」。

| 选中的对象 | 可用的上下文 |
| --- | --- |
| 群聊 | 群名称、简介、人数，以及最近 20 条主会话消息的发送者、时间和正文。可继续向前翻页。 |
| 联系人 | 姓名、部门、双方最近的私聊记录。重名候选显示部门和 ID 尾号。首次联系的人返回联系人资料。 |
| 云文档 | 新版飞书文档（Docx）及对应的知识库节点。正文每页最多 12,000 个字符，后续页沿用同一修订版本。 |
| 多维表格 | 数据表目录和记录数。可读取指定数据表，每页 5 条记录。粘贴带数据表和视图的分享链接可直接读取该视图。 |

搜索框留空会列出近期对象，也支持粘贴飞书链接、会话 ID 或联系人 open_id。选中引用后，Codex 按对象的稳定标识读取内容。单条消息超过 1,200 个字符时会标注节选，附件以飞书返回的摘要呈现。多维表格每行最多展示 16 列，单元格超过 400 个字符时会标注节选。

## 安装

本项目已在 macOS 的 Codex 桌面端 26.1111.21308、Node.js 22 和 lark-cli 1.0.39 验证。需要 Node.js 20 或更高版本、支持插件市场的 Codex CLI，以及已配置的飞书 CLI。

~~~sh
gh repo clone MRKCH/lark-chat
cd lark-chat
codex plugin marketplace add "$PWD"
codex plugin add feishu@lark-chat
~~~

在新的桌面对话中输入 **@飞书**。可用以下命令核对插件版本及启用状态。

~~~sh
codex plugin list --marketplace lark-chat --json
~~~

## 飞书账号

如果已有 lark-cli 用户授权，插件可以直接复用。新环境先运行以下命令，根据飞书提示配置应用。

~~~sh
npm install -g @larksuite/cli
lark-cli config init
~~~

飞书应用后台需要开启相应的用户身份权限，并由使用者完成 OAuth 授权。根据需要启用的功能选择范围。

| 功能 | 用户授权范围 |
| --- | --- |
| 群聊、联系人、消息 | im:chat:read、im:message:readonly、im:message.group_msg:get_as_user、im:message.p2p_msg:get_as_user、contact:user:search、contact:user.base:readonly |
| 文档、知识库 | search:docs:read、docx:document:readonly、docs:document.content:read、wiki:node:retrieve |
| 多维表格 | search:docs:read、base:table:read、base:record:read |

使用一个 profile 时，直接在终端执行授权。

~~~sh
lark-cli auth login --scope "im:chat:read im:message:readonly im:message.group_msg:get_as_user im:message.p2p_msg:get_as_user contact:user:search contact:user.base:readonly search:docs:read docx:document:readonly docs:document.content:read wiki:node:retrieve base:table:read base:record:read"
~~~

默认使用 lark-cli 的当前 profile。若会话和文档权限分属两个应用，在本机的 ~/.config/codex-feishu/settings.json 中分别填写已有的 profile 名称。设置了 XDG_CONFIG_HOME 时，插件使用该目录下的 codex-feishu/settings.json。

~~~json
{
  "imProfile": "my-feishu-im",
  "docsProfile": "my-feishu-docs"
}
~~~

分别用 lark-cli --profile PROFILE auth login --scope "..." 授权。桌面环境找不到 lark-cli 时，还可以在该文件的 cliPath 字段中填写其绝对路径。令牌由 lark-cli 管理。插件以用户身份只读访问飞书，本机配置只需保存 profile 名称和可执行文件路径。

## 验证

~~~sh
npm test
npm run test:live
~~~

离线测试使用虚构数据，覆盖搜索、同名区分、授权失败、知识库节点、分页和 stdio 协议。真实验收启动 Codex app-server 的临时会话，通过已安装插件的桌面提及接口搜索，再读取选中资源并检查结果。终端只显示断言结果和数量。

真实验收默认从近期列表为四种对象各选一个样本。若近期列表缺少样本，可分别设置 FEISHU_TEST_CHAT_QUERY、FEISHU_TEST_CONTACT_QUERY、FEISHU_TEST_DOCUMENT_QUERY 和 FEISHU_TEST_BASE_QUERY。会话样本应有消息，文档应有正文，多维表格应有数据表。FEISHU_TEST_CODEX 可指定桌面端附带的 Codex 可执行文件。

## 接入方式

插件通过本地 MCP stdio 服务声明 openai/mentions 搜索能力。search_mentions 返回 resource_link 候选。Codex 将选中项插入输入框，resources/read 和 read_context 共用同一条读取路径。飞书返回的文字作为外部引用数据交给本轮模型。项目仓库发布插件、测试和说明，账号配置由使用者在本机管理。

打包和资源读取协议参见 [OpenAI 插件文档](https://developers.openai.com/plugins/build/plugins) 和 [MCP 资源规范](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)。飞书命令和安装说明见 [larksuite/cli](https://github.com/larksuite/cli)。
