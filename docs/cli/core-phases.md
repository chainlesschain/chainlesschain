# CLI — Phases 2–7 · Init, Persona, Cowork

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)

## Phase 2: Knowledge & Content Management

```bash
chainlesschain import markdown ./docs  # 导入 markdown 文件
chainlesschain import evernote backup.enex # 导入 Evernote
chainlesschain import pdf document.pdf # 导入 PDF
chainlesschain export site -o ./site   # 导出为静态 HTML
chainlesschain git status              # Git 集成
chainlesschain git auto-commit         # 自动提交改动
```

## Phase 3: MCP & External Integration

```bash
chainlesschain mcp servers             # 列出 MCP 服务器
chainlesschain mcp add fs -c npx -a "-y,@modelcontextprotocol/server-filesystem"
chainlesschain mcp add weather -u https://mcp.example.com/weather            # Streamable HTTP 传输 (自动识别)
chainlesschain mcp add weather -u https://mcp.example.com/weather -t http    # 显式传输类型 (http|sse|stdio)
chainlesschain mcp add weather -u https://... -H Authorization=Bearer+xyz    # 自定义请求头 (可重复)
chainlesschain mcp tools               # 列出可用工具
chainlesschain mcp scaffold weather                          # 在 ./weather 中生成 stdio MCP 服务器
chainlesschain mcp scaffold weather -t http -p 4001          # Streamable HTTP + SSE 于端口 4001
chainlesschain mcp scaffold weather --dry-run --json         # 预览文件集合, 不落盘
chainlesschain mcp scaffold weather -d "Forecasts" -a Alice  # 自定义描述 + package.json 作者
chainlesschain mcp scaffold weather -o ~/projects/w --force  # 指定输出目录, 覆盖已存在内容
chainlesschain mcp registry list                             # 浏览社区 MCP 服务器精选目录
chainlesschain mcp registry list -c database --sort rating --order desc
chainlesschain mcp registry list -t browser,automation --json
chainlesschain mcp registry search git                       # 关键字搜索 (name/description/tags)
chainlesschain mcp registry show filesystem                  # 完整条目详情 (id 或短名)
chainlesschain mcp registry install github                   # 将目录条目注册为 MCP 服务器
chainlesschain mcp registry install github --as gh --auto-connect
chainlesschain mcp registry categories                       # 列出目录分类
chainlesschain browse fetch https://example.com  # 抓取网页
chainlesschain browse scrape <url> -s "h2"       # 抓取指定元素
chainlesschain llm providers           # 列出 10 个 LLM 提供商
chainlesschain llm switch anthropic    # 切换当前提供商
chainlesschain instinct show           # 已学习的偏好
```

## Phase 4: Security & Identity

```bash
chainlesschain did create              # 创建 DID 身份 (Ed25519)
chainlesschain did list                # 列出所有身份
chainlesschain did sign "message"      # 使用默认 DID 签名
chainlesschain encrypt file secret.txt # AES-256-GCM 文件加密
chainlesschain decrypt file secret.txt.enc # 解密文件
chainlesschain auth roles              # 列出 RBAC 角色
chainlesschain auth check user1 "note:read" # 检查权限
chainlesschain audit log               # 最近审计事件
chainlesschain audit stats             # 审计统计
```

## Phase 5: P2P, Blockchain & Enterprise

```bash
chainlesschain p2p peers               # 列出 P2P 节点
chainlesschain p2p send <peer> "msg"   # 发送加密消息
chainlesschain p2p pair "My Phone"     # 配对设备
chainlesschain sync status             # 同步状态
chainlesschain sync push               # 推送本地改动
chainlesschain sync pull               # 拉取远端改动
chainlesschain wallet create --name "Main" # 创建钱包
chainlesschain wallet assets           # 列出数字资产
chainlesschain wallet transfer <id> <to> # 转账资产
chainlesschain org create "Acme Corp"  # 创建组织
chainlesschain org invite <org> <user> # 邀请成员
chainlesschain org approve <id>        # 批准申请
chainlesschain plugin list             # 列出已安装插件
chainlesschain plugin install <name>   # 安装插件
chainlesschain plugin search <query>   # 搜索插件仓库
```

## Project Initialization & Persona

```bash
chainlesschain init                    # 交互式项目初始化
chainlesschain init --bare             # 最小项目结构
chainlesschain init --template code-project --yes
chainlesschain init --template medical-triage --yes
chainlesschain init --template agriculture-expert --yes
chainlesschain init --template general-assistant --yes
chainlesschain init --template ai-media-creator --yes
chainlesschain init --template ai-doc-creator --yes
chainlesschain persona show                # 显示当前 persona
chainlesschain persona set --name "Bot" --role "Helper"
chainlesschain persona set -b "Be polite"
chainlesschain persona set --tools-disabled run_shell
chainlesschain persona reset
```

## Multi-agent Collaboration (Cowork)

```bash
chainlesschain cowork debate <file>    # 多视角代码评审
chainlesschain cowork compare <prompt> # A/B 方案对比
chainlesschain cowork analyze <path>   # 代码分析
chainlesschain cowork status           # 显示 cowork 状态
```

## Phase 6: AI Core (Hooks, Workflow, Memory, A2A)

```bash
chainlesschain hook list / add / run / stats
chainlesschain workflow create / run / templates
chainlesschain hmemory store / recall / consolidate
chainlesschain a2a register / discover / submit
```

## Phase 7: Security & Evolution

```bash
chainlesschain sandbox create / exec / audit
chainlesschain evolution assess / diagnose / learn
chainlesschain evomap federation list-hubs / sync / pressure
chainlesschain evomap gov propose / vote / dashboard
chainlesschain dao propose / vote / delegate / execute / treasury / stats
```
