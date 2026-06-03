# 外部设备文件管理 - 测试指南

## 概述

本文档提供外部设备文件管理功能的完整测试指南，包括自动化测试和手动测试步骤。

## 自动化测试

### 运行测试

```bash
# 运行所有集成测试
npm run test:integration

# 运行特定测试文件
npm test tests/integration/external-device-file.test.js

# 运行特定测试组
npm test tests/integration/external-device-file.test.js -t "索引同步"

# 生成覆盖率报告
npm test -- --coverage
```

### 测试覆盖范围

自动化测试覆盖以下功能模块：

| 测试组 | 测试用例数 | 覆盖功能 |
|--------|-----------|---------|
| 索引同步 | 4 | 全量同步、增量同步、分类过滤、分页 |
| 文件列表查询 | 5 | 全部文件、分类过滤、多分类、搜索、分页 |
| 文件传输 | 4 | 小文件、大文件、并发、缓存检查 |
| 缓存管理 | 4 | 缓存大小、LRU淘汰、过期清理、空间确保 |
| 文件验证 | 2 | SHA256校验、跳过验证 |
| 搜索功能 | 3 | 文件名搜索、设备过滤、分类过滤 |
| 传输任务管理 | 4 | 创建任务、更新状态、获取进度、取消传输 |
| 事件系统 | 3 | 同步完成、文件拉取、传输进度 |
| 错误处理 | 4 | 数据库错误、网络超时、文件不存在、校验失败 |
| 同步日志 | 3 | 成功日志、失败日志、获取时间 |

**总计：36 个测试用例**

## 手动端到端测试

### 前置条件

1. **设备准备**：
   - PC端应用已启动（desktop-app-vue）
   - Android端应用已安装并运行
   - 两设备在同一WiFi/局域网

2. **数据准备**：
   - Android端有各类型文件（文档、图片、视频、音频、代码）
   - 至少包含：
     - 小文件（<1MB）：5个
     - 中文件（1-10MB）：3个
     - 大文件（>100MB）：1个

3. **权限确认**：
   - Android端已授予文件访问权限
   - PC端网络防火墙已配置

### 测试场景 1: 索引同步

#### 1.1 首次全量同步

**步骤：**
1. 打开PC端应用，导航到 `#/external-devices`
2. 从设备下拉列表中选择Android设备
3. 点击"同步索引"按钮
4. 观察同步进度

**预期结果：**
- ✅ 显示同步进度（loading状态）
- ✅ 同步完成后显示文件总数
- ✅ 文件列表显示所有文件
- ✅ 同步时间 < 30秒（1000个文件）

**验证点：**
```sql
-- 检查数据库记录数
SELECT COUNT(*) FROM external_device_files WHERE device_id = 'android_xxx';

-- 检查同步日志
SELECT * FROM file_sync_logs ORDER BY created_at DESC LIMIT 1;
```

#### 1.2 增量同步

**步骤：**
1. 在Android端添加新文件（3个文档）
2. PC端再次点击"同步索引"
3. 观察同步结果

**预期结果：**
- ✅ 仅同步新增文件（3个）
- ✅ 同步时间 < 5秒
- ✅ 文件列表包含新文件

**验证点：**
```sql
-- 检查最新索引时间
SELECT indexed_at FROM external_device_files
WHERE device_id = 'android_xxx'
ORDER BY indexed_at DESC LIMIT 3;
```

#### 1.3 分类过滤同步

**步骤：**
1. 选择"文档"分类
2. 点击"同步索引"

**预期结果：**
- ✅ 仅显示文档类型文件
- ✅ 图片/视频等不显示

### 测试场景 2: 文件浏览和搜索

#### 2.1 分类过滤

**步骤：**
1. 点击不同分类按钮（文档、图片、视频等）
2. 观察文件列表变化

**预期结果：**
- ✅ 列表仅显示对应分类文件
- ✅ 分类标签颜色正确
- ✅ 文件数量统计准确

#### 2.2 搜索功能

**步骤：**
1. 在搜索框输入"report"
2. 观察搜索结果

**预期结果：**
- ✅ 仅显示文件名包含"report"的文件
- ✅ 搜索实时响应

#### 2.3 分页

**步骤：**
1. 设置每页显示10条
2. 切换到第2页
3. 观察URL和文件列表

**预期结果：**
- ✅ 文件列表更新
- ✅ 分页器状态正确
- ✅ 总数显示准确

### 测试场景 3: 文件传输

#### 3.1 拉取小文件（<1MB）

**步骤：**
1. 选择一个小文件（例如：document.pdf, 500KB）
2. 点击"拉取"按钮
3. 观察传输进度浮窗

**预期结果：**
- ✅ 传输进度实时更新
- ✅ 传输速度 > 1MB/s（WiFi）
- ✅ 传输完成后状态变为"已缓存"
- ✅ 传输时间 < 2秒

**验证点：**
```bash
# 检查缓存文件是否存在
ls -lh ~/Library/Application\ Support/chainlesschain-desktop-vue/external-file-cache/android_xxx/
```

#### 3.2 拉取大文件（>100MB）

**步骤：**
1. 选择一个大文件（例如：video.mp4, 150MB）
2. 点击"拉取"按钮
3. 观察分块传输进度

**预期结果：**
- ✅ 传输进度平滑更新（0% → 100%）
- ✅ 传输速度显示（MB/s）
- ✅ 可以取消传输
- ✅ 传输完成后文件完整性校验通过

**验证点：**
```sql
-- 检查传输任务记录
SELECT * FROM file_transfer_tasks WHERE file_id = 'xxx';

-- 验证文件大小
SELECT file_size, is_cached FROM external_device_files WHERE id = 'xxx';
```

#### 3.3 并发传输

**步骤：**
1. 同时点击3个文件的"拉取"按钮
2. 观察传输进度浮窗

**预期结果：**
- ✅ 最多3个文件同时传输
- ✅ 第4个文件排队等待
- ✅ 传输完成顺序符合队列规则

#### 3.4 断点续传（可选）

**步骤：**
1. 开始拉取一个大文件
2. 传输到50%时，断开WiFi
3. 重新连接WiFi
4. 再次点击"拉取"

**预期结果：**
- ✅ 从50%继续传输（不重新开始）
- ✅ 最终文件完整

### 测试场景 4: 缓存管理

#### 4.1 查看缓存统计

**步骤：**
1. 点击"缓存统计"按钮
2. 观察统计信息

**预期结果：**
- ✅ 显示总文件数
- ✅ 显示已缓存文件数
- ✅ 显示缓存大小（MB/GB）
- ✅ 显示缓存使用率（百分比）
- ✅ 进度条颜色正确（>90%为红色）

#### 4.2 LRU缓存淘汰

**步骤：**
1. 拉取文件直到缓存接近100%（例如：990MB/1GB）
2. 再拉取一个50MB的文件
3. 观察缓存变化

**预期结果：**
- ✅ 自动淘汰最久未访问的文件
- ✅ 腾出足够空间
- ✅ 新文件成功缓存
- ✅ 总缓存大小 < 1GB

**验证点：**
```sql
-- 检查被淘汰的文件
SELECT id, display_name, last_access, is_cached
FROM external_device_files
WHERE device_id = 'xxx' AND is_cached = 0
ORDER BY last_access ASC;
```

#### 4.3 清理过期缓存

**步骤：**
1. 打开缓存统计对话框
2. 点击"清理过期缓存"按钮
3. 确认清理

**预期结果：**
- ✅ 显示清理的文件数量
- ✅ 缓存统计更新
- ✅ 过期文件被删除（默认7天）

### 测试场景 5: RAG集成

#### 5.1 导入PDF到RAG

**步骤：**
1. 拉取一个PDF文件（例如：research_paper.pdf）
2. 等待缓存完成
3. 点击"导入RAG"按钮
4. 导航到AI聊天页面
5. 询问该文件内容相关问题

**预期结果：**
- ✅ 导入成功提示
- ✅ AI聊天能检索到文件内容
- ✅ 回答基于文件内容

**验证点：**
```sql
-- 检查知识库中是否有该文件
SELECT * FROM knowledge_items WHERE title LIKE '%research_paper%';
```

#### 5.2 导入Markdown到RAG（可选）

**步骤：**
1. 拉取一个Markdown文件
2. 导入到RAG
3. 验证知识库

**预期结果：**
- ✅ Markdown格式正确解析
- ✅ 标题、列表、代码块等保留

### 测试场景 6: 错误处理

#### 6.1 网络断开

**步骤：**
1. 开始同步索引
2. 同步过程中断开WiFi
3. 观察错误提示

**预期结果：**
- ✅ 显示"网络错误"提示
- ✅ 同步状态恢复
- ✅ 可以重新同步

#### 6.2 设备离线

**步骤：**
1. 关闭Android应用
2. PC端选择该设备
3. 点击"同步索引"

**预期结果：**
- ✅ 显示"设备离线"提示
- ✅ 设备列表标记为离线

#### 6.3 文件访问权限不足

**步骤：**
1. Android端撤销文件访问权限
2. PC端尝试拉取文件

**预期结果：**
- ✅ 显示"权限不足"错误
- ✅ 提示用户授予权限

#### 6.4 文件校验失败

**步骤：**
1. 传输过程中模拟文件损坏（需修改代码）
2. 观察验证结果

**预期结果：**
- ✅ 校验失败，删除损坏文件
- ✅ 提示用户重新拉取

### 测试场景 7: UI交互

#### 7.1 文件详情

**步骤：**
1. 点击文件的"更多"按钮
2. 选择"查看详情"
3. 观察详情对话框

**预期结果：**
- ✅ 显示完整文件信息
- ✅ 显示缓存路径（如已缓存）
- ✅ 显示校验和

#### 7.2 收藏功能

**步骤：**
1. 点击"更多" → "收藏"
2. 切换到收藏过滤
3. 观察文件列表

**预期结果：**
- ✅ 文件显示星标图标
- ✅ 收藏列表包含该文件
- ✅ 再次点击取消收藏

#### 7.3 复制文件路径

**步骤：**
1. 点击"更多" → "复制路径"
2. 粘贴到文本编辑器

**预期结果：**
- ✅ 路径已复制到剪贴板
- ✅ 路径格式正确

### 测试场景 8: 性能测试

#### 8.1 大量文件索引

**测试数据：**
- Android端文件数量：10,000+

**步骤：**
1. 执行全量同步
2. 记录同步时间
3. 观察内存占用

**预期结果：**
- ✅ 同步时间 < 5分钟
- ✅ 内存占用 < 500MB
- ✅ UI不卡顿

#### 8.2 并发文件拉取

**步骤：**
1. 同时拉取10个文件（每个1MB）
2. 观察传输队列

**预期结果：**
- ✅ 3个文件同时传输
- ✅ 其余7个排队
- ✅ 按顺序完成

#### 8.3 缓存压力测试

**步骤：**
1. 拉取文件直到缓存满
2. 继续拉取新文件
3. 观察LRU淘汰

**预期结果：**
- ✅ 自动淘汰旧文件
- ✅ 缓存保持在限制内
- ✅ 无性能下降

## 测试数据准备

### Android端测试文件

在Android设备上准备以下测试文件：

```
/Download/
  ├── documents/
  │   ├── report_small.pdf (500KB)
  │   ├── presentation.pptx (2MB)
  │   ├── spreadsheet.xlsx (1MB)
  │   └── research_paper.pdf (5MB)
  ├── images/
  │   ├── photo_001.jpg (3MB)
  │   ├── photo_002.png (1.5MB)
  │   └── screenshot.png (500KB)
  ├── videos/
  │   ├── video_small.mp4 (10MB)
  │   └── video_large.mp4 (150MB)
  ├── code/
  │   ├── main.py (50KB)
  │   ├── app.js (30KB)
  │   └── README.md (10KB)
  └── audio/
      ├── song.mp3 (5MB)
      └── podcast.m4a (20MB)
```

### 数据库验证SQL

```sql
-- 检查索引完整性
SELECT
  device_id,
  category,
  COUNT(*) as count,
  SUM(file_size) as total_size
FROM external_device_files
GROUP BY device_id, category;

-- 检查缓存状态
SELECT
  COUNT(*) as total_files,
  SUM(CASE WHEN is_cached = 1 THEN 1 ELSE 0 END) as cached_files,
  SUM(CASE WHEN is_cached = 1 THEN file_size ELSE 0 END) as cache_size
FROM external_device_files;

-- 检查传输任务
SELECT
  status,
  COUNT(*) as count,
  AVG(progress) as avg_progress
FROM file_transfer_tasks
GROUP BY status;

-- 检查同步历史
SELECT
  sync_type,
  status,
  items_count,
  duration_ms,
  created_at
FROM file_sync_logs
ORDER BY created_at DESC
LIMIT 10;
```

## 测试报告模板

### 测试执行记录

| 测试场景 | 测试用例 | 执行结果 | 备注 |
|---------|---------|---------|------|
| 索引同步 | 首次全量同步 | ✅ 通过 | 同步1000个文件，耗时25秒 |
| 索引同步 | 增量同步 | ✅ 通过 | 同步3个新文件，耗时2秒 |
| 文件传输 | 拉取小文件 | ✅ 通过 | 500KB文件，耗时1秒 |
| 文件传输 | 拉取大文件 | ✅ 通过 | 150MB文件，耗时180秒 |
| 缓存管理 | LRU淘汰 | ✅ 通过 | 自动淘汰50MB旧文件 |
| RAG集成 | 导入PDF | ✅ 通过 | 成功导入并可检索 |
| 错误处理 | 网络断开 | ✅ 通过 | 显示错误提示 |
| UI交互 | 文件详情 | ✅ 通过 | 信息显示完整 |

### 性能指标

| 指标 | 目标值 | 实际值 | 状态 |
|------|-------|--------|------|
| 索引同步速度（1000文件） | < 30s | 25s | ✅ |
| 小文件传输速度 | > 1MB/s | 1.5MB/s | ✅ |
| 大文件传输速度 | > 500KB/s | 800KB/s | ✅ |
| 缓存LRU淘汰时间 | < 1s | 0.5s | ✅ |
| UI响应时间 | < 200ms | 150ms | ✅ |
| 内存占用（10000文件） | < 500MB | 420MB | ✅ |

### 已知问题

1. **问题**：大文件传输偶尔失败
   - **复现步骤**：拉取>200MB的文件
   - **临时解决方案**：重新拉取
   - **优先级**：中
   - **状态**：待修复

2. **问题**：缓存统计加载慢
   - **复现步骤**：文件数>5000时打开缓存统计
   - **临时解决方案**：优化SQL查询
   - **优先级**：低
   - **状态**：待优化

## 持续集成配置

### GitHub Actions工作流

```yaml
name: External Device File Tests

on:
  push:
    paths:
      - 'src/main/file/**'
      - 'src/main/p2p/file-sync-protocols.js'
      - 'tests/integration/external-device-file.test.js'
  pull_request:
    paths:
      - 'src/main/file/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Run integration tests
        run: npm test tests/integration/external-device-file.test.js
      - name: Upload coverage
        uses: codecov/codecov-action@v2
```

## 总结

按照本指南完成测试后，应验证：

- ✅ 所有自动化测试通过（36个测试用例）
- ✅ 手动端到端测试通过（8个测试场景）
- ✅ 性能指标达标
- ✅ 错误处理正确
- ✅ UI交互流畅

**测试覆盖率目标：> 85%**
