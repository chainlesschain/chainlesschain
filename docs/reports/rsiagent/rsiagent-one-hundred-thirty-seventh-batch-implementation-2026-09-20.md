# 第一百三十七次工程实施：LLM 安全存储 IPC 最小披露

## 本批目标

阻断 Secure Storage IPC 把 API Key、完整配置、本地存储/备份/导入导出路径和 caught Error 返回 renderer 或写入普通日志，并约束备份恢复只能引用主进程已枚举的工件。

## 实施结果

- Secure Config Storage 的 35 处诊断已进入固定 component/event 边界，Storage 与 IPC 两个模块直接 logger/console、`error.message` 归零。
- 20 个 IPC catch 只返回固定 `CC_SECURE_STORAGE_OPERATION_FAILED` receipt，不再回显文件系统、密码、密钥或底层异常。
- `load` 只返回 configured 状态；`get-info` 删除 storage path、mtime 与 size；导出只返回 exported receipt。
- 创建/列出备份只返回 basename 级 backup ID，恢复会在主进程 inventory 中精确解析该 ID，不再接受 renderer 提供的任意路径。
- API Key 读取只返回 configured 布尔；通用 sanitize 使用固定八星占位符，不再保留密钥首尾字符；批量校验不返回字段路径。
- 注册与注销支持依赖注入，便于 hostile Error 和路径投影回归。

## 回归与门禁

- Secure Config Storage 与 IPC 隐私回归：2 test files、113 tests passed。
- 覆盖秘密/路径投影、backup ID 解析、未知备份拒绝、hostile Proxy Error、固定事件/operation 白名单和 23 个 handler 注销。
- ESLint：0 errors、0 warnings。
- Prettier 与 `git diff --check` 通过。

## 未完成边界

- Renderer 仍可调用保存/删除/导入导出和字段查询 API，尚缺 sender/tenant/用户授权、交互式确认及用途级 capability。
- Secure storage 成功写入的持久化策略、备份保留/删除、真实 OS safeStorage 与导入导出 UI E2E 尚未验收。
- 其他 LLM 模块日志/错误通道、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
