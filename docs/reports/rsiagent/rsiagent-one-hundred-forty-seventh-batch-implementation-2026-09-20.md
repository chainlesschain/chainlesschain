# 第一百四十七次工程实施：Secure Storage 有界备份与恢复清单

## 本批目标

补齐 LLM 安全配置备份无限增长和底层任意路径恢复缺口：备份只能进入有界、可验证的服务端清单，恢复必须精确选择清单内的普通文件，保留清理失败时不能把超出上限的新备份误报为成功。

## 实施结果

- Secure Storage 默认最多保留 10 个备份；构造参数只接受 1–100 的安全整数，避免无界配置和隐式类型转换。
- 备份名使用严格 UTC 时间戳与 8 位随机十六进制后缀。清单只接纳命名匹配、位于规范备份目录内、非符号链接且不超过 16 MiB 的普通文件。
- 备份目录若是符号链接、junction 或非目录会失败关闭，不会经链接向外部目录写入。清单通过真实路径再次验证父目录，拒绝目录逃逸。
- 底层 `restoreFromBackup` 不再接受调用方提供的任意可解密路径；请求必须与当前服务端清单中的规范路径精确匹配，再执行认证解密和原子恢复。
- 每次创建备份后立即执行有界保留。新备份始终纳入保留集合，超过上限的旧备份通过原子文件提交器执行耐久删除；任一删除失败会撤销本次新备份并返回失败。
- 备份盘点、保留清理成功与失败只记录固定事件，不包含路径、文件名、配置内容或动态异常。

## 回归与门禁

- 备份保留、原子文件、Secure Storage 隐私与存储定向回归：4 test files、136 tests passed。
- 完整 LLM 主进程回归：35 test files、538 tests passed、15 tests skipped。
- 覆盖真实临时目录中的上限裁剪、最新备份保留、严格命名、目录链接、外部路径恢复、超大文件、清单内恢复、删除失败撤销及无效上限配置。
- 相关模块 ESLint：0 errors、0 warnings；Prettier、JavaScript 语法检查与 `git diff --check` 通过。
- Desktop `build:main` 通过。测试仅出现 Node `punycode` 弃用提示。

## 未完成边界

- 当前保留上限是进程配置，不是 operator 签名的 tenant policy；自动删除也没有独立 destruction authority、双人审批或认证耐久审计回执。
- 清单依赖单进程内的检查与删除，不能替代跨进程 owner/fence。多个 Desktop 主进程或外部进程共享目录前仍需跨进程锁与竞争故障演练。
- 真实突然断电、控制器缓存丢失及 Windows、macOS、Linux 文件系统故障矩阵尚未完成。
- 真实 Windows Credential Manager、macOS Keychain、Linux Secret Service、系统文件选择器、损坏导入文件及用户目录 ACL E2E 尚未完成。
- tenant HMAC、秘密轮换与撤销仍是生产上线门槛。
