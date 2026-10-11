# CLI 0.166.98 第四轮 CI 修复与真实失败归档

821c63e 的发行检查发现安装测试误取新增的 Windows 准备步骤，以及三个 CLI 测试仍假设最后一条消息是 user；实际请求末尾为可信临时预算 system。安装测试改为唯一命名 Bash 步骤，保留原重试和 15000ms 期限；CLI 测试严格检查原历史及唯一 49 次剩余请求预算，E2E 回调异常即时返回 500 并传回主断言，保留原成功断言及 90000ms/210000ms 期限。

安装夹具 Windows/Linux 修前各 3/3 失败、修后各 6/6，既有合同各 56/56；最终 Windows CI integrity 两文件实际 60/60。CLI 两文件双平台修前各 2fail/9pass、修后各 11/11；完整 E2E 双平台各 1/1，无 retry，独立坏请求负例产生 HTTP500 与主断言失败，无 90 秒等待或 unhandled error。生产 agent、SDK 整树、共享 action 与安全 guard 均未改。

JetBrains macOS 原件显示初始 UI 和 canonical drain 成功，进程组结算后端口 8082 仍占用；原件不能区分退出瞬态与逃离进程组。诊断改为在原 30 秒截止内等待实际 bind+close，仅重试 EADDRINUSE，有限期限/正轮询校验及探测前后截止检查接入原宿主合同。Windows 端口 6/6；本机 Ubuntu 为 WSL1，端口 4pass/2fail，独立探针证明该环境允许同一 loopback 端口双 listener。失败完整保留，未跳过断言；原生 Linux/macOS 仍待新提交 Actions。

PR Tests API head 为 821c63e，实际检出为 003a70ec 合并源码；八项来源文件与 head 逐字节匹配。该套件 40054pass/194skip/2fail，两失败正是本次 prepareCall/resume。三 OS CLI E2E 的末尾 user 假设与独立真实 loopback 请求绑定，不能把捕获请求视为旧断言通过。历史 Kernel Windows SDK 83/83 只归档原准确 821 成功，不替代新 SHA 门。

归档 [manifest.json](./manifest.json) 保存 518 个 gzip 原件，15 个历史 Git 内容绑定；每份记录压缩前后 bytes/SHA256，包含失败、拒绝、缺依赖、受控负例和最新索引。根代理已独立解压、摘要、原 Git 内容及候选源码核对。helperSnapshot 的命令只用于复现记录，不代表重跑模型或原生实验。

旧 821 的六门通过不能转移给新提交。新发行候选须自己的七门 71/5/19/10/3/3/3，以及 Full Test、PR Tests 和 Host Diagnostics 修复验证；用户已授权通过后按 Actions OIDC 子包 → CLI → IDE 发布并公开回读，当前未新增发行、付费复跑或合并。正式 **36+9 / NOT_RUN / observed=0 / $99** 和冻结指纹不变，人工预审、账单/硬额度、目标 GUI/辅助技术、native/durable 与 8h/24h/SLO 仍开放。
