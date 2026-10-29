# macOS JetBrains 首次任务：verify-09 辅助修复

日期：2026-10-30。**verify-09 辅助修复已通过原 Docker 检查器；连同 verify-07 / 10，辅助交付共 3 项成功，原自动验收仍为 34/45。** 本页的 verify-09 对照不代表完整 macOS 首次安装旅程重新通过。三份修复测试现已实际安装到 `packages/cli/__tests__/`，仅做 Prettier 格式化，尚未随新的 CLI / IDE 发布。

安装后针对当前源码的独立回归为 **6 文件 70/70**：transcript 40、origins 12、index 2、新增 16。来源为已修改、尚未提交的工作区，不能视为冻结 b2aa 的完整依赖闭包与当前 main 相同。verify-07 / 09 / 10 的独立云端检查分别为 [40916508225](https://github.com/chainlesschain/chainlesschain/actions/runs/40916508225)、[40916174023](https://github.com/chainlesschain/chainlesschain/actions/runs/40916174023)、[40907857461](https://github.com/chainlesschain/chainlesschain/actions/runs/40907857461)；安装前后摘要、格式化差异与本机结果见[集成回执](./cli/evidence/native131-assisted-integration-2026-10-30/review.json)。原归档中的“未安装”保留归档时点，不改写原始 JSON。

CLI CI 三系统 `verify-cli` 已加入三个新增文件的定向步骤，新 HEAD 云端验证尚未完成。旧 source44 的 CLI CI / Strict 因两个 macOS 作业未获得 runner 而取消，完整矩阵未通过。下一版 .132 截断 / termination 产品修复仍在私有实现，未合入、未发行；按用户要求先完成新 CLI / IDE 发行，再用新版本真实重测，Microsoft Marketplace 继续暂缓。

交付：[修正后的完整测试文件](./cli/evidence/native131-assisted-install-2026-10-30/verify09/corrected-verify-09.test.js) · [相对原候选的补丁](./cli/evidence/native131-assisted-install-2026-10-30/verify09/repair.patch)。目标路径为 `packages/cli/__tests__/verify-09.test.js`，保留 **6 个用例与全部原断言**。

| 阶段                   | 实际结果                                                | 原因与处理                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生运行 `40909552042` | 生成成功；验收失败；baseline 11/11，候选 5/6            | `prefixEvent` 只用 `slice` 复制数组，负例改写消息内容时也污染后续正例的源消息；生产代码正确拒绝该内容。原运行和 ledger 保持失败。                                       |
| 仅修浅拷贝             | 候选 6/6；原行为变异仍 6/6，检查器拒绝                  | `structuredClone` 修复夹具别名，但原六例从未执行 `compact`，不能识别原 `sourceRef.digest` 守卫被移除。仅改一行不足以通过完整验收。                                      |
| 最终辅助修复           | 候选 6/6；原 baseline 11/11；唯一原变异 5 通过 / 1 失败 | 在现有篡改用例中追加 compact 对照：内容、事件序号保持一致，仅伪造来源摘要，重新规范化外层 ContextItem；要求拒绝伪造历史映射，并验证真实来源仍可回读。没有放宽原检查器。 |

上述三组结果均在真实 [GitHub Actions 40916174023](https://github.com/chainlesschain/chainlesschain/actions/runs/40916174023) 中顺序执行并保存回执；该运行 **success，attempt 1**。固定来源为 `cbf3bb93c62c5a2a8e2993bc0bc849c2a05e9a04`，不可变标签 `ci-verify09-assisted-20261030-v1`，artifact `12915562807`。没有调用付费模型，也没有伪造或重写 native generation summary。

## 验证范围

使用冻结项目 `b2aa3aba082873570e85dce39b00754e5504ff37` 和原 acceptance artifact `12913773491` 中直接提取的 setup/check 脚本，字节摘要与原结果一致。Node 为 22.12.0，Docker 为 `node:22.12.0-bookworm`，固定 image ID `sha256:344dbe71e1c47a59db0e94bebdcc94ef3a7bc8bd828393c820168993539048da`。setup 依照原脚本安装依赖，候选及变异检查在禁网容器内运行。生产模块和测试支持文件每阶段结束后均核对恢复摘要。

| 对象           | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| 原候选         | `3a194ef2990c21bf2cfdcd33736a4d4421e9d54888b67bbce920e7c7909c1adb` |
| 仅修浅拷贝候选 | `703c449223ec7c89db2c0310b7fa2125ae7100cdd6f62ba4d6000cd26d7c928c` |
| 最终文件       | `65b20b2906ad57b5c1a1e9d3621b250c86cc747e2c81d7de9d81e7cec040de9f` |
| 原 setup       | `49eb697c2cef5134c879baaedc5d36fd0d38fd98907bb67ce126c392188564da` |
| 原 check       | `dcbe6ab1606c575d78e72787f8b46a885c8d71df898f3226b7c3df79843c62a2` |
| 冻结生产模块   | `98235ac374ddc6fa8a9bc2de2c251cad9b3caa6527680ec211e8d1868c5ffb31` |
| 原精确变异模块 | `a2f64f40d837a6057a50571cdff8768152b671e3bada75f9f5b915ae08304f5b` |

变异 `trust-tampered-source-digest` 将 `source?.sourceRef.digest === item.sourceRef.digest &&` 改为 `Boolean(source) &&`。最终唯一失败是伪造来源被错误接受，属于行为断言失败；不是语法、导入或运行器错误。仅修浅拷贝版本漏检时，检查器先抛错，因此 `mutations` 数组为空，其原始 execution JSON 保留 6/6 漏检证据；没有补造成功变异记录。

此前本机 Windows Node 22.22.2 / Vitest 4.1.11 也完成五组对照：原 5/6、仅修浅拷贝 6/6、仅修浅拷贝变异 6/6、最终正常 6/6、最终变异 5/6。该局部复验不等于原容器检查；本页通过结论以实际云端回执为依据。完整首次任务、真实模型质量、当前 main 依赖闭包及新版本发行验收均保持独立边界。

## 证据与复核

[证据清单](./cli/evidence/native131-assisted-install-2026-10-30/verify09/review.json)包含实际下载 artifact 的逐文件内容、GitHub artifact 元数据、调度/完成观察以及原生失败的两份验收回执，共 **39 个逻辑文件**。每份 gzip 同时记录原始和压缩字节长度、SHA-256。GitHub 元数据中的原 ZIP digest 保留原值；此次下载解包后逐文件核验，没有声称独立重算整个 ZIP 摘要。没有归档私有资金或模型费用。

[独立校验器](./cli/evidence/native131-assisted-install-2026-10-30/verify09/verify-evidence.mjs)只读归档和本地 Git：核对双摘要、真实 CI/receipt/output 绑定、固定 CI payload 字节、冻结源码与支持文件、原失败及最终变异、可下载交付文件。运行：

```bash
node docs/research/cli/evidence/native131-assisted-install-2026-10-30/verify09/verify-evidence.mjs
```

复核通过：39 个文件；**本页 verify-09 辅助修复 1 项完成，三项辅助交付均已安装，原自动验收 34/45 不变**。后续新 HEAD 完整 CI、发行和新版本真实重测分别记录，不继承这份冻结检查器的通过结论。
