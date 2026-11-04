# DMM-07 IDE 事件观察入口验证（2026-11-04）

本批接入 VS Code / JetBrains 的显式桌面事件观察界面，使用同日上一批独立 v4 `goal.events` 连接；不扩充原生授权、不读取凭据、不提供持久游标或历史重放。基线 `main@5717128e51` 加既有未提交工作树，未提升版本或发布。

**11 个互不重叠文件/类、161 项通过、0 失败、0 跳过**：[Node/Vitest 136](./cli-tests.json)、[JetBrains 观察器 8](./jetbrains-observer-tests.xml)、[JetBrains 既有插件管理 17](./jetbrains-plugin-manager-tests.xml)。不与同日先前批次累加；代码、测试及本地制品指纹见 [汇总](./summary.json)。

从 `packages/cli` 运行：

```powershell
node node_modules/vitest/vitest.mjs run __tests__/unit/vscode-ext-goal-events.test.js __tests__/unit/vscode-ext-goal-events-view.test.js __tests__/integration/vscode-goal-events-process.test.js __tests__/unit/vscode-ext-goal-panels-view.test.js __tests__/unit/vscode-ext-goal-drafts.test.js __tests__/unit/vscode-ext-goal-draft-request-view.test.js __tests__/unit/vscode-ext-plugin-manager.test.js __tests__/unit/plugin-goal-extension.test.js __tests__/unit/cli-project-goal-events.test.js --reporter=json --outputFile=../../docs/research/agents/evidence/dmm-ide-goal-events-2026-11-04/cli-tests.json
```

从 `packages/jetbrains-plugin` 运行，本机使用已有 JDK 21 与 Gradle 缓存：

```powershell
$env:JAVA_HOME = 'C:/Users/longfa/AppData/Local/Programs/idea-2025.3/jbr'
.\gradlew.bat '-Dorg.gradle.java.installations.paths=C:/Users/longfa/AppData/Local/Programs/idea-2025.3/jbr' --offline --no-daemon test --tests com.chainlesschain.ide.GoalEventObserverTest --tests com.chainlesschain.ide.PluginManagerTest --console=plain
.\gradlew.bat '-Dorg.gradle.java.installations.paths=C:/Users/longfa/AppData/Local/Programs/idea-2025.3/jbr' --offline --no-daemon buildPlugin --console=plain
```

协议测试覆盖固定参数、原生选中文件的单参数传递、ready 顺序、目标/插件/版本不变、拒绝额外字段、无效 UTF-8、超大或截断输出及有限显示。VS Code API 替身验证取消选择、刷新、关闭、工作区变化、旧回调、停止确认与替代进程次序。两端各 3 个真实进程用例运行协议夹具，区分正常结束、手动停止及污染后终止；JetBrains 额外用子 JVM PID 独立确认后代已退出。夹具不连接真实业务项目，不能替代上一批的原生 SQLite/HMAC 联调或真实 GUI。

JetBrains 生产与 UI 源码编译、JUnit 和 `buildPlugin` 均通过。测试夹具首次因局部变量 `java` 遮蔽包名、随后因 Gradle 类缺少 CodeSource 失败，修正为独立变量与类资源路径后最终 25 项通过；只统计最终 XML。构建的 headless searchable-options 扫描不计作真实 GUI 验收。

VSIX 用本机已缓存 `@vscode/vsce@3.9.2`、`package --no-dependencies` 构建，通过现有 `verify-vsix.mjs` 全部 18 项 metadata 检查。归档中的事件模块/视图与源码一致；JetBrains ZIP 中的观察器/Decoder/UI 编译类与本地编译输出一致。制品路径与 SHA-256 只作为本地检查，保留现有版本号，不表示公开版本已支持此增量。

未运行真实 VS Code / JetBrains / Electron GUI、Linux/macOS 真实宿主、独立业务效果或准确候选提交远端发行门。持久事件历史、完整交付助手及整体 DMM 计划仍需继续；发行时继续遵守三平台准确提交验证、OIDC 和子包→CLI→IDE→移动/PC 顺序。
