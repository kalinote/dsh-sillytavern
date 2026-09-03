# dsh-sillytavern 0.9.0 架构

## 边界

本项目是独立 DSH Bundle，不修改 DeepSeek Harness 源码。

- **Host 根插件 `dsh-sillytavern`**：由 `dsh.bundle.patch` 加入 Host composition，拥有当前工作区内跨会话的角色库、独立世界书库、Web API 路由、工作区持久化缓存和异步记忆维护队列，并提供 `sillyTavern` Cordis Service。插件没有 DSH 级数据目录，也不跨工作区共享数据。
- **Agent consumer `dsh-sillytavern/agent`**：由 `sillytavern` Agent preset 挂载。它不提供 Service，只向当前 preset 的 scoped registries 注册 Prompt、两个只读记忆 Tool 和人类 Commands。主 Agent 不执行记忆写入、纠错或去重。
- **Client `dsh-sillytavern/client`**：随 Host bundle 被 `dsh.client` 自动发现，只使用官方 Slots 和 `commandUi.decorate`，不查询或改写 Harness DOM。角色卡快捷菜单与内置管理项注册在 `conversation.input.left`；空白会话的 `first_mes` 预览注册在全宽 `conversation.input.dock`，以 `ConversationSnapshot.blank` 控制生命周期；它用 `100dvh` 在自身组件内计算纵向剩余空间、窄屏采用独立开销，并以禁止 flex shrink 的自有根元素让 Logo、预览和原生 Composer 共同填满可视区，不查询或改写产品 DOM。管理器以全屏弹窗显示。普通助手正文、开场与未命中 HTML 的 Regex 结果由 DSH 0.1.2 `MarkdownText` 以完整 labels 渲染 GFM；兼容层只把围栏/缩进代码以外、独占 Markdown 行的传统 `<font color>` 投影为 React 颜色容器；状态栏等自定义标签只由角色卡或 Global/Preset/Scoped 来源实际定义且命中的 Regex 处理，未命中的 `<status>` 不获得插件内建语义。行内代码、链接标签、正文内联标签、未闭合或嵌套 `<font>` 均保持字面 Markdown，不执行模型输出中的任意 raw HTML。角色卡 Regex 生成的 HTML 围栏/文档则不经过属性、标签、URL 或 CSS 清理，也不注入 CSP；前端在授予脚本/表单/弹窗/下载/modal、但不授予 `allow-same-origin` 的 opaque-origin iframe 中运行；运行时在文档 head 注入独立 API 环境脚本，通过受 channel/source 校验的 `postMessage` 向父 Client 提供 `setChatMessages` message-0 swipe 与 `triggerSlash('/echo')` 子集，角色卡存储源不改写；刷新仅由当前插件的本地 mutation 触发，不做轮询或焦点刷新，刷新期间保持现有预览挂载。首轮完成后，持久 `st-opening` command node 通过 keyed `conversation.chat.commandview` Slot 渲染为顶部开场；overlay 与设置页分别注册在各自 list Slot；不占用 `conversation.hero.agentPreset`，不替换原生 Agent 预设或 Composer UI。酒馆会话的角色选择组件挂载后，以 priority -20 和 `chat` locale 临时注册 `conversation.chat.node:assistant-step`、`user`、`steering`、`turn-process` 与 `system-prompt` keyed renderer；这些 renderer 仅存活于当前酒馆会话组件，切换到其他预设/会话即释放并恢复内置 renderer。插件直接复用 DSH 提供的 `turnProcess.open/setOpen`，只把该折叠标题替换为“剧情推进”，不复制状态、不重排原生节点，因而工具调用、递归工具调用和思考过程仍保持原有嵌套层级。`system-prompt` renderer 在酒馆对话中返回隐藏标记，并以限定 CSS 收起完整节点，只隐藏呈现而不改变模型提示词；最终正文及其媒体、Regex/HTML 结果保持可见。

Agent preset 是 standing scope，不是一会话一实例。因此 Prompt provider 从 `AssembleContext.agent`、Tool 从 `exec.agent`、Command 从 invocation.agent 获取真实 Agent；不在 preset apply 闭包中缓存某个 Session。

记忆维护子 Agent 通过 DSH `subagents.start('spawn', ...)` 从父会话异步启动，使用严格结构化输出且不获得插件工具；它只提出 patch，最终写盘仍由父 Host 完成。`origin: subagent` 的会话不满足酒馆 Host eligibility，Agent consumer 也会移除继承的酒馆 Prompt section 并拒绝只读工具调用，因此维护任务不会角色扮演、执行 Regex 管线或递归产生下一轮维护任务。普通用户 fork 虽有 `parentSession`，但没有 `origin: subagent`，仍可保持酒馆模式。

开场选择持久化为 `openingSwipeId`。未开始的 Session 可选择角色卡，但这不是最终绑定：`GET /greeting` 只解析候选角色的开场，不把角色或世界书写入 Session。Host 监听 `agent/inbox/inserted`：第一条真实 user inbox 消息到达、而原生 turn/user 事件尚未发布时，先提交该 Session 的角色，以当时角色卡的 `defaultWorldbookId` 初始化 `worldbookId`，并记录 `startedAt`，再同步追加一对 log-only `command/run`/`command/done`（名称 `st-opening`，结果文本为最终开场）。此后修改角色默认世界书不会影响该 Session，已开始的 Session 也不能换角色；Session 自己的世界书引用仍可通过专用下拉框独立修改。若绑定初始化仍在进行，listener 会同步进入 Agent maintenance、等待 Store 就绪后写入开场，再让已锁存的 inbox 唤醒正常 driver；若 maintenance 暂被其他活动占用，首条 inbox 会保存在带 Agent/Session 身份的 pending marker 中，并在 idle、inbox claim 或该首步的 system-prompt assembly 完成 `ensure` 后、原生 user 发布前补写。`/opening/select` 同样在 Agent maintenance 内提交，选择期间到达的第一条 inbox 会在新 swipe 持久化后才写入对应开场。孤立的 `command/run` 会在当前首轮或 Agent 恢复时补写匹配的 done；若同时存在已完成节点，多余 orphan 会以隐藏的 error outcome 结算，而不会再显示第二个开场。Client 的 additive keyed command-view 按 command/run 的较小 seq 将它显示在原生用户消息之前。该设计既不复制 user 事件，也不逆序改写 Surface，因而原生用户日志和 Surface 均只有一条；不伪造 turn/step，不增加模型调用。由于 log-only command 不进入 DSH `deriveMessages()`，Agent Prompt 在每轮以 `# Conversation-opening assistant message` 系统段显式携带已选开场，世界书激活也把它作为对话起点读取。

## Client/Host 协议

第一版采用插件自有同源 HTTP JSON 路由 `/api/dsh-sillytavern`。Client 页面发起请求；trusted iframe 不能直接调用 Host，而是通过 `postMessage` 请求父 Client，由父 Client代理 HTTP。iframe 也通过同一套 channel/source 校验桥回传由 `ResizeObserver` 测得的内容高度，父 Client 只调整对应 iframe 的块尺寸。这样 iframe 的 lifecycle 与 Host carrier 分离，且不需要修改 DSH Remote allowlist 或生成 Typert 文件。

主要路由：

- `GET /health`
- `GET /library`（当前工作区的角色库）
- `GET /card?id=...`
- `GET /greeting?sessionId=...&swipeId=...`（只解析候选角色的 `first_mes`/`alternate_greetings`；省略 swipeId 时恢复会话所选开场，不提交角色或世界书绑定）
- `POST /opening/select`（仅在空白会话持久化 message-0 swipe，不调用模型）
- `GET /session?sessionId=...`
- `GET /event-state?sessionId=...&after=<eventSeq>`（轻量、增量、可 catch-up 的脚本事件游标）
- `POST /import`（导入角色卡；卡内世界书导入为独立资源）
- `POST /bind`（未开始 Session 的候选角色；首条真实用户消息才最终提交 binding）
- `POST /selection`（持久化当前工作区中新酒馆会话的默认角色）
- `POST /session/update`
- `POST /memory`
- `POST /card/update`
- `POST /card/delete`（先检查尚未删除或归档的引用 Session；存在时拒绝删除并返回清单。允许删除时，可选同步删除默认世界书。）
- 世界书资源的列出、创建、更新、删除和 Session 引用路由；删除前返回引用该书的角色卡与 Session，确认后清空这些引用。
- `POST /template/save`
- `POST /template/delete`

所有请求先经过插件自己的严格 loopback Host、same-origin Origin/Fetch-Metadata trust fence；V1 故意不开放 LAN Host。所有会话路由再解析 live Agent，并验证其 composed preset 为 `sillytavern`。角色库、世界书库和模板路由都在当前工作区内全局可见、但不跨工作区；cardId 只接受 64 位 SHA-256 hex。

## Prompt 顺序

Agent consumer 注册：

1. scoped `system-prompt/assemble` Waterfall：以 prepend 包住后续组装，在 `await next()` 后读取与本轮模型请求同一快照的最终 `provider/model`；随后 await 当前工作区默认角色的首次消息绑定，以及当前会话的 binding/memory I/O，并回填本轮 authoritative section/variables，避免首轮缺少角色卡或首次装配竞态。
2. `PromptSection` order 5：Character Card、用户 persona、世界书、模板、自动召回记忆、必要时的未维护 compact 原文回退、脚本临时注入与 system-role post-history 指令。
3. `PromptSection` order 115：明确主模型只负责剧情，以及两个只读记忆查询工具的使用规则。
4. `char`、`user` Prompt variables。

记忆文档使用 schema 5：`{ schemaVersion, sessionId, revision, rows, eventEdges, appliedMaintenanceJobs }`。加载时只接受严格相等的版本号；版本不等于 5 时直接报错，不迁移、不重置、不改写，旧文件由用户手动删除。`appliedMaintenanceJobs` 是有限长度的后台任务幂等标记，与对应 patch 在同一记忆文件事务中提交。每行除 `table/key/value/keywords/importance/storyTime/location/characters` 外，保存 `sourceRefs`（`eventSeq/turn/role`）与 `recallPolicy`。`keywords` 必须包含 2–10 个唯一、具体的检索词，并以完全相同的拼写和大小写逐字存在于对应 `assistant/message` 正文；Host 在记忆事务写盘前统一校验，不匹配时拒绝整次写入并返回缺失词。无 `sourceRefs` 的管理页手动写入以当前 Session 的全部助手正文为校验范围。`storyTime` 分为 `normalized`、`label-only` 和 `unknown`；只有 normalized 行参与同一 timeline 的区间相交查询。`location` 是从大到小的地点路径或 null，查询按路径前缀匹配；`characters` 是实际在场人物。

生成前，Host 从全部 `compaction/summary.data.shadowedSeqs` 构造 compact 集合，并执行有界自动召回。`query_only` 永不自动进入 Prompt；`always` 始终可用；`after_compaction` 的普通行只有全部 `sourceRefs` 都已 compact 且与近期对话相关时才可用。相关性覆盖行的结构化字段和已 compact 的直接事件关系；零匹配普通组不注入。重要度 `>= 0.8` 的行（除 `query_only`）可越过 compact 与相关性门槛，并在相关度、重要度与更新时间排序前先占高优先级；最终限制为 24 行和约 28 KiB。事件边仅在自身全部 `sourceRefs` 已 compact 后参与相关性及自动注入。`st_memory_query` 与 `st_memory_graph_query` 是主 Agent 仅有的记忆工具，显式查询绕过上述自动门槛。

`eventId` 把多条行聚合成隐式事件节点；独立 `eventEdges` 只连接事件，当前关系类型为有向 `precedes`。Host 拒绝不存在端点、自环、重复边和有向环；行与边可在同一 batch 中原子增删。图查询返回 seed 事件的全部成员行及直接入边/出边，不把关系挂到单条记忆上。

Host 监听父会话成功的 `turn/end`，先通过 `sessions.flush(session)` 等待最终正文的持久化检查点成功，再写入 `<workspace>/.dsh/sillytavern/memory-maintenance/` 并异步执行。普通完成回合创建增量维护任务，只携带该轮最后一条真实 user 正文、最终 assistant 正文和相关记忆候选，不再携带近 N 轮完整对话。候选把两段正文合为 `latestText`，经 Unicode NFKC、英文小写、统一空白标准化后遍历 `keywords`：任一 keyword 出现即命中，按命中 keyword 数量降序、命中 keyword 长度降序、重要度降序选择；重要度仅解决同分，不会让零命中的高重要度行进入候选。命中行会补齐同一 `eventId` 的全部行，同时只给该事件的直接入/出边；相邻事件只附短摘要，不自动带入其全部记忆。

自动定期整理默认每 10 个完整回合触发一次；该触发回合跳过增量维护。整理上下文从最近一次成功的定期整理边界开始，向前重叠 1 个完整回合，因而首次为 1–10、下一次为 10–20。失败或取消的整理不推进边界。候选以该窗口所有真实 user 正文和最终 assistant 正文按相同 keyword 规则命中；维护 Agent 合并逐轮近似记忆、修正遗漏的矛盾、补全事件关系、调整重要度和召回策略、删除失效状态并合并误拆事件。完整正文上下文最多 160 KiB；超过上限时 Host 仅在完整回合边界拆分为连续整理任务，绝不截断某轮正文后仍将其标记为完整。`/st-memory-consolidate` 可手动排入定期整理队列，且不会中断已在执行的增量维护。

队列保证每 Session FIFO，并以共享信号量限制全局并发；任务失败最多重试三次。维护 Agent 返回最多 100 个 row/edge 操作。Host 合并来源、丢弃已失效的删除目标，按“删边→写行→写边→删行”排序；若生成期间 revision 改变则整任务重跑，最终提交仍带 `expectedRevision` 锁内复核。任务 ID 与 patch 原子写入 `appliedMaintenanceJobs`，因此即使进程恰在记忆提交后、队列完成状态落盘前退出，恢复也会跳过重复模型调用与重复提交。进程或父 Agent 中断时 running 任务恢复为 pending；恢复错误会记录，并在 idle 转换及下一次 Prompt 装配前重试。若 pending/failed 任务的来源已经 compact，Prompt 暂时注入任务中保存的原始正文，直到结构化记忆提交完成。

世界书只在 Prompt 组装阶段执行，不在导入阶段改写；运行时只读取当前 Session `binding.worldbookId` 指向的独立资源，不读取角色卡内置 `character_book`。角色卡的 `defaultWorldbookId` 仅在 Session 首条真实用户消息时用于初始化该引用。`constant`、关键词、四种 selective secondary logic、概率、正则、全词匹配与 Order 均由运行时处理。启用 `recursive_scanning` 后，已接纳条目的宏/Regex 最终内容会加入下一轮扫描，支持 per-entry `scan_depth`、`exclude_recursion`、`prevent_recursion` 和 `delay_until_recursion`，并由有界最大步数终止；即使中间没有新 frontier，也会推进到仍待处理的显式延迟层级。候选先按 constant、再按高 Order 进入预算评估；首个普通条目达到预算后不再回填普通条目，但仍可扫描并接纳 `ignore_budget`；最终每个区段按低到高 Order 构建，使高 Order 靠近区段末尾。内容先展开宏并执行 WORLD_INFO Regex，再按模型路由使用与 SillyTavern 同系的 tiktoken、HF tokenizer JSON 或 SentencePiece 计数；预算默认是当前模型真实上下文窗口的 25%，可配置比例与 cap，未知/资源故障才警告并回退字节估算。卡片自己的 `token_budget` 作为附加上限取更小值，缺失表示不额外限制，显式 0 阻止普通条目而不影响 `ignore_budget` 条目。

V3 定位优先读取 `extensions.position/depth/role/ignore_budget`，顶层同名字段只作兼容回退；缺省 position 按 After Char 处理。Before/After Character、AN Top/Bottom 和 EM Top/Bottom 分别落到独立 Prompt 锚点；命名 Outlet 只由 `{{outlet::Name}}` 在宏感知模板中消费，并兼容 `outlet_name`、`outletName`、`outlet`；at-depth 内容经 Host 的 `llm/stream` 投影插入当次不可变请求副本，保持指定 system/user/assistant role 与相对历史 depth，不追加 Session 事件。仅当本轮存在 `@depth` 投影时才生成请求绑定 ID，只有携带该私有 marker 的确切系统提示请求可以取得对应投影；没有 `@depth` 条目时系统提示保持原样，避免随机 marker 造成无意义的提示词缓存失效。Host 在重派发/adapter 前移除 marker，路由不一致则跳过并告警。未知 position 与空名称 Outlet 均跳过并告警，未知 decorator/content 原样保留。最近一次成功组装的活动条目、预算和警告保存在 Host 的会话级弱引用诊断快照，通过 `/session` 显示，但不写入 Session 事件，也不返回 Prompt 或扫描原文。扫描文本/深度、角色卡输入和最终 Prompt 仍受各自的通用数据预算约束；在这些通用边界内，世界书正则直接使用原生 JavaScript RegExp，不再施加正则专用长度上限，也不限制分组、交替、量词、前后查找、反向引用或 flags，不设置执行 deadline，数据与执行安全性由用户负责。EJS 模板在独立 resource-limited Worker 的禁用字符串代码生成 VM 中执行，50 ms VM timeout + 500 ms Worker deadline 后强制终止；本轮 AbortSignal 会立即 terminate Worker 并停止后续模板。模板只收到受预算的最小 scope。

## 存储

```text
<workspace>/.dsh/sillytavern/
  cards/<sha256>.json
  originals/<sha256>.png|apng|json
  worldbooks/<id>.json
  templates.json
  selection.json
  regex-scripts.json
  bindings.json
  memory/<sha256(sessionId)>.json
  memory-maintenance/<sha256(sessionId)>.json
```

这里的“全局”均指当前工作区内的全局资源。任何 DSH_HOME 下的 `data/dsh-sillytavern` 文件均不再读写；切换工作区会得到完全独立的角色、世界书、模板、脚本、选择和会话数据。

隔离边界分为资源与引用两层：角色卡内容和其 Scoped 脚本、独立世界书内容、模板定义、Global/Preset Regex 与全局变量是工作区资源；Session binding 中的角色卡 ID、`worldbookId`、persona、会话变量、模板 ID 选择、prompt script injections 与开场 swipe，以及按 Session ID 哈希保存的记忆表格，是会话隔离数据。因此两个 Session 可以引用同一角色卡但使用不同世界书、persona、变量、模板选择、prompt injections 和记忆；修改共享角色卡、同一本世界书或工作区脚本/模板定义仍会同时影响引用者。当前管理器的“脚本”页编辑的是工作区或角色卡脚本，不是 Session 私有脚本副本；Session 私有 `scriptInjections` 由兼容 API 写入。

角色卡中的 `character_book` 仅在角色导入时转换成独立世界书资源。角色记录保存 `defaultWorldbookId`，Session binding 保存 `worldbookId` 和 `startedAt`。一个角色卡和一个 Session 当前均只可关联一套世界书；这是刻意的单书限制，数据模型将来可扩展为 ID 列表。修改某独立世界书会实时影响所有仍引用它的角色与 Session；更新角色 `defaultWorldbookId` 不回写已有 Session。管理页的“编辑世界书”下拉框只决定编辑目标，默认跟随当前 Session 的 `worldbookId`；“Session 世界书”下拉框才修改该 Session 引用，两者独立。

角色卡导入时，如内置世界书与现有资源同名，用户必须选择“覆盖”或“另存为”。覆盖将以导入内容整本替换同名世界书，不进行条目级合并；另存为创建另一份独立资源。删除世界书前必须列出所有引用它的角色与 Session；确认删除后清空这些 `defaultWorldbookId`/`worldbookId` 引用。删除角色卡前必须检查引用它的未删除、未归档 Session；任何此类 Session 存在即拒绝删除并返回清单。无阻塞时可以勾选同时删除其默认世界书，未勾选则世界书作为独立资源保留。

写入先经可取消的 per-resource Promise tail，再用带 host/pid/token owner 的 `wx` lockfile 跨 Store/进程互斥；确认同主机 owner PID 已死亡时可原子回收 crash lock，活跃 owner 或无效旧锁绝不抢占。进入锁后从磁盘重载最新 snapshot/revision，并以同目录临时文件 + rename 提交；Agent 绑定/记忆在 rename 前复核 dispose epoch。后台 patch 额外携带 `expectedRevision`，锁内 revision 不一致即拒绝并重跑维护任务。工作区 cards/worldbooks/templates/selection 在读取、绑定和 Prompt 屏障中从磁盘刷新，多个已启动 Store 互相可见；角色库与世界书库刷新也会驱逐磁盘上已经删除的缓存记录。角色记录有 12 MiB 聚合上限和对称启动读取预算。角色 ID 是原始导入字节的 SHA-256；卡片已知字段可编辑，未知字段与 `extensions` 保留。

## 执行脚本

角色记录 schema 4 延续 schema 3 的 Regex 规则模型，将 `extensions.regex_scripts` 的每个对象保存为一条原子 Scoped 规则：`id/scriptName/findRegex/replaceString/trimStrings/placement/markdownOnly/promptOnly/runOnEdit/substituteRegex/minDepth/maxDepth` 不再被递归拆成伪脚本；Global 和 Preset 来源及 `{{globalvar::key}}` 变量保存在当前工作区的 `regex-scripts.json`。执行顺序固定为 Global → Preset → Scoped，每个来源内部保持管理列表顺序。0.5.3 schema 2 的已拆分记录在启动时从原卡恢复；schema 1 的旧授权禁用。授权 SHA-256 绑定规则类型、匹配式、替换内容和全部执行阶段元数据，修改任一受信字段都撤销授权，digest 代次避免等待期间的取消/编辑竞态。

“启用”是持久的管线资格，不等于管理页运行。Scripts tab 只有“运行预览”显式挂载预览，停止、编辑、禁用、删除、切页或关闭管理器都会卸载。共享执行语义对齐 SillyTavern：JavaScript RegExp parser、placement 1/2/3/5/6、Markdown/Prompt/原始/Edit 阶段、min/max depth、NONE/RAW/ESCAPED findRegex 宏、`{{match}}`、数字/命名捕获、宏化 trimStrings 与最终替换宏。引擎与 Worker 接受 `isEdit` 并按 `runOnEdit` 门控；当前 DSH 尚无原生持久消息编辑事件，故会话 UI 没有可接入的编辑阶段触发器。替换回调只展开 SillyTavern 支持的捕获 token，因此 `$$`、`$&` 等保持字面量。系统不审查或清洗 replaceString，不拒绝嵌套重复/alternation，不施加 pattern/规则/trim 数量上限或 deadline；用户负责在启用前验证代码与正则。

Host 的 `agent/pre-step` 在原生 UserMessage 入日志前执行原始 User Input 规则；`llm/stream` 先验证 Agent-loop 原请求，再以公共 LLM Service 单次重派发一个 promptOnly 消息投影视图，持久 Session 日志保持原文，返回流在入日志前按完整 block 执行原始 AI Output/Reasoning 规则。世界书在激活并展开宏后执行 WORLD_INFO prompt 阶段。Client 对 assistant/user/steering 的已完成 text/reasoning block 执行 Markdown 阶段；按次 Blob Worker 不设置超时，组件卸载时才取消。HTML 替换结果在不授予 `allow-same-origin` 的 opaque-origin iframe 中原样运行。父页面只通过 source/channel 校验的脚本 JSON API 暴露插件数据。针对 SillyTavern HTML 对 `window.parent.document.querySelector('#send_textarea')` 的既有调用，运行副本映射到 `__dshComposerInput` 代理，最终只调用官方 `inputActions.setDraft`，不开放父 DOM。

脚本 API facade：

- `getState/getCharacterCard/getWorldbook`
- `getVariables/setVariables`
- `injectPrompts`
- `memory`
- `eventOn/eventEmit`
- `tavern_events`（`app_ready`、`message_received`、`character_changed`）

依赖 SillyTavern 私有 DOM 或未实现后端 API 的脚本仍可能不兼容；插件不会自动修改这些脚本。

## 生命周期

- Host 启动先通过 `agentPresets.copy()` 探测部署的可写用户根，再以隐藏 staging 目录原子安装包内 `sillytavern` 预设。不能在同一 Host Fiber 的 `apply()` 返回前调用 `standingKeyFor()`：该阶段 `sillyTavern` Service 尚未完成激活；预设由 DSH 在正常选择/创建会话路径中挂载。托管 fingerprint 只允许升级未被用户修改的副本。
- Host route、Service、Prompt、Tool、Command、Slot 和样式均由 Cordis fiber/effect 所有。
- Client overlay/controller 是 module-local，但所有可见组件随 Slot 卸载；样式通过 effect 删除。
- iframe 事件监听器由 React effect 清理；管理页只有显式预览挂载时才创建自己的 cursor poll；当前酒馆会话由角色选择组件持有一个共享 cursor poll，并向该会话全部对话 iframe 分发快照；组件卸载会清空规则、宏 scope、事件 Store，取消进行中的 Worker，并释放 assistant/user/steering renderer。
- Host 重启从当前工作区的 cards/worldbooks/templates/selection/regex、bindings/memory 与未完成 memory-maintenance 队列恢复。
