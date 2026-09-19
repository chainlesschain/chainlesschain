# 第一百二十三次工程实施：Plugin 权限与生命周期回执最小披露

## 本批目标

关闭 Plugin 普通/懒加载 IPC 对权限数据库记录和生命周期 manager 返回值的原样透传，统一权限查询、权限响应与插件启停卸载的公开结果契约。

## 实施结果

- 新增 `projectPluginPermissionRecords`，权限读取与更新仅返回有界 `permission` 和布尔 `granted`，不再返回 `grantedAt` 或任意附加字段。
- 新增 `projectPluginPermissionDetails`，权限详情仅保留展示与风险白名单字段，并限制数量、字符串长度、风险等级及颜色格式。
- 权限对话框响应只返回固定成功回执，失效请求返回稳定 error/code，不再透传 manager 的任意结果对象。
- 普通和懒加载的 uninstall/enable/disable 均在 manager 操作完成后只返回固定 `{ success: true }`。
- 懒加载权限查询与普通 IPC 对齐为 `{ success, permissions }`，并复用相同投影。

## 回归与门禁

- 投影测试向权限记录、详情、响应和生命周期伪结果注入 secret，确认数据库时间、metadata、内部结果与动态错误均不进入公开结果。
- 普通 IPC 覆盖权限读取/更新、失效响应、详情以及三类生命周期操作；懒加载 IPC 覆盖权限读取和三类生命周期操作。
- 针对性回归：3 test files、36 tests passed。
- ESLint：0 errors。

## 未完成边界

- 真实 Plugin sandbox/第三方日志、Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- 生产权限 authority、审批身份和审计回读不由本批固定 IPC 回执替代。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
