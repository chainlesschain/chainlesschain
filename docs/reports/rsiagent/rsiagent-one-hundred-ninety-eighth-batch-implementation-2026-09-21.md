# 第一百九十八次工程实施：Markdown Skills IPC 最小表面

## 本批目标

把 Markdown Skills IPC 收敛到当前产品实际需要的技能查询、路由、执行和凭据入口。旧模块还注册 11 个固定 preload 未开放且仓库无调用者的维护/写入入口，包括任意 workspace 切换和直接创建 SKILL.md/handler 文件。

## 实施结果

- 删除 `skills:load-all`、`skills:reload`、`skills:set-workspace`、`skills:get-body`、`skills:auto-execute`、`skills:find-for-task`、`skills:parse-command`、`skills:set-enabled`、`skills:get-stats`、`skills:get-categories`、`skills:create` 11 个无消费者 handler。
- renderer 不再能够通过旧入口切换任意 workspace、重载全局 registry、直接改变技能 enabled 状态或向文件系统写入 SKILL.md 与可执行 handler 模板。
- 删除只服务于 `skills:create` 的 path/fs 依赖、Markdown 生成器和 handler 模板生成器。
- 保留 `skills:list`、`skills:list-invocable`、`skills:route`、`skills:get`、`skills:execute` 五个现有产品/E2E 通道，以及 Skill Credentials 设置页使用的三个专用凭据通道。
- 注册与注销函数均支持注入同一 `ipcMain` port，新增精确集合测试验证 8 个 handler 可对称注册和清理。
- Phase 1 handler 元数据由错误的 18 修正为 8；renderer Skills 类型删除从未实现的 install/uninstall 伪通道，API tester 文档同步到 5 个主 Skills handler。
- 已删除通道原本未进入固定 preload capability，因此精确通道数保持 1,217。

## 回归与门禁

- Skills IPC/Phase 定向回归：2 test files、57 tests passed。
- 完整 Skills 回归：74 test files、1,134 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,217 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 保留的 8 个 handler 仍需在 registry、router、executor 或 credential store 访问前绑定实际主窗口/main frame、actor DID/tenant 与固定用途。
- list/get/route/execute 的参数仍缺统一 plain-data、字段、字节、集合、深度和速率边界。
- get 仍返回技能 definition/body，execute 仍返回内部 result 并向 HookSystem 发送动态结果/错误正文，尚未完成字段级最小投影和内容分类。
- registry/loader 仍是进程级共享对象，workspace、技能可见性、指标和执行 owner 尚未按 tenant/session 隔离。
- 真实 Electron 技能面板、凭据设置、路由 authority、执行沙箱和 provider E2E 仍待完成。
