# 0.10.0 兼容性修复范围

本版落实兼容性分析建议中的首批五项：标准脚本导入、原生消息投影、生成参数契约、Session 生成准备协调器，以及共享的核心 EJS 执行环境。目标是修复资产到最终模型请求之间的断点；完整复刻 TavernHelper 或 ST-Prompt-Template 仍需后续开发。

## 固定对照基线

| 项目 | 版本 | 提交 |
| --- | --- | --- |
| TavernHelper | 4.9.4 | `8c1f159388e216b52bff0e0995f371a8c9861bca` |
| SillyTavern | 1.18.0 | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` |
| ST-Prompt-Template | 1.17.9 | `d6f520d149aba146305b0b781ddd691d449c28d2` |
| EJS 引擎 | 3.1.10 | package.json / pnpm-lock.yaml 固定版本 |

基线表示源码对照范围，不表示全部上游功能均已实现。机器可读边界位于 `src/compatibility.js`，通过 `/api/dsh-sillytavern/compatibility` 提供。

## 本版行为

- **导入**：优先解析 `data.extensions.tavern_helper.scripts`，兼容 `TavernHelper_scripts` 旧版导出，再处理通用扩展字段。保留 `content/id/enabled/info/data/button/export_with` 和文件夹信息；文件夹禁用会影响子脚本运行。移除原有 32 条及浅层遍历截断。缺失或重复 ID 使用稳定的运行时 ID，原始信息和转换损失写入导入报告，管理器“脚本”页可查看。重新导入不会覆盖已存在的脚本变量。
- **消息**：兼容账本的编辑、隐藏、删除、插入和排序投影到最终请求副本。不会重建已被 DSH 压缩移除的原生历史；同文不同 ID 的合成消息保持独立。原生图片、工具调用与工具结果结构随所属消息保留，避免文本编辑破坏协议。DSH 原始事件不改写。
- **生成**：修正 `max_chat_history: 0`；支持角色、persona、场景、示例、世界书前后及 author note 覆盖；`generateRaw` 按混合 `ordered_prompts` 顺序组装命名段和 RolePrompt。支持 URL/data URL 图片、请求级 injects、tools、tool choice、JSON schema 和采样参数。独立 broker 的请求不会再次被原生历史投影污染。
- **生成准备**：Host 请求所有活跃浏览器完成 iframe 写入屏障，回到各自 owner 执行注入 filter，然后读取本轮状态快照、渲染模板并调用宏。处理 filter 错误、超时、失联、生成准备期间取消和会话释放。生成 ID 在同一 Session 的 iframe 间共享；销毁某个 iframe 只停止它自己发起的任务。
- **模板**：使用真实异步 EJS，同一次 Prompt 组装共享定义、变量缓存和编译缓存。支持 `await`、`print`、`define`、结构化 `inject`，以及可由资源/适配器提供的 `include/getwi/getchar/getpreset/execute`。角色提示词、激活世界书和选中的独立模板通过共享环境求值；Raw 命名段复用求值结果，不重复执行角色字段。
- **模板状态**：`getvar` 默认读合并缓存（global → initial → local → message），`setvar` 默认写 message；local/global/message 可持久化，initial/cache 仅用于本次求值。默认 message 指向最后一条非 system 兼容消息的当前 swipe。Host 在模板及宏成功后复核各作用域 revision，统一锁定并提交；模板错误或 revision 冲突不提交半份状态，也不调用模型。

模板跨文件提交对普通 I/O 错误提供回滚，但尚无崩溃恢复事务日志；进程恰在多个文件 rename 之间被强制终止时，不保证跨文件原子恢复。一次性注入在 Prompt 成功准备后消费，模型随后失败不会自动恢复它。

## 未完成项与依赖

| 未完成项 | 当前表现 | 后续实现依赖 |
| --- | --- | --- |
| 完整脚本树、按钮及导出管理 API | 导入保留元数据，尚不能复刻树编辑和按钮执行 | 统一脚本资源模型 → CRUD/导出 → 按钮和树 UI |
| 命名生成预设和代理预设 | 仅 `preset_name: "in_use"` 可用；其他预设、`getProxyPresetNames` 显式报错 | ST 生成预设资源模型 → 预设选择和完整提示词排列 |
| File 图片、临时 custom_api.apiurl | 图片需 URL/data URL；临时 API URL 显式报错 | Client 文件序列化和 Host 媒体协议；DSH provider 配置适配 |
| STPT 完整 GENERATE/RENDER 生命周期 | 本版执行生成提示词中的 EJS；不替换原生聊天正文或 HTML 显示 | 不可变渲染投影 → 上游阶段调度 → prepare/generate/render 事件契约 |
| `[InitialVariables]` 自动初始化、全量世界书/预设资源 | 核心 runtime 可接收 initial 和资源；Host 尚未加载完整上游资源集 | 初始化规则与资源索引 → 生命周期挂接 → 首轮/重生成对照测试 |
| 模板 `include/getpreset/execute` 的完整 Host 接入 | runtime 接受显式资源/适配器；未提供时明确报不可用。Host 当前提供当前角色及当前绑定世界书 | 模板资源寻址、真实 ST 预设、可等待的 STScript 执行器 → Host 适配器 |
| 跨消息/跨 swipe 的模板变量上下文 | 默认求值和提交围绕当前消息 swipe；未实现任意消息上下文切换 | 多消息变量快照 → 按消息分组 mutation → 多目标事务提交 |
| 可修改参数对象的原版事件语义、全页面宏管线 | filter 和已准备 system/depth/Raw 命名段可调用 owner；通知事件不能复刻上游共享可变对象 | 明确阶段及请求变换协议 → 生命周期适配 → 原版浏览器对照 |

## 验证与使用

运行 `pnpm check` 检查生成的事件 Client bundle、入口语法以及 Node 测试。本轮完整检查通过，共 203 项测试；新增用例覆盖标准/旧版导入、最终请求消息投影、生成参数、双 iframe owner 回调与取消、异步 EJS、变量跨轮次和多作用域提交冲突。

本轮另使用隔离的 DSH `3097` 实例验证启动加载，并通过独立 `3098` 测试页连接真实插件 Host、父层运行时和两个浏览器 iframe。使用模型替身验证的 HTTP/postMessage 链路已通过：生成返回值、owner filter、写入屏障、宏、注入、once 清理和零历史均符合预期。没有使用用户模型密钥；未做原版 SillyTavern 同卡对照，也未完成 DSH 管理器中从文件选择到真实模型回答的完整手动操作。

更新插件后需要重启 DSH 使 Host 与 Client 同时载入新版本。建议在一个新测试会话导入实际角色卡，查看导入报告，再验证首轮、第二轮、重新生成与 swipe；这一步用于补充具体角色资产和真实模型的验收。
