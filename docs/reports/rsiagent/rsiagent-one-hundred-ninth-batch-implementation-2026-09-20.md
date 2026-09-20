# 第一百零九次工程实施：Plugin Loader 文件异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `plugin-loader.js` 读取 `plugin.json`、回退 `package.json` 和插件入口文件时的三条非 `ENOENT` 原样 rethrow。文件系统异常原文只进入严格日志，直接调用方收到固定 `PLUGIN_OPERATION_FAILED`。

`ENOENT` 兼容语义保持不变：缺少 `plugin.json` 时仍尝试 `package.json`，两者均缺失仍返回受控文案，入口缺失仍按原有受控校验失败。本批没有改变安装路径解析或 manifest 字段验证。

## 主要实现

- Plugin Loader 接入共享稳定 operation Error。
- `fs.promises` 增加生产默认不变的测试注入口。
- 三条非 `ENOENT` 读取异常先进入严格日志，再转换为稳定 Error。
- manifest fallback 与入口文件缺失的既有控制流保持不变。
- 回归分别向 manifest 和 entry 读取注入 secret。
- 源码门禁覆盖 `error/err/err2/e` 原样 rethrow。

## 验证结果

```text
Plugin Loader and shared boundaries:
  Test Files  3 passed (3)
  Tests      24 passed (24)

Source gate:
  raw caught-error rethrows in plugin-loader.js: 0

ESLint:
  0 errors
```

## 仍未完成

- Plugin IPC 的页面内容 fallback 仍有一条内部原样 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
