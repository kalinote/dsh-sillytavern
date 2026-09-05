# Changelog

## Unreleased

- 输入框角色卡选择器在名称超长或工具栏空间不足时收起为单个图标，保留完整名称提示和菜单；宽度恢复后自动显示可容纳的短名称。
- 新增 TavernHelper 4.9.3 / SillyTavern 1.18.0 固定基线的机器可读能力清单与 `/compatibility`、`/compat/runtime` 接口；未实现能力以 `degraded`/`unavailable` 和原因显式登记。
- 新增 Session 级 iframe 兼容运行时：角色代码执行前即安装同步状态快照、`TavernHelper`、`SillyTavern.getContext()`、变量 API、注入 disposer、完整监听器管理 facade 和同 Session 自定义事件总线；后续状态使用单调 revision 推送。
- 开场、对话 HTML、管理预览和后台 JavaScript 统一使用同一 bridge；已确认的 JavaScript 会按 Session 持续挂载。开场现在也兼容 parent `querySelector`、`getElementById` 与 jQuery 形式的 `#send_textarea/#send_but` 调用。
- Session 变量写入增加 binding revision CAS；同步 facade 先更新镜像，再串行持久化，冲突或失败时重新读取权威快照。Prompt injection 保存基础 TavernHelper 字段并支持按 ID 幂等解除。
- 移除消息历史 HTML 固定 520px 的 flex basis；opaque-origin iframe 统一按受认证 resize 消息设置实际高度，避免短选项块后出现大段空白。
- 修复 SillyTavern `#send_textarea` 兼容桥错误读取不存在的 Slot `input` 属性：现在通过 DSH 正式 `useInput` 契约订阅草稿与输入阶段，并继续使用 `inputActions.setDraft` 写入，使角色卡/脚本选项可以填充当前用户输入框。
- 修复新会话首条真实用户消息自动绑定角色卡后，Client 仍持有未绑定 `/session` 快照，导致第一次助手输出缺少 Regex 脚本而显示原文的问题；事件状态中的角色 ID 变化现在会重新加载完整 Session。
- 对话中的 Regex HTML iframe 现在通过受 channel/source 校验的消息桥同步实际内容高度，不再为每个短 HTML 片段固定保留 520px 空白。
- 完成兼容阶段 2–5：全部变量作用域、持久消息 CRUD/swipe、Prompt injection `filter/once`、常用 STScript、独立生成/停止、命名世界书 CRUD/条目操作与三类绑定、Lorebook 别名、Tavern Regex 查询/写入/格式化，以及宏、音频、剪贴板、弹窗、lodash/jQuery/toastr facade。
- 新增工作区 `compatibility.json` 和 Session `compat-chat` 账本；所有兼容写入使用串行队列、资源锁与 revision CAS。生成提示词只读取仍存在于当前 Session 的原生账本消息，同时保留脚本创建消息，避免压缩或移除的历史正文误触发长期记忆召回。

## 0.9.0

- 长期记忆升级为 schema 5，移除记忆行 `tags` 并改用 2–10 个唯一 `keywords`。关键词用于显式查询、后台维护上下文筛选和生成前自动召回匹配。
- schema 版本不匹配时只报错，不迁移、不重置也不改写旧记忆文件；开发阶段的旧文件由用户手动删除。
- 新增保存前正文校验：每个关键词都必须以相同拼写和大小写逐字存在于对应助手正文中；缺少正文来源、关键词数量不合规、命中不到原文或使用“物品”“事件”“关系”“状态变化”等泛化分类词时，整次写入失败并返回具体原因。关键词过多时要求维护 Agent 拆分为更细的记忆行。
- 记忆管理页支持输入和展示关键词；后台维护 Agent 的结构化输出及提示词同步改为 `keywords`，并强调使用正文中的名称、别名、专名、编号和特征短语。

## 0.8.0

- 将剧情生成与记忆维护彻底拆分：主 Agent 不再拥有 upsert/update/delete/batch，只保留 `st_memory_query` 与 `st_memory_graph_query` 两个只读工具；成功 `turn/end` 的最终正文通过 Session 持久化检查点后，由独立后台 Agent 基于最终正文和近期上下文生成结构化 patch，再由 Host 提交。
- 后台维护任务先持久化后异步执行，保证每 Session FIFO、无竞态的全局并发上限、三次重试与重启恢复；任务 ID 和 patch 在记忆文档内原子提交，封闭“patch 已写入而队列完成状态未落盘”的重复执行窗口。生成期间 memory revision 改变会重跑，提交时再次以 `expectedRevision` 锁内复核。若来源已 compact 而任务未完成，下一轮 Prompt 临时使用任务保存的原始正文兜底。
- 长期记忆升级为 schema 4：每行新增 `sourceRefs` 和 `recallPolicy`，高重要度记忆优先自动召回；普通记忆只在全部来源进入 `compaction/summary.data.shadowedSeqs` 且与近期对话相关时参与，`query_only` 仅供显式查询。schema 3 不做迁移，不兼容文档会重置为空。
- 新增独立 `eventEdges` 事件图；多条记忆以 `eventId` 聚合为事件节点，当前 `precedes` 关系只连接事件。事件关系的自动相关性与注入也受其来源 compact 门槛约束；混合 row/edge batch 保持原子性，并校验端点、自环、重复边与有向环。
- 记忆管理页新增召回策略、来源信息、事件节点聚合及直接前置/后续关系展示；删除最后一条事件成员记忆时同步删除关联边。
- 酒馆会话将 DSH 原生 `turnProcess` 折叠标题替换为“剧情推进”，直接复用原生展开状态，因此原有思考、工具调用和多层工具调用层级保持不变。
- 酒馆对话视图不再渲染系统提示词行；这只是显示层隐藏，不改变实际发给模型的系统提示词。最终剧情正文、图片及 Regex/HTML 结果保持可见；本功能仅修改插件 Client 渲染，不修改 `deepseek-harness`。

## 0.7.0

- 酒馆模式管理器改为全屏弹窗；世界书页现在区分“编辑的世界书”和“当前 Session 引用的世界书”两个下拉框，前者默认选择当前 Session 的世界书但不改变后者。
- 所有酒馆插件数据改为按工作区保存到 `<workspace>/.dsh/sillytavern/`，包括角色库、原始导入文件、世界书、模板、选择、Regex、变量、绑定和记忆；不再读取或写入 `${DSH_HOME}/data/dsh-sillytavern/`。
- 世界书成为独立工作区资源。角色卡以 `defaultWorldbookId` 保存一套默认世界书；Session binding 以 `worldbookId` 保存一套引用，并以 `startedAt` 标记已开始。当前保持单书限制，为未来多书引用预留扩展方向。
- Session 在第一条真实用户消息时才最终绑定角色，并以角色卡当时的默认世界书初始化自身引用；之后角色卡的默认世界书引用变化不影响该 Session，已开始的 Session 禁止更换角色卡，但仍可独立选择自己的单套世界书。角色卡内容以及独立世界书内容仍是工作区共享资源，修改后会影响全部引用者。
- 导入角色卡时会把卡内世界书导入为独立资源，运行时不再从角色卡 `character_book` 读取。遇到同名世界书时必须选择“覆盖”或“另存为”；“覆盖”整本替换现有世界书，不做条目增量合并。
- 删除世界书会先显示引用它的角色卡和 Session，确认后清除这些引用。删除角色卡会阻止仍有未删除、未归档 Session 的角色，并列出相关 Session；可删除的角色卡可通过确认框勾选同步删除其默认绑定的世界书。

## 0.6.7

- 世界书管理页由原始 JSON 编辑器升级为结构化条目编辑器：支持书级扫描/递归设置、蓝圈常驻/绿圈关键词/链接向量策略、四种 Secondary Logic、概率、Order、0–7 插入位置、`@depth`、Outlet 与递归控制，同时保留未展示的未知字段和 extensions。
- 世界书运行时实现多级递归扫描、每条目扫描深度、宏化关键字、全词匹配、原生 JavaScript `/regex/flags` 关键字、概率激活及递归排除/阻断/延迟；移除 512 字符的正则专用上限以及对分组、交替、量词、前后查找、反向引用和 flags 的限制，正则安全性由用户自行判断；纯向量条目在没有 embedding retriever 时跳过并明确告警，带 keys 的向量条目仍可按关键词激活。
- 世界书内容先展开宏并执行 WORLD_INFO Regex，再交给当前模型 tokenizer 做预算；Before/After Character、AN Top/Bottom、EM Top/Bottom、`@depth` 与 Outlet 保持独立锚点，未知位置和无名称 Outlet 不再静默落入 middle。
- 修正世界书扫描深度 41–100 实际只读取 40 条历史的问题；卡内 `token_budget` 现在作为模型相对预算的附加上限生效，显式 0 禁用普通条目，`ignore_budget` 条目仍可插入。
- 修正 `@Depth` 缺省值、Outlet aliases、缺省/未知 Position 和无前序命中的延迟递归层级；最近一次 Prompt 的世界书活动条目、预算与警告会通过会话视图显示在管理页。
- 只有本轮实际存在 `@depth` 投影时才生成专属的不可伪造 binding marker 并绑定到具体系统提示请求；普通请求不再因随机 marker 产生无意义的系统提示词更新和缓存失效。marker 在进入 adapter 前移除，未绑定请求不能复用旧投影，模型路由变化时跳过并告警。
- 酒馆会话的用户与 steering 消息恢复 DSH 原生风格的右对齐、按内容收缩气泡，不再让“继续”等短消息落在固定宽度容器左侧而产生近似居中的错觉。
- 用户图片重新位于气泡上方的右对齐消息栈中；用户 Regex 替换仍在同一气泡内渲染。

## 0.6.6

- HTML 代码围栏改为逐行按 CommonMark 规则闭合；角色卡 Regex 替换脚本中的行内三反引号（例如 JavaScript 注释里的 ` ```json `）不再截断 iframe，也不会把剩余 JavaScript 泄漏成 Markdown。
- 角色开场与会话 Regex 渲染共用同一分段语义，并补充内嵌反引号、完整脚本尾部和围栏后 Markdown 的回归覆盖。

## 0.6.5

- 世界书预算对齐 SillyTavern：从本轮最终 `provider/model` 解析真实上下文窗口，默认使用 25% 比例（支持可选 cap），并用该模型对应的 tiktoken、Hugging Face tokenizer JSON 或 SentencePiece tokenizer 计数；只有模型未知或官方 tokenizer 资源不可用时才显式警告并退回字节估算。
- 世界书候选按高 `insertion_order`（Order）优先评估；第一个普通条目达到预算后不再用后续小条目回填，仅继续处理 `ignore_budget` 条目。最终同一 Prompt 区段仍按低到高 Order 排列，使高 Order 更靠近区段末尾。
- Character Card V3 条目优先读取 `extensions.position/depth/role/ignore_budget`。`position: 4` 的 at-depth 内容按指定 role/depth 注入当次模型请求，不写入 DSH 持久会话；顶层字段仅作兼容回退。

## 0.6.4

- 按严格 SillyTavern 语义撤回 0.6.3 的通用 `<status>` 状态栏：插件只执行角色卡或 Global/Preset/Scoped 来源实际定义并命中的 Regex；未定义、未命中的标签继续作为普通 Markdown 源交给 DSH，不再由插件猜测含义。
- 保留完整 DSH GFM Markdown labels、传统独占行 `<font color>` 兼容、代码边界保护以及用户 Regex HTML/JavaScript 不审查语义。

## 0.6.3

- 酒馆助手正文统一通过 DSH 0.1.2 的完整 GFM Markdown renderer，并补齐代码块与脚注所需的 labels；普通 Markdown、代码、表格、链接、数学和图片沿用 DSH 原生渲染。
- 兼容模型输出中的 SillyTavern 传统 `<font color>` 行与通用 `<status>` 块：前者保留文字颜色，后者显示为语义化状态栏；代码围栏中的同名标签保持字面内容。
- 角色卡专用 `<ournotes>{JSON}</ournotes>` 状态脚本及所有用户 Regex HTML/JavaScript 仍按既有显式规则与 opaque-origin iframe 执行，不审查、不清洗、不改写替换代码。

## 0.6.2

- 适配 DSH 0.1.2 的 Session list 投影结构：从 `projectionValues.agentPreset` 读取当前 Agent 预设，并保留旧版 `agentPreset` 回退；修复更新 DSH 后角色卡控件、首条问候与酒馆消息 renderer 全部被错误隐藏。
- 更新 DSH 0.1.2 依赖声明，移除新版已不存在的 `dsh-client-runtime` Client 注入，并显式声明消息与命令渲染槽所属的 `dsh-client-ui-chat` 依赖。

## 0.6.1

- 切换 Global/Preset/Scoped 来源时立即清空并卸载所有管理预览，防止切回来源后预览无显式操作自行重新挂载，也避免跨来源同 ID 误运行。
- 文档明确 `/narrator` 命令与当前 DSH 尚无原生持久消息编辑事件的 `runOnEdit` 平台边界。

## 0.6.0

- Regex 执行语义对齐 SillyTavern：Global → Preset → Scoped 来源顺序、User/AI/Slash/WORLD_INFO/Reasoning placement、原始/Markdown/Prompt/Edit 阶段、depth、Trim Out、NONE/RAW/ESCAPED findRegex 宏、捕获组及最终替换宏。
- Host 在用户消息入日志前执行原始 User Input 规则，通过公共 LLM Service 的单次受控重派发提供不改写持久日志的 promptOnly 历史投影，并在助手流持久化前执行原始 AI/Reasoning 规则；世界书内容在 Prompt 注入前执行 WORLD_INFO 规则。
- Client 增加 user/steering 与 reasoning 显示阶段转换，开场问候同样经过 AI Markdown 规则；Global/Preset 规则与 globalvar 持久化并可在管理器中编辑，新增 `/narrator`、`/regex`、`/regex-state`、`/regex-toggle`。
- 按用户要求移除 Regex pattern 长度、规则/trim 数量、嵌套重复/alternation 预拒绝与 500ms deadline；replaceString 不审查、不清洗、不删改，代码和正则安全性由启用者自行验证。

## 0.5.5

- 兼容 SillyTavern 选项脚本通过 `window.parent.document.querySelector('#send_textarea')` 写入输入框的行为：运行文档将该调用映射到受限 RPC，由父页面追加到当前 DSH composer，同时继续保持 iframe opaque-origin、绝不启用 `allow-same-origin`。

## 0.5.4

- 修正 `extensions.regex_scripts` 导入：不再把 `id`、`scriptName`、`findRegex`、`replaceString` 等对象字段拆成多个伪脚本；schema 3 将整条 Regex 规则原子保存并迁移 0.5.3 记录，整条规则元数据共同参与授权哈希。
- 分离“启用”与“运行”：脚本管理页不再自动运行已启用脚本，新增显式“运行预览 / 停止预览”，编辑、禁用、删除或离开页面都会卸载预览。
- 当前酒馆会话临时接管 assistant renderer；已启用且适用于 assistant 显示阶段的 Regex 在 500 ms 可终止 Worker 中匹配，匹配替换结果精确取代原始代码并在 opaque-origin iframe 中交互运行，禁用/无匹配/流式/失败状态保留普通消息渲染；切换会话会释放接管并恢复 DSH 内置 renderer。

## 0.5.3

- 全局角色库新增带二次确认和进行中状态的“删除角色卡”操作；删除角色记录与原始导入文件，清除全局选择，并解除所有已加载工作区中引用该卡的持久会话绑定，保留会话记忆。
- 角色库刷新会移除其他 Store 已删除的缓存记录；选择与绑定在提交前重新验证卡片存在性，避免删除竞态重新写入悬空选择或绑定。

## 0.5.2

- 脚本管理页标题简化为“执行脚本”，相关说明统一改为通用的脚本执行文案。
- 从角色卡提取的新导入脚本默认启用，同时记录绑定脚本类型与源码的 SHA-256 approval hash；后续修改类型或源码仍会自动停用，手动再次启用仍需确认。

## 0.5.1

- 修复 0.5.0 首轮真实 GUI 中两条相同 user 气泡：确认其不是单纯显示问题，而是 Surface 重排方案为保持历史而额外写入了 user 副本；新方案完全移除 user/assistant Surface 改写，原生 user 事件只写入一次。
- 第一条真实 user inbox 到达、原生 turn 发布前，以持久 log-only `st-opening` command lifecycle 记录最终开场；Client 使用官方 additive `conversation.chat.commandview` Slot 将其稳定显示在对话顶部，不替换 Harness 原生会话或消息 renderer。
- `GET /greeting` 预先绑定当前全局角色但不创建对话事件；首次初始化与 `/opening/select` 使用 Agent maintenance 串行化快速首发/选择竞态，maintenance 暂不可用时通过身份绑定的 pending marker 在 claim/Prompt assembly 边界补写；恢复时会结算全部孤立 opening command run；已选开场持续进入每轮模型系统上下文与世界书激活，不增加模型调用。

## 0.5.0

- 实现完整的酒馆开局选择语义：`setChatMessages` 选中的 message-0 swipe 按会话持久化；刷新或重启后开场预览恢复最终选择，选择过程仍不调用模型或提前创建对话消息。
- 用户第一次正常发送消息时，插件在该首步内把最终 `first_mes`/`alternate_greetings` 宏展开结果写成原生 `assistant/message`，并通过官方 Surface replacement 保证可见与后续模型历史的顺序为“角色开场 → 用户回复”；无需额外模型调用。
- 第一次模型请求显式接收最终所选开场内容，不再把角色卡原始 `first_mes` 菜单重复放入系统提示；开场写入后，Prompt、世界书与记忆读取原生 Surface，避免读取被替换的内部用户事件副本。

## 0.4.2

- 为开场 HTML iframe 注入受 channel/source 校验的 SillyTavern 兼容桥，提供全局 `setChatMessages`、`triggerSlash` 及对应脚本 API；角色卡源数据保持不变。
- `setChatMessages([{ message_id: 0, swipe_id }])` 现在以只读 `/greeting?swipeId=` 请求切换 `first_mes`/`alternate_greetings`，不写会话事件、不调用模型、不更新记忆；`triggerSlash('/echo severity=... ...')` 在开场底部显示反馈。其他消息编辑或 slash 命令仍会返回明确的不支持错误。

## 0.4.1

- 仅在酒馆模式空白会话中，将开场预览改为按动态视口高度伸展：Logo、预览与原生 Composer 共同占据完整可视区，预览弹性使用扣除页头/编辑区后的主要剩余空间；窄屏采用独立纵向开销并禁止祖先 flex 压缩预览。
- HTML iframe 随预览纵向伸展且内部内容保留滚动；移除预览右上角可见的“开场预览”徽标文字，角色名、原生输入框和发送能力保持不变。

## 0.4.0

- 纠正0.3.7–0.3.9违背既定兼容性需求的安全过滤：`first_mes` HTML 不再删除远程资源、脚本、内联事件、meta、iframe 或 CSS，也不再注入限制性 CSP；Markdown 图片语法保持原样。
- HTML 前端继续放在不授予 `allow-same-origin` 的 opaque-origin iframe 中，但恢复 `allow-scripts`、表单、弹窗、下载与 modal 能力，使角色卡前端和网络图片按作者代码运行；DSH 源码不受修改。

## 0.3.9

- 真实0.3.8控制台验收发现角色卡 HTML 的内联事件属性仍会被空 sandbox 阻止并产生两条日志；渲染副本现额外移除所有 `on*` 事件属性和 `javascript:` 资源 URL，原始角色卡保持不变。

## 0.3.8

- 根据0.3.7真实浏览器验收清理角色卡常见的 `</start>` 结束标记，避免它作为 Markdown 尾段显示在预览下方。
- 在写入沙箱 `srcDoc` 前从渲染副本中移除脚本、meta refresh 及自动联网资源/CSS URL；保留原始角色卡数据不变，同时避免浏览器产生被 sandbox/CSP 阻止的脚本和图片错误。

## 0.3.7

- 移除开场预览的3秒轮询、焦点刷新和按 revision 重挂载，只在当前插件发生角色绑定/保存等本地变更时就地刷新；刷新期间保留旧预览，消除 `/greeting` 重复请求和闪烁。
- 开场内容改用 DSH `MarkdownText` 渲染 Markdown；HTML fenced code、完整 HTML 文档和未闭合 HTML 围栏使用独立 `sandbox=""`、无脚本/无同源权限的 iframe 渲染，并通过 CSP 禁止联网资源；Markdown 图片语法会被转成不自动加载的普通链接文本。

## 0.3.6

- 修复真实 Slot 运行时未将定时刷新注入继续传给开场预览子组件，导致 `scheduleRefresh is not a function`、预览席位崩溃的问题；新增注入透传回归断言。

## 0.3.5

- 尚未开始的酒馆会话绑定角色卡后，通过官方 `conversation.input.dock` 在输入框上方显示安全展开的 `first_mes` 开场预览；保留原生 Logo、标题、输入框与发送按钮。
- 预览仅在 `session.blank === true` 时显示，不写入会话事件、不调用模型、不执行 HTML/脚本；第一条用户消息被接受后自动消失，已有对话切换角色不会插入开场内容。

## 0.3.4

- 角色卡快捷入口改用16px酒杯线框图标，替代信息含义模糊的通用 Personalization 滑杆图标；保持 `currentColor`、系统线宽、无障碍隐藏及原有紧凑布局。

## 0.3.3

- 根据 855px 真实 GUI 验收修正：多模型插件同时存在时，150px 角色名仍会令工具行换行；容器宽度 ≤780px 时改为系统图标 + chevron，≤560px 时进一步收为单图标，确保工具行回到单行。
- 完整角色名保留在 trigger title 与系统菜单中，不牺牲可识别性和选择能力。

## 0.3.2

- 角色卡快捷入口改用 DSH 原生 `Menu`、系统图标、主题 token、选中勾选与浮层定位，替代浏览器原生 `<select>` 菜单。
- “管理”合并为同一菜单的末项；触发器使用单行省略与响应式紧凑宽度，窄屏折叠为图标，减少多插件工具行换行。

## 0.3.1

- 恢复 DSH 原生 Agent 预设 chip 与菜单，不再占用或替换 `conversation.hero.agentPreset`。
- 角色卡快捷下拉与“管理”入口迁移到输入框工具行左侧的官方增量 Slot `conversation.input.left`；非酒馆会话通过 Host eligibility 校验后不渲染。
- 切换期间仍暂时阻断当前 Composer，且只释放自己持有的阻断，不覆盖其他插件的新旧阻断。

## 0.3.0

- 酒馆模式的新会话界面在 Agent 预设旁显示全局角色卡快捷下拉；没有选择时显示“选择角色卡”，非酒馆预设下隐藏。
- 当前会话顶部支持直接切换全局角色库中的角色卡，同时保留完整酒馆管理入口与替换确认。
- 当前角色选择持久化到全局 `selection.json`；新酒馆会话会在首轮 Prompt 组装屏障内自动绑定所选角色，保存选择期间 Composer 会被暂时锁定并安全保留其他插件已有/更新的阻断，避免第一轮缺少或绑定错误的角色设定。
- Agent 预设 staging 由会话流级 controller 持有，跨 hero 组件卸载仍可落到新建空白会话；角色替换提交会校验用户确认时的旧 cardId，拒绝跨标签页竞态。

## 0.2.1

- 修复 Host apply 尚未完成时调用 `standingKeyFor()`，使预设 consumer 看不到同一 Fiber 正在提供的 `sillyTavern` Service 并阻断 DSH 启动的问题。
- 自动安装仍在 Host 启动时完成；预设由 DSH 在正常选择/创建会话路径中挂载，此时 Host Service 已完成激活。

## 0.2.0

- Bundle Host 启动时通过 `agentPresets` 选择部署的可写用户根，自动安装并 mount-validate 包内“酒馆模式”预设，无需用户确认或手工复制。
- 托管标记支持幂等启动和未修改预设的安全升级；相同手工安装会被接管，用户修改或系统同名预设绝不覆盖。

## 0.1.1

- 兼容部分 V3 导出器遗漏 `data.group_only_greetings` 与 `data.character_book.extensions` 的角色卡：导入时分别安全规范化为 `[]` 和 `{}`，同时保留警告。
- 添加真实缺失字段形状的回归测试。

## 0.1.0

- 首个“酒馆模式”版本。
- Character Card V3 PNG/APNG/JSON 导入和当前会话绑定。
- 世界书、角色设定、提示词模板和 post-history Prompt。
- 表格长期记忆与五个模型工具。
- 全局角色库、会话管理、opt-in opaque-origin 脚本 iframe 与受校验的脚本 API bridge。
- 用户级全局角色库与工作区级绑定/记忆持久化，带跨 Store 文件锁、revision 合并和原子写入。
- 可取消 Worker 隔离 EJS、无量词线性正则子集、Prompt/卡片/记忆预算、脚本类型+源码哈希代次授权、event-seq 增量 catch-up 轮询与稳定 iframe 生命周期。
