# 第一百三十二次工程实施：LLM 配置 IPC 最小披露

## 本批目标

阻断 `llm:get-config` 把 API Key、provider endpoint、organization、system prompt 与任意扩展字段直接返回 renderer，同时保持设置页更新非敏感配置时不会清空主进程私有值。

## 实施结果

- 新增 `llm-config-projection`，按八类 provider 与通用 options 的字段白名单重建 renderer 配置。
- API Key、baseURL/Ollama URL、organization 与 system prompt 读取值固定为空，只返回对应 `*Configured` 布尔状态。
- Model/embedding/version/name、有限数值 options 与布尔开关继续按兼容合同返回；未知顶层、provider 和 options 字段均丢弃。
- `llm:set-config` 先通过写入投影：空私有字段保留当前主进程值，非空字符串替换，显式 `null` 清除；configured receipt 字段不会持久化。
- 部分配置写入会保留未提交 options/provider 字段，避免最小披露读回导致无关配置被覆盖。

## 回归与门禁

- Config projection + Core/Selector IPC 隐私回归：3 test files、10 tests passed。
- 覆盖多 provider 密钥/endpoint、organization、system prompt、未知字段、空值保留、替换、显式清除及 core handler 实际接线。
- ESLint：0 errors、0 warnings。
- `git diff --check` 通过。

## 未完成边界

- Model ID、provider name、options 与其他成功业务 payload 仍按现有 UI 合同返回；尚未完成字段级 renderer 授权。
- Core 内部日志、`llm-manager`、其他 LLM IPC 分组及 renderer 自身日志仍待收口。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
