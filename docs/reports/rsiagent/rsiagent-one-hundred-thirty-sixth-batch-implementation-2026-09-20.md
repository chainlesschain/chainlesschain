# 第一百三十六次工程实施：LLM Selector 业务日志最小披露

## 本批目标

阻断 `llm-selector` 把选中的 provider、评分和 fallback provider 写入普通日志，同时保持选择、默认和回退算法及返回合同不变。

## 实施结果

- 新增 Selector 专用诊断隐私边界，只接受 `provider-selected`、`provider-defaulted`、`provider-fallback-selected` 三个固定事件。
- `llm-selector` 已删除直接通用 logger/console；provider、评分和 fallback 标识不再进入普通 sink。
- 未知动态事件名固定降级为 `unknown`，不允许经事件名携带业务值。

## 回归与门禁

- Selector 算法、业务日志与 IPC 隐私回归：3 test files、49 tests passed。
- 新增源码门禁与全部静态事件白名单验证。
- ESLint：0 errors、0 warnings。
- Prettier 与 `git diff --check` 通过。

## 未完成边界

- Selector 的模型特性、报告与选择结果仍按现有成功合同返回，尚未完成字段级 renderer 授权。
- Core/辅助 IPC/Manager 成功 payload，以及 context/session/memory/Manus 等其他 LLM 模块日志与错误通道仍待收口。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
