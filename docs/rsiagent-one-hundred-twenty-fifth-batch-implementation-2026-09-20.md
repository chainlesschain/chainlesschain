# 第一百二十五次工程实施：Plugin 第三方依赖隔离加载

## 本批目标

关闭 Plugin Sandbox 将相对模块与 `node_modules` 依赖交给宿主 CommonJS loader 执行的路径，使第三方代码及其 console 输出继续受同一 VM 与日志最小披露边界约束。

## 实施结果

- 插件相对模块和包依赖现在由 Sandbox 自有 CommonJS loader 在同一 VM context 中编译执行，不再调用 `require(resolvedPath)` 或 `require(modulePath)`。
- 模块解析结果经插件根目录 `realpath` 边界复核，目录外文件和解析失败统一返回稳定 `PLUGIN_SANDBOX_MODULE_UNAVAILABLE`。
- 单个模块限制为 4 MiB、单个 sandbox 最多缓存 512 个模块，仅接受 `.js/.cjs/.json`；原生 `.node`、ESM 及其他格式失败关闭。
- 依赖内部的相对 `require` 复用同一受限 loader，循环/重复加载使用 sandbox 私有缓存，销毁时清空。
- 第三方依赖的 `console.*` 进入上一批建立的固定事件信封，不会调用宿主全局 console 或泄露原始参数。

## 回归与门禁

- 临时插件包回归覆盖 bare package、嵌套相对依赖、console secret、重复加载缓存、原生模块和目录外路径拒绝。
- 源码门禁禁止恢复 `return require(resolvedPath)` 或 `return require(modulePath)`。
- 针对性回归：3 test files、17 tests passed；扩展 Plugin 回归：12 test files、105 tests passed。
- ESLint：0 errors（5 条既有 `curly` warnings）。

## 未完成边界

- 允许名单内的 Node 内置模块仍由宿主提供；本批不是进程级或操作系统级沙箱证明。
- Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
