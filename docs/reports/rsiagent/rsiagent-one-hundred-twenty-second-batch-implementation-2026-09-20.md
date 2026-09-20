# 第一百二十二次工程实施：Plugin 品牌与企业扩展查询最小披露

## 本批目标

关闭普通 Plugin IPC 的品牌、Provider、存储、加密与合规注册扩展原对象返回，避免资源地址、服务端点、能力对象和审计 sink 跨越公开查询边界。

## 实施结果

- 新增 `projectPluginEnterpriseEntries`，覆盖 Brand Theme、Brand Identity、LLM、Auth、Data Storage、Data Crypto 与 Compliance Audit。
- Brand Theme 的 tokens 仅接受有界键名以及简单颜色、数值长度/时间或标识符值，URL、函数表达式和复杂字符串不返回。
- Brand Identity 仅保留身份与产品展示文本，`logo/splash/favicon/eula/links` 等资源或链接字段不再返回。
- LLM/Auth Provider 删除 endpoint、endpoints 和 capabilities；仅保留身份、类型、模型或字符串 scope。
- Data Storage、Data Crypto 与 Compliance Audit 删除 capabilities 和 sinks，仅保留类型、算法及公开描述字段。
- active 与 list 查询统一经过同一类型化投影，renderer TypeScript 契约和 Admin Console 同步删除已收窄字段。

## 回归与门禁

- 投影测试向七类对象注入同一 secret，并验证危险字段、复杂 theme token 和原值均不会出现在结果中。
- 普通 IPC 的十四个 active/list handler 均覆盖运行时投影，并验证两种查询返回一致的公开对象。
- 针对性回归：4 test files、45 tests passed。
- ESLint：0 errors。

## 未完成边界

- Plugin 权限查询/更新和部分生命周期成功回执仍需字段级治理。
- 真实 sandbox/第三方日志、Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
