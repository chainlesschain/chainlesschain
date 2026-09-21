# 第二百零一次工程实施：AI Engine 项目输出路径托管

## 本批目标

关闭第 200 批仍由 renderer 选择 PPT/Word 完整输出路径的边界。生成请求现在只提交受限 `projectId` 与文档结构，由主进程从数据库中的本机认证项目根目录分配输出文件，并统一处理文件名、冲突、失败清理和完成检查。

## 实施结果

- `aiEngine:generatePPT` 与 `aiEngine:generateWord` 不再接受 `outputPath`；任务规划页只提交 `projectId`，renderer 无法选择任意目录或扩展名。
- 主进程按精确项目 ID 读取项目记录，只接受未删除、`root_path_local_attested = 1`、绝对、真实存在、非符号链接且 `realpath` 与记录一致的目录。
- 输出扩展名固定为 `.pptx` 或 `.docx`。标题只用于生成受限文件名；控制字符、路径分隔符、Windows 非法字符、尾随点/空格和保留设备名会被清理，名称长度限制为 96 个字符。
- 输出文件以 `wx` 和 `0600` 独占保留；已有同名文件不会被覆盖，冲突时依次使用 `-2`、`-3` 等后缀，最多尝试 1,000 个候选。
- 生成器只能接收主进程租约分配的路径。成功回执使用租约的文件名和路径，不信任生成器返回的路径；Word 文件大小由提交时的实际文件状态取得，不信任生成器元数据。
- 租约提交要求目标仍是非符号链接、非空普通文件；生成失败或提交失败会删除未提交目标。已提交文件不会被失败清理误删。
- 可选项目 authority 接收冻结的 actor、tenant、sender、purpose、operation、项目 ID 与项目用户 ID；拒绝或异常均失败关闭，项目根目录不会披露给 authority。
- Phase 1 已注入实际数据库和可选 `authorizeAIEngineProjectOutput`，保留第 200 批的主窗口/main frame、当前 DID/tenant 和固定用途授权。
- 新增真实生成器集成回归：生产 PPT 与 Word 引擎均能覆盖独占保留的空文件，提交后的产物非空并具有 Office ZIP `PK` 文件头。

## 回归与门禁

- AI Engine IPC、授权、输入、输出租约、真实 PPT/Word 写盘、引擎单元测试及 Phase 注册：8 test files、212 tests passed。
- 固定 renderer IPC capability 验证：1,217 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings；相关 Prettier 和 `git diff --check` 通过。
- Desktop 完整构建通过；既有 `jspreadsheet` eval、大块输出和 splash 资源提示未转化为构建失败。

## 未完成边界

- `projects.user_id` 当前是应用登录/设备用户 ID，而文档授权主体是 DID；仓库尚无两者的可审计绑定。可选项目 authority 已留出接口，但本批不宣称完成生产项目 owner/DID 授权。
- renderer 仍会在成功 UI 中收到主进程选定的输出路径；它不能选择该路径，但成功回执尚未进一步缩减为不透明文件句柄。
- 进程在保留文件后崩溃可能留下空文件或部分文件；尚无启动期 reconciliation，也没有绑定 actor、tenant、用途、输入摘要和文件摘要的认证耐久回执。
- 尚未增加按 actor/tenant 的请求速率和并发额度。独占保留可避免应用内同名覆盖，但没有提供抵御本机恶意进程替换目标文件的强目录句柄语义。
- 真实 Electron 身份切换、同名并发、崩溃恢复以及 Office 打开/内容回读 E2E 仍待完成。
