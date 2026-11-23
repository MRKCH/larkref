# LarkRef（飞书引用）

LarkRef 把指定的飞书群聊、联系人私聊、云文档和多维表格带进当前对话。Codex 桌面端在输入框键入 `@飞书`，Claude Desktop 的 Code 模式键入 `@飞书/关键词`，Claude 普通对话从 **+** 菜单添加引用。三种入口共用本机飞书授权。

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

在 LarkRef 源码目录里运行下面的命令，将路径换成你要在 Claude 中打开的本机项目。需要 Node.js 20+、Git、Claude Code CLI 及已授权的 lark-cli。

~~~sh
./bin/larkref enable /path/to/your-project
~~~

1. 打开 Claude Desktop → **Code** → **This computer**，在新会话中选择刚启用的文件夹。单独使用的 Git worktree 也可以用自己的路径启用。
2. 在输入框键入 **`@飞书/周会`**，把「周会」换成名称的一部分。选择例如 **项目周会（群聊）**，引用就会进入草稿。文件名末尾标明群聊、联系人、文档或多维表格，同类型重名时附加标识。
3. 接着输入「总结这个群最近的决定和待办」并发送。Code 从所选文件取得 URI，通过项目 MCP 服务 `larkref-code` 读取最新的飞书内容。

**目标不在菜单里时**，在 Code 会话发送「用本项目的 `larkref-code` 在线搜索『周会』，按类型列出候选，等我选」。选中后可以回复「把第二项加入本项目」，也可以直接让它读取第二项。成功收录后，在同一项目再次输入 `@飞书/周会` 即可点选。除了近期列表，每个项目还保留最近从在线搜索中选定的 50 个对象。服务通过 `search_mentions` 搜索，通过 `save_reference` 收录选定项，通过 `read_context` 获取内容。

启用命令在本机登记项目级 MCP 服务，并创建项目下的 `飞书/` 目录。首次向飞书获取最近活跃的群聊、聊过的联系人、最近打开的文档或多维表格，每类最多 4 项，文档和多维表格共用一类。同一飞书账号组合的多个窗口或项目复用本机近期缓存。缓存过期时先显示已有快照，再刷新。项目服务运行期间每五分钟检查一次，某一类遇到网络错误时沿用该类上次成功的数据。确认撤权会清理相应候选，切换账号会重新建立项目列表。输入联想在本机完成，网络耗时发生在刷新、在线搜索及读取正文时。

每个引用都是无后缀的纯文本文件，只含一行稳定的飞书 URI。升级后首次刷新会自动迁移旧版生成的 `.md` 引用，保留用户自行添加或编辑过的文件。群名和文档标题用于文件名，消息、联系人资料和文档正文均按选中对象实时读取。目录自带 `.gitignore`，项目内同名的既有目录或已跟踪文件会阻止接管。停用时保留用户添加或改写过的文件。账号级缓存存放在 `~/.cache/larkref/references-v1/`，设置了 `XDG_CACHE_HOME` 时随该目录变化。

~~~sh
./bin/larkref refresh /path/to/your-project
./bin/larkref disable /path/to/your-project
~~~

也可以在会话里让 LarkRef「立即刷新本项目的飞书引用」。命令行的 `--files-only` 适用于已自行配置 MCP、只想管理目录的情况。在 macOS 的 Claude Desktop 6.28899.6 上，已验证同一关键词可同时匹配群聊和多维表格，点选群聊后引用进入草稿。桌面 Code 自行生成文件候选，LarkRef 使用其文件选择器和标准 MCP。[Claude Code 桌面端的设置差异](https://code.claude.com/docs/en/desktop#claude-code-settings-that-behave-differently-in-the-code-tab)

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
npm run test:code:live
~~~

离线测试使用虚构数据，覆盖同名区分、授权失败、分页、跨窗口缓存、账号切换、用户文件保护及三种协议入口。`test:live` 启动 Codex app-server 临时会话并检查已安装插件。`test:claude:live` 解包实际的 MCPB，按清单启动服务，验证近期资源和补全。`test:code:live` 在临时 Git 项目中验证真实索引、收录、从引用文件读取四类对象、立即刷新和 Git 忽略，并报告首次生成和复用缓存的耗时。真实验收只输出结果、数量和耗时。

真实验收默认从近期列表为四种对象各选一个样本。若近期列表缺少样本，可分别设置 FEISHU_TEST_CHAT_QUERY、FEISHU_TEST_CONTACT_QUERY、FEISHU_TEST_DOCUMENT_QUERY 和 FEISHU_TEST_BASE_QUERY。会话样本应有消息，文档应有正文，多维表格应有数据表。FEISHU_TEST_CODEX 可指定桌面端附带的 Codex 可执行文件。

## 接入方式

插件通过本地 MCP stdio 服务声明 openai/mentions 搜索能力。search_mentions 返回 resource_link 候选。Codex 将选中项插入输入框，resources/read 和 read_context 共用同一条读取路径。飞书返回的文字作为外部引用数据交给本轮模型。项目仓库发布插件、测试和说明，账号配置由使用者在本机管理。

Claude 安装包使用标准 MCP。资源列表提供近期对象的名称、简介和 URI，`resources/read` 获取选中对象的内容。客户端调用 `completion/complete` 时，插件会为 `feishu-reference` 返回候选。提交该表单时，插件按名称或链接解析对象，返回其稳定 URI。客户端也可直接调用 `search_mentions` 和 `read_context`。[MCP 资源规范](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)

打包和资源读取协议参见 [OpenAI 插件文档](https://developers.openai.com/plugins/build/plugins) 和 [MCP 资源规范](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)。飞书命令和安装说明见 [larksuite/cli](https://github.com/larksuite/cli)。
