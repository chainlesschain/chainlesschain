# Whisper.cpp Server Dockerfile
# 支持 CPU 和 GPU (CUDA) 加速
#
# 构建命令:
#   CPU:  docker build -t chainlesschain/whisper-server:cpu .
#   GPU:  docker build --build-arg GPU_SUPPORT=cuda -t chainlesschain/whisper-server:cuda .
#
# 运行命令:
#   CPU:  docker run -p 8002:8002 chainlesschain/whisper-server:cpu
#   GPU:  docker run --gpus all -p 8002:8002 chainlesschain/whisper-server:cuda

ARG GPU_SUPPORT=cpu
ARG WHISPER_VERSION=1.6.2

# ============================================
# CPU 版本基础镜像
# ============================================
FROM python:3.11-slim as base-cpu

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ============================================
# CUDA GPU 版本基础镜像
# ============================================
FROM nvidia/cuda:12.2.0-devel-ubuntu22.04 as base-cuda

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    cmake \
    git \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 软链接 Python
RUN ln -sf /usr/bin/python3 /usr/bin/python

# ============================================
# 选择基础镜像
# ============================================
FROM base-${GPU_SUPPORT} as builder

WORKDIR /app

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 克隆并编译 whisper.cpp
RUN git clone --depth 1 --branch v${WHISPER_VERSION} https://github.com/ggerganov/whisper.cpp.git /whisper.cpp

WORKDIR /whisper.cpp

# 根据 GPU 支持编译
ARG GPU_SUPPORT
RUN if [ "$GPU_SUPPORT" = "cuda" ]; then \
        cmake -B build -DWHISPER_CUDA=ON && cmake --build build --config Release; \
    else \
        cmake -B build && cmake --build build --config Release; \
    fi

# ============================================
# 运行时镜像
# ============================================
FROM base-${GPU_SUPPORT} as runtime

WORKDIR /app

# 复制编译产物
COPY --from=builder /whisper.cpp/build/bin/* /usr/local/bin/
COPY --from=builder /whisper.cpp/models /app/models/

# 复制 Python 依赖
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages

# 复制应用代码
COPY server.py .
COPY start.sh .

# 创建模型目录
RUN mkdir -p /app/models

# 设置权限
RUN chmod +x start.sh

# 环境变量
ENV WHISPER_MODEL_DIR=/app/models
ENV WHISPER_MODEL_SIZE=base
ENV WHISPER_SERVER_PORT=8002
ENV WHISPER_DEVICE=auto
ENV PYTHONUNBUFFERED=1

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${WHISPER_SERVER_PORT}/health || exit 1

# 暴露端口
EXPOSE 8002

# 启动命令
CMD ["./start.sh"]
