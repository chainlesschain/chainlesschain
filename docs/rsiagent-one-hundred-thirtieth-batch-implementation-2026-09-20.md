# 第一百三十次工程实施：LLM Selector IPC 隐私边界

## 本批目标

收紧 LLM 智能选择与 provider 切换 IPC 的日志和失败返回，避免 provider/model/baseURL/config 及原始 Error 跨普通日志或 Electron IPC 异常边界传播。

## 实施结果

- 新增可复用 `llm-ipc-privacy` 边界；组件与操作只接受白名单值，日志使用固定消息。
- `get-selector-info`、`select-best`、`generate-report` 与 `switch-provider` 的 catch 均改为固定 `LLM IPC operation failed / CC_LLM_IPC_OPERATION_FAILED`。
- Provider 切换不再记录动态 provider、model、baseURL 或 manager config；成功日志同样只含固定事件和白名单 operation。
- 失败边界不接收或检查原始 Error，不会触发 hostile Proxy/accessor，也不附 `cause`。
- 源码门禁禁止 selector handler 重新直连通用 logger/console、原样 rethrow 或读取 managerConfig 的 model/baseURL。

## 回归与门禁

- 专用回归：1 test file、3 tests passed。
- 覆盖四个 handler 的 hostile Error、动态 component/operation 和递归源码合同。
- ESLint：0 errors、0 warnings。
- `git diff --check` 通过。

## 既有测试边界

- 旧 `tests/unit/llm/llm-ipc.test.js` 在当前仓库根 Vitest 下 22 项均于 handler 注册阶段失败：其 Electron mock 未把 `ipcMain` 传入拆分后的 `registerCoreHandlers`，报错为 `Cannot read properties of undefined (reading 'handle')`；失败发生在本批 selector 逻辑前。
- 本批没有为通过测试而改变生产依赖装配，使用显式注入 `ipcMain` 的 selector 专用回归验证实际修改。

## 未完成边界

- `llm-ipc-core`、其他 LLM IPC 分组、`llm-manager`/selector 内部日志及业务 payload 尚未据此完成最小披露。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
