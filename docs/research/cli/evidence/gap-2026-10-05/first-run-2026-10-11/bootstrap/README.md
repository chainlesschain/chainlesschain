# 首次旅程 fresh checkout 启动修复（2026-10-11）

[Actions 38120518762](https://github.com/chainlesschain/chainlesschain/actions/runs/38120518762) 在 Node22.12 的无账户离线验证阶段报 semver ERR_MODULE_NOT_FOUND。Docker pull、公开安装及模型阶段均 skipped，零新付费调用。原 job log、artifact ZIP 与 API 字节归档，原日志107448字节SHA256为38669291cdebbdfc2f12df7820120d68aa64ebedab01b6e23c00de654642cbf1，ZIP418字节SHA256/API digest为0c441e57e4941af032789645a8b1680d8a6250b4a8d0e74a6251d8f5dce4565f。

实际问题是诊断从 verify01-execution 导入 seed/snapshot/diff，间接加载 process broker → plugin scopes → semver。本机 node_modules 掩盖了新 checkout 的启动缺口。已抽取无 npm 依赖的 verify01-workspace.js，contracts/execution保留旧接口；文件校验、稳定读取、独占空种子、路径/链接拒绝、依赖流式摘要、diff容量及deadline均保持。Astra逐函数核对迁移正文，并发现抽取时遗漏的执行器空种子摘要常量，已恢复；AI不替代人工。

新测试在仓库外临时目录只复制源码并清除Node hooks，验证无依赖启动能到达confirm-live拒绝；另覆盖seed不覆盖/不越界、增删改diff、17MiB依赖不保留正文、外链拒绝、deadline。原22/23夹具失败来自未支持的--help，已改为实际的未确认执行拒绝并保留原件。

真正无node_modules的仓库外稀疏clone保留冻结Git对象：Windows Node22.22.2与Linux固定Node22.12.0各 **23/23**，零skip，包含真实keyless review pack prepare。Windows路径传给wslpath被解释成无反斜杠、沙箱WSL E_ACCESSDENIED两次环境失败也保留；最终用绝对Linux路径在owner环境通过，未放宽safe.directory或安装npm依赖。相关Vitest三套各85/85、collection各42/42，合计每平台 **127/127**，零skip；ESLint/Prettier/diff通过。相同合同不跨平台累加。

[manifest](./manifest.json) 共 21 份gzip双摘要原件，其中6个normalized源码blob；源码集合指纹 sha256:8a8e1f5c553d951c383157b5cf08f16d00e26d04e4c04b6928e024e756ca73d1。历史contracts18原件未覆盖；本轮fresh clone为bf51282基底加当前6文件源码overlay，后续commit须逐blob核对。修复后火山旅程由新源码显式触发，结果另行归档，不能rerun失败旧SHA。

正式36+9 / NOT_RUN / observed=0 / $99与冻结计划保持。独立人工预审/外部锁、账单/硬额度、目标宿主与辅助技术、8h/24h/SLO及Windows/macOS durable/native review仍待完成。本轮未合并或发行。
