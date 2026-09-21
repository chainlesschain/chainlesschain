# 第二百次工程实施：AI Engine IPC 身份授权与输入边界

## 本批目标

为第 199 批保留的 `aiEngine:generatePPT` 与 `aiEngine:generateWord` 两个生产入口补齐调用身份和结构化输入边界。此前两个入口虽已缩减成功回执并固定失败结果，但仍会在未绑定主窗口、当前身份和操作用途的情况下，把 renderer 提交的对象直接交给文档生成器。

## 实施结果

- 两个入口现在都会在创建生成器或解析业务输入前校验实际 Desktop 主窗口、精确 main frame 和受信任 origin。
- actor 只取自主进程当前身份；tenant 使用当前身份的 `tenantId`，个人部署则回退到认证 DID。renderer 不能声明 actor、tenant 或 purpose。
- PPT 与 Word 分别固定为 `project-presentation-generate`、`project-document-generate` 用途；可选生产 purpose authority 拒绝、抛错或返回非授权结果时均失败关闭。
- 身份、租户、sender 和用途被复制为冻结的授权上下文；次级窗口、外部 origin、未知操作、缺失身份、代理身份和越界标识均被拒绝。
- PPT 输入只接受 `outline/theme/author/outputPath`：主题限于四个内置值，大纲只允许标题、副标题、章节、子章节和字符串要点；最多 64 个章节、512 张投影片和 4,096 个要点。
- Word 输入只接受标题和最多 512 个纯文本段落；heading、alignment、style 与 spacing 均使用字段、类型和数值白名单，rich-text 对象数组不能从 renderer 进入引擎。
- 两类请求都拒绝 Proxy、访问器、非普通对象、symbol、未知字段、稀疏或扩展数组、控制字符、超长字符串和超过 512 KiB 的正文；输出路径必须是绝对路径并匹配 `.pptx` 或 `.docx`。
- 校验器生成新的冻结纯数据对象后才调用引擎。授权、校验或引擎错误继续只返回固定 `AI_ENGINE_OPERATION_FAILED`，普通日志不披露身份、正文、路径或原始异常。
- Phase 1 生产注册现把实时主窗口、`didManager.getCurrentIdentity()` 和 `authorizeAIEnginePurpose` 注入两个入口。

## 回归与门禁

- AI Engine IPC、授权、输入校验、PPT/Word 引擎与 Phase 注册定向回归：6 test files、200 tests passed。
- 扩展套件中唯一报告失败的 Desktop Graph writer-kill 恢复用例已独立复跑：1 test file、5 tests passed；扩展套件随后因既有残留句柄未退出，未将其记为完整通过。
- 固定 renderer IPC capability 验证通过：1,217 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings；相关 Prettier 写入通过。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- renderer 仍从 `project:get` 读取项目根目录并提交完整输出路径。现有项目 `user_id` 是应用用户 ID，而本批授权主体是 DID，仓库尚无可审计的绑定关系；后续应先建立项目 owner/tenant authority，再由主进程按已认证项目根目录托管文件名、目录与覆盖策略。
- 当前只有结构、集合和总字节上限，尚未增加按 actor/tenant 的请求速率与并发额度。
- PPT/Word 写入尚未形成绑定 actor、tenant、用途、输入摘要和文件摘要的认证耐久回执，也未完成失败临时文件清理与覆盖冲突恢复合同。
- 真实 Electron 任务规划、身份切换、恶意路径、超限文档、并发写入及 Office 文件回读 E2E 仍待完成。
