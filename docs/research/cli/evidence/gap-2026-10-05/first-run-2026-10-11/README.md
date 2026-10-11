# Linux CLI 首次旅程、认证 usage 与整段费用修复（2026-10-11）

本轮接通公开 CLI 的 install → configure → authenticate → tool → artifact 五阶段独立诊断，并修复认证费用丢失、整旅程漏算和错误消息截断后的部分密钥残留。源码与离线原件见 [合同归档](./contracts/manifest.json)。火山实际旅程尚待执行，不把离线合同或 AI 复核计入正式样本。

已落实的优化：

- `cc llm test --json` 保留四项已校验 usage 与 USD token 估算；普通文字输出兼容。模型消耗 reasoning tokens 却耗尽最终答案额度时，失败回执仍保留 usage；缺失、非法计数或未知费率保持 null。
- 首次旅程的 `observation.firstRun.costAccounting` 分列认证和工具费用，总费用仅在两项都已知时求和。Eval result 继续保存工具费用；旧 `.97` 认证没有 usage，不补零，也不把工具费用冒充整旅程费用。
- Astra 复核发现并关闭两项问题：早停 `tool.passed:false` 不能证明工具未收费，工具费用保持未知；已知密钥在 provider 错误及 reply 截断前移除，避免仅完整密钥脱敏留下前缀。AI 复核不替代独立人工预审。
- 五阶段 driver 复用正常公开安装的同一 private installation/profile；密钥仅注入认证与模型子进程，npm/git/config/checker 无密钥。原始冻结 verify-04 prompt 不追加提示；失败、候选正文、完整 diff、冻结检查及四项费用语义检查均保留。显式付费 workflow 不因普通 PR 或无标记 push 调用模型。

最终本地验证为 Windows **201/201**、WSL Linux **201/201**，零 skip；Windows 系统 Node **22.22.2**，Linux 固定 **22.12.0**。五阶段及公开安装合同两平台各 **17/17**，零 skip；相同用例不跨平台累加。ESLint、Prettier、diff 和四项生成文件检查通过。

另保留 Windows 沙箱账户的 **16 pass / 1 fail** 原始日志，原因是 `CodexSandboxOffline` 对 longfa 所有的 Git checkout 触发 dubious ownership；在 owner 环境复验 17/17，未放宽 Git 配置。Windows 该 TAP 日志未 pin Node executable/version，不能当作 Windows Node22.12 的验证。原始失败日志为 PowerShell UTF-16LE，归档保留其字节，解析时按 BOM 识别。

合同归档共有 **18 份 gzip 双摘要原件**：13 个 normalized 源码/测试/workflow snapshot、两个最终201项 JSON reporter、两个17项 TAP reporter与一个原始环境失败 reporter。源码集合指纹为 `sha256:a5dfda44af8bd73d7fa08b411fe3d46094bb392f940c6cf04991912753b7503b`；准确提交需独立核对所有13个 Git blobs。

实际诊断限制：Ubuntu24.04 x64 / Node22.12、public CLI0.166.97、volcengine/deepseek-v4-flash-ga-260731；全旅程30分钟，工具8分钟、20轮、$0.25估算停止线。公开 `.97` 认证 usage/总费用与 invoice 仍未知；该停止线不能冒充 provider 硬额度。未发布费用修复不会装入公开 `.97` 后再宣称发行版本通过。

正式 **36 tasks + 9 firstRuns / NOT_RUN / observed=0 / $99** 保持，冻结计划 `sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0` 未改。独立人工预审与 review 外部锁、真实账单/硬额度、目标 GUI/辅助技术、8h/24h/SLO、Windows/macOS durable/owner-only 及完整 native review 仍待完成；不发布或合并。

后续首次Actions发现fresh checkout的semver间接依赖，模型阶段未执行。已完成抽取与无依赖回归，完整失败和修复见[启动delta归档](./bootstrap/README.md)，不覆盖以上历史合同。
