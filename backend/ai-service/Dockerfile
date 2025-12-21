FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖和中文字体
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    git \
    fonts-wqy-zenhei \
    fonts-wqy-microhei \
    fonts-noto-cjk \
    fontconfig \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /root/.cache/matplotlib/*

# 复制requirements并安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --extra-index-url https://pypi.org/simple

# 复制源代码
COPY src ./src
COPY main.py .

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
