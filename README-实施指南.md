# ChainlessChain 实施指南

本文档提供快速启动和开发指南。

## 快速启动

### 前置要求

- Docker Desktop（带GPU支持）
- Git
- Node.js 18+（前端开发）
- JDK 17+（后端开发）
- Python 3.10+（AI服务开发）

### 1. 克隆代码

```bash
git clone <repository-url>
cd chainlesschain
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑.env文件，填入实际配置
```

### 3. 启动基础设施

```bash
# 启动所有服务（首次启动会自动下载镜像）
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 4. 下载AI模型

```bash
# 下载Qwen2-7B模型（约4GB）
docker exec -it chainlesschain-ollama ollama pull qwen2:7b

# 下载Embedding模型
docker exec -it chainlesschain-ollama ollama pull bge-base-zh-v1.5

# 验证模型
docker exec -it chainlesschain-ollama ollama list
```

### 5. 初始化数据库

```bash
# 数据库会在首次启动时自动初始化
# 如需手动初始化，执行：
docker exec -it chainlesschain-postgres psql -U chainlesschain -d chainlesschain -f /docker-entrypoint-initdb.d/V001__create_project_tables.sql
```

### 6. 验证服务

访问以下地址验证服务是否正常：

- Ollama API: http://localhost:11434
- Qdrant Dashboard: http://localhost:6333/dashboard
- AI Service: http://localhost:8001/docs
- Project Service: http://localhost:8080/actuator/health

## 开发指南

### 后端开发

#### project-service（Spring Boot）

```bash
cd backend/project-service
./mvnw spring-boot:run
```

#### ai-service（FastAPI）

```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### 前端开发

#### PC端（Electron + Vue 3）

```bash
cd desktop-app-vue
npm install
npm run dev
```

#### 移动端（uni-app）

```bash
cd mobile-app-uniapp
npm install
npm run dev:mp-weixin  # 微信小程序
npm run dev:h5         # H5
```

## 测试AI功能

### 测试Ollama

```bash
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2:7b",
  "prompt": "你好，请介绍一下你自己",
  "stream": false
}'
```

### 测试向量检索

```bash
curl http://localhost:6333/collections
```

### 测试AI服务

```bash
# 创建网页项目
curl -X POST http://localhost:8001/api/projects/create \
  -H "Content-Type: application/json" \
  -d '{
    "user_prompt": "帮我创建一个智能手表的产品介绍网页",
    "project_type": "web"
  }'
```

## 目录结构

```
chainlesschain/
├── backend/                    # 后端服务
│   ├── project-service/       # 项目管理服务（Spring Boot）
│   ├── ai-service/            # AI引擎服务（FastAPI）
│   ├── knowledge-service/     # 知识库服务（Spring Boot）
│   └── community-forum/       # 社区论坛服务（现有）
├── desktop-app-vue/           # PC端应用（Electron + Vue 3）
├── mobile-app-uniapp/         # 移动端应用（uni-app）
├── data/                      # 数据持久化目录
│   ├── ollama/               # Ollama模型和数据
│   ├── qdrant/               # 向量数据库数据
│   ├── postgres/             # PostgreSQL数据
│   ├── redis/                # Redis数据
│   ├── projects/             # 项目文件
│   └── knowledge/            # 知识库文件
├── docker-compose.yml         # Docker编排配置
├── .env.example              # 环境变量示例
└── README-实施指南.md         # 本文档
```

## 常见问题

### Q: GPU不可用怎么办？

A: 编辑`docker-compose.yml`，注释掉`deploy.resources`部分，使用CPU推理（会较慢）。

### Q: 模型下载失败？

A: 使用国内镜像：
```bash
docker exec -it chainlesschain-ollama sh
export OLLAMA_MODELS=/root/.ollama/models
wget https://modelscope.cn/models/qwen/Qwen2-7B-Instruct-GGUF/resolve/master/qwen2-7b-instruct-q4_k_m.gguf -O /root/.ollama/models/qwen2-7b.gguf
```

### Q: 端口冲突？

A: 编辑`docker-compose.yml`修改端口映射，例如`"11434:11434"`改为`"11435:11434"`。

## 下一步

1. 完成project-service后端服务开发
2. 实现NLU意图识别引擎
3. 实现Web开发引擎
4. 集成前端AI对话界面

详见：`实施计划_系统设计对比与差距分析.md`

## 贡献指南

1. 创建feature分支
2. 提交代码并编写测试
3. 提交Pull Request
4. 代码审查通过后合并

## 许可证

MIT License
