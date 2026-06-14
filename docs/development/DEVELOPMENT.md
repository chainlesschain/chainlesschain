# ChainlessChain 开发指南

本文档为开发者提供开发环境搭建、开发流程和贡献指南。

## 目录

- [快速开始](#快速开始)
- [环境要求](#环境要求)
- [开发流程](#开发流程)
- [开发路线图](#开发路线图)
- [贡献指南](#贡献指南)
- [代码规范](#代码规范)
- [测试指南](#测试指南)

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

### 2. 启动PC端桌面应用

```bash
cd desktop-app-vue

# 安装依赖
npm install

# 构建主进程（首次运行或修改后需要）
npm run build:main

# 启动开发服务器
npm run dev
```

### 3. 启动后端服务（可选）

#### Docker 方式（推荐）

```bash
# 返回项目根目录
cd ..

# 启动所有Docker服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 下载LLM模型（首次运行）
docker exec chainlesschain-ollama ollama pull qwen2:7b

# 查看日志
docker-compose logs -f
```

#### 手动启动

**Project Service (Spring Boot)**:

```bash
cd backend/project-service
mvn clean compile
mvn spring-boot:run
# 访问 http://localhost:9090
# Swagger文档: http://localhost:9090/swagger-ui.html
```

**AI Service (FastAPI)**:

```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
# 访问 http://localhost:8001
# API文档: http://localhost:8001/docs
```

**Community Forum**:

```bash
# 后端
cd community-forum/backend
mvn spring-boot:run

# 前端
cd community-forum/frontend
npm install
npm run dev
```

---

## 环境要求

### PC端开发

- **Node.js**: 20+ (推荐使用 nvm 管理版本)
- **npm**: 9+ 或 yarn 1.22+
- **Python**: 3.9+ (用于AI服务)
- **Java**: JDK 17+ (用于后端服务)
- **Docker**: 20.10+ (可选，用于服务编排)
- **Git**: 2.30+

### 移动端开发

- **Android**: Android Studio 2024+, SDK 28+
- **iOS**: Xcode 15+, macOS 13+
- **uni-app**: HBuilderX 3.0+

### 硬件要求

- **内存**: 8GB+ (推荐16GB)
- **硬盘**: 50GB+ 可用空间
- **显卡**: 支持WebGL 2.0 (用于3D可视化)

---

## 开发流程

### 分支管理

- `main`: 主分支，稳定版本
- `develop`: 开发分支
- `feature/*`: 功能分支
- `fix/*`: 修复分支
- `release/*`: 发布分支

### 工作流程

1. **创建功能分支**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **开发和测试**

   ```bash
   npm run dev
   npm run test
   ```

3. **提交代码**

   ```bash
   git add .
   git commit -m "feat: add your feature"
   ```

4. **推送到远程**

   ```bash
   git push origin feature/your-feature-name
   ```

5. **创建 Pull Request**
   - 在GitHub上创建PR
   - 填写PR模板
   - 等待代码审查

### 提交信息规范

使用语义化提交消息:

- `feat`: 新功能
- `fix`: Bug修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具相关
- `perf`: 性能优化

示例:

```bash
feat(rag): add reranker support
fix(p2p): resolve connection timeout issue
docs(readme): update installation guide
```

---

## 开发路线图

### 已完成 ✅

#### Phase 1: MVP - 知识库管理 (100%)

- [x] 桌面应用框架搭建
- [x] U盾集成和加密存储
- [x] 本地LLM和RAG实现
- [x] Git同步功能
- [x] 文件导入和OCR
- [x] 知识图谱可视化

#### Phase 2: 去中心化社交 (100%)

- [x] DID身份系统
- [x] P2P通信基础
- [x] Signal协议E2E加密
- [x] 好友管理系统
- [x] 群聊功能
- [x] 语音/视频通话

#### Phase 3: 去中心化交易 (100%)

- [x] 数字资产管理
- [x] 智能合约引擎
- [x] 托管服务
- [x] 信用评分系统

#### Phase 4: 区块链集成 (100%)

- [x] 6个智能合约开发
- [x] HD钱包系统
- [x] 15链支持
- [x] 跨链桥系统

#### Phase 5: 生态完善 (100%)

- [x] 企业版功能
- [x] 移动端应用
- [x] 技能工具系统
- [x] 插件系统

### 进行中 🚧

#### Phase 6: 生产优化 (10%)

- [ ] 测试覆盖率提升
- [ ] 性能优化
- [ ] 安全审计
- [ ] 文档完善

### 计划中 ⏳

- [ ] Phase 7: 企业版增强
- [ ] Phase 8: 移动端完善
- [ ] Phase 9: 生态扩展

---

## 贡献指南

### 如何贡献

我们欢迎所有形式的贡献!

1. **Fork 本仓库**
2. **创建特性分支**
   ```bash
   git checkout -b feature/AmazingFeature
   ```
3. **提交更改**
   ```bash
   git commit -m 'feat: Add some AmazingFeature'
   ```
4. **推送到分支**
   ```bash
   git push origin feature/AmazingFeature
   ```
5. **开启 Pull Request**

### 优先级任务

#### 🔴 高优先级

1. **测试覆盖率提升**
   - 单元测试
   - 集成测试
   - E2E测试

2. **文档完善**
   - API文档
   - 用户指南
   - 开发者文档

3. **性能优化**
   - 前端性能
   - 后端性能
   - 数据库优化

#### 🟡 中优先级

1. **国际化**
   - 多语言支持
   - 时区处理

2. **无障碍支持**
   - 键盘导航
   - 屏幕阅读器

---

## 代码规范

### JavaScript/TypeScript

```javascript
// 使用 async/await
async function fetchData() {
  try {
    const response = await api.get("/data");
    return response.data;
  } catch (error) {
    logger.error("Failed to fetch data:", error);
    throw error;
  }
}
```

### Vue 组件

```vue
<script setup>
import { ref, computed } from "vue";

const props = defineProps({
  userName: String,
  isActive: Boolean,
});

const count = ref(0);
</script>
```

### 命名约定

- 文件名: kebab-case
- 类名: PascalCase
- 变量/函数: camelCase
- 常量: UPPER_SNAKE_CASE

---

## 测试指南

### 运行测试

```bash
npm run test           # 所有测试
npm run test:unit      # 单元测试
npm run test:e2e       # E2E测试
npm run test:coverage  # 测试覆盖率
```

### 测试覆盖率目标

- 单元测试: 80%+
- 集成测试: 60%+
- E2E测试: 主要流程覆盖

---

## 构建和发布

### 构建生产版本

```bash
cd desktop-app-vue
npm run build
npm run make:win     # Windows
npm run make:mac     # macOS
npm run make:linux   # Linux
```

---

## 相关文档

- [返回主文档](../README.md)
- [功能详解](./FEATURES.md)
- [安装指南](./INSTALLATION.md)
- [架构文档](./ARCHITECTURE.md)
- [版本历史](./CHANGELOG.md)

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：ChainlessChain 开发指南。

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
