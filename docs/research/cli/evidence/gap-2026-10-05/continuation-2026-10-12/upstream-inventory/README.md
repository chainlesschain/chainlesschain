# 11 个稳定版本的完整清单与保守处置

覆盖 Codex CLI0.160.1/0.161.0/0.162.0/0.162.1 和 Claude Code2.1.290–2.1.296，记录41个预发布但不并入稳定范围。974条均有原文、版本、来源与处置引用；Codex摘要和完整PR changelog存在重复，**974不是独立功能数、场景执行数或测试通过数**。完整逐项JSON、版本清单、源码分组及14份HTTP原件见 [manifest.json](./manifest.json)。官方文档初次404原件同样保留；CLI版本身份来自明确官方稳定 release API，未从混合产品页面猜测。

Astra生成的是完整清单、来源路由与保守候选处置。Haiku与非法UTF8两项确认缺口由根代理完成集成并回归；其余MCP协商、Responses Retry-After、管理hooks/权限、原生沙箱、后台生命周期和IDE场景均未宣称已验证。报告所引用源码为当时工作区快照，不把已有测试文件引用计为974次实际执行。后续源码绑定与工程验证见[Haiku集成](../haiku-runtime/README.md)及[UTF8保护](../utf8-edit/README.md)。

上游审查基线0.160.0 / 2.1.289继续保留，未因清单完成自动推进。当前2026-10-12 fixture只更新已确认的模型合同。AI复核不代替独立人工预审；正式36+9/NOT_RUN/observed=0/$99、冻结指纹、provider/账单/宿主/native/durable/长时验收不变。
