# Git同步

ChainlessChain使用Git作为核心同步机制，提供版本控制和跨设备数据同步。

## 为什么选择Git?

- ✅ **去中心化**: 无需依赖中心服务器
- ✅ **版本控制**: 完整的历史记录，可回滚
- ✅ **冲突解决**: 成熟的合并算法
- ✅ **增量同步**: 只传输变化的数据
- ✅ **加密友好**: 支持透明加密（git-crypt）
- ✅ **免费托管**: GitHub、GitLab免费私有仓库

## 快速开始

### 创建Git仓库

#### 使用GitHub（推荐）

```
1. 访问 https://github.com
2. 登录账号
3. New repository
4. 填写信息:
   - 名称: chainlesschain-data
   - 可见性: Private（私有）
   - ✓ Add .gitignore
   - ✓ Add README
5. Create repository
```

#### 获取访问Token

```
1. GitHub → Settings → Developer settings
2. Personal access tokens → Tokens (classic)
3. Generate new token
4. 权限选择:
   ✓ repo (完整仓库访问)
5. Generate token
6. 复制保存Token (ghp_...)
```

### 配置ChainlessChain

```
设置 → 数据同步 → Git配置

提供商: GitHub
用户名: your-username
仓库名: chainlesschain-data
分支: main
Token: ghp_xxxxxxxxxxxxx

点击"测试连接"
✓ 连接成功
点击"保存"
```

### 首次同步

```
设置 → 数据同步 → 立即同步

ChainlessChain会:
1. 初始化本地Git仓库
2. 加密敏感数据
3. 创建初始提交
4. 推送到远程仓库
5. 完成！
```

## Git仓库结构

```
chainlesschain-data/
├── .git/                  # Git元数据
├── .gitattributes         # 文件属性配置
├── .git-crypt/            # 加密配置
│
├── knowledge/             # 知识库文件
│   ├── notes/
│   │   └── 2024-01-01-示例笔记.md
│   ├── documents/
│   └── images/
│
├── social/                # 社交数据（加密）
│   ├── posts/
│   ├── contacts.json.enc
│   └── messages/
│
├── transactions/          # 交易数据（加密）
│
├── databases/             # 数据库备份（加密）
│   ├── knowledge.db.enc
│   ├── social.db.enc
│   └── transactions.db.enc
│
└── configs/               # 配置文件（加密）
    └── settings.json.enc
```

## 自动同步

### 配置自动同步

```json
{
  "sync": {
    "autoSync": true,
    "syncInterval": 5, // 分钟
    "syncOnChange": true, // 有变化立即同步
    "syncOnStartup": true // 启动时同步
  }
}
```

### 同步触发条件

```
自动同步在以下情况触发:
- ✓ 启动应用时
- ✓ 每隔N分钟（可配置）
- ✓ 有数据变化时
- ✓ 网络恢复时（离线 → 在线）
```

### 手动同步

```
方式一: 菜单
文件 → 立即同步

方式二: 快捷键
Ctrl+Shift+S (Windows/Linux)
Cmd+Shift+S (macOS)

方式三: 命令行
chainlesschain sync
```

## 冲突解决

### 什么时候会冲突?

```
场景:
1. 在PC修改了笔记A
2. 同时在手机也修改了笔记A
3. 两边都提交到本地
4. 一方先推送成功
5. 另一方推送时产生冲突
```

### 冲突解决策略

#### 自动解决

```json
{
  "sync": {
    "conflictStrategy": "auto",
    "autoStrategy": "newest" // 使用最新的版本
  }
}
```

策略选项:

- `newest`: 使用修改时间最新的版本
- `local`: 优先使用本地版本
- `remote`: 优先使用远程版本
- `manual`: 手动解决（推荐）

#### 手动解决

```
1. ChainlessChain检测到冲突
2. 显示冲突文件列表
3. 点击文件查看差异:

┌─────────────────────────────────┐
│ <<<<<<< 本地版本 (PC)            │
│ 这是在PC上的修改内容              │
│ =======                         │
│ 这是在手机上的修改内容            │
│ >>>>>>> 远程版本 (手机)          │
└─────────────────────────────────┘

4. 选择保留哪个版本:
   ○ 保留本地
   ○ 保留远程
   ● 合并两者（手动编辑）

5. 解决所有冲突
6. 提交合并
7. 推送到远程
```

## 高级功能

### Git分支

虽然默认使用main分支，你也可以创建实验分支：

```bash
# 创建实验分支
git checkout -b experiment

# 进行实验性修改
# ...

# 如果满意，合并到main
git checkout main
git merge experiment

# 如果不满意，删除分支
git branch -d experiment
```

### 历史版本

#### 查看历史

```
设置 → 数据同步 → 历史记录

显示:
- 提交时间
- 设备名称
- 变更文件
- 提交信息
```

#### 回滚到某个版本

```
1. 右键某个历史提交
2. 选择"恢复到此版本"
3. 确认警告
4. 系统回滚数据
5. 完成
```

::: warning
回滚是不可逆操作，请先备份
:::

### Git LFS（大文件）

对于大文件（视频、大图片），使用Git LFS：

```bash
# 安装Git LFS
git lfs install

# 配置跟踪规则
git lfs track "*.mp4"
git lfs track "*.mov"
git lfs track "*.psd"

# Git LFS会自动处理这些文件
```

在ChainlessChain中配置：

```json
{
  "sync": {
    "lfsEnabled": true,
    "lfsPatterns": ["*.mp4", "*.mov", "*.psd"],
    "lfsEndpoint": "https://github.com/..."
  }
}
```

## 多设备同步

### 添加新设备

```
新设备（如新手机）:

1. 安装ChainlessChain
2. 登录（使用U盾/SIMKey恢复）
3. 配置Git同步（同样的仓库地址和Token）
4. 首次同步会下载所有数据
5. 完成！

之后所有设备会自动保持同步
```

### 设备管理

```
设置 → 设备管理

显示:
- 设备名称（可编辑）
- 设备类型（PC/移动）
- 最后同步时间
- 同步状态

操作:
- 重命名设备
- 远程锁定设备
- 撤销设备权限
```

## 加密

### Git-crypt

ChainlessChain使用git-crypt透明加密敏感数据：

```bash
# 自动配置（ChainlessChain内置）
已加密文件:
✓ social/contacts.json
✓ databases/*.db.enc
✓ configs/*.json
✗ knowledge/*.md （知识文件可选加密）
```

### 配置加密规则

`.gitattributes`:

```
# 加密所有 .enc 文件
*.enc filter=git-crypt diff=git-crypt
social/** filter=git-crypt diff=git-crypt
transactions/** filter=git-crypt diff=git-crypt
databases/** filter=git-crypt diff=git-crypt
configs/** filter=git-crypt diff=git-crypt

# 知识文件不加密（可选）
knowledge/** -filter -diff
```

### 密钥管理

加密密钥由U盾/SIMKey管理：

```
设置 → 安全 → Git加密

操作:
- 查看加密状态
- 重新生成密钥（慎用）
- 导出密钥（用于新设备）
```

## 性能优化

### 减少仓库大小

```bash
# 清理历史大文件
git filter-branch --tree-filter 'rm -f large_file.bin' HEAD

# 或使用BFG Repo-Cleaner
bfg --delete-files '*.bin'
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### 浅克隆

新设备首次同步时，可以使用浅克隆：

```json
{
  "sync": {
    "shallowClone": true,
    "depth": 10 // 只克隆最近10次提交
  }
}
```

### 稀疏检出

只同步需要的目录：

```bash
git sparse-checkout init
git sparse-checkout set knowledge/ configs/
```

## 故障排查

### 推送失败

**错误**: `! [rejected] main -> main (non-fast-forward)`

**原因**: 远程有新提交，本地未同步

**解决**:

```
设置 → 数据同步 → 拉取远程更新
或
git pull --rebase
```

### 认证失败

**错误**: `Authentication failed`

**原因**:

- Token过期
- Token权限不足
- 用户名错误

**解决**:

```
1. 重新生成Token
2. 更新配置
3. 测试连接
```

### 合并冲突过多

**问题**: 频繁出现冲突

**原因**: 多设备同时编辑同一文件

**建议**:

```
1. 增加自动同步频率
2. 编辑前先同步
3. 避免同时在多设备编辑同一文件
4. 使用不同的文件/笔记本
```

## 托管选择

### GitHub

```
优点:
✓ 免费私有仓库
✓ 稳定可靠
✓ 全球CDN
✓ 大存储空间

缺点:
✗ 数据在国外服务器（已加密）
✗ 访问可能较慢（可用代理）

推荐: ⭐⭐⭐⭐⭐
```

### GitLab

```
优点:
✓ 可自托管
✓ 完全控制数据
✓ 免费私有仓库
✓ CI/CD功能

缺点:
✗ 自托管需要维护

推荐: ⭐⭐⭐⭐
```

### Gitea

```
优点:
✓ 轻量级
✓ 易部署（Docker一键安装）
✓ 资源占用小
✓ 适合家庭服务器/NAS

缺点:
✗ 功能相对简单

推荐: ⭐⭐⭐⭐ (自托管用户)
```

## 常见问题

### 仓库可以公开吗?

```
不建议：
✗ 即使加密，也不要公开仓库
✓ 使用私有仓库
✓ 只邀请信任的协作者
```

### 如何备份Git仓库?

```
方式一: 多个远程仓库
git remote add github https://github.com/...
git remote add gitlab https://gitlab.com/...
git push github main
git push gitlab main

方式二: 定期导出
git bundle create backup.bundle --all

方式三: 云备份
rsync -avz .git/ backup-server:/backups/
```

### 同步慢怎么办?

```
优化建议:
1. 使用浅克隆
2. 启用Git LFS（大文件）
3. 使用国内镜像/CDN
4. 配置HTTP/SOCKS代理
5. 选择地理位置近的托管服务
```

### 可以同步到多个仓库吗?

```
可以：
1. 添加多个远程仓库
2. 配置推送策略
3. 自动推送到所有仓库

配置:
git remote add origin-github https://github.com/...
git remote add origin-gitlab https://gitlab.com/...
git remote set-url --add --push origin git@github.com:...
git remote set-url --add --push origin git@gitlab.com:...

推送时会同时推送到所有仓库
```

## 最佳实践

1. ✅ **定期同步**: 不要积累太多未同步的更改
2. ✅ **有意义的提交**: 每次提交包含一个逻辑变更
3. ✅ **备份**: 多个远程仓库 + 本地备份
4. ✅ **监控**: 定期检查同步状态
5. ✅ **清理**: 定期清理大文件和无用数据

## 未来功能

### v1.0.0 — P2P Git同步（设备直接同步）

**目标**: 突破中心服务器限制，实现设备间直接Git仓库同步，真正去中心化

#### 架构设计

基于现有 `P2PSyncEngine`（1400+ 行）和 `WebRTC DataChannel` 基础设施，构建设备间直接Git同步通道：

```
┌──────────────┐    WebRTC DataChannel    ┌──────────────┐
│   设备 A      │◄────────────────────────►│   设备 B      │
│              │                          │              │
│ GitManager   │   git-upload-pack        │ GitManager   │
│ (isomorphic- │   git-receive-pack       │ (isomorphic- │
│  git)        │   对象协商               │  git)        │
│              │                          │              │
│ P2PSyncEngine│   向量时钟同步            │ P2PSyncEngine│
└──────┬───────┘                          └──────┬───────┘
       │                                         │
       ▼                                         ▼
   本地 .git/                                本地 .git/
```

#### 核心功能

- [ ] **Git Smart Protocol over WebRTC** — 在 WebRTC DataChannel 上实现 Git Smart HTTP 传输协议，复用 isomorphic-git 的 `http` 插件接口
- [ ] **设备发现与配对** — 基于现有 libp2p 发现机制，自动发现局域网/互联网上的 ChainlessChain 设备
- [ ] **双向引用协商** — 实现 `git-upload-pack` / `git-receive-pack` 的引用广告和对象协商，仅传输缺失对象
- [ ] **离线队列与重连** — 复用 `P2PSyncEngine` 的离线队列机制（5秒重试间隔，最多5次指数退避），网络恢复后自动续传
- [ ] **多设备拓扑同步** — 支持星型（一主多从）和网状（任意设备互同步）两种拓扑，通过向量时钟保证最终一致性
- [ ] **带宽自适应** — 根据 WebRTC DataChannel 的可用带宽动态调整 packfile 分片大小（16KB-256KB）

#### 安全机制

- [ ] **DID 身份验证** — 每次 P2P 连接使用 DID 签名握手，防止中间人攻击
- [ ] **端到端加密** — Git 对象通过 DTLS（WebRTC 内置）加密传输，敏感文件额外使用 git-crypt
- [ ] **设备授权白名单** — 只有通过 U盾/SIMKey 确认的设备才能参与 P2P 同步

#### 配置示例

```json
{
  "sync": {
    "p2pGitSync": {
      "enabled": true,
      "topology": "mesh",
      "discoveryMethods": ["mdns", "libp2p", "manual"],
      "maxConcurrentPeers": 3,
      "chunkSize": 65536,
      "requireDIDAuth": true,
      "allowedDevices": ["did:key:z6Mk...", "did:key:z6Mn..."]
    }
  }
}
```

#### 关键文件（规划）

| 文件                                | 职责                             |
| ----------------------------------- | -------------------------------- |
| `src/main/git/p2p-git-transport.js` | WebRTC Git Smart Protocol 传输层 |
| `src/main/git/p2p-git-sync.js`      | P2P 同步编排器                   |
| `src/main/git/device-discovery.js`  | 设备发现与配对管理               |
| `src/main/git/git-p2p-ipc.js`       | IPC 处理器（~15个）              |

---

### v1.1.0 — 差分同步优化

**目标**: 减少同步数据传输量 70%+，提升大仓库同步速度

#### 增量 Packfile 优化

基于 Git 的 delta 压缩机制，进一步优化传输效率：

- [ ] **Thin Pack 传输** — 生成 thin packfile，仅包含接收方缺失的 delta 对象，减少冗余传输
- [ ] **对象复用协商** — 推送前先交换 `have`/`want` 引用列表，精确计算最小传输集
- [ ] **分层 Delta 链** — 对大文件（>1MB）构建多层 delta 链，每层压缩率 40-60%
- [ ] **流式 Packfile** — packfile 边生成边传输，减少内存峰值占用（目标 <100MB）

#### 文件级差分

- [ ] **rsync 算法集成** — 对大型二进制文件（数据库备份 `.db.enc`、多媒体文件）使用 rolling checksum + MD5 差分算法
- [ ] **块级去重** — 4KB 固定块 + 内容定义分块（CDC）混合策略，跨文件去重
- [ ] **压缩管线** — Delta → zstd 压缩 → 传输 → 解压 → 应用，端到端压缩率 >80%

#### 数据库差分同步

与现有 `DbSyncManager`（973 行）深度集成：

- [ ] **行级变更追踪** — 基于 SQLite trigger 记录行级 INSERT/UPDATE/DELETE，替代全表时间戳扫描
- [ ] **CRDT 数据结构** — 对高频冲突字段（计数器、集合）使用 CRDT，实现无冲突自动合并
- [ ] **变更日志压缩** — 同一行的多次变更合并为最终状态，减少同步开销

#### 性能指标（目标）

| 场景               | 当前   | 优化后   | 改善 |
| ------------------ | ------ | -------- | ---- |
| 10MB 文本变更      | ~8秒   | ~2秒     | 75%  |
| 100MB 数据库同步   | ~45秒  | ~12秒    | 73%  |
| 1GB 多媒体仓库     | ~5分钟 | ~1.5分钟 | 70%  |
| 首次克隆（浅克隆） | ~2分钟 | ~40秒    | 67%  |

#### 配置示例

```json
{
  "sync": {
    "differential": {
      "enabled": true,
      "thinPack": true,
      "rsyncForBinary": true,
      "blockSize": 4096,
      "compressionAlgorithm": "zstd",
      "compressionLevel": 3,
      "maxDeltaChainDepth": 10,
      "crdtFields": ["view_count", "tags", "collaborators"]
    }
  }
}
```

---

### v1.2.0 — 智能冲突解决（AI辅助）

**目标**: 将冲突解决从手动操作转变为 AI 驱动的智能合并，自动解决 90%+ 的常见冲突

#### 架构设计

集成现有 Ollama LLM 引擎和 ErrorMonitor AI 诊断能力：

```
┌────────────────────────────────────────────────┐
│              冲突检测层                           │
│  GitManager.pull() → 检测到冲突文件列表           │
└──────────────────────┬─────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────┐
│           冲突分类引擎                            │
│  文本冲突 / 结构冲突 / 语义冲突 / 二进制冲突       │
└──────────────────────┬─────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────┐
│           AI 合并引擎                            │
│                                                │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐    │
│  │规则合并  │ │ AST 合并  │ │ LLM 语义合并  │    │
│  │(简单)    │ │(代码)     │ │(复杂)         │    │
│  └─────────┘ └──────────┘ └──────────────┘    │
└──────────────────────┬─────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────┐
│           验证与确认                              │
│  语法检查 → 语义验证 → 用户确认（可选）            │
└────────────────────────────────────────────────┘
```

#### 三级合并策略

**Level 1: 规则合并（自动，<100ms）**

- [ ] **非重叠变更** — 不同区域的修改自动合并（已有 Git 3-way merge 基础）
- [ ] **追加合并** — 双方都在文件末尾追加内容，自动按时间戳排列
- [ ] **配置文件合并** — JSON/YAML 配置文件按 key 进行字段级合并，自动处理新增字段
- [ ] **格式差异忽略** — 忽略空白、换行、缩进等格式差异，只关注实质内容变更

**Level 2: AST 合并（半自动，<2秒）**

- [ ] **代码 AST 分析** — 对 JavaScript/TypeScript/Python 代码解析 AST，在语法树级别合并
- [ ] **函数级合并** — 不同函数的修改自动合并，同一函数的修改提示用户
- [ ] **import 语句合并** — 自动合并双方新增的 import 语句，去重排序
- [ ] **Markdown 结构合并** — 按标题层级分段合并，同一段落的修改提示用户

**Level 3: LLM 语义合并（智能，<10秒）**

- [ ] **意图理解** — 使用 Ollama 本地 LLM 分析双方修改的意图和目的
- [ ] **语义合并建议** — LLM 生成合并建议，保留双方修改的核心语义
- [ ] **笔记内容合并** — 对知识库笔记的内容冲突，AI 理解上下文后智能合并
- [ ] **冲突解释** — 用自然语言向用户解释冲突原因和推荐的合并方案

#### 学习与优化

- [ ] **用户选择学习** — 记录用户的冲突解决偏好（选择本地/远程/手动编辑的模式），训练个性化策略
- [ ] **冲突模式库** — 积累常见冲突模式和最佳解决方案，优先匹配历史经验
- [ ] **Permanent Memory 集成** — 将冲突解决经验写入 MEMORY.md，跨会话复用

#### 用户界面

```
┌─────────────────────────────────────────────┐
│ 🔀 智能冲突解决                    3个冲突文件 │
├─────────────────────────────────────────────┤
│                                             │
│ 📄 notes/2024-01-15-会议纪要.md              │
│ ├─ 冲突类型: 文本冲突（同一段落修改）          │
│ ├─ AI建议: 合并双方内容（置信度 92%）          │
│ ├─ [查看差异] [接受AI建议] [手动编辑]         │
│                                             │
│ 📄 configs/settings.json                     │
│ ├─ 冲突类型: 配置冲突（同一字段修改）          │
│ ├─ AI建议: 使用远程版本（更新的配置）          │
│ ├─ [查看差异] [接受AI建议] [手动编辑]         │
│                                             │
│ 📄 knowledge/项目架构.md                      │
│ ├─ 冲突类型: 结构冲突（章节重组）              │
│ ├─ AI建议: 需要人工审核（置信度 67%）          │
│ ├─ [查看差异] [AI辅助编辑] [手动编辑]         │
│                                             │
├─────────────────────────────────────────────┤
│ [全部接受AI建议]  [逐个审核]  [全部手动处理]   │
└─────────────────────────────────────────────┘
```

#### 配置示例

```json
{
  "sync": {
    "smartConflictResolution": {
      "enabled": true,
      "autoResolveLevel": 1,
      "aiAssistLevel": 3,
      "llmModel": "qwen2:7b",
      "confidenceThreshold": 0.85,
      "learnFromUser": true,
      "maxLLMTokens": 4096,
      "astParsers": ["javascript", "typescript", "python", "markdown"],
      "alwaysConfirm": ["configs/*", "databases/*"]
    }
  }
}
```

---

### v1.3.0 — 更多托管服务支持

**目标**: 支持 10+ Git 托管平台，一键配置，无缝切换

#### 新增托管平台

| 平台                | 认证方式             | 特性                   | 状态      |
| ------------------- | -------------------- | ---------------------- | --------- |
| **GitHub**          | Token / OAuth / SSH  | 免费私有仓库，全球 CDN | ✅ 已支持 |
| **GitLab**          | Token / OAuth / SSH  | 自托管 + SaaS          | 🔜 计划中 |
| **Gitea**           | Token / Basic Auth   | 轻量级，适合 NAS       | 🔜 计划中 |
| **Gitee（码云）**   | Token / OAuth        | 国内加速，免费私有仓库 | 🔜 计划中 |
| **Coding**          | Token / OAuth        | 腾讯云集成             | 🔜 计划中 |
| **Bitbucket**       | App Password / OAuth | Atlassian 生态集成     | 🔜 计划中 |
| **Azure DevOps**    | PAT / Azure AD       | 企业级 CI/CD           | 🔜 计划中 |
| **AWS CodeCommit**  | IAM / HTTPS          | AWS 生态集成           | 🔜 计划中 |
| **自建 Git Server** | SSH / HTTP(S)        | 完全自主控制           | 🔜 计划中 |
| **Keybase Git**     | Keybase 认证         | 端到端加密仓库         | 🔜 计划中 |

#### 核心功能

- [ ] **统一配置界面** — 选择平台后自动填充 API 端点、认证方式等参数
- [ ] **OAuth 一键授权** — 集成现有 `OAuthProvider`（PKCE 支持），浏览器内完成授权流程
- [ ] **SSH 密钥管理** — 自动生成 Ed25519 密钥对，一键添加到托管平台
- [ ] **连接测试** — 自动验证认证、权限、仓库可达性
- [ ] **多仓库镜像** — 一键配置同时推送到多个平台（数据冗余备份）
- [ ] **平台迁移向导** — 从一个平台迁移到另一个平台，保留完整历史

#### 国内优化

- [ ] **Gitee/Coding 加速** — 国内平台自动检测，优先使用国内 CDN 节点
- [ ] **代理配置** — 内置 HTTP/SOCKS5 代理支持，解决 GitHub 访问慢的问题
- [ ] **镜像仓库** — 国外主仓库 + 国内镜像仓库，自动双向同步

#### 配置示例

```json
{
  "sync": {
    "providers": [
      {
        "name": "github",
        "type": "github",
        "remoteUrl": "https://github.com/user/chainlesschain-data.git",
        "auth": { "type": "token", "token": "ghp_..." },
        "primary": true
      },
      {
        "name": "gitee-mirror",
        "type": "gitee",
        "remoteUrl": "https://gitee.com/user/chainlesschain-data.git",
        "auth": { "type": "token", "token": "..." },
        "mirror": true,
        "syncDirection": "push-only"
      }
    ],
    "proxy": {
      "enabled": false,
      "type": "http",
      "host": "127.0.0.1",
      "port": 7890
    }
  }
}
```

---

### v2.0.0 — 实时协作编辑

**目标**: 实现类似 Google Docs 的实时多人协作编辑，同时保持去中心化架构

#### 架构设计

基于 CRDT（Conflict-free Replicated Data Types）和现有 WebRTC 基础设施：

```
┌─────────────┐  WebRTC DataChannel  ┌─────────────┐
│   用户 A     │◄───────────────────►│   用户 B     │
│             │  CRDT 操作广播       │             │
│ Yjs Doc     │                     │ Yjs Doc     │
│ ┌─────────┐ │  增量操作            │ ┌─────────┐ │
│ │ Y.Text  │ │  (insert/delete)    │ │ Y.Text  │ │
│ │ Y.Map   │ │                     │ │ Y.Map   │ │
│ │ Y.Array │ │                     │ │ Y.Array │ │
│ └─────────┘ │                     │ └─────────┘ │
│      │      │                     │      │      │
│      ▼      │                     │      ▼      │
│ Markdown    │                     │ Markdown    │
│ 编辑器      │                     │ 编辑器      │
└─────────────┘                     └─────────────┘
       │                                   │
       ▼                                   ▼
   本地 Git                            本地 Git
   (定期提交)                          (定期提交)
```

#### 核心功能

**实时编辑引擎**

- [ ] **Yjs CRDT 集成** — 基于 Yjs 库实现文档的 CRDT 表示，支持并发编辑无冲突自动合并
- [ ] **WebRTC Provider** — 通过现有 `webrtc-data-channel.js` 传输 Yjs 更新消息，P2P 直连无需服务器
- [ ] **操作转换** — 实时将用户输入转换为 CRDT 操作（insert、delete、format），毫秒级同步
- [ ] **光标感知** — 显示其他协作者的实时光标位置和选区，带用户颜色标识

**Markdown 协作**

- [ ] **结构化编辑** — Markdown 文档映射为 Yjs 结构化数据（标题、段落、列表、代码块），支持块级并发编辑
- [ ] **富文本同步** — 加粗、斜体、链接等格式标记的实时同步
- [ ] **图片与附件** — 协作中插入的图片通过 P2P 传输，自动添加到 Git 仓库
- [ ] **评论与标注** — 类似 Google Docs 的行内评论功能，评论数据通过 CRDT 同步

**会话管理**

- [ ] **协作房间** — 基于 libp2p Topic 创建文档协作房间，支持邀请链接
- [ ] **权限控制** — 集成 `PermissionEngine` RBAC，支持只读/编辑/管理三级权限
- [ ] **在线状态** — 显示协作者在线/离线/编辑中状态
- [ ] **离线编辑** — 断网后继续编辑，重新上线时 CRDT 自动合并离线期间的变更

**Git 集成**

- [ ] **自动提交** — 协作编辑的变更每隔 N 分钟自动提交到本地 Git（复用 `git-auto-commit.js`）
- [ ] **版本快照** — 重要编辑节点自动创建 Git tag，方便回溯
- [ ] **协作历史** — 记录每个变更的作者信息，Git blame 可追溯到具体协作者
- [ ] **冲突预防** — CRDT 保证实时编辑无冲突，Git 层面的冲突通过 AI 智能合并处理

#### 性能指标（目标）

| 指标               | 目标值         |
| ------------------ | -------------- |
| 编辑延迟（局域网） | <50ms          |
| 编辑延迟（互联网） | <200ms         |
| 最大并发编辑者     | 10人           |
| 文档大小上限       | 10MB           |
| CRDT 内存开销      | <文档大小的 2x |
| 离线重连合并时间   | <3秒           |

#### 配置示例

```json
{
  "sync": {
    "realTimeCollab": {
      "enabled": true,
      "maxCollaborators": 10,
      "autoCommitInterval": 300,
      "showCursors": true,
      "showPresence": true,
      "offlineSupport": true,
      "permissions": {
        "defaultRole": "editor",
        "requireInvite": true
      }
    }
  }
}
```

---

### 长期路线图

| 版本       | 功能           | 目标                 | 预计时间 |
| ---------- | -------------- | -------------------- | -------- |
| **v1.0.0** | P2P Git同步    | 无服务器设备直连同步 | 2026 Q2  |
| **v1.1.0** | 差分同步优化   | 传输量减少 70%       | 2026 Q2  |
| **v1.2.0** | AI智能冲突解决 | 自动解决 90% 冲突    | 2026 Q3  |
| **v1.3.0** | 多平台托管支持 | 10+ Git 平台         | 2026 Q3  |
| **v2.0.0** | 实时协作编辑   | Google Docs 级体验   | 2026 Q4  |
| **v2.1.0** | 端到端加密同步 | 零知识加密           | 2027 Q1  |
| **v2.2.0** | 智能同步策略   | AI 选择最优同步路径  | 2027 Q1  |
