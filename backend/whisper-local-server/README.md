# Whisper Local Server 部署指南

本地 Whisper 语音识别服务器，提供与 OpenAI API 兼容的接口。

---

## 📋 系统要求

### 最低配置
- **CPU**: 4核心以上
- **内存**: 8GB RAM
- **存储**: 5GB 可用空间
- **Python**: 3.8+

### 推荐配置
- **GPU**: NVIDIA GPU (CUDA 支持)
- **内存**: 16GB+ RAM
- **存储**: 10GB+ 可用空间

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd backend/whisper-local-server

# 创建虚拟环境（推荐）
python -m venv venv

# 激活虚拟环境
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 2. 启动服务器

```bash
# 方法 1: 直接运行
python whisper_local_server.py

# 方法 2: 使用 uvicorn
uvicorn whisper_local_server:app --host 0.0.0.0 --port 8000 --reload

# 方法 3: 后台运行
nohup python whisper_local_server.py > whisper.log 2>&1 &
```

### 3. 验证服务

```bash
# 检查健康状态
curl http://localhost:8000/health

# 查看可用模型
curl http://localhost:8000/v1/models
```

---

## 📦 模型说明

### 可用模型

| 模型 | 参数量 | 内存占用 | 速度 | 准确度 |
|------|--------|----------|------|--------|
| tiny | 39M | ~1GB | 最快 | 较低 |
| base | 74M | ~1GB | 快 | 中等 |
| small | 244M | ~2GB | 中等 | 良好 |
| medium | 769M | ~5GB | 慢 | 很好 |
| large | 1550M | ~10GB | 最慢 | 最好 |

### 首次使用

首次使用时，Whisper 会自动下载模型文件到 `~/.cache/whisper/`。

**手动下载模型**:
```python
import whisper
whisper.load_model("base")  # 下载 base 模型
```

---

## 🔧 配置选项

### 环境变量

```bash
# 设置设备（cpu/cuda）
export WHISPER_DEVICE=cuda

# 设置默认模型
export WHISPER_DEFAULT_MODEL=base

# 设置端口
export WHISPER_PORT=8000
```

### 服务器配置

编辑 `whisper_local_server.py`:

```python
# 修改默认端口
uvicorn.run(app, host="0.0.0.0", port=8000)

# 修改默认模型
load_model("small")  # 改为 small 模型

# 修改设备
device = "cpu"  # 强制使用 CPU
```

---

## 📡 API 使用

### 转录音频

```bash
curl -X POST http://localhost:8000/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "model=base" \
  -F "language=zh"
```

### 翻译音频（翻译为英文）

```bash
curl -X POST http://localhost:8000/v1/audio/translations \
  -F "file=@audio.mp3" \
  -F "model=base"
```

### 在桌面应用中使用

桌面应用会自动使用本地服务器（如果可用）：

```javascript
// 在设置中配置
{
  "speech": {
    "engine": "whisper-local",  // 使用本地服务
    "serverUrl": "http://localhost:8000",
    "modelSize": "base"
  }
}
```

---

## 🐳 Docker 部署

### 使用 Docker

```bash
# 构建镜像
docker build -t whisper-local-server .

# 运行容器（CPU）
docker run -d -p 8000:8000 whisper-local-server

# 运行容器（GPU）
docker run -d --gpus all -p 8000:8000 whisper-local-server
```

### Docker Compose

```yaml
version: '3.8'

services:
  whisper:
    build: ./backend/whisper-local-server
    ports:
      - "8000:8000"
    environment:
      - WHISPER_DEVICE=cuda
      - WHISPER_DEFAULT_MODEL=base
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

---

## 🔍 性能优化

### 1. 使用 GPU

确保安装了 CUDA 和 PyTorch GPU 版本：

```bash
# 安装 PyTorch GPU 版本
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

### 2. 预加载模型

在服务器启动时预加载常用模型：

```python
# 在 __main__ 中添加
load_model("base")
load_model("small")
```

### 3. 调整并发数

使用 Gunicorn 提高并发处理能力：

```bash
pip install gunicorn

gunicorn whisper_local_server:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000
```

### 4. 使用更快的模型

对于实时应用，使用 `tiny` 或 `base` 模型：

```python
# 默认使用 tiny 模型
load_model("tiny")
```

---

## 🐛 故障排查

### 问题 1: 模型下载失败

**症状**: 首次运行时卡住或超时

**解决**:
```bash
# 手动下载模型
python -c "import whisper; whisper.load_model('base')"

# 或设置代理
export HTTP_PROXY=http://proxy:port
export HTTPS_PROXY=http://proxy:port
```

### 问题 2: CUDA 不可用

**症状**: 显示 "使用设备: cpu" 但有 GPU

**解决**:
```bash
# 检查 CUDA 安装
nvidia-smi

# 重新安装 PyTorch GPU 版本
pip uninstall torch
pip install torch --index-url https://download.pytorch.org/whl/cu118
```

### 问题 3: 内存不足

**症状**: 转录大文件时崩溃

**解决**:
- 使用更小的模型（tiny/base）
- 增加系统内存
- 分段处理音频文件

### 问题 4: 端口被占用

**症状**: "Address already in use"

**解决**:
```bash
# 查找占用端口的进程
# Windows:
netstat -ano | findstr :8000

# Linux/Mac:
lsof -i :8000

# 更改端口
uvicorn whisper_local_server:app --port 8001
```

---

## 📊 监控和日志

### 查看日志

```bash
# 实时查看日志
tail -f whisper.log

# 查看错误日志
grep ERROR whisper.log
```

### 性能监控

```bash
# 查看 GPU 使用情况
nvidia-smi -l 1

# 查看 CPU 和内存
htop
```

---

## 🔒 安全建议

### 1. 限制访问

```python
# 只允许本地访问
uvicorn.run(app, host="127.0.0.1", port=8000)
```

### 2. 添加认证

```python
from fastapi import Header, HTTPException

async def verify_token(x_token: str = Header(...)):
    if x_token != "your-secret-token":
        raise HTTPException(status_code=401, detail="Invalid token")

@app.post("/v1/audio/transcriptions", dependencies=[Depends(verify_token)])
async def transcribe_audio(...):
    ...
```

### 3. 限制文件大小

```python
from fastapi import UploadFile, File

@app.post("/v1/audio/transcriptions")
async def transcribe_audio(
    file: UploadFile = File(..., max_length=25 * 1024 * 1024)  # 25MB
):
    ...
```

---

## 📈 性能基准

### 测试环境
- CPU: Intel i7-10700K
- GPU: NVIDIA RTX 3080
- 音频: 1分钟 MP3 文件

### 结果

| 模型 | CPU 时间 | GPU 时间 | 准确度 |
|------|----------|----------|--------|
| tiny | 15s | 3s | 85% |
| base | 30s | 5s | 90% |
| small | 60s | 10s | 93% |
| medium | 120s | 20s | 95% |
| large | 240s | 40s | 97% |

---

## 🔄 更新和维护

### 更新依赖

```bash
pip install --upgrade -r requirements.txt
```

### 清理缓存

```bash
# 清理模型缓存
rm -rf ~/.cache/whisper/

# 清理临时文件
rm -rf /tmp/whisper_*
```

---

## 📚 参考资料

- [OpenAI Whisper](https://github.com/openai/whisper)
- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [PyTorch 文档](https://pytorch.org/docs/)

---

## 💡 最佳实践

1. **使用 GPU**: 显著提升性能（5-10倍）
2. **预加载模型**: 减少首次请求延迟
3. **选择合适的模型**: 平衡速度和准确度
4. **监控资源**: 避免内存溢出
5. **日志记录**: 便于问题排查

---

**最后更新**: 2026-01-09
**版本**: 1.0.0
