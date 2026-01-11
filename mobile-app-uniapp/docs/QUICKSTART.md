# ChainlessChain 移动端 - 快速开始指南

## 📱 项目简介

ChainlessChain Mobile 是基于 uni-app 开发的跨平台移动应用，支持 iOS、Android 和 H5。提供个人知识管理、AI对话、去中心化社交和交易等功能。

## 🚀 快速开始

### 环境要求

- **Node.js**: >= 16.0.0
- **npm**: >= 8.0.0
- **HBuilderX**: 最新版本（推荐）
- **Android Studio**: 用于Android开发
- **Xcode**: 用于iOS开发（仅macOS）

### 安装依赖

```bash
cd mobile-app-uniapp
npm install
```

### 运行项目

#### 1. H5 开发模式

```bash
npm run dev:h5
```

访问: http://localhost:8080

#### 2. 微信小程序

```bash
npm run dev:mp-weixin
```

然后在微信开发者工具中打开 `dist/dev/mp-weixin` 目录。

#### 3. Android 应用

```bash
npm run dev:app-android
```

或在 HBuilderX 中选择"运行 -> 运行到手机或模拟器 -> Android"。

#### 4. iOS 应用

```bash
npm run dev:app-ios
```

或在 HBuilderX 中选择"运行 -> 运行到手机或模拟器 -> iOS"。

### 构建生产版本

```bash
# H5
npm run build:h5

# 微信小程序
npm run build:mp-weixin

# Android
npm run build:app-android

# iOS
npm run build:app-ios
```

## 📁 项目结构

```
mobile-app-uniapp/
├── src/
│   ├── pages/              # 页面
│   │   ├── index/          # 首页
│   │   ├── knowledge/      # 知识库
│   │   ├── chat/           # AI对话
│   │   ├── social/         # 社交
│   │   ├── trade/          # 交易
│   │   └── ...
│   ├── components/         # 组件
│   ├── services/           # 服务层
│   │   ├── database.js     # 数据库服务
│   │   ├── ai.js           # AI服务
│   │   ├── knowledge-rag.js # RAG服务
│   │   ├── did.js          # DID身份
│   │   └── ...
│   ├── stores/             # Pinia状态管理
│   ├── utils/              # 工具函数
│   ├── static/             # 静态资源
│   ├── App.vue             # 应用入口
│   ├── main.js             # 主入口
│   └── pages.json          # 页面配置
├── docs/                   # 文档
├── package.json
└── README.md
```

## 🎯 核心功能

### 1. 知识库管理

**功能**:
- ✅ 知识条目CRUD
- ✅ 标签系统
- ✅ 搜索和筛选
- ✅ 收藏/星标
- ⏳ 文件夹管理
- ⏳ 文件导入
- ⏳ RAG检索

**使用示例**:
```javascript
import database from '@/services/database'

// 创建知识条目
const knowledge = await database.insert('knowledge', {
  title: '我的笔记',
  content: '这是内容',
  tags: 'tag1,tag2',
  created_at: Date.now()
})

// 查询知识列表
const list = await database.query(`
  SELECT * FROM knowledge
  WHERE deleted_at IS NULL
  ORDER BY updated_at DESC
  LIMIT 20
`)

// 搜索知识
const results = await database.query(`
  SELECT * FROM knowledge
  WHERE title LIKE ? OR content LIKE ?
`, [`%${keyword}%`, `%${keyword}%`])
```

### 2. AI对话

**功能**:
- ✅ 多LLM支持（OpenAI, DeepSeek, Ollama）
- ✅ 对话历史
- ⏳ 流式响应
- ⏳ 知识库上下文
- ⏳ 多轮对话

**使用示例**:
```javascript
import { aiService } from '@/services/ai'

// 发送消息
const response = await aiService.chat({
  message: '你好，请介绍一下自己',
  model: 'gpt-3.5-turbo',
  temperature: 0.7
})

console.log(response.content)
```

### 3. RAG检索

**功能**:
- ✅ 本地向量化（transformers.js）
- ✅ 语义搜索
- ✅ 混合检索
- ⏳ 重排序
- ⏳ 知识图谱

**使用示例**:
```javascript
import { knowledgeRAGService } from '@/services/knowledge-rag'

// 检索相关知识
const results = await knowledgeRAGService.retrieve({
  query: '如何使用Vue 3',
  topK: 5,
  method: 'hybrid' // 'vector', 'keyword', 'hybrid'
})

// 生成增强回答
const answer = await knowledgeRAGService.generateAnswer({
  query: '如何使用Vue 3',
  context: results
})
```

### 4. DID身份

**功能**:
- ✅ DID生成
- ✅ 密钥管理
- ⏳ 可验证凭证
- ⏳ DID登录

**使用示例**:
```javascript
import { didService } from '@/services/did'

// 生成DID
const { did, didDocument } = await didService.generateDID()

// 签名消息
const signature = await didService.sign(did, 'Hello World')

// 验证签名
const isValid = await didService.verify(did, 'Hello World', signature)
```

## 🔧 配置

### 环境变量

创建 `.env` 文件：

```env
# AI服务配置
VUE_APP_AI_SERVICE_URL=http://localhost:8001
VUE_APP_OLLAMA_URL=http://localhost:11434

# LLM API密钥
VUE_APP_OPENAI_API_KEY=your_openai_key
VUE_APP_DEEPSEEK_API_KEY=your_deepseek_key

# 信令服务器
VUE_APP_SIGNALING_SERVER=ws://localhost:9001
```

### 数据库配置

数据库自动初始化，无需手动配置。数据存储位置：
- **H5**: localStorage
- **App**: SQLite数据库

### LLM配置

在应用设置中配置LLM提供商和API密钥。

## 📱 功能演示

### 知识库

1. 打开应用，点击底部"知识"标签
2. 点击右上角"+"按钮创建新知识
3. 输入标题和内容，添加标签
4. 点击"保存"

### AI对话

1. 点击底部"首页"标签
2. 点击"AI对话"卡片
3. 输入消息，点击发送
4. 查看AI回复

### 搜索知识

1. 在知识库页面，点击搜索框
2. 输入关键词
3. 查看搜索结果
4. 点击结果查看详情

## 🐛 常见问题

### Q: H5模式下数据库报错？

**A**: H5模式使用localStorage模拟数据库，功能有限。建议使用App模式进行完整测试。

### Q: AI对话无响应？

**A**: 检查以下几点：
1. 确认AI服务URL配置正确
2. 确认API密钥有效
3. 检查网络连接
4. 查看控制台错误日志

### Q: 如何清空数据？

**A**:
- **H5**: 清除浏览器localStorage
- **App**: 在设置中选择"清空数据"

### Q: 如何导入知识？

**A**: 当前版本暂不支持文件导入，该功能正在开发中。

## 📚 开发指南

### 添加新页面

1. 在 `src/pages/` 创建页面目录
2. 创建 `.vue` 文件
3. 在 `pages.json` 中注册页面

```json
{
  "pages": [
    {
      "path": "pages/my-page/my-page",
      "style": {
        "navigationBarTitleText": "我的页面"
      }
    }
  ]
}
```

### 添加新服务

1. 在 `src/services/` 创建服务文件
2. 导出服务类或函数
3. 在页面中导入使用

```javascript
// src/services/my-service.js
class MyService {
  async doSomething() {
    // 实现逻辑
  }
}

export default new MyService()
```

### 使用Pinia状态管理

```javascript
// src/stores/my-store.js
import { defineStore } from 'pinia'

export const useMyStore = defineStore('my', {
  state: () => ({
    count: 0
  }),
  actions: {
    increment() {
      this.count++
    }
  }
})

// 在组件中使用
import { useMyStore } from '@/stores/my-store'

const myStore = useMyStore()
myStore.increment()
```

## 🧪 测试

### 运行测试

```bash
npm run test
```

### 编写测试

```javascript
import { describe, it, expect } from 'vitest'
import database from '@/services/database'

describe('Database Service', () => {
  it('should insert data', async () => {
    const result = await database.insert('knowledge', {
      title: 'Test',
      content: 'Content'
    })
    expect(result.id).toBeDefined()
  })
})
```

## 📖 更多文档

- [移动端适配计划](./MOBILE_ADAPTATION_PLAN.md)
- [API文档](./API.md)
- [架构设计](./ARCHITECTURE.md)
- [贡献指南](./CONTRIBUTING.md)

## 🤝 贡献

欢迎贡献代码！请阅读 [贡献指南](./CONTRIBUTING.md)。

## 📄 许可证

MIT License

## 📞 联系我们

- GitHub Issues: [chainlesschain/issues](https://github.com/chainlesschain/chainlesschain/issues)
- 邮箱: support@chainlesschain.com

---

**版本**: v0.2.0
**更新日期**: 2026-01-12
