# ChainlessChain 功能测试指南

## 测试环境准备

### 1. 启动Docker服务 ✅

已启动的服务：
- PostgreSQL (端口 5432) - 健康
- Redis (端口 6379) - 健康

### 2. 启动后端服务

由于Maven未安装，请按以下步骤手动启动：

#### 方式一：使用IDE（推荐）
1. 使用IntelliJ IDEA或Eclipse打开项目
2. 导入Maven项目：`backend/project-service`
3. 等待依赖下载完成
4. 运行主类：`com.chainlesschain.project.ProjectServiceApplication`
5. 等待服务启动，看到日志：`Started ProjectServiceApplication in X seconds`

#### 方式二：使用Docker Compose
```bash
cd D:\code\chainlesschain\config\docker
docker-compose up -d project-service
```

#### 方式三：安装Maven后编译运行
```bash
# 下载Maven: https://maven.apache.org/download.cgi
# 配置环境变量后执行：
cd D:\code\chainlesschain\backend\project-service
mvn clean compile
mvn spring-boot:run
```

---

## 测试计划

### 1️⃣ 后端API测试

#### 1.1 健康检查
```bash
# 对话API健康检查
curl http://localhost:9090/api/conversations/health

# 预期响应：
{
  "code": 200,
  "message": "成功",
  "data": {
    "service": "conversation-service",
    "status": "running",
    "timestamp": 1704787200000
  }
}
```

#### 1.2 创建对话
```bash
curl -X POST http://localhost:9090/api/conversations/create \
  -H "Content-Type: application/json" \
  -d '{
    "title": "测试对话",
    "userId": "user_test_001",
    "contextMode": "global"
  }'

# 预期响应：
{
  "code": 200,
  "message": "对话创建成功",
  "data": {
    "id": "conv_xxx",
    "title": "测试对话",
    "userId": "user_test_001",
    "contextMode": "global",
    "messageCount": 0,
    "createdAt": "2026-01-09T15:30:00",
    "updatedAt": "2026-01-09T15:30:00"
  }
}
```

#### 1.3 创建消息
```bash
curl -X POST http://localhost:9090/api/conversations/messages/create \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv_xxx",
    "role": "user",
    "content": "你好，这是一条测试消息",
    "type": "text"
  }'

# 预期响应：
{
  "code": 200,
  "message": "消息创建成功",
  "data": {
    "id": "msg_xxx",
    "conversationId": "conv_xxx",
    "role": "user",
    "content": "你好，这是一条测试消息",
    "type": "text",
    "createdAt": "2026-01-09T15:31:00"
  }
}
```

#### 1.4 查询对话列表
```bash
curl "http://localhost:9090/api/conversations/list?userId=user_test_001&pageNum=1&pageSize=10"

# 预期响应：
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [
      {
        "id": "conv_xxx",
        "title": "测试对话",
        "messageCount": 1,
        ...
      }
    ],
    "total": 1,
    "size": 10,
    "current": 1
  }
}
```

#### 1.5 查询消息列表
```bash
curl "http://localhost:9090/api/conversations/conv_xxx/messages?limit=50"

# 预期响应：
{
  "code": 200,
  "message": "成功",
  "data": [
    {
      "id": "msg_xxx",
      "conversationId": "conv_xxx",
      "role": "user",
      "content": "你好，这是一条测试消息",
      "type": "text",
      "createdAt": "2026-01-09T15:31:00"
    }
  ]
}
```

#### 1.6 Swagger UI测试
访问：http://localhost:9090/swagger-ui.html

可视化测试所有API接口。

---

### 2️⃣ 桌面应用测试

#### 2.1 启动桌面应用
```bash
cd D:\code\chainlesschain\desktop-app-vue
npm run dev
```

#### 2.2 测试对话功能
1. 打开应用后，导航到项目详情页
2. 点击"AI助手"面板
3. 选择上下文模式（项目/文件/全局）
4. 发送测试消息
5. 验证消息是否正确显示
6. 检查对话是否保存到数据库

**验证点**：
- ✅ 对话创建成功
- ✅ 消息发送成功
- ✅ 消息列表正确显示
- ✅ 对话历史可以加载
- ✅ 流式输出正常工作

---

### 3️⃣ 社交功能测试

#### 3.1 朋友圈功能测试

**测试步骤**：
1. 启动桌面应用
2. 导航到社交模块 → 朋友圈
3. 点击"发布动态"按钮
4. 输入内容：`这是一条测试动态 #测试`
5. 上传1-3张测试图片
6. 选择可见范围：公开
7. 点击发布

**验证点**：
- ✅ 发布按钮可点击
- ✅ 图片上传功能正常
- ✅ 可见范围选择器工作
- ✅ 发布后动态出现在列表中
- ✅ 点赞功能正常
- ✅ 评论功能正常
- ✅ 图片预览功能正常

**注意**：由于后端API未实现，前端会显示错误。这是预期行为。

#### 3.2 论坛功能测试

**测试步骤**：
1. 导航到社交模块 → 论坛
2. 点击"发帖"按钮
3. 输入标题：`测试帖子标题`
4. 选择分类：技术交流
5. 输入内容（支持Markdown）：
   ```markdown
   # 这是一个测试帖子

   ## 测试内容
   - 列表项1
   - 列表项2

   **粗体文本** *斜体文本*
   ```
6. 添加标签：`测试`, `功能验证`
7. 点击发布

**验证点**：
- ✅ 发帖表单正常显示
- ✅ Markdown编辑器工作
- ✅ 分类选择器正常
- ✅ 标签输入功能正常
- ✅ 发布后帖子出现在列表中
- ✅ 点击帖子可查看详情
- ✅ Markdown渲染正确
- ✅ 回复功能正常
- ✅ 点赞功能正常

**注意**：由于后端API未实现，前端会显示错误。这是预期行为。

---

### 4️⃣ 协作权限测试

#### 4.1 创建测试知识库
```javascript
// 在桌面应用的开发者工具控制台执行：
await window.electronAPI.db.addKnowledgeItem({
  title: '测试知识库',
  content: '这是一个测试知识库',
  share_scope: 'private',  // private/public/organization
  permissions: JSON.stringify({
    whitelist: ['did:example:user1', 'did:example:user2'],
    blacklist: [],
    users: {
      'did:example:user1': 'edit',
      'did:example:user2': 'view'
    }
  })
})
```

#### 4.2 测试权限检查
```javascript
// 测试私有知识库访问
const hasPermission = await window.electronAPI.collaboration.checkPermission({
  knowledgeId: 'knowledge_xxx',
  userDID: 'did:example:user1',
  permission: 'edit'
})

console.log('权限检查结果:', hasPermission)
// 预期：true（user1有edit权限）

// 测试无权限用户
const hasPermission2 = await window.electronAPI.collaboration.checkPermission({
  knowledgeId: 'knowledge_xxx',
  userDID: 'did:example:user3',
  permission: 'view'
})

console.log('权限检查结果:', hasPermission2)
// 预期：false（user3不在白名单中）
```

**验证点**：
- ✅ 私有知识库只有所有者可访问
- ✅ 白名单用户可以访问
- ✅ 黑名单用户被拒绝
- ✅ 权限级别正确判断（view < comment < edit < admin < owner）
- ✅ 组织级别权限隔离
- ✅ 出错时拒绝访问（安全优先）

---

### 5️⃣ 区块链适配器测试

#### 5.1 配置RPC端点（可选）
```bash
cd D:\code\chainlesschain\desktop-app-vue
cp .env.blockchain.example .env.blockchain

# 编辑 .env.blockchain，填入您的API密钥（可选）
# 如果不填，将使用公共RPC端点
```

#### 5.2 测试区块链连接
```javascript
// 在桌面应用的开发者工具控制台执行：

// 1. 检查区块链适配器状态
const status = await window.electronAPI.blockchain.getStatus()
console.log('区块链状态:', status)

// 2. 获取支持的网络列表
const networks = await window.electronAPI.blockchain.getSupportedNetworks()
console.log('支持的网络:', networks)

// 3. 切换网络（测试网）
await window.electronAPI.blockchain.switchNetwork(11155111) // Sepolia
console.log('已切换到Sepolia测试网')

// 4. 获取当前网络信息
const currentNetwork = await window.electronAPI.blockchain.getCurrentNetwork()
console.log('当前网络:', currentNetwork)
```

**验证点**：
- ✅ 至少有一个网络可用
- ✅ 网络切换功能正常
- ✅ RPC端点自动切换
- ✅ 连接超时保护生效
- ✅ 备用网络初始化成功

---

## 测试结果记录

### 测试环境
- **操作系统**: Windows
- **Node.js版本**: _____
- **Docker版本**: _____
- **数据库**: PostgreSQL 16 (Docker)
- **缓存**: Redis 7 (Docker)

### 测试结果

| 功能模块 | 测试项 | 状态 | 备注 |
|---------|--------|------|------|
| 后端API | 健康检查 | ⬜ 待测试 | |
| 后端API | 创建对话 | ⬜ 待测试 | |
| 后端API | 创建消息 | ⬜ 待测试 | |
| 后端API | 查询对话列表 | ⬜ 待测试 | |
| 后端API | 查询消息列表 | ⬜ 待测试 | |
| 桌面应用 | 对话功能 | ⬜ 待测试 | |
| 桌面应用 | 消息发送 | ⬜ 待测试 | |
| 桌面应用 | 流式输出 | ⬜ 待测试 | |
| 社交功能 | 朋友圈发布 | ⬜ 待测试 | 后端API未实现 |
| 社交功能 | 朋友圈点赞 | ⬜ 待测试 | 后端API未实现 |
| 社交功能 | 朋友圈评论 | ⬜ 待测试 | 后端API未实现 |
| 社交功能 | 论坛发帖 | ⬜ 待测试 | 后端API未实现 |
| 社交功能 | 论坛回复 | ⬜ 待测试 | 后端API未实现 |
| 社交功能 | 论坛点赞 | ⬜ 待测试 | 后端API未实现 |
| 协作权限 | 私有权限 | ⬜ 待测试 | |
| 协作权限 | 白名单 | ⬜ 待测试 | |
| 协作权限 | 黑名单 | ⬜ 待测试 | |
| 协作权限 | 权限级别 | ⬜ 待测试 | |
| 协作权限 | 组织隔离 | ⬜ 待测试 | |
| 区块链 | 网络连接 | ⬜ 待测试 | |
| 区块链 | 网络切换 | ⬜ 待测试 | |
| 区块链 | RPC切换 | ⬜ 待测试 | |

---

## 已知问题

### 1. 社交功能后端API未实现
**影响**: 朋友圈和论坛功能无法正常使用

**解决方案**: 需要实现以下后端API：
- `POST /api/social/posts` - 创建动态/帖子
- `GET /api/social/posts` - 获取动态/帖子列表
- `POST /api/social/posts/{id}/like` - 点赞
- `POST /api/social/posts/{id}/comment` - 评论
- `GET /api/social/posts/{id}/comments` - 获取评论列表

**临时方案**: 前端UI已完成，可以进行UI测试和交互测试

### 2. Maven未安装
**影响**: 无法直接编译运行后端服务

**解决方案**:
- 使用IDE（IntelliJ IDEA）打开项目
- 或使用Docker Compose启动服务
- 或安装Maven后编译

---

## 下一步计划

### 短期（1-2周）
1. ✅ 完成对话API实现
2. ⬜ 实现社交功能后端API
3. ⬜ 完成E2E测试
4. ⬜ 修复发现的bug

### 中期（2-4周）
1. ⬜ 实现WebSocket实时通知
2. ⬜ 添加文件上传服务
3. ⬜ 实现全文搜索
4. ⬜ 添加JWT认证

### 长期（1-3个月）
1. ⬜ 性能优化
2. ⬜ 安全加固
3. ⬜ 监控告警
4. ⬜ 生产部署

---

**测试日期**: 2026-01-09
**测试人员**: _____
**审核人员**: _____
