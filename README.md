# dsh-sillytavern

“酒馆模式”是 DeepSeek Harness 的外部 Bundle + Agent 预设组合。它让 DSH 原生会话导入并使用 SillyTavern Character Card V3，而不是在 DSH 内重做一套 SillyTavern。

## 功能

- 从输入框左下角“+”导入 V3 PNG、APNG 或 JSON；角色卡内携带的世界书会作为独立世界书资源一并导入；
- V3 `ccv3` CRC/Base64/UTF-8/JSON 分层校验，V2-only 明确拒绝；对生态中常见但不规范的缺失 `group_only_greetings`/世界书 `extensions` 安全补空并给出警告；
- 角色卡、用户设定/变量、首条问候、独立的结构化 Character Book V3 世界书管理和 system-role post-history 注入；角色卡可绑定一套默认世界书，Session 在首次真实用户消息时以其初始化自身的世界书引用，之后可独立修改该引用；TavernHelper API 还可绑定工作区全局书及当前角色的 primary/additional 书，生成时按全局→角色→当前会话去重合并。世界书支持常驻/关键词/向量标记策略、Secondary Logic、概率、原生 JavaScript 正则、多级递归、Order、0–7 Position、`@depth`、Outlet 与递归控制，并在宏及 WORLD_INFO Regex 展开后按本轮模型真实 tokenizer 与上下文窗口比例（默认 25%）预算；卡内 `token_budget` 可进一步收紧该预算，最近一次激活条目、预算与运行时警告可在管理页查看；纯向量相似度激活仍需要未来接入 embedding retriever；
- EJS 风格提示词模板与 `{{char}}`、`{{user}}`、`{{getvar::name}}`；
- 生成前自动召回 + 主模型按需只读查询的事件：主 Agent 只负责剧情生成，只暴露 `st_event_query` 和 `st_event_graph_query`。普通完成回合在后台进行增量维护，仅向独立事件维护 Agent 提供该轮最后一条真实用户消息、最终助手正文和关键词命中的相关 memory rows；每 10 个完整回合自动进行一次定期整理，用重叠 1 轮的完整上下文归并、纠错和补全事件关系，再由 Host 原子提交结构化 patch；
- 工作区角色库、独立世界书库、角色编辑、模板、事件和脚本管理 UI；管理页使用全屏弹窗；
- 对话页“对话 / 轨迹”旁新增“事件”视图：上方剧情时间甘特图、下方完整事件关系图，点击时间条或节点打开右侧详情；支持搜索定位、缩放、拖动画布和自动刷新；
- 面向 TavernHelper 4.9.3 / SillyTavern 1.18.0 固定基线的 Session 级兼容运行时：所有 iframe 在角色代码执行前获得同步状态快照，共享 `TavernHelper`、`SillyTavern.getContext()`、变量、消息、事件、注入、生成、世界书、Regex 与常见前端生态 facade；已确认的 JavaScript 作为会话后台脚本持续运行；能力清单可从 `GET /api/dsh-sillytavern/compatibility` 读取；
- 角色、变量、Prompt、事件（由多条 memory rows 聚合而成）、增量事件 API 与 opaque-origin iframe 前端渲染；助手正文使用 DSH 原生 GFM Markdown，并兼容传统独占行 `<font color>`；状态栏等自定义标签只按角色卡或其他 Regex 来源实际定义的规则渲染，插件不猜测未命中标签的含义；
- 将 `extensions.regex_scripts` 作为完整的 `findRegex → replaceString` 规则导入；支持 Global → Preset → Scoped 顺序、用户/助手/Slash/世界书/Reasoning placement、原始/显示/Prompt/Edit 阶段、depth、Trim Out、NONE/RAW/ESCAPED 宏替换以及 `/narrator`、`/regex`、`/regex-state`、`/regex-toggle`；导入规则默认启用，编辑执行材料后自动停用；
- 所有插件数据均在工作区的 `.dsh/sillytavern/` 持久化；会话绑定、事件与全局资源在该工作区内隔离，支持跨 Store 刷新、dead-owner lock 恢复与 dispose 提交屏障。

当前不支持 V1/V2、群聊、自动创建新会话和向量语义检索。

## 安装

要求 DSH `0.1.2-alpha.1`（同时保留对 `0.1.1-rc.2` Session 摘要结构的兼容回退）、Node `^22.19 || >=24`。

```powershell
# 在本项目目录执行；这只修改用户 profile，不修改 Harness checkout。
dsh plugin --profile web add .
```

Bundle 在 Host 启动时会把包内 `preset/` 自动安装到部署配置的用户预设根目录；无需用户点击或手工复制。DSH 会在用户选择该预设并创建会话时按正常流程挂载验证。相同的手工安装会被安全接管，后续未修改的托管预设随 Bundle 更新；若同名预设已被用户修改或由系统根提供，插件拒绝覆盖并以明确错误停止启动。

重启当前 DSH Web 进程，在新会话中选择“酒馆模式”。不要启动第二个 Web server；Client bundle 由现有 DSH Web URL 提供。

## 使用

1. 用户在左侧自行新建或打开会话；
2. 使用 DSH 原生 Agent 预设菜单选择“酒馆模式”；最近一次选择的工作区角色会在首次真实用户消息前作为候选角色；第一条真实用户消息才提交角色与默认世界书的 Session 引用；
3. 会话开始前，角色卡的 `first_mes` 会显示在输入框上方；仅在酒馆模式空白会话中，Logo、开场内容与原生编辑框共同占据完整动态视口，开场内容弹性使用扣除 Logo/编辑区后的主要剩余高度，且不显示额外的“开场预览”徽标；Markdown 使用 DSH 原生渲染器，HTML 围栏/文档在 opaque-origin iframe 中按原样运行，插件不删除远程资源、脚本、内联事件、meta、iframe 或 CSS，也不注入 CSP；开场、消息 HTML、预览和后台脚本使用同一兼容桥，提供 `setChatMessages` 的 message 0 swipe、`triggerSlash('/echo ...')` 和常见 `#send_textarea`/`#send_but` 输入代理；选择本身不调用模型，用户仍在原生输入框中发送第一条回复；Host 会在原生用户消息进入日志前写入一个持久的 `st-opening` 展示节点，Client 通过官方 additive command-view Slot 将最终开场显示在对话顶部，原生用户消息只写入一次；模型每轮均从系统上下文读取同一已选开场，不增加模型调用；
4. 输入框工具行左侧会出现带酒杯线框图标的系统风格角色卡菜单；没有绑定时显示“选择角色卡”，窄窗口会自动折叠文字以减少工具行换行；
5. 未开始对话的会话可从下拉中选择工作区角色；首条真实用户消息后角色与世界书引用冻结，不能再换角色。所选角色也会成为以后新酒馆会话的默认角色；
6. 若角色尚未导入，点击输入框左下角“+”，选择 `st-import` →“导入 V3 角色卡”，再选择 PNG/APNG/JSON；
7. 从角色卡菜单底部的“管理酒馆模式”进入全屏管理页，管理角色设定、persona、世界书、事件、脚本和模板。“事件”页可录入剧情时间状态与时间轴范围、从大到小的地点路径、在场人物、召回策略和可选事件组 ID；一个事件通过 `eventId` 聚合多条 memory rows，并按事件聚合展示直接前置/后续关系及来源。同一事件涉及多个地点时每个地点单独一行，并使用不同 key。世界书是独立全局资源：编辑器下拉框选择要编辑的书，默认选中当前 Session 引用的书；另一个下拉框仅选择当前 Session 引用的书，两者互不等同。当前每张角色卡和每个 Session 均暂限一套世界书，未来可扩展为多书引用。世界书页以结构化条目编辑器管理激活策略、关键字、概率、Order 与 Position，并原样保留未展示的扩展字段；已确认并启用的 JavaScript 会在当前 Session 持续挂载为后台脚本，Regex 仍按文本阶段运行，管理页“运行预览”只创建额外的临时预览；
8. 酒馆会话处于前台时，Client 仅对该会话临时接管 assistant/user/steering 及过程展示 renderer：显示阶段 Regex 在按次创建、可由组件卸载取消且没有代码内容过滤或执行时限的 Worker 中运行；Host 在用户入日志前执行原始 User Input 规则，在模型流持久化前执行原始 AI/Reasoning 规则，并通过一次受控的公共 LLM 重派发把 promptOnly 历史投影给模型而不改写持久日志。匹配结果精确替换对应 text/reasoning block，HTML 在 opaque-origin iframe 中交互运行，并通过已校验的消息桥按实际内容高度自适应。共享 Regex 引擎已实现 `isEdit`/`runOnEdit` 语义；当前 DSH 尚无原生持久消息编辑事件，因此会话 UI 暂无可接入的编辑阶段触发器。DSH 原生 `turnProcess` 折叠在酒馆对话中显示为“剧情推进”，仍由原生状态控制思考过程、工具调用和多层工具调用；系统提示词行仅从酒馆对话视图隐藏，不影响实际模型提示词。最终剧情正文、图片、Regex/HTML 渲染结果和状态栏保持可见。

### 对话页的“事件”标签

已有消息的酒馆会话可在“对话 / 轨迹 / 事件”中切换。这里展示当前 Session 事件文档中的全部剧情事件，不是 DSH 的工具调用、流式片段等运行日志，也不受自动召回数量、重要度或 compact 状态限制。管理弹窗中原有的“事件”编辑页保持不变。

- 同一 `eventId` 的多条 memory rows 聚合为一个节点；箭头只表示已保存的 `precedes`（前置 → 后续），不会根据时间或关键词猜测关系。
- 甘特图按 `storyTime` 排列，不同 `timeline` 各用独立刻度；同一事件的不同时间记录分别展示，不把不连续时间合并成长区间。结束时间未记录时只标出已知开始位置，与确定的零时长事件区分；历史文字标签或时间未知的记录另列，且仍显示在关系图里。
- 点击时间条、事件名称或图节点可查看完整记录、地点、人物、关键词、来源、召回策略和关系依据；详情中的前置/后续事件可直接跳转。
- 搜索只高亮、定位，不隐藏其他节点。未填写 `eventId` 的记录单列在“未分组记录”中，不伪造事件节点或关联。
- 视图打开时每两秒检查文档 revision，变化后替换完整快照；切换标签、会话或卸载插件会取消请求，浏览器页面隐藏时暂停后续轮询。支持手动刷新，失败时保留上次成功数据并提示错误。

### 事件写入的时间要求

新增事件记忆必须提供 `storyTime.state: "normalized"`、非空 `timeline` 和有限数值 `start`（剧情开始时间，`0` 也是合法值）。`end` 可以省略或填 `null`；非空时必须是大于或等于 `start` 的有限数值。例如：

```json
{"state":"normalized","label":"抵达港口","timeline":"剧情日","start":3,"end":null}
```

时间来自剧情，不使用系统时钟、模型运行时间或现实日期。没有绝对纪年时，可以使用剧情依据支持的相对时间线；没有可依据的开始时间时，维护 Agent 不写入该条记忆。结束为空仅表示“结束时间未记录”，不推定仍在持续；区间查询只将这种记录匹配到已知开始位置。

更新已有记录而不改变时间时，可省略整个 `storyTime` 沿用已有的有效开始时间。管理表单覆盖同名记录时，仅在时间线相同的情况下允许沿用开始时间。历史 `unknown` / `label-only` 数据仍可读取、查询和删除，不自动迁移或补值；再次修改这些记录时必须补齐标准化的开始时间。

## 数据

全部插件数据按工作区隔离，保存在 `<workspace>/.dsh/sillytavern/`；不再使用 `${DSH_HOME}/data/dsh-sillytavern/`，也不存在跨工作区共享的插件数据。角色库、原始导入文件、独立世界书、模板、选择状态、Regex 与全局变量、会话绑定、事件及后台维护队列均属于当前工作区。

每个 Session 的事件模块数据文档保存为 `event/<sha256(sessionId)>.json`，后台维护队列保存为 `event-maintenance/<sha256(sessionId)>.json`。一份事件文档可以包含多个 `eventId`；每个逻辑事件通过 `eventId` 聚合多条 memory rows。模板上下文中的 `event` 字段仍是自动召回的 memory rows 列表，不改变 rows 或 `eventEdges` 的结构。

在同一工作区内，角色卡内容及其 Scoped 脚本、世界书内容、模板定义、Global/Preset Regex 与全局变量是共享资源；角色卡/世界书引用、persona、会话变量、模板选择、prompt injections、开场 swipe 与事件表按 Session 隔离。因此两个 Session 可使用同一角色卡但绑定不同世界书并维护不同用户设定、变量、模板选择、prompt injections 与事件。管理器“脚本”页编辑的是共享的角色卡或工作区脚本，不会为每个 Session 复制一份；Session 私有 prompt injections 由兼容 API 写入。

事件文档使用 schema 5，主体为 `rows + eventEdges`，并以有限长度的 `appliedMaintenanceJobs` 原子记录已提交后台任务。逻辑事件是聚合节点：一个事件通过同一 `eventId` 对应多条 memory rows；事件关系保存在 `eventEdges`，结构与行为保持不变。每条 memory row 包含 2–10 个唯一 `keywords`，用于查询与自动召回匹配；它们必须是对应助手正文中可逐字命中的具体名称、别名、专名、编号或特征短语，不能使用“物品”“事件”“关系”“状态变化”等泛化分类词。Host 在写盘前校验数量和正文来源，失败时拒绝整次写入并说明缺失词或原因。事件文档只检查文档版本号是否严格等于 5；其他版本会直接报错，不迁移、不重置、不改写，需手动删除对应事件文件。新 memory row 除 `storyTime`、`location`、`characters` 外，还保存正文来源 `sourceRefs` 和 `recallPolicy`：`always` 始终可自动召回，`after_compaction` 仅在全部来源事件都进入 DSH `compaction/summary.data.shadowedSeqs` 后成为自动召回候选，且普通候选仍须与近期对话或已 compact 的直接事件关系相关；`query_only` 只允许显式查询。重要度达到 `0.8` 的 memory row 除 `query_only` 外可提前进入候选，并在数量与字符预算内排在普通 memory rows 之前。事件关系自身也须全部来源已 compact 后才可参与自动相关性和 Prompt 注入；显式查询不受这些自动门槛影响。

`eventId` 将同一事件的多条 memory rows 聚合为一个隐式事件节点；关系单独保存在 `eventEdges`，当前只支持事件到事件的 `precedes`，不在 memory rows 之间建边。一个事件跨多个地点时仍以多行、不同 key 保存并共享 `eventId`。增量维护在普通成功 `turn/end`、最终正文持久化后排队：它把该轮最后一条真实用户消息与最终助手正文合为 `latestText`，以 Unicode NFKC、英文小写和统一空白标准化，再按关键词命中数、命中关键词长度、重要度依次排序候选；命中某行会补齐同一 `eventId` 的其他 rows，只提供该事件的直接关系边，相邻事件仅提供短摘要。第 10、20……个完整回合触发自动定期整理时跳过本轮增量维护。定期整理以最近一次成功整理的边界为准，默认每 10 轮执行一次、与上次成功边界重叠 1 轮；失败或取消不推进该边界。它使用该窗口中全部真实用户消息和最终助手正文命中关键词候选，并处理逐轮近似 memory row 合并、矛盾修正、事件关系补全、重要度/召回策略调整、失效状态删除和误拆事件合并。完整上下文总量上限为 160 KiB；超限时仅按完整回合拆为连续的多个整理任务，绝不从正文中间截断并声称其完整。`/st-event-consolidate` 可手动排入整理任务，不会中断正在执行的增量维护。任务按 Session FIFO、全局并发上限执行，失败重试，Host 只在维护 Agent 基于当前 event revision 时提交 patch，并在同一写盘事务中记录任务 ID，以封闭崩溃后的重复执行窗口。启动恢复失败会明确记录，并在 Agent idle 与下一次生成前继续重试。若来源剧情先被 compact 而任务尚未完成，生成前会临时注入任务中保存的原始正文，避免上下文空窗。主 Agent 不拥有任何事件写入、修正或去重工具。

角色记录以 `defaultWorldbookId` 保存默认世界书引用；Session binding 以 `worldbookId` 和 `startedAt` 保存本会话引用与首次真实用户消息时间。首次真实用户消息只会用角色的默认世界书初始化该 Session 引用；其后可在 Session 世界书下拉框独立改选。兼容层另在 `compatibility.json` 持久化全局书及当前角色 primary/additional 绑定；Prompt 依次合并全局、角色、当前会话书并按资源 ID 去重。修改世界书内容会影响所有引用该书的角色和 Session；修改角色默认世界书只影响之后开始的会话，不改写已有 Session 引用。导入角色卡时，卡内 `character_book` 只作为世界书导入源；导入完成后，运行时只读取独立世界书。若同名世界书已存在，必须选择“覆盖”（整本替换，不增量合并）或“另存为”。

删除世界书会在确认框列出引用它的角色卡与 Session；确认后删除资源并清除这些引用。删除角色卡前会检查尚未删除或归档的 Session，有任何此类 Session 时禁止删除并列出它们；可删除时，确认框可勾选同步删除该卡默认绑定的世界书。脚本源不改写。角色记录 Schema 4 延续 Schema 3 的 Regex 规则模型：Character Card 的 `regex_scripts` 原子化保存为整条规则，并把 0.5.3 错误拆分出的字段迁回规则；Global/Preset 规则与 `{{globalvar::key}}` 全局变量保存在当前工作区的 `.dsh/sillytavern/regex-scripts.json`。授权 SHA-256 同时绑定类型、匹配式、替换内容、trim/placement 与阶段选项，任一修改都会自动停用。Regex 运行器遵循 SillyTavern 的 JavaScript RegExp 和替换回调语义，不限制 pattern、规则数、trim 数量，不做嵌套重复/alternation 拒绝，不过滤或清洗 replaceString，也不设置执行 deadline；`substituteRegex` NONE/RAW/ESCAPED 均执行。代码安全性由启用者自行验证。交互 HTML 和手动预览在 opaque-origin iframe 中运行；常见的 parent `querySelector`/`getElementById`/jQuery `#send_textarea` 与 `#send_but` 调用映射到 DSH 官方 `inputActions.setDraft`，不开放父页面 DOM。

## TavernHelper 兼容阶段 5

兼容目标固定为 TavernHelper `4.9.3`（commit `e559c5a13f6337b2ac1a1086c69587793beb3823`）和 SillyTavern `1.18.0` release（commit `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`）。每个 Session 只有一个父层状态镜像和消息总线；开场、普通消息、管理预览与后台 JavaScript 在执行角色代码前就获得相同的初始快照，后续更新使用单调 revision 推送，不通过重载 iframe 更新状态。

阶段 2–5 已覆盖全部变量作用域、持久消息投影与 CRUD/swipe、`filter/once` Prompt injection、常用 STScript 管线、独立生成与停止、具备 revision CAS 的命名世界书 CRUD/条目操作、global/character/chat 世界书绑定、Lorebook 兼容别名、Tavern Regex 查询/替换/格式化，以及宏、音频、剪贴板、弹窗、lodash/jQuery/toastr 等常见 iframe 依赖。消息删除/旋转只改变兼容投影，不破坏 DSH append-only 事件；生成、绑定和前端 facade 因宿主模型不同按 `degraded` 标注。角色/预设/persona 的完整 CRUD、原生扩展安装和脚本树 UI 等没有可靠 DSH 等价物的能力保持 `unavailable`，不会用成功空值伪装。脚本可通过 `TavernHelper.compatibility` 或同步 `getCompatibility()` 读取精确状态。

## 开发与验证

```powershell
pnpm run build:events # 修改 src/client/event-explorer-*.cjs 后更新 Client bundle
pnpm run check
pnpm pack --pack-destination .artifacts
```

当前 Windows DSH 沙箱禁止 Node test runner 的逐文件子进程管道，因此测试使用 `--test-isolation=none`；EJS 自身仍在可终止的 resource-limited Worker + VM 中测试和运行。

架构和协议见 `docs/ARCHITECTURE.md`。
