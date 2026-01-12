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

**当前版本**: v0.2.0
**开发进度**: 80% 完成 ⭐大幅提升

**已完成**:
- ✅ 项目基础结构
- ✅ 数据库服务层（参考 desktop-app-vue 设计）
- ✅ LLM 云端 API 服务
- ✅ 认证服务（PIN 码模拟）
- ✅ 登录页面
- ✅ 知识库 CRUD 页面（Markdown渲染、代码高亮、图片预览）
- ✅ AI 对话界面（流式响应、消息气泡）
- ✅ 社交功能（好友管理、动态发布、私信聊天）
- ✅ 交易系统（订单管理、资产展示、支付流程）
- ✅ 项目管理（任务列表、进度跟踪）
- ✅ 移动端UX优化（响应式设计、现代化UI、性能优化）
- ✅ P2P 通信（设备配对、数据同步）

**待开发**:
- ⏳ 交易系统完善（智能合约、托管、信用评分）
- ⏳ 项目管理增强（模板、AI聊天、协作功能）
- ⏳ 设置配置完善（高级LLM设置、网络配置）
- ⏳ 社交功能增强（群聊UI、视频帖子、话题系统）
- ⏳ 通知系统（推送通知、通知中心）
- ⏳ 高级功能（语音输入、相机集成）
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

## 移动端UX优化 ⭐新增

ChainlessChain移动端应用经过全面的UX优化，提供流畅、现代化的移动体验：

### 核心UX特性

**响应式设计**:
- 适配各种屏幕尺寸（手机、平板）
- 支持横竖屏切换
- 动态字体大小调整
- 安全区域适配（刘海屏、圆角屏）

**现代化UI**:
- 渐变色设计和卡片式布局
- 流畅的页面切换动画
- 微交互反馈（按钮点击、滑动效果）
- 统一的视觉语言

**性能优化**:
- 虚拟滚动列表（长列表优化）
- 图片懒加载和压缩
- 骨架屏加载状态
- 组件按需加载
- 内存管理优化

**交互体验**:
- 下拉刷新（所有列表页面）
- 上拉加载更多
- 滑动删除操作
- 长按菜单
- 双击缩放（图片预览）
- Toast即时反馈
- 底部弹出菜单

**Markdown编辑器**:
- 实时预览模式
- 代码语法高亮
- 图片预览和上传
- 工具栏快捷操作
- 自动保存草稿
- 全屏编辑模式

**图片处理**:
- 图片预览和缩放
- 上传进度显示
- 自动压缩优化
- 多图选择上传
- 图片裁剪功能

**通知系统**:
- 本地通知推送
- 应用内消息提示
- 通知中心管理
- 消息角标显示

**主题系统**:
- 亮色/暗色主题
- 跟随系统设置
- 自定义主题色
- 平滑主题切换

### 已实现功能模块

**知识库管理** (95%):
- Markdown渲染和编辑
- 代码高亮显示
- 图片预览和上传
- 标签管理
- 搜索和筛选
- 文件夹组织

**AI对话界面** (90%):
- 流式响应显示
- 消息气泡样式
- 语音输入支持
- 对话历史管理
- 多模型切换
- 上下文管理

**社交功能** (80%):
- 好友列表和搜索
- 动态发布和浏览
- 私信聊天
- 在线状态显示
- 消息已读状态
- 表情和图片发送

**交易系统** (85%):
- 订单列表和详情
- 资产展示和管理
- 支付流程
- 交易历史
- 订单状态追踪

**项目管理** (75%):
- 任务列表
- 进度跟踪
- 协作功能
- 文件管理

**设置页面** (90%):
- 账户管理
- 隐私设置
- 同步配置
- 主题切换
- 语言选择
- 关于信息

### 技术实现

**框架和库**:
- uni-app 3.0 - 跨平台开发框架
- Vue 3.4 - 渐进式JavaScript框架
- Pinia 2.1.7 - 状态管理
- SQLite - 本地数据库
- WebRTC - P2P通信

**UI组件**:
- 自定义组件库（15+组件）
- MarkdownRenderer - Markdown渲染
- MarkdownToolbar - 编辑工具栏
- ImagePreview - 图片预览
- PullRefresh - 下拉刷新
- LoadMore - 上拉加载

**样式系统**:
- CSS自定义属性（主题变量）
- SCSS预处理器
- 响应式布局（flex/grid）
- 动画库（transition/animation）

**性能优化**:
- 虚拟列表（长列表优化）
- 图片懒加载
- 组件懒加载
- 请求防抖节流
- 内存泄漏防护

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
