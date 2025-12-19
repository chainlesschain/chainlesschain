# ChainlessChain Mobile (uni-app)

基于 uni-app 的 ChainlessChain 移动端应用。

## 项目概述

这是 ChainlessChain 的 uni-app 跨平台移动端实现，支持 Android、iOS、H5 等多个平台。

### 技术栈

- **框架**: uni-app 3.0 + Vue 3
- **状态管理**: Pinia
- **数据库**: SQLite (plus.sqlite)
- **AI服务**: 云端API（OpenAI/DeepSeek）优先
- **认证**: PIN 码模拟 SIMKey

### 项目状态

**当前版本**: v0.1.0
**开发进度**: 初始化完成

**已完成**:
- ✅ 项目基础结构
- ✅ 数据库服务层（参考 desktop-app-vue 设计）
- ✅ LLM 云端 API 服务
- ✅ 认证服务（PIN 码模拟）
- ✅ 登录页面

**待开发**:
- ⏳ 知识库 CRUD 页面
- ⏳ AI 对话界面
- ⏳ 社交功能（好友、动态）
- ⏳ 交易系统（市场、订单、资产）
- ⏳ P2P 通信
- ⏳ Git 同步

## 快速开始

### 环境要求

- Node.js 16+
- HBuilderX 或 CLI
- 微信开发者工具（小程序开发）
- Android Studio（Android 开发）
- Xcode（iOS 开发）

### 安装依赖

```bash
npm install
```

### 运行

```bash
# H5
npm run dev:h5

# 微信小程序
npm run dev:mp-weixin

# App
npm run dev:app
```

### 构建

```bash
# H5
npm run build:h5

# 微信小程序
npm run build:mp-weixin

# App
npm run build:app
```

## 项目结构

```
mobile-app-uniapp/
├── pages/              # 页面
│   ├── index/          # 首页
│   ├── login/          # 登录页
│   ├── knowledge/      # 知识库模块
│   │   ├── list/       # 知识列表
│   │   ├── detail/     # 知识详情
│   │   └── edit/       # 编辑知识
│   ├── chat/           # AI 对话
│   ├── social/         # 社交模块
│   │   ├── friends/    # 好友
│   │   ├── posts/      # 动态
│   │   └── messages/   # 消息
│   ├── trade/          # 交易模块
│   │   ├── market/     # 市场
│   │   ├── orders/     # 订单
│   │   └── assets/     # 资产
│   └── settings/       # 设置
│
├── components/         # 组件
├── static/             # 静态资源
│   ├── images/
│   └── fonts/
│
├── services/           # 服务层
│   ├── database.js     # 数据库服务
│   ├── llm.js          # LLM 服务
│   └── auth.js         # 认证服务
│
├── store/              # 状态管理 (Pinia)
├── utils/              # 工具函数
│
├── App.vue             # 主应用组件
├── main.js             # 入口文件
├── manifest.json       # 应用配置
├── pages.json          # 页面路由配置
├── uni.scss            # 全局样式
└── package.json        # 项目依赖
```

## 核心服务

### 数据库服务 (services/database.js)

基于 desktop-app-vue 的数据库设计，支持：
- 知识库项 (knowledge_items)
- 标签 (tags)
- 对话和消息 (conversations, messages)
- 好友关系 (friendships)
- 社交动态 (posts, post_comments)

### LLM 服务 (services/llm.js)

支持多个 LLM 提供商：
- OpenAI (gpt-3.5-turbo, gpt-4)
- DeepSeek (deepseek-chat)
- Ollama (本地模型)
- 自定义 API

### 认证服务 (services/auth.js)

PIN 码模拟 SIMKey：
- PIN 码验证
- 加密密钥派生
- 模拟数据签名/加密/解密

## 配置

### LLM API 配置

在设置页面配置 LLM API：
1. 选择提供商（OpenAI/DeepSeek/Ollama）
2. 输入 API Key
3. 选择模型
4. 设置参数（温度、最大Token数）

### 数据库加密

数据库使用 PIN 码派生的密钥进行加密。首次登录时设置 PIN 码。

## 开发指南

### 添加新页面

1. 在 `pages/` 下创建页面目录和文件
2. 在 `pages.json` 中注册页面路由
3. 使用 uni-app 路由 API 进行跳转

### 使用服务

```javascript
import { db } from '@/services/database'
import { llm } from '@/services/llm'
import { auth } from '@/services/auth'

// 数据库操作
const items = await db.getKnowledgeItems()

// LLM 查询
const response = await llm.query('你好', [])

// 认证
const result = await auth.verifyPIN('1234')
```

### 状态管理

使用 Pinia 进行全局状态管理（待实现）。

## 与桌面端的关系

uni-app 移动端与 desktop-app-vue 共享：
- 相同的数据库表结构
- 相似的服务层架构
- 一致的数据模型

数据同步通过 Git 实现（待开发）。

## 替代原生 Android

本项目替代了之前的 android-app（原生 Android 版本）：
- android-app 已删除
- 采用 uni-app 实现跨平台
- 保留 android-app 的核心设计思想

## 路线图

### Phase 1 - MVP (2-3 weeks)
- [ ] 知识库 CRUD 完整实现
- [ ] AI 对话界面
- [ ] 基础搜索功能
- [ ] 设置页面完善

### Phase 2 - 社交功能 (2-3 weeks)
- [ ] 好友管理
- [ ] P2P 加密消息
- [ ] 社交动态发布
- [ ] 推送通知

### Phase 3 - 交易系统 (2-3 weeks)
- [ ] 知识付费购买
- [ ] 移动支付集成
- [ ] 订单管理
- [ ] 评价系统

### Phase 4 - 高级功能 (4-6 weeks)
- [ ] Git 同步
- [ ] 真实 SIMKey 集成
- [ ] DID 身份管理
- [ ] 智能合约托管

## 许可证

MIT License

## 联系方式

- **Email**: zhanglongfa@chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/chainlesschain
