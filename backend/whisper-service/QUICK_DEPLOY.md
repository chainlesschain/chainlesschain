# Whisper 服务快速部署指南

由于 Docker 构建需要下载大量依赖（PyTorch + CUDA 库约 1GB+），这里提供一个更快的部署方案。

## 方案选择

### 方案 1: Docker 部署 (推荐，但需要时间)
**优点**:
- 环境隔离，不影响系统
- 一次构建，随处运行
- 自动管理依赖

**缺点**:
- 首次构建需要 10-15 分钟
- 需要下载约 1GB 的依赖

**当前状态**: 正在下载 CUDA 库 (约 70% 完成)

### 方案 2: 简化版本 (快速测试)
**优点**:
- 5 分钟内可以运行
- 使用 CPU 版本的 PyTorch (更小)
- 适合快速测试

**缺点**:
- 需要手动安装依赖
- 转录速度较慢（CPU only）

## 快速部署方案 (推荐先试这个)

### 步骤 1: 安装 FFmpeg
```bash
# 检查是否已安装
ffmpeg -version

# 如果未安装
brew install ffmpeg
```

### 步骤 2: 创建简化的 requirements.txt
```bash
cd /Users/mac/Documents/code2/chainlesschain/backend/whisper-service

# 创建 CPU 版本的依赖文件
cat > requirements-cpu.txt << 'EOF'
fastapi==0.109.0
uvicorn[standard]==0.27.0
python-multipart==0.0.6
openai-whisper==20231117
torch==2.1.2
torchaudio==2.1.2
numpy==1.24.3
ffmpeg-python==0.2.0
python-dotenv==1.0.0
EOF
```

### 步骤 3: 安装依赖
```bash
# 激活虚拟环境
source venv/bin/activate

# 安装 CPU 版本（更快）
pip install -r requirements-cpu.txt
```

### 步骤 4: 启动服务
```bash
# 设置环境变量
export WHISPER_HOST=0.0.0.0
export WHISPER_PORT=8002
export WHISPER_MODEL=tiny  # 使用最小模型进行快速测试

# 启动服务
python main.py
```

### 步骤 5: 测试
```bash
# 新开一个终端
curl http://localhost:8002/health

# 应该看到:
# {"status":"healthy","device":"cpu","models_loaded":0}
```

## 测试转录功能

### 下载测试音频
```bash
curl -L -o /tmp/test-audio.mp3 \
  "https://github.com/openai/whisper/raw/main/tests/jfk.flac"
```

### 转录测试
```bash
curl -X POST http://localhost:8002/v1/audio/transcriptions \
  -F "file=@/tmp/test-audio.mp3" \
  -F "model=tiny" \
  -F "language=en"
```

## 在 ChainlessChain 中使用

### 1. 确保服务运行
```bash
curl http://localhost:8002/health
```

### 2. 配置桌面应用
打开 ChainlessChain 桌面应用:
1. 进入 **设置 → 语音识别**
2. 选择 **"Whisper Local"** 引擎
3. 服务 URL: `http://localhost:8002`
4. 点击 **"测试连接"**

### 3. 开始使用
- 点击麦克风图标开始录音
- 说话完成后点击停止
- 等待转录结果

## 模型选择建议

| 模型 | 大小 | 速度 | 准确度 | 使用场景 |
|------|------|------|--------|----------|
| tiny | 75MB | 很快 | 基础 | 快速测试 |
| base | 140MB | 快 | 良好 | **日常使用推荐** |
| small | 460MB | 中等 | 较好 | 需要更高准确度 |
| medium | 1.5GB | 慢 | 高 | 专业用途 |
| large | 2.9GB | 很慢 | 最高 | 最高质量要求 |

## 性能优化

### 使用 GPU (如果有 NVIDIA 显卡)
```bash
# 安装 CUDA 版本的 PyTorch
pip install torch==2.1.2+cu118 torchaudio==2.1.2+cu118 \
  --index-url https://download.pytorch.org/whl/cu118

# 设置使用 GPU
export WHISPER_DEVICE=cuda
```

### 调整并发数
```bash
# 在 .env 文件中设置
WHISPER_WORKERS=2  # 根据 CPU 核心数调整
```

## 故障排除

### 问题 1: 端口被占用
```bash
# 检查端口
lsof -i :8002

# 更改端口
export WHISPER_PORT=8003
```

### 问题 2: 模型下载慢
```bash
# 预先下载模型
python -c "import whisper; whisper.load_model('base')"
```

### 问题 3: 内存不足
```bash
# 使用更小的模型
export WHISPER_MODEL=tiny
```

## Docker 部署状态

如果你想等待 Docker 构建完成:

```bash
# 查看构建进度
docker-compose logs -f whisper-service

# 构建完成后启动
docker-compose up -d whisper-service

# 检查状态
docker ps | grep whisper
```

**预计完成时间**: 还需要 5-10 分钟

## 下一步

1. ✅ 选择部署方案（快速 or Docker）
2. ✅ 启动服务
3. ✅ 测试健康检查
4. ✅ 测试转录功能
5. ✅ 在桌面应用中配置
6. ✅ 开始使用离线语音识别！

---

**建议**: 先使用快速部署方案进行测试，确认功能正常后，可以等待 Docker 构建完成用于生产环境。
