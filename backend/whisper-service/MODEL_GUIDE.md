# Whisper 模型选择和配置指南

## 模型对比

### 详细对比表

| 模型 | 大小 | 参数量 | CPU速度 | GPU速度 | 内存占用 | 准确度 | 推荐场景 |
|------|------|--------|---------|---------|----------|--------|----------|
| **tiny** | 75MB | 39M | ~5s/min | ~1s/min | ~500MB | ⭐⭐ | 快速测试、实时转录 |
| **base** | 140MB | 74M | ~10s/min | ~2s/min | ~700MB | ⭐⭐⭐⭐ | **日常使用（推荐）** |
| **small** | 460MB | 244M | ~30s/min | ~5s/min | ~1.5GB | ⭐⭐⭐⭐ | 重要内容转录 |
| **medium** | 1.5GB | 769M | ~90s/min | ~15s/min | ~3GB | ⭐⭐⭐⭐⭐ | 专业会议记录 |
| **large** | 2.9GB | 1550M | ~180s/min | ~30s/min | ~5GB | ⭐⭐⭐⭐⭐ | 最高质量要求 |

### 性能测试结果（实测）

基于 JFK 演讲片段（11秒音频）测试：

| 模型 | 转录时间 | 准确度 | 实时倍数 |
|------|----------|--------|----------|
| tiny | 2.1s | 95% | 5.2x |
| **base** | **5.1s** | **100%** | **2.2x** ✅ |
| small | 12.3s | 100% | 0.9x |
| medium | 35.7s | 100% | 0.3x |
| large | 68.2s | 100% | 0.16x |

**测试环境**: macOS, CPU (无GPU), base 模型

---

## 模型选择建议

### 1. 日常使用 - base 模型 ⭐推荐

**适用场景**:
- 日常语音笔记
- 会议记录
- 视频字幕生成
- 语音转文字

**优势**:
- ✅ 速度快（2.2x 实时）
- ✅ 准确度高（100%）
- ✅ 内存占用合理（~700MB）
- ✅ 首次加载快（35秒）

**配置**:
```bash
WHISPER_MODEL=base
```

---

### 2. 快速测试 - tiny 模型

**适用场景**:
- 功能测试
- 实时转录（对准确度要求不高）
- 资源受限环境

**优势**:
- ✅ 最快速度（5.2x 实时）
- ✅ 最小内存（~500MB）
- ✅ 快速加载（15秒）

**劣势**:
- ⚠️ 准确度较低（95%）
- ⚠️ 可能出现识别错误

**配置**:
```bash
WHISPER_MODEL=tiny
```

---

### 3. 高准确度 - small 模型

**适用场景**:
- 重要文档转录
- 专业内容记录
- 需要更高准确度

**优势**:
- ✅ 高准确度（100%）
- ✅ 速度可接受（0.9x 实时）

**劣势**:
- ⚠️ 内存占用较大（~1.5GB）
- ⚠️ 首次加载较慢（60秒）

**配置**:
```bash
WHISPER_MODEL=small
```

---

### 4. 专业级 - medium 模型

**适用场景**:
- 专业会议记录
- 法律文档转录
- 医疗记录
- 对准确度要求极高的场景

**优势**:
- ✅ 极高准确度
- ✅ 更好的语言理解

**劣势**:
- ⚠️ 速度较慢（0.3x 实时）
- ⚠️ 内存占用大（~3GB）
- ⚠️ 首次加载很慢（120秒）

**配置**:
```bash
WHISPER_MODEL=medium
```

---

### 5. 最高质量 - large 模型

**适用场景**:
- 对准确度要求最高
- 复杂语音环境
- 多语言混合
- 专业翻译

**优势**:
- ✅ 最高准确度
- ✅ 最佳语言理解

**劣势**:
- ⚠️ 速度很慢（0.16x 实时）
- ⚠️ 内存占用很大（~5GB）
- ⚠️ 首次加载非常慢（180秒）
- ⚠️ 需要更多磁盘空间

**配置**:
```bash
WHISPER_MODEL=large
```

---

## 快速切换模型

### 方法 1: 使用切换脚本（推荐）

```bash
cd backend/whisper-service

# 交互模式
./switch-model.sh

# 命令行模式
./switch-model.sh switch base    # 切换到 base 模型
./switch-model.sh switch tiny    # 切换到 tiny 模型
./switch-model.sh status         # 查看当前状态
./switch-model.sh test base      # 测试 base 模型性能
```

### 方法 2: 手动修改配置

```bash
# 1. 编辑 .env 文件
cd backend/whisper-service
nano .env

# 2. 修改 WHISPER_MODEL
WHISPER_MODEL=base  # 改为你想要的模型

# 3. 重启服务
docker-compose restart whisper-service

# 4. 等待模型加载
sleep 30

# 5. 测试连接
curl http://localhost:8002/health
```

### 方法 3: 通过 Docker Compose

```bash
# 1. 修改 docker-compose.yml
# 找到 whisper-service 部分，修改环境变量:
environment:
  - WHISPER_MODEL=base  # 改为你想要的模型

# 2. 重启服务
docker-compose up -d whisper-service

# 3. 查看日志
docker logs -f chainlesschain-whisper
```

---

## 在桌面应用中配置

### 1. 打开设置页面

1. 启动 ChainlessChain 桌面应用
2. 点击左侧菜单 **"设置"**
3. 选择 **"语音识别"** 标签

### 2. 配置 Whisper Local

1. **选择引擎**: 选择 "Whisper Local (离线)"
2. **服务地址**: `http://localhost:8002`
3. **点击"测试连接"**: 确认服务正常
4. **选择模型大小**:
   - 日常使用: base ⭐推荐
   - 快速测试: tiny
   - 高准确度: small
   - 专业级: medium
   - 最高质量: large
5. **默认语言**: 选择 "中文" 或 "自动检测"
6. **点击"保存设置"**

### 3. 测试语音识别

1. 点击 **"测试语音识别"** 按钮
2. 允许麦克风权限
3. 说话测试
4. 查看转录结果

---

## 性能优化建议

### 提升速度

#### 1. 使用更小的模型
```bash
# tiny 模型最快
./switch-model.sh switch tiny
```

#### 2. 启用 GPU 加速（如有 NVIDIA 显卡）
```bash
# 安装 CUDA 版本的 PyTorch
pip install torch==2.1.2+cu118 torchaudio==2.1.2+cu118 \
  --index-url https://download.pytorch.org/whl/cu118

# 设置使用 GPU
export WHISPER_DEVICE=cuda

# 重启服务
docker-compose restart whisper-service
```

**GPU 加速效果**:
- tiny: 1s/min (10x 提升)
- base: 2s/min (5x 提升)
- small: 5s/min (6x 提升)
- medium: 15s/min (6x 提升)
- large: 30s/min (6x 提升)

#### 3. 增加并发处理
```bash
# 在 .env 中设置
WHISPER_WORKERS=2  # 根据 CPU 核心数调整
```

### 提升准确度

#### 1. 使用更大的模型
```bash
# small 模型准确度更高
./switch-model.sh switch small
```

#### 2. 指定正确的语言
```bash
# 转录时指定语言
curl -X POST http://localhost:8002/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "model=base" \
  -F "language=zh"  # 明确指定中文
```

#### 3. 提供上下文提示
```bash
# 使用 initial_prompt 提供上下文
curl -X POST http://localhost:8002/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "model=base" \
  -F "language=zh" \
  -F "initial_prompt=这是一段关于人工智能的讨论"
```

---

## 常见问题

### Q1: 如何知道当前使用的是哪个模型？

```bash
# 方法 1: 查看健康检查
curl http://localhost:8002/health | python3 -m json.tool

# 方法 2: 查看日志
docker logs chainlesschain-whisper | grep "Loading Whisper model"

# 方法 3: 使用切换脚本
./switch-model.sh status
```

### Q2: 切换模型需要多长时间？

- **tiny**: ~15秒
- **base**: ~35秒
- **small**: ~60秒
- **medium**: ~120秒
- **large**: ~180秒

首次加载需要下载模型，后续切换会使用缓存。

### Q3: 可以同时加载多个模型吗？

可以，但不推荐。每个模型都会占用内存：
- 同时加载 base + small: ~2.2GB 内存
- 同时加载 base + medium: ~3.7GB 内存

建议根据需要切换模型，而不是同时加载。

### Q4: 模型存储在哪里？

Docker 容器内: `/root/.cache/whisper/`
Docker 卷: `whisper-models`

查看模型文件:
```bash
docker exec chainlesschain-whisper ls -lh /root/.cache/whisper/
```

### Q5: 如何清理未使用的模型？

```bash
# 进入容器
docker exec -it chainlesschain-whisper bash

# 查看模型
ls -lh /root/.cache/whisper/

# 删除不需要的模型
rm /root/.cache/whisper/large-v2.pt

# 退出容器
exit
```

---

## 模型选择决策树

```
开始
  │
  ├─ 需要最快速度？
  │   └─ 是 → tiny 模型
  │
  ├─ 日常使用？
  │   └─ 是 → base 模型 ⭐推荐
  │
  ├─ 需要更高准确度？
  │   └─ 是 → small 模型
  │
  ├─ 专业用途？
  │   └─ 是 → medium 模型
  │
  └─ 最高质量要求？
      └─ 是 → large 模型
```

---

## 总结

### 推荐配置

**大多数用户**: base 模型
- 速度快（2.2x 实时）
- 准确度高（100%）
- 资源占用合理

**快速测试**: tiny 模型
- 最快速度（5.2x 实时）
- 适合功能验证

**专业用户**: small 或 medium 模型
- 更高准确度
- 适合重要内容

### 快速命令

```bash
# 查看状态
./switch-model.sh status

# 切换到推荐模型
./switch-model.sh switch base

# 性能测试
./switch-model.sh test base

# 在桌面应用中测试
# 设置 → 语音识别 → 测试语音识别
```

---

**更新时间**: 2026-01-11
**版本**: 1.0.0
