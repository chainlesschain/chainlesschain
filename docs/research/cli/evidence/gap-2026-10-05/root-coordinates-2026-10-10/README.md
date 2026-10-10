# LowBox 根坐标只读原生观察

[manifest.json](./manifest.json)记录 65 份 gzip 原件的原始/归档字节摘要；包含三轮冻结输入、三个编译目标的调用和二进制摘要、实际 host stdout/stderr、actor identity、安装/退出回执、最终报告及 Windows 九文件回归输出。最终 tracked 输入必须与 c-source 原件逐字节一致；本机 compiler closure 非 hermetic。

Windows 10 x64、固定 Node 22.22.2、普通非管理员用户启动原监督器。只增加当前 LowBox 线程的固定 root native open 和 Global C alias query；观察函数没有 DeviceMap setter、ACL 变更、宿主代开、namespace fallback 或 reparse 翻译。既有 broker 的私有映射和 capsule ACL 设置保持原诊断设计。

两次实际 root open NTSTATUS 均为 0，两个句柄与 inherited root 的 FileId、卷号和 NT name 一致，directory=true/reparse=false。直接打开精确 Global C alias 返回 unsigned 3221225506 (`0xC0000022`)，未尝试 query；前后线程/PID、无 impersonation、有效用户/AppContainer SID、零 capability 观察相同。默认六槽，带参数调用拒绝，root exit 0、Job 0、profile 删除、host map 未变。

a 轮 native 执行及清理成功，但之后 runner 用 Windows 绝对路径 import verifier，工具记录返回 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；该异常没有单独原 stderr 文件，不能冒称完整 runner 成功。改 `pathToFileURL` 后 b 轮冻结、重编译三个目标并实跑成功。未运行旧综合 self-test（普通进程无 X map 时已知失败），不声称它通过。

Astra 随后确认 b 轮 verifier 会接受 pending/矛盾的 IO completion、held root 元数据及 alias 查询值；runner 的源摘要也未覆盖三份二进制。已新增 15 项拒绝回归，记录 native decoded length/completeness，并在运行前后校验 frozen source、三个 binary、七份复制产物。c 轮全部重编译并实跑成功，观察结果一致，最终 verdict 来自 c 轮；a/b 仅保留各自原始记录，不迁移其旧 verifier 或 producerInputsUnchanged 结论。

最终 Windows 九文件 544/544、零失败/跳过；Linux Node 22.12.0 新合同 50/50，Linux stdout 仅有工具记录。格式、lint、spawn inventory 检查通过。Astra 独立审查结果另见验证文档。

Astra 最终只读复核 12/12 冻结输入逐字节一致、3/3 二进制和 7/7 运行副本摘要/大小一致；冻结 verifier 重算与 c report.inspection 一致，host/probe/两 receipts 与报告一致，独立合同 50/50。c 轮实际时间 2026-10-10 22:04:48–22:04:52（北京时间）。

一次根坐标相同不证明 Global alias 绑定、前缀不可重绑定、所有 suffix 解析等价或持久 authority。六项不支持的声明均固定 false；只校验原始观察，继续 NOT_ADMITTED。junction 修复、完整 native review、旧冻结 211=194/16/1 与 6/4/4、正式 36+9、$99 和 observations、durable/账单/真人/长时验收状态未改，无付费调用。
