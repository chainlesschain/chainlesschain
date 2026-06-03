# Python Sandbox Docker Image
# 安全的代码执行环境
#
# 构建命令: docker build -t chainlesschain/python-sandbox:latest .

FROM python:3.11-slim

# 安全设置：创建非 root 用户
RUN groupadd -r sandbox && useradd -r -g sandbox sandbox

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 包
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

# 创建工作目录
RUN mkdir -p /workspace /output && \
    chown -R sandbox:sandbox /workspace /output

# 切换到非 root 用户
USER sandbox

# 设置工作目录
WORKDIR /workspace

# 环境变量
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV MPLBACKEND=Agg

# 默认命令
CMD ["python", "-c", "print('Ready')"]
