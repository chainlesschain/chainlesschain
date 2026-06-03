FROM python:3.10-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY whisper_local_server.py .

# 预下载默认模型（可选）
RUN python -c "import whisper; whisper.load_model('base')"

# 暴露端口
EXPOSE 8000

# 启动服务
CMD ["python", "whisper_local_server.py"]
