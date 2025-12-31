# 好友功能测试计划

**功能模块**: 好友列表 UI (Phase 1 - Task 1)
**测试日期**: 2025-12-31
**测试范围**: `pages/social/friends/friends.vue`
**状态**: 🧪 待测试

---

## 📋 目录

1. [测试环境准备](#测试环境准备)
2. [代码检查清单](#代码检查清单)
3. [功能测试清单](#功能测试清单)
4. [测试数据准备](#测试数据准备)
5. [已知问题和限制](#已知问题和限制)
6. [测试报告](#测试报告)

---

## 🛠️ 测试环境准备

### 1. 启动开发环境

#### H5 环境（推荐用于快速测试）
```bash
cd mobile-app-uniapp
npm install  # 如果未安装依赖
npm run dev:h5
```

启动后访问: `http://localhost:5173`

#### 微信小程序环境
```bash
npm run dev:mp-weixin
```

然后在微信开发者工具中导入项目

#### App 环境（真机测试）
```bash
npm run dev:app-android  # Android
npm run dev:app-ios      # iOS
```

### 2. 数据库初始化

好友功能依赖以下服务：
- ✅ `services/database.js` - 数据库服务
- ✅ `services/friends.js` - 好友管理服务
- ✅ `services/did.js` - DID 身份服务

**初始化步骤**:
1. 首次启动应用时会自动初始化数据库
2. 如果没有 DID 身份，需要先创建 DID（`pages/identity/create.vue`）
3. 数据库位置：
   - H5: `localStorage`
   - App: SQLite 文件

### 3. 检查依赖

确保以下依赖已安装：
```json
{
  "dependencies": {
    "@dcloudio/uni-app": "3.0.0-4080420251103001",
    "tweetnacl": "^1.0.3",
    "tweetnacl-util": "^0.15.1",
    "bs58": "^5.0.0",
    "crypto-js": "^4.2.0",
    "vue": "^3.4.21"
  }
}
```

---

## 🔍 代码检查清单

### 静态代码检查

#### 1. 导入语句检查
- [ ] `friendsService` 导入正确
- [ ] `didService` 导入正确
- [ ] 路径是否正确（`@/services/friends` vs `@/services/friends.js`）

#### 2. 方法调用检查
- [ ] `friendsService.init()` - 初始化服务
- [ ] `friendsService.getFriends()` - 获取好友列表
- [ ] `friendsService.getPendingRequests()` - 获取待处理请求
- [ ] `friendsService.acceptFriendRequest(requestId)` - 接受请求
- [ ] `friendsService.rejectFriendRequest(requestId)` - 拒绝请求
- [ ] `friendsService.removeFriend(friendDid)` - 删除好友
- [ ] `friendsService.updateFriendInfo(friendDid, updates)` - 更新备注
- [ ] `friendsService.sendFriendRequest(targetDid, message)` - 发送请求
- [ ] `friendsService.getStatistics()` - 获取统计信息

#### 3. 数据字段检查

**好友对象字段** (来自 `getFriends()`):
```javascript
{
  id: string,
  userDid: string,
  friendDid: string,
  nickname: string,
  notes: string,
  createdAt: string,
  updatedAt: string,
  didDocument: object // DID 文档
}
```

**好友请求字段** (来自 `getPendingRequests()`):
```javascript
{
  id: string,
  fromDid: string,
  toDid: string,
  message: string,
  status: 'pending',
  direction: 'received',
  createdAt: string,
  signature: string
}
```

**检查清单**:
- [ ] 模板中使用 `item.friendDid` 而非 `item.friend_did`
- [ ] 模板中使用 `item.fromDid` 而非 `item.from_did`
- [ ] 模板中使用 `item.createdAt` 而非 `item.created_at`

#### 4. 潜在问题检查

**问题 1**: `friends.js` 中的 DID 格式检查
```javascript
// friends.js:53-54
if (!targetDid || !targetDid.startsWith('did:chainlesschain:')) {
  throw new Error('无效的DID格式')
}
```

但在 `friends.vue:328` 中：
```javascript
if (!this.newFriend.did.startsWith('did:')) {
  throw new Error('DID格式不正确')
}
```

❌ **不一致！** `friends.js` 要求 `did:chainlesschain:`，但 `friends.vue` 只检查 `did:`

**修复方案**: 统一 DID 格式验证

---

**问题 2**: `friendsService.init()` 可能失败

```javascript
async init() {
  try {
    await friendsService.init()
    // ...
  } catch (error) {
    console.error('初始化失败:', error)
    uni.showToast({
      title: '初始化失败',
      icon: 'none'
    })
  }
}
```

如果 DID 不存在会怎样？
- `didService.getCurrentIdentity()` 返回 `null`
- `friendsService.loadFriends()` 中会设置 `this.friends = []`

✅ **已处理**

---

**问题 3**: 数据库表结构

检查 `services/database.js` 中是否有 `friendships` 和 `friend_requests` 表：

```sql
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_did TEXT NOT NULL,
  friend_did TEXT NOT NULL,
  nickname TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  from_did TEXT NOT NULL,
  to_did TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL,  -- pending, accepted, rejected
  direction TEXT NOT NULL, -- sent, received
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  signature TEXT
)
```

需要检查：
- [ ] 表是否存在
- [ ] 字段名是否匹配（蛇形命名 vs 驼峰命名）
- [ ] 索引是否创建

---

## ✅ 功能测试清单

### 测试场景 1: 首次进入页面

**前置条件**:
- 已创建 DID 身份
- 数据库已初始化
- 无好友数据

**测试步骤**:
1. 导航到 `/pages/social/friends/friends`
2. 观察页面加载

**预期结果**:
- [ ] 页面成功加载，无错误
- [ ] 显示"还没有好友"空状态
- [ ] 显示"添加好友"按钮
- [ ] 统计数字显示 "全部好友 (0)"
- [ ] 统计数字显示 "待验证 (0)"

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 2: 添加好友（发送请求）

**前置条件**:
- 已登录并有 DID 身份
- 准备好一个测试 DID 地址

**测试步骤**:
1. 点击右上角 ➕ 按钮
2. 弹出"添加好友"对话框
3. 输入测试 DID: `did:chainlesschain:test001`
4. 输入备注名称: `测试好友`
5. 点击"添加"按钮

**预期结果**:
- [ ] 显示"好友请求已发送"提示
- [ ] 显示"注意：当前仅支持本地添加"提示
- [ ] 对话框关闭
- [ ] 列表自动刷新

**实际结果**:
```
记录测试结果...
```

**可能的错误**:
- ❌ `无效的DID格式` - 如果 DID 不符合 `did:chainlesschain:` 前缀
- ❌ `请先创建DID身份` - 如果当前用户没有 DID
- ❌ 数据库错误 - 如果表不存在

---

### 测试场景 3: 查看已发送的请求

**前置条件**:
- 已发送至少一个好友请求

**测试步骤**:
1. 检查数据库中的 `friend_requests` 表
2. 验证请求是否已保存

**预期结果**:
- [ ] 请求已保存到数据库
- [ ] `status` = `'pending'`
- [ ] `direction` = `'sent'`
- [ ] `signature` 字段不为空

**SQL 查询**:
```sql
SELECT * FROM friend_requests WHERE status = 'pending' AND direction = 'sent';
```

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 4: 模拟接收好友请求

**前置条件**:
- 需要手动在数据库中插入一条"收到的"好友请求

**准备数据** (在浏览器控制台或数据库工具中执行):
```javascript
// 获取当前用户 DID
const identity = await didService.getCurrentIdentity();
const myDid = identity.did;

// 手动创建一个"收到的"好友请求
const request = {
  id: `req_${Date.now()}_test`,
  fromDid: 'did:chainlesschain:sender123',
  toDid: myDid,
  message: '你好，我想添加你为好友',
  status: 'pending',
  direction: 'received',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  signature: 'test_signature_12345'
};

// 保存到数据库
await database.saveFriendRequest(request);
```

**测试步骤**:
1. 刷新好友列表页面
2. 切换到"待验证"标签
3. 应该看到一条待处理的请求

**预期结果**:
- [ ] "待验证"标签显示 (1)
- [ ] 列表中显示请求卡片
- [ ] 显示发送者 DID（截断）
- [ ] 显示消息内容
- [ ] 显示时间

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 5: 接受好友请求

**前置条件**:
- 有至少一条待处理的"收到的"请求

**测试步骤**:
1. 切换到"待验证"标签
2. 点击好友请求卡片
3. 弹出确认对话框
4. 点击"接受"按钮

**预期结果**:
- [ ] 显示"已添加好友"提示
- [ ] 自动切换到"全部好友"标签
- [ ] 新好友出现在列表中
- [ ] "全部好友"计数 +1
- [ ] "待验证"计数 -1
- [ ] 请求状态从 `pending` 变为 `accepted`

**实际结果**:
```
记录测试结果...
```

**可能的错误**:
- ❌ `请求签名验证失败` - 如果签名无效
- ❌ `该请求已处理` - 如果重复操作

---

### 测试场景 6: 拒绝好友请求

**前置条件**:
- 有至少一条待处理的"收到的"请求

**测试步骤**:
1. 切换到"待验证"标签
2. 点击好友请求卡片
3. 弹出确认对话框
4. 点击"拒绝"按钮

**预期结果**:
- [ ] 显示"已拒绝"提示
- [ ] 请求从列表中消失
- [ ] "待验证"计数 -1
- [ ] 请求状态从 `pending` 变为 `rejected`

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 7: 查看好友列表

**前置条件**:
- 已接受至少一个好友请求

**测试步骤**:
1. 切换到"全部好友"标签
2. 查看好友列表

**预期结果**:
- [ ] 显示所有已添加的好友
- [ ] 每个好友显示：
  - [ ] 头像（👤 图标）
  - [ ] 昵称或 DID（截断）
  - [ ] 完整 DID（截断显示）
  - [ ] 备注（如有）
  - [ ] "已添加"状态标签
  - [ ] 添加时间
  - [ ] ⋯ 更多菜单按钮

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 8: 编辑好友备注

**前置条件**:
- 好友列表中至少有一个好友

**测试步骤**:
1. 点击好友卡片右侧的 ⋯ 按钮
2. 选择"编辑备注"
3. 弹出输入对话框
4. 输入新备注: `我的好友`
5. 点击"确定"

**预期结果**:
- [ ] 显示"修改成功"提示
- [ ] 好友昵称更新为新备注
- [ ] 列表自动刷新
- [ ] 数据库中 `nickname` 字段已更新

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 9: 删除好友

**前置条件**:
- 好友列表中至少有一个好友

**测试步骤**:
1. 点击好友卡片右侧的 ⋯ 按钮
2. 选择"删除好友"
3. 弹出确认对话框（红色按钮）
4. 点击"确定"

**预期结果**:
- [ ] 显示"已删除"提示
- [ ] 好友从列表中消失
- [ ] "全部好友"计数 -1
- [ ] 数据库中好友关系已删除

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 10: 搜索好友

**前置条件**:
- 好友列表中至少有 3 个好友

**测试步骤**:
1. 在顶部搜索框输入好友昵称的一部分
2. 观察列表变化

**预期结果**:
- [ ] 列表实时过滤
- [ ] 只显示匹配的好友
- [ ] 搜索 DID 也能工作
- [ ] 搜索备注也能工作
- [ ] 清空搜索框恢复完整列表

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 11: 点击好友跳转聊天

**前置条件**:
- 好友列表中至少有一个好友

**测试步骤**:
1. 在"全部好友"标签下
2. 点击好友卡片

**预期结果**:
- [ ] 跳转到聊天页面
- [ ] URL 包含 `friendDid` 和 `nickname` 参数
- [ ] 聊天页面正常加载（如果已实现）

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 12: 下拉刷新

**前置条件**:
- 在好友列表页面

**测试步骤**:
1. 在列表顶部下拉
2. 触发刷新

**预期结果**:
- [ ] 显示加载指示器
- [ ] 列表重新加载
- [ ] 统计数字更新
- [ ] 加载完成后停止刷新动画

**实际结果**:
```
记录测试结果...
```

---

### 测试场景 13: 边界情况测试

#### 13.1 空 DID 输入
**步骤**: 点击添加好友，DID 输入框留空，点击添加
**预期**: ❌ 提示"请输入好友 DID"

#### 13.2 无效 DID 格式
**步骤**: 输入 `invalid_did_123`，点击添加
**预期**: ❌ 提示"DID格式不正确"

#### 13.3 添加自己为好友
**步骤**: 输入自己的 DID，点击添加
**预期**: ❌ 提示"不能添加自己为好友"

#### 13.4 重复添加好友
**步骤**: 尝试添加已存在的好友
**预期**: ❌ 提示"该用户已是您的好友"

#### 13.5 重复发送请求
**步骤**: 向同一个 DID 发送两次请求
**预期**: ❌ 提示"已发送过好友请求"

---

## 📦 测试数据准备

### 方法 1: 使用浏览器控制台

打开 H5 应用，按 F12 打开控制台，执行以下脚本：

```javascript
// 1. 获取当前用户信息
import didService from '@/services/did';
import friendsService from '@/services/friends';

const identity = await didService.getCurrentIdentity();
console.log('当前用户 DID:', identity.did);

// 2. 创建测试好友请求（收到的）
const testRequest = {
  id: `req_${Date.now()}_001`,
  fromDid: 'did:chainlesschain:alice',
  toDid: identity.did,
  message: '我是 Alice，想和你成为好友！',
  status: 'pending',
  direction: 'received',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  signature: 'test_signature_alice'
};

// 保存到数据库
import database from '@/services/database';
await database.saveFriendRequest(testRequest);

console.log('测试请求已创建:', testRequest.id);

// 3. 创建另一个测试请求
const testRequest2 = {
  id: `req_${Date.now()}_002`,
  fromDid: 'did:chainlesschain:bob',
  toDid: identity.did,
  message: '你好，我是 Bob',
  status: 'pending',
  direction: 'received',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  signature: 'test_signature_bob'
};

await database.saveFriendRequest(testRequest2);
console.log('测试请求2已创建:', testRequest2.id);

// 4. 刷新页面查看效果
```

### 方法 2: 创建测试脚本

创建文件 `mobile-app-uniapp/test-data/create-friend-requests.js`:

```javascript
/**
 * 创建测试好友请求数据
 * 使用方法：在浏览器控制台中运行此脚本
 */

async function createTestData() {
  const { default: didService } = await import('@/services/did');
  const { default: database } = await import('@/services/database');

  // 获取当前用户
  const identity = await didService.getCurrentIdentity();
  if (!identity) {
    console.error('请先创建 DID 身份');
    return;
  }

  const myDid = identity.did;
  console.log('当前用户:', myDid);

  // 测试好友列表
  const testFriends = [
    {
      did: 'did:chainlesschain:alice',
      nickname: 'Alice',
      message: '我是 Alice，想和你成为好友！'
    },
    {
      did: 'did:chainlesschain:bob',
      nickname: 'Bob',
      message: '你好，我是 Bob'
    },
    {
      did: 'did:chainlesschain:charlie',
      nickname: 'Charlie',
      message: '大家好，我是 Charlie'
    }
  ];

  // 创建好友请求
  for (const friend of testFriends) {
    const request = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      fromDid: friend.did,
      toDid: myDid,
      message: friend.message,
      status: 'pending',
      direction: 'received',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      signature: `test_signature_${friend.nickname.toLowerCase()}`
    };

    await database.saveFriendRequest(request);
    console.log(`✅ 已创建来自 ${friend.nickname} 的好友请求`);

    // 避免 ID 冲突
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  console.log('✅ 所有测试数据创建完成！');
  console.log('刷新页面查看效果');
}

// 执行
createTestData().catch(console.error);
```

---

## ⚠️ 已知问题和限制

### 1. DID 格式不一致 ❌

**问题描述**:
- `friends.js` 要求 DID 格式: `did:chainlesschain:`
- `friends.vue` 只检查: `did:`
- `didService` 生成的 DID 格式: `did:chainlesschain:` 或 `did:key:`

**影响**: 可能导致添加好友失败

**临时解决方案**: 手动修改验证逻辑一致

**永久解决方案**:
```javascript
// 在 friends.vue 中统一验证
if (!this.newFriend.did.startsWith('did:chainlesschain:')) {
  throw new Error('DID格式不正确，必须是 did:chainlesschain: 开头')
}
```

### 2. P2P 网络未实现 ⚠️

**问题描述**:
- 好友请求只保存在本地
- 对方无法收到请求
- 无法实现真正的好友添加流程

**影响**: 当前仅能模拟好友功能

**提示信息**: 已添加"注意：当前仅支持本地添加"提示

**解决方案**: 等待 P2P 网络实现（Phase 3-4）

### 3. 签名验证可能失败 ⚠️

**问题描述**:
```javascript
// friends.js:130-139
const isValid = await didService.verifySignature(
  signatureData,
  request.signature,
  request.fromDid
)

if (!isValid) {
  throw new Error('请求签名验证失败')
}
```

如果测试数据中的 `signature` 是假的，验证会失败。

**临时解决方案**: 在测试时注释掉签名验证

**永久解决方案**: 使用真实的签名

### 4. 数据库表结构可能不匹配 ❌

**检查方法**:
```javascript
// 在控制台中执行
import database from '@/services/database';

// 检查表是否存在
const tables = await database.getTables();
console.log('数据库表:', tables);

// 检查 friendships 表结构
const friendships = await database.executeSql('PRAGMA table_info(friendships)');
console.log('friendships 表结构:', friendships);

// 检查 friend_requests 表结构
const requests = await database.executeSql('PRAGMA table_info(friend_requests)');
console.log('friend_requests 表结构:', requests);
```

### 5. 字段命名不一致 ❌

数据库可能使用蛇形命名 (`friend_did`)，但代码使用驼峰命名 (`friendDid`)。

**检查位置**:
- `services/database.js` 中的 SQL 查询
- `services/friends.js` 中的数据返回格式
- `pages/social/friends/friends.vue` 中的数据使用

---

## 📊 测试报告

### 测试执行记录

| 测试场景 | 状态 | 说明 | 截图 |
|---------|------|------|------|
| 1. 首次进入页面 | ⏸️ 待测试 | | |
| 2. 添加好友 | ⏸️ 待测试 | | |
| 3. 查看已发送请求 | ⏸️ 待测试 | | |
| 4. 模拟接收请求 | ⏸️ 待测试 | | |
| 5. 接受好友请求 | ⏸️ 待测试 | | |
| 6. 拒绝好友请求 | ⏸️ 待测试 | | |
| 7. 查看好友列表 | ⏸️ 待测试 | | |
| 8. 编辑好友备注 | ⏸️ 待测试 | | |
| 9. 删除好友 | ⏸️ 待测试 | | |
| 10. 搜索好友 | ⏸️ 待测试 | | |
| 11. 点击跳转聊天 | ⏸️ 待测试 | | |
| 12. 下拉刷新 | ⏸️ 待测试 | | |
| 13. 边界情况 | ⏸️ 待测试 | | |

### 发现的 Bug

#### Bug #1: [标题]
- **严重程度**: 🔴 高 / 🟡 中 / 🟢 低
- **复现步骤**:
- **预期行为**:
- **实际行为**:
- **截图**:
- **修复方案**:
- **状态**: 待修复 / 已修复

### 性能测试

- **页面加载时间**: ___ ms
- **好友列表渲染时间** (100 条数据): ___ ms
- **搜索响应时间**: ___ ms
- **内存占用**: ___ MB

### 兼容性测试

| 平台 | 版本 | 状态 | 备注 |
|------|------|------|------|
| Chrome (H5) | 120+ | ⏸️ 待测试 | |
| Firefox (H5) | 120+ | ⏸️ 待测试 | |
| 微信小程序 | 最新 | ⏸️ 待测试 | |
| Android App | 7.0+ | ⏸️ 待测试 | |
| iOS App | 12+ | ⏸️ 待测试 | |

### 用户体验评分

- **易用性**: ___ / 5
- **响应速度**: ___ / 5
- **视觉设计**: ___ / 5
- **错误提示**: ___ / 5
- **总体满意度**: ___ / 5

---

## 🔧 待修复问题清单

### 紧急 (P0)
- [ ] 修复 DID 格式验证不一致问题
- [ ] 检查数据库表结构
- [ ] 验证字段命名一致性

### 重要 (P1)
- [ ] 处理签名验证逻辑（测试模式）
- [ ] 优化错误提示信息
- [ ] 添加加载状态指示器

### 一般 (P2)
- [ ] 优化搜索性能
- [ ] 添加动画效果
- [ ] 改进空状态 UI

### 未来优化 (P3)
- [ ] 添加头像上传功能
- [ ] 支持好友分组
- [ ] 批量管理好友

---

## 📝 测试结论

### 总结
测试完成后填写...

### 建议
- 建议 1: ...
- 建议 2: ...
- 建议 3: ...

### 下一步行动
- [ ] 修复发现的 Bug
- [ ] 优化用户体验
- [ ] 继续下一个任务 (Task 2: 添加好友页面)

---

**测试人员**: _________
**测试日期**: 2025-12-31
**测试时长**: _____ 小时
**最后更新**: 2025-12-31

---

🤖 **Generated with [Claude Code](https://claude.com/claude-code)**

**Co-Authored-By**: Claude Sonnet 4.5 <noreply@anthropic.com>
