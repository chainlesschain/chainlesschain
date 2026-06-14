# Phase 3 实施计划 - 高级远程控制功能

**版本**: v1.0
**创建时间**: 2026-01-27
**目标版本**: v0.28.0
**预计完成**: 2-3 周

---

## 目录

1. [概述](#概述)
2. [Phase 3 目标](#phase-3-目标)
3. [功能需求](#功能需求)
4. [技术方案](#技术方案)
5. [任务分解](#任务分解)
6. [实施路线图](#实施路线图)
7. [风险评估](#风险评估)
8. [成功标准](#成功标准)

---

## 概述

### Phase 2 回顾

Phase 2 已成功完成，交付了完整的远程控制基础设施：

- ✅ PC 端命令处理器（AI + System）
- ✅ Android 端控制界面
- ✅ 日志记录和统计系统
- ✅ 完整的测试和文档

**Phase 2 成果**:
- 代码: 12,859 行
- 测试: 182+ 用例
- 文档: 20 个
- 性能: 提升 140%

### Phase 3 定位

Phase 3 在 Phase 2 的基础上，增加两个高级功能：

1. **文件传输**: Android ↔ PC 双向文件传输
2. **远程桌面**: Android 端实时查看和控制 PC 桌面

---

## Phase 3 目标

### 核心目标

#### 1. 文件传输功能 📁

**PC 端**:
- ✅ 文件上传接收（来自 Android）
- ✅ 文件下载发送（到 Android）
- ✅ 断点续传支持
- ✅ 文件压缩传输
- ✅ 传输进度监控
- ✅ 传输历史记录

**Android 端**:
- ✅ 文件选择器（系统文件、相册、文档）
- ✅ 文件上传（单文件、多文件、文件夹）
- ✅ 文件下载（保存到本地）
- ✅ 传输进度显示
- ✅ 传输管理（暂停、恢复、取消）
- ✅ 传输历史查看

#### 2. 远程桌面功能 🖥️

**PC 端**:
- ✅ 屏幕实时捕获（30 FPS）
- ✅ 鼠标键盘事件处理
- ✅ 屏幕分辨率自适应
- ✅ 帧率和质量控制
- ✅ 多显示器支持

**Android 端**:
- ✅ 实时画面显示
- ✅ 触摸控制（鼠标移动、点击、拖拽）
- ✅ 虚拟键盘输入
- ✅ 手势支持（缩放、拖动）
- ✅ 全屏模式

---

## 功能需求

### 3.1 文件传输功能详细需求

#### 3.1.1 上传功能（Android → PC）

**用户故事**:
作为用户，我想从 Android 手机上传文件到 PC，以便在 PC 上处理这些文件。

**功能点**:
- [ ] 支持单文件上传（最大 2GB）
- [ ] 支持多文件批量上传
- [ ] 支持文件夹上传（递归）
- [ ] 支持从相册选择图片/视频
- [ ] 支持从文件管理器选择任意文件
- [ ] 实时显示上传进度（百分比、速度、剩余时间）
- [ ] 支持暂停/恢复上传
- [ ] 支持取消上传
- [ ] 断点续传（网络中断后自动恢复）
- [ ] 文件完整性校验（MD5/SHA256）

**技术要求**:
- 分块上传（chunk size: 256KB）
- 并发上传（最多 3 个文件）
- 自动压缩（可选，针对文本文件）
- 传输加密（P2P 已有端到端加密）

#### 3.1.2 下载功能（PC → Android）

**用户故事**:
作为用户，我想从 PC 下载文件到 Android，以便在手机上查看或分享这些文件。

**功能点**:
- [ ] 支持单文件下载
- [ ] 支持多文件批量下载
- [ ] 支持文件夹下载（打包为 zip）
- [ ] 实时显示下载进度
- [ ] 支持暂停/恢复下载
- [ ] 支持取消下载
- [ ] 断点续传
- [ ] 自动保存到指定目录（Downloads/Pictures/Documents）
- [ ] 文件完整性校验

**技术要求**:
- 分块下载（chunk size: 256KB）
- 并发下载（最多 3 个文件）
- 自动解压缩
- MediaStore API 适配（Android 10+）

#### 3.1.3 传输管理

**功能点**:
- [ ] 传输队列管理（排队、执行、完成、失败）
- [ ] 传输历史记录（SQLite 存储）
- [ ] 传输统计（总量、成功率、平均速度）
- [ ] 失败重试机制（最多 3 次）
- [ ] 网络状态监控（Wi-Fi/移动数据切换处理）
- [ ] 通知提醒（传输完成、失败）

### 3.2 远程桌面功能详细需求

#### 3.2.1 屏幕捕获（PC 端）

**功能点**:
- [ ] 实时屏幕捕获（目标 30 FPS）
- [ ] 支持多显示器（可选择显示器）
- [ ] 分辨率自适应（1080p/720p/480p）
- [ ] 帧率控制（10/15/30 FPS）
- [ ] 质量控制（高/中/低）
- [ ] H.264 硬件编码（可选）
- [ ] 画面压缩（JPEG/WebP）

**技术要求**:
- Windows: DXGI Desktop Duplication API
- macOS: CGDisplayStream
- Linux: X11 Screen Capture

#### 3.2.2 远程控制（Android 端）

**功能点**:
- [ ] 鼠标移动（触摸拖动）
- [ ] 鼠标点击（单击、双击、右击）
- [ ] 鼠标滚轮（双指滑动）
- [ ] 键盘输入（虚拟键盘）
- [ ] 快捷键支持（Ctrl+C、Ctrl+V 等）
- [ ] 画面缩放（双指缩放）
- [ ] 画面拖动（平移）
- [ ] 全屏模式
- [ ] 延迟显示（实时显示延迟时间）

**技术要求**:
- PC 端: robot 库（模拟鼠标键盘）
- Android 端: Canvas 绘制 + 触摸事件处理
- 协议: 自定义二进制协议（低延迟）

#### 3.2.3 性能优化

**目标指标**:
- 帧率: >= 30 FPS（同一局域网）
- 延迟: < 100ms（同一局域网）
- 带宽: < 5 Mbps（1080p 中等质量）
- CPU 占用: < 20%（PC 端）
- 电池消耗: < 15%/小时（Android 端）

**优化策略**:
- 差分编码（仅传输变化区域）
- I 帧和 P 帧（关键帧 + 预测帧）
- 动态质量调整（根据网络状况）
- 硬件加速（GPU 编码/解码）

---

## 技术方案

### 4.1 文件传输技术方案

#### 4.1.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                   Android 端                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ File Picker │  │  Transfer   │  │  Transfer   │      │
│  │             │→│   Manager   │→│   Database  │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
│         │                 │                              │
│         ↓                 ↓                              │
│  ┌──────────────────────────────────────┐               │
│  │     FileTransferClient (P2P)         │               │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
                      │
                      │ WebRTC Data Channel (Chunked Binary)
                      ↓
┌─────────────────────────────────────────────────────────┐
│                    PC 端 (Electron)                      │
│  ┌──────────────────────────────────────┐               │
│  │     FileTransferHandler (P2P)        │               │
│  └──────────────────────────────────────┘               │
│         │                 │                              │
│         ↓                 ↓                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  File I/O   │  │  Transfer   │  │  Transfer   │      │
│  │             │  │   Manager   │  │  Database   │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
└─────────────────────────────────────────────────────────┘
```

#### 4.1.2 传输协议

**命令格式**（JSON）:
```javascript
// 上传请求
{
  "namespace": "file",
  "action": "upload",
  "params": {
    "fileName": "example.pdf",
    "fileSize": 1048576,
    "mimeType": "application/pdf",
    "checksum": "md5:abc123...",
    "chunkSize": 262144,  // 256KB
    "totalChunks": 4
  }
}

// 上传数据块（二进制）
{
  "namespace": "file",
  "action": "uploadChunk",
  "params": {
    "transferId": "transfer-123",
    "chunkIndex": 0,
    "chunkData": "<Base64 encoded binary>"
  }
}

// 下载请求
{
  "namespace": "file",
  "action": "download",
  "params": {
    "filePath": "/path/to/file.pdf",
    "chunkSize": 262144
  }
}
```

#### 4.1.3 数据库设计

**PC 端（SQLite）**:
```sql
CREATE TABLE file_transfers (
  id TEXT PRIMARY KEY,
  device_did TEXT NOT NULL,
  direction TEXT NOT NULL,  -- 'upload' | 'download'
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size INTEGER NOT NULL,
  mime_type TEXT,
  status TEXT NOT NULL,  -- 'pending' | 'transferring' | 'completed' | 'failed'
  progress REAL DEFAULT 0,
  speed INTEGER,  -- bytes/second
  checksum TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT
);

CREATE INDEX idx_file_transfers_device ON file_transfers(device_did);
CREATE INDEX idx_file_transfers_status ON file_transfers(status);
```

**Android 端（Room）**:
```kotlin
@Entity(tableName = "file_transfers")
data class FileTransferEntity(
    @PrimaryKey val id: String,
    val deviceDid: String,
    val direction: String,  // 'upload' | 'download'
    val fileName: String,
    val fileUri: String?,  // Android URI
    val fileSize: Long,
    val mimeType: String?,
    val status: String,  // 'pending' | 'transferring' | 'completed' | 'failed'
    val progress: Float = 0f,
    val speed: Long = 0,  // bytes/second
    val checksum: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val completedAt: Long? = null,
    val error: String? = null
)
```

### 4.2 远程桌面技术方案

#### 4.2.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                   Android 端                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │   Canvas    │←│  Decoder    │←│   Control   │      │
│  │   Renderer  │  │  (JPEG)     │  │  Handler    │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
│         ↑                 ↑                │             │
│         │                 │                ↓             │
│  ┌──────────────────────────────────────────────┐       │
│  │     RemoteDesktopClient (WebRTC)             │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
                      │
                      │ WebRTC Data Channel (Binary Frames)
                      ↓
┌─────────────────────────────────────────────────────────┐
│                    PC 端 (Electron)                      │
│  ┌──────────────────────────────────────────────┐       │
│  │     RemoteDesktopHandler (WebRTC)            │       │
│  └──────────────────────────────────────────────┘       │
│         │                 │                │             │
│         ↓                 ↓                ↓             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  Screen     │  │  Encoder    │  │   Input     │      │
│  │  Capture    │  │  (JPEG)     │  │  Handler    │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
└─────────────────────────────────────────────────────────┘
```

#### 4.2.2 帧传输协议

**帧格式**（二进制）:
```
Frame Header (16 bytes):
- Magic: 0x5244  (2 bytes) - "RD" (Remote Desktop)
- Version: 0x01  (1 byte)
- Frame Type: 0x01 (1 byte) - 0x01: I-Frame, 0x02: P-Frame
- Timestamp: (8 bytes) - Unix timestamp in milliseconds
- Frame Size: (4 bytes) - Compressed data size

Frame Data (variable):
- JPEG/WebP compressed image data

Control Event (JSON):
{
  "type": "mouse_move",
  "x": 100,
  "y": 200
}

{
  "type": "mouse_click",
  "button": "left",  // 'left' | 'right' | 'middle'
  "x": 100,
  "y": 200
}

{
  "type": "key_press",
  "key": "Enter",
  "modifiers": ["Ctrl", "Shift"]
}
```

#### 4.2.3 性能优化策略

**1. 差分编码**:
```javascript
// 仅传输变化区域
const changedRegions = detectChanges(previousFrame, currentFrame);
const patches = encodePatches(changedRegions);
sendPatches(patches);
```

**2. 动态质量调整**:
```javascript
const qualityLevels = {
  high: { resolution: 1080, fps: 30, quality: 90 },
  medium: { resolution: 720, fps: 20, quality: 75 },
  low: { resolution: 480, fps: 15, quality: 60 }
};

function adjustQuality(networkStats) {
  if (networkStats.bandwidth < 1000) return qualityLevels.low;
  if (networkStats.bandwidth < 3000) return qualityLevels.medium;
  return qualityLevels.high;
}
```

**3. 硬件加速**（可选）:
```javascript
// PC 端使用 H.264 硬件编码
const encoder = new VideoEncoder({
  codec: 'h264',
  width: 1920,
  height: 1080,
  bitrate: 2_000_000,
  hardwareAcceleration: 'prefer-hardware'
});
```

---

## 任务分解

### Task #1: 文件传输 - PC 端实现

**负责人**: PC 端开发
**预计时间**: 3-4 天
**优先级**: P0（高）

#### 子任务
- [ ] 1.1 创建 FileTransferHandler（~300 行）
  - 上传接收逻辑
  - 下载发送逻辑
  - 分块传输管理
  - 断点续传支持
- [ ] 1.2 文件 I/O 管理（~200 行）
  - 文件读写
  - 目录创建
  - 文件校验（MD5）
- [ ] 1.3 传输管理器（~250 行）
  - 传输队列
  - 并发控制
  - 进度跟踪
- [ ] 1.4 数据库集成（~150 行）
  - 传输记录保存
  - 传输历史查询
- [ ] 1.5 单元测试（~400 行）
  - 上传测试
  - 下载测试
  - 断点续传测试
  - 并发测试

**交付物**:
- `src/main/remote/handlers/file-transfer-handler.js`
- `src/main/remote/file-io-manager.js`
- `src/main/remote/transfer-manager.js`
- `tests/remote/file-transfer.test.js`

---

### Task #2: 文件传输 - Android 端实现

**负责人**: Android 端开发
**预计时间**: 4-5 天
**优先级**: P0（高）

#### 子任务
- [ ] 2.1 创建 FileTransferClient（~300 行）
  - 上传发送逻辑
  - 下载接收逻辑
  - 分块传输
- [ ] 2.2 文件选择器集成（~200 行）
  - 系统文件选择器
  - 相册选择器
  - 权限处理
- [ ] 2.3 传输 UI 界面（~600 行）
  - 文件上传界面
  - 文件下载界面
  - 传输进度显示
  - 传输管理界面
- [ ] 2.4 ViewModel 实现（~250 行）
  - FileTransferViewModel
  - 状态管理
  - 进度更新
- [ ] 2.5 Room 数据库（~150 行）
  - FileTransferEntity
  - FileTransferDao
  - FileTransferRepository

**交付物**:
- `remote/client/FileTransferClient.kt`
- `remote/ui/FileTransferScreen.kt`
- `remote/ui/FileTransferViewModel.kt`
- `remote/data/FileTransferEntity.kt`

---

### Task #3: 远程桌面 - PC 端实现

**负责人**: PC 端开发
**预计时间**: 5-6 天
**优先级**: P1（中高）

#### 子任务
- [ ] 3.1 创建 RemoteDesktopHandler（~400 行）
  - 屏幕捕获循环
  - 帧编码和压缩
  - 帧率控制
  - 多显示器支持
- [ ] 3.2 输入事件处理（~300 行）
  - 鼠标移动
  - 鼠标点击
  - 键盘输入
  - 快捷键映射
- [ ] 3.3 性能优化（~200 行）
  - 差分编码
  - 动态质量调整
  - 硬件加速（可选）
- [ ] 3.4 单元测试（~350 行）
  - 屏幕捕获测试
  - 输入处理测试
  - 性能测试

**交付物**:
- `src/main/remote/handlers/remote-desktop-handler.js`
- `src/main/remote/screen-capture.js`
- `src/main/remote/input-handler.js`
- `tests/remote/remote-desktop.test.js`

---

### Task #4: 远程桌面 - Android 端实现

**负责人**: Android 端开发
**预计时间**: 5-6 天
**优先级**: P1（中高）

#### 子任务
- [ ] 4.1 创建 RemoteDesktopClient（~350 行）
  - 帧接收和解码
  - 帧显示
  - 性能监控
- [ ] 4.2 Canvas 渲染（~300 行）
  - 画面绘制
  - 缩放和拖动
  - 全屏模式
- [ ] 4.3 触摸控制（~400 行）
  - 触摸事件转换
  - 手势识别
  - 虚拟键盘
- [ ] 4.4 远程桌面 UI（~500 行）
  - 主界面
  - 控制面板
  - 设置界面
- [ ] 4.5 ViewModel 实现（~200 行）
  - RemoteDesktopViewModel
  - 状态管理

**交付物**:
- `remote/client/RemoteDesktopClient.kt`
- `remote/ui/RemoteDesktopScreen.kt`
- `remote/ui/RemoteDesktopViewModel.kt`
- `remote/ui/components/DesktopCanvas.kt`

---

### Task #5: 集成测试和文档

**负责人**: QA + 文档
**预计时间**: 2-3 天
**优先级**: P0（高）

#### 子任务
- [ ] 5.1 E2E 测试（~400 行）
  - 文件传输测试
  - 远程桌面测试
  - 性能测试
- [ ] 5.2 用户手册更新（~300 行）
  - 文件传输使用指南
  - 远程桌面使用指南
- [ ] 5.3 API 文档更新（~200 行）
  - 文件传输 API
  - 远程桌面 API
- [ ] 5.4 部署指南更新（~150 行）
  - 新功能配置
  - 性能优化建议

**交付物**:
- `tests/integration/phase3-e2e.test.js`
- `docs/features/PHASE3_USER_GUIDE.md`
- `docs/features/PHASE3_API_REFERENCE.md`
- `docs/features/PHASE3_DEPLOYMENT_GUIDE.md`

---

## 实施路线图

### Week 1: 文件传输功能

**Day 1-2: PC 端基础**
- Task #1.1: FileTransferHandler 实现
- Task #1.2: 文件 I/O 管理

**Day 3-4: PC 端完善**
- Task #1.3: 传输管理器
- Task #1.4: 数据库集成
- Task #1.5: 单元测试

**Day 5-7: Android 端**
- Task #2.1: FileTransferClient
- Task #2.2: 文件选择器
- Task #2.3: 传输 UI（开始）

### Week 2: 文件传输 + 远程桌面启动

**Day 1-2: Android 端完成**
- Task #2.3: 传输 UI（完成）
- Task #2.4: ViewModel
- Task #2.5: Room 数据库

**Day 3-5: 远程桌面 PC 端**
- Task #3.1: RemoteDesktopHandler
- Task #3.2: 输入事件处理

**Day 6-7: 远程桌面 PC 端完善**
- Task #3.3: 性能优化
- Task #3.4: 单元测试

### Week 3: 远程桌面完成 + 测试

**Day 1-3: Android 端远程桌面**
- Task #4.1: RemoteDesktopClient
- Task #4.2: Canvas 渲染
- Task #4.3: 触摸控制

**Day 4-5: Android 端完成**
- Task #4.4: 远程桌面 UI
- Task #4.5: ViewModel

**Day 6-7: 集成测试和文档**
- Task #5.1: E2E 测试
- Task #5.2-5.4: 文档编写

---

## 风险评估

### 高风险

#### 1. 远程桌面性能

**风险**: 帧率低、延迟高、带宽占用大

**影响**: 用户体验差，功能不可用

**缓解措施**:
- 使用硬件加速编码（H.264）
- 实现差分编码减少传输数据
- 动态质量调整适应网络状况
- 提前进行性能测试和优化

**应急方案**:
- 降低默认分辨率（720p）
- 降低默认帧率（15 FPS）
- 提供质量档位选择

#### 2. 文件传输可靠性

**风险**: 大文件传输失败、断点续传不稳定

**影响**: 用户体验差，数据丢失

**缓解措施**:
- 实现完善的断点续传机制
- 添加文件完整性校验（MD5）
- 实现自动重试机制
- 充分的单元测试和集成测试

**应急方案**:
- 限制单文件最大大小（500MB）
- 提供传输失败后手动重试

### 中风险

#### 3. 跨平台兼容性

**风险**: 屏幕捕获在不同操作系统表现不一致

**影响**: 部分用户无法使用

**缓解措施**:
- 针对不同平台使用原生 API
- 充分测试主流操作系统（Windows 10/11, macOS 12+, Ubuntu 20.04+）
- 提供降级方案（软件编码）

#### 4. Android 权限问题

**风险**: 文件访问权限、存储权限在不同 Android 版本表现不同

**影响**: 功能受限

**缓解措施**:
- 使用 MediaStore API（Android 10+）
- 请求必要的运行时权限
- 提供权限引导说明

### 低风险

#### 5. 时间延期

**风险**: 开发时间超出预期

**影响**: 延迟发布

**缓解措施**:
- 细化任务分解
- 每日进度跟踪
- 优先实现核心功能

---

## 成功标准

### 功能标准

#### 文件传输
- ✅ 支持上传/下载单文件、多文件、文件夹
- ✅ 断点续传成功率 >= 95%
- ✅ 文件完整性校验成功率 100%
- ✅ 传输进度实时显示
- ✅ 传输历史记录完整

#### 远程桌面
- ✅ 帧率 >= 20 FPS（同一局域网）
- ✅ 延迟 < 150ms（同一局域网）
- ✅ 鼠标/键盘控制响应准确
- ✅ 画面缩放和拖动流畅
- ✅ 支持多显示器切换

### 性能标准

| 指标 | 目标值 | 测试场景 |
|------|--------|---------|
| 文件上传速度 | >= 5 MB/s | 同一局域网 100MB 文件 |
| 文件下载速度 | >= 5 MB/s | 同一局域网 100MB 文件 |
| 远程桌面帧率 | >= 20 FPS | 1080p 中等质量 |
| 远程桌面延迟 | < 150ms | 同一局域网 |
| 远程桌面带宽 | < 5 Mbps | 1080p 中等质量 |
| PC 端 CPU 占用 | < 25% | 远程桌面运行中 |
| Android 电池消耗 | < 20%/小时 | 远程桌面运行中 |

### 质量标准

- ✅ 单元测试覆盖率 >= 80%
- ✅ E2E 测试通过率 100%
- ✅ 无严重 Bug（P0/P1）
- ✅ 代码审查通过
- ✅ 文档完整

---

## 附录

### A. 依赖库

**PC 端**:
```json
{
  "screenshot-desktop": "^1.15.3",  // 已有
  "sharp": "^0.33.5",  // 已有，用于图片压缩
  "robotjs": "^0.6.0",  // 新增，鼠标键盘控制
  "archiver": "^7.0.1",  // 已有，文件压缩
  "md5-file": "^5.0.0"  // 新增，文件校验
}
```

**Android 端**:
```kotlin
// 已有依赖
implementation("androidx.compose.ui:ui:1.5.4")
implementation("androidx.room:room-runtime:2.6.1")
implementation("com.google.dagger:hilt-android:2.48")

// 新增依赖
implementation("io.coil-kt:coil-compose:2.4.0")  // 图片加载
```

### B. 参考资料

- [WebRTC Data Channels](https://webrtc.org/getting-started/data-channels)
- [Electron Remote Desktop](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [Android MediaStore API](https://developer.android.com/training/data-storage/shared/media)
- [Canvas Touch Events](https://developer.android.com/develop/ui/views/touch-and-input/gestures)

---

**创建时间**: 2026-01-27
**文档版本**: v1.0
**维护者**: ChainlessChain 团队

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：Phase 3 实施计划 - 高级远程控制功能。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
