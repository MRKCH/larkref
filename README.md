# LarkRef（飞书引用）

LarkRef 把指定的飞书群聊、联系人私聊、云文档和多维表格带进当前对话。Claude Desktop 使用本地扩展，Codex 桌面端使用输入框里的 `@飞书`。两端共用本机飞书授权。

| 选中的对象 | 可用的上下文 |
| --- | --- |
| 群聊 | 群名称、简介、人数，以及最近 20 条主会话消息的发送者、时间和正文。可继续向前翻页。 |
| 联系人 | 姓名、部门、双方最近的私聊记录。重名候选显示部门和 ID 尾号。首次联系的人返回联系人资料。 |
| 云文档 | 新版飞书文档（Docx）及对应的知识库节点。正文每页最多 12,000 个字符，后续页沿用同一修订版本。 |
| 多维表格 | 数据表目录和记录数。可读取指定数据表，每页 5 条记录。粘贴带数据表和视图的分享链接可直接读取该视图。 |

也可以用飞书文档链接、会话 ID 或联系人 open_id 指定对象。选中引用后，插件按对象的稳定标识读取内容。单条消息超过 1,200 个字符时会标注节选，附件以飞书返回的摘要呈现。多维表格每行最多展示 16 列，单元格超过 400 个字符时会标注节选。

## Claude Desktop

1. 在 Mac 上双击 `larkref.mcpb`，在 Claude 中安装并启用 **LarkRef（飞书引用）**。也可从 `Settings → Desktop app → Extensions → Manage → Advanced settings → Install extension` 选择安装包。[Claude 官方安装说明](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
2. 在左上角切到 **Claude** 普通对话。点输入框旁的 **+ → Plugins → Add from LarkRef（飞书引用）**，直接点选近期群聊、联系人或文档。相邻的 **LarkRef（飞书引用）** 开关控制工具是否启用，**Search plugins** 用来筛选插件名称。
3. 目标不在列表时，可在同一菜单点 **引用飞书**，在 **Reference** 填完整名称或粘贴飞书文档链接，再点 **Add prompt**。引用会出现在草稿中，可以继续添加其他来源。
4. 输入问题并发送，例如「总结所选群聊最近 20 条消息中的决定和待办」。只记得部分名称时，可以先发「用 LarkRef 搜索名称含『周会』的飞书对象，先列出候选，等我选定再读取」。

在 macOS 的 Claude Desktop 6.28899.6 上已验证近期菜单和按完整名称添加引用。在普通对话主输入框键入 `@飞书` 显示 `No results`，在 **Reference** 中逐字输入群名也未弹出飞书候选。

从源码生成安装包需要 Python 3。在仓库根目录运行 `npm run build:claude`，输出文件为 `dist/larkref.mcpb`。

### Claude 的 Code 模式

在本机 **Code** 会话的 **+ → Plugins** 可以查看 LarkRef 的启用状态。要按关键词查找，可直接提问，例如「用 LarkRef 查找群名包含『周会』的飞书群，先列出匹配项」。也可以在需要使用它的项目目录注册 MCP 服务。将下例中的启动器路径替换为本机实际路径。

~~~sh
claude mcp add --transport stdio --scope local larkref -- /absolute/path/to/larkref/plugins/larkref/launch --claude-desktop
~~~

在 macOS 的 Claude Desktop 6.28899.6 上，插件已启用时，Code 新会话的 `@飞书` 匹配到了本机应用窗口。在独立注册 LarkRef 并确认连接的项目中，键入已知飞书群名也没有弹出群聊候选。桌面 Code 自行生成 `@` 文件列表，忽略终端的 `fileSuggestion` 命令。Claude Code 终端另有 `@服务器:协议://资源路径` 的 MCP 资源引用语法。[桌面 Code 的设置差异](https://code.claude.com/docs/en/desktop#claude-code-settings-that-behave-differently-in-the-code-tab) · [终端的 MCP 资源引用](https://code.claude.com/docs/en/mcp#reference-mcp-resources)

本地引用文件可以利用 Code 的原生文件选择器。用虚构群聊验证时，在项目中放入只含引用 URI 的 `飞书/群聊/海盐联想样例群.md`，输入 `@海盐` 或 `@飞书/群聊/` 都能找到该文件，点选后进入草稿。LarkRef 1.1.0 尚未提供自动生成此类索引的功能。

## Codex 桌面端

本项目已在 macOS 的 Codex 桌面端 26.1111.21308、Node.js 22 和 lark-cli 1.0.39 验证。需要 Node.js 20 或更高版本、支持插件市场的 Codex CLI，以及已配置的飞书 CLI。

~~~sh
gh repo clone MRKCH/larkref
cd larkref
codex plugin marketplace add "$PWD"
codex plugin add larkref@larkref
~~~

在新的桌面对话中输入 **@飞书**，打开「飞书」即可看到近期对象。继续输入关键词可筛选候选，同一条消息可以引用多个对象。可用以下命令核对插件版本及启用状态。

~~~sh
codex plugin list --marketplace larkref --json
~~~

从旧版 `feishu@lark-chat` 升级时，装好新版后移除旧登记，输入框就只保留一个「飞书」入口。

~~~sh
codex plugin remove feishu@lark-chat
codex plugin marketplace remove lark-chat
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

默认使用 lark-cli 的当前 profile。若会话和文档权限分属两个应用，在 `~/.config/larkref/settings.json` 中分别填写已有的 profile 名称。设置了 `XDG_CONFIG_HOME` 时，配置路径相对于该目录。尚未创建新版配置时，插件会读取原有的 `codex-feishu/settings.json`，沿用已授权的账号。

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
npm run test:claude:live
~~~

离线测试使用虚构数据，覆盖同名区分、授权失败、分页以及两端的协议入口。`test:live` 启动 Codex app-server 临时会话并检查已安装插件。`test:claude:live` 解包实际的 MCPB，按清单启动服务，直接调用 MCP 接口验证近期资源、补全候选和四类飞书对象的读取。两项真实验收只输出断言结果和数量。

真实验收默认从近期列表为四种对象各选一个样本。若近期列表缺少样本，可分别设置 FEISHU_TEST_CHAT_QUERY、FEISHU_TEST_CONTACT_QUERY、FEISHU_TEST_DOCUMENT_QUERY 和 FEISHU_TEST_BASE_QUERY。会话样本应有消息，文档应有正文，多维表格应有数据表。FEISHU_TEST_CODEX 可指定桌面端附带的 Codex 可执行文件。

## 接入方式

插件通过本地 MCP stdio 服务声明 openai/mentions 搜索能力。search_mentions 返回 resource_link 候选。Codex 将选中项插入输入框，resources/read 和 read_context 共用同一条读取路径。飞书返回的文字作为外部引用数据交给本轮模型。项目仓库发布插件、测试和说明，账号配置由使用者在本机管理。

Claude 安装包使用标准 MCP。资源列表提供近期对象的名称、简介和 URI，`resources/read` 获取选中对象的内容。客户端调用 `completion/complete` 时，插件会为 `feishu-reference` 返回候选。提交该表单时，插件按名称或链接解析对象，返回其稳定 URI。客户端也可直接调用 `search_mentions` 和 `read_context`。[MCP 资源规范](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)

打包和资源读取协议参见 [OpenAI 插件文档](https://developers.openai.com/plugins/build/plugins) 和 [MCP 资源规范](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)。飞书命令和安装说明见 [larksuite/cli](https://github.com/larksuite/cli)。
