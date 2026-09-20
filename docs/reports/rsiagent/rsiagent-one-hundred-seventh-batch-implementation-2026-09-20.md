# 第一百零七次工程实施：Plugin Update Manager 异常与事件最小披露

日期：2026-09-20

## 本批结论

本批关闭 `update-manager.js` 检查更新和单插件更新的两条原样 rethrow，并移除 `check-error`、`update-error` 事件中的 Error 对象。失败路径仍保持 rejection，`checking` 仍由 `finally` 复位；调用方和事件监听器只收到固定 `PLUGIN_OPERATION_FAILED`。

构造器增加可选 Marketplace API 注入口，生产默认仍使用既有单例；测试可在无网络条件下注入失败。该变更不改变 channel、自动检查默认值或批量更新结果结构。

## 主要实现

- check/update catch 改为共享稳定 operation Error。
- `check-error` 事件改为固定 descriptor。
- `update-error` 保留 pluginId 参数，第二参数改为固定 descriptor。
- `finally` 的 `checking=false` 行为保持不变。
- 新增可选 `marketplaceAPI` 构造注入，生产 fallback 保持原逻辑。
- 运行时 secret 负例与源码门禁覆盖两条 rejection 和两类事件。

## 验证结果

```text
Plugin Update Manager and shared boundaries:
  Test Files  3 passed (3)
  Tests      18 passed (18)

Source gates:
  raw caught-error rethrows in update-manager.js: 0
  dynamic Error event payloads: 0

ESLint:
  0 errors
```

## 仍未完成

- Plugin Loader、Permission Dialog 与 Plugin IPC fallback 仍有原样内部 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
