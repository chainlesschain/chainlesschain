# 第一百九十七次工程实施：旧 Skill Sync Renderer IPC 生产退役

## 本批目标

退役没有 preload、renderer 或其他生产调用者的旧 Skill Sync IPC。旧入口虽然对导入结果做候选态校验，仍允许任意 renderer 导出本地技能包、发起 peer catalog/下载/广播、导入外部包和解决冲突，且没有 sender、actor、tenant、用途或 peer 授权。

## 实施结果

- Phase 1 删除 Skill Sync IPC 注册，不再为 renderer 临时创建进程级 `SkillSyncManager`。
- 删除 `skills:sync:export/import/get-peer-catalog/download-from-peer/broadcast-catalog/get-sync-status/resolve-conflict` 7 个 handler 及专用 IPC 模块。
- Skills barrel 删除 `registerSkillSyncIPC` 导入与导出，只保留可供内部受治理调用者使用的 `SkillSyncManager`。
- 删除仅验证已退役 IPC 参数/异步回执边界的 5 个测试，保留 manager 的包格式、签名、路径、候选隔离、依赖与持久化安全回归。
- Cowork CI 选择器删除已不存在的 IPC 文件映射，manager 与 Skills barrel 仍映射到完整供应链合同测试。
- Phase 1 无条件注册模块数从 15 降为 14，并新增合同验证 manager 保留、renderer registrar 不再导出。
- renderer 固定能力清单原本未开放任何 `skills:sync:*` 通道，因此精确通道数保持 1,217。

## 回归与门禁

- Skill Sync/Phase 定向回归：2 test files、77 tests passed。
- 完整 Skills 回归：73 test files、1,133 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,217 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings；Cowork CI selector 语法检查通过。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 产品当前没有跨设备 Skill Sync UI 或替代入口；未来若恢复该能力，应从受治理 service 层建立新合同，不能重新开放通用 renderer IPC。
- 未来入口仍需绑定实际主窗口/main frame、actor DID/tenant、固定用途、受信 peer、短期网络 capability 与包大小/速率配额。
- peer 传输、候选 store、依赖解析和冲突决议仍需认证耐久审计、撤销传播与失败恢复。
- 真实多设备、恶意 peer、断网重试、并发冲突和签名 deployment E2E 仍待完成。
