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
    "syncInterval": 5,  // 分钟
    "syncOnChange": true,  // 有变化立即同步
    "syncOnStartup": true  // 启动时同步
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
    "autoStrategy": "newest"  // 使用最新的版本
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
    "depth": 10  // 只克隆最近10次提交
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

- [ ] P2P Git同步（设备直接同步，无需服务器）
- [ ] 差分同步优化
- [ ] 智能冲突解决（AI辅助）
- [ ] 更多托管服务支持
- [ ] 实时协作编辑
