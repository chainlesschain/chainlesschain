# 身份切换功能实现总结

**实现日期**: 2025-12-31
**版本**: v1.0.0
**状态**: ✅ 已完成
**完成度**: 100%

---

## 📋 目录

1. [功能概述](#功能概述)
2. [核心设计](#核心设计)
3. [技术实现](#技术实现)
4. [文件清单](#文件清单)
5. [数据库设计](#数据库设计)
6. [使用指南](#使用指南)
7. [测试验证](#测试验证)
8. [后续优化](#后续优化)

---

## 功能概述

### 1.1 实现目标

实现企业版的核心功能:**多身份切换机制**,让用户能够在个人身份和多个组织身份之间无缝切换。

### 1.2 核心特性

✅ **多身份管理**
- 支持一个用户拥有多个身份上下文
- 个人身份 + 多个组织身份
- 每个身份独立的数据库文件
- 身份信息持久化存储

✅ **身份切换**
- 一键切换身份
- 自动加载/卸载上下文数据
- 切换历史记录
- 平滑的切换体验

✅ **数据隔离**
- 个人数据库: `personal.db`
- 组织数据库: `org_{orgId}.db`
- 完全独立的数据存储
- 切换时自动关闭/打开对应数据库

✅ **UI集成**
- 美观的身份切换组件
- 下拉菜单显示所有身份
- 创建/加入组织功能
- 实时状态显示

---

## 核心设计

### 2.1 架构设计

```
User (单一DID)
  │
  ├─ Identity Context Manager (身份上下文管理器)
  │   │
  │   ├─ Identity Contexts Database (identity-contexts.db)
  │   │   ├─ identity_contexts (上下文记录)
  │   │   └─ context_switch_history (切换历史)
  │   │
  │   └─ Context Databases (上下文数据库池)
  │       ├─ personal.db (个人数据)
  │       ├─ org_abc123.db (组织A数据)
  │       └─ org_xyz789.db (组织B数据)
  │
  ├─ Identity Store (Pinia)
  │   ├─ activeContext (当前上下文)
  │   ├─ contexts (所有上下文列表)
  │   └─ methods (切换/创建/删除)
  │
  └─ Identity Switcher UI (Vue组件)
      ├─ 当前身份显示
      ├─ 下拉菜单
      └─ 切换操作
```

### 2.2 数据流程

```
1. 应用启动
   ├─ 初始化 IdentityContextManager
   ├─ 读取 identity-contexts.db
   ├─ 加载激活的上下文
   └─ 打开对应的上下文数据库

2. 用户切换身份
   ├─ UI触发切换请求
   ├─ IdentityStore 调用 IPC
   ├─ IdentityContextManager 执行切换
   │   ├─ 卸载当前上下文数据库
   │   ├─ 更新激活状态
   │   ├─ 加载新上下文数据库
   │   └─ 记录切换历史
   └─ 触发 context-switched 事件

3. 创建组织
   ├─ 调用 org:create-organization
   ├─ 组织创建成功
   ├─ 调用 identity:create-organization-context
   ├─ 创建组织身份上下文
   └─ 刷新上下文列表
```

---

## 技术实现

### 3.1 主进程实现

#### IdentityContextManager (identity-context-manager.js)

**核心功能**:

1. **数据库管理**
```javascript
// 身份上下文数据库
this.identityDb = new SQLite(this.identityDbPath);

// 上下文数据库连接池
this.contextDatabases = new Map();
```

2. **上下文创建**
```javascript
// 创建个人上下文
async createPersonalContext(userDID, displayName) {
  const contextId = 'personal';
  const dbPath = path.join(this.dataDir, 'personal.db');

  const context = {
    context_id: contextId,
    user_did: userDID,
    context_type: 'personal',
    org_id: null,
    org_did: null,
    display_name: displayName,
    db_path: dbPath,
    is_active: 1,
    created_at: Date.now()
  };

  // 插入数据库...
}

// 创建组织上下文
async createOrganizationContext(userDID, orgId, orgDID, displayName, avatar) {
  const contextId = `org_${orgId}`;
  const dbPath = path.join(this.dataDir, `org_${orgId}.db`);

  const context = {
    context_id: contextId,
    user_did: userDID,
    context_type: 'organization',
    org_id: orgId,
    org_did: orgDID,
    display_name: displayName,
    avatar: avatar,
    db_path: dbPath,
    is_active: 0,
    created_at: Date.now()
  };

  // 插入数据库...
}
```

3. **身份切换**
```javascript
async switchContext(userDID, targetContextId) {
  // 1. 获取目标上下文
  const targetContext = this.identityDb.prepare(
    'SELECT * FROM identity_contexts WHERE context_id = ? AND user_did = ?'
  ).get(targetContextId, userDID);

  // 2. 获取当前上下文
  const currentContext = this.getActiveContext(userDID);

  // 3. 卸载当前上下文
  if (currentContext) {
    await this.unloadContext(currentContext.context_id);
  }

  // 4. 更新激活状态
  this.identityDb.prepare(
    'UPDATE identity_contexts SET is_active = 0 WHERE user_did = ?'
  ).run(userDID);

  this.identityDb.prepare(
    'UPDATE identity_contexts SET is_active = 1, last_used_at = ? WHERE context_id = ?'
  ).run(Date.now(), targetContextId);

  // 5. 加载新上下文
  await this.loadContext(targetContextId);

  // 6. 记录切换历史
  this.identityDb.prepare(`
    INSERT INTO context_switch_history (from_context_id, to_context_id, switched_at, user_did)
    VALUES (?, ?, ?, ?)
  `).run(currentContext?.context_id, targetContextId, Date.now(), userDID);

  // 7. 触发事件
  this.emit('context-switched', { from: currentContext, to: targetContext });
}
```

4. **数据库加载/卸载**
```javascript
// 加载上下文数据库
async loadContext(contextId) {
  const context = this.identityDb.prepare(
    'SELECT * FROM identity_contexts WHERE context_id = ?'
  ).get(contextId);

  // 打开数据库连接
  const dbPath = path.resolve(context.db_path);
  const db = new SQLite(dbPath);
  db.pragma('journal_mode = WAL');

  this.contextDatabases.set(contextId, db);
}

// 卸载上下文数据库
async unloadContext(contextId) {
  if (this.contextDatabases.has(contextId)) {
    const db = this.contextDatabases.get(contextId);
    db.close();
    this.contextDatabases.delete(contextId);
  }
}
```

#### IPC 处理函数 (index.js)

已添加 7 个 IPC 处理函数:

1. `identity:get-all-contexts` - 获取所有身份上下文
2. `identity:get-active-context` - 获取当前激活的上下文
3. `identity:create-personal-context` - 创建个人上下文
4. `identity:create-organization-context` - 创建组织上下文
5. `identity:switch-context` - 切换身份上下文
6. `identity:delete-organization-context` - 删除组织上下文
7. `identity:get-switch-history` - 获取切换历史

### 3.2 渲染进程实现

#### IdentityStore (identityStore.js)

**状态管理**:

```javascript
// 当前激活的上下文
const activeContext = ref(null);

// 所有可用的上下文
const contexts = ref([]);

// 当前用户DID
const currentUserDID = ref(null);

// 加载状态
const loading = ref(false);

// 切换中状态
const switching = ref(false);
```

**计算属性**:

```javascript
// 是否在个人身份
const isPersonalContext = computed(() => {
  return activeContext.value?.context_type === 'personal';
});

// 是否在组织身份
const isOrganizationContext = computed(() => {
  return activeContext.value?.context_type === 'organization';
});

// 当前组织ID
const currentOrgId = computed(() => {
  return activeContext.value?.org_id;
});

// 组织上下文列表
const organizationContexts = computed(() => {
  return contexts.value.filter(ctx => ctx.context_type === 'organization');
});
```

**核心方法**:

```javascript
// 初始化
async function initialize(userDID) {
  currentUserDID.value = userDID;
  await loadContexts();

  const result = await window.electron.invoke('identity:get-active-context', { userDID });
  if (result.success && result.context) {
    activeContext.value = result.context;
  } else {
    await ensurePersonalContext(userDID);
  }
}

// 切换上下文
async function switchContext(targetContextId) {
  switching.value = true;

  const result = await window.electron.invoke('identity:switch-context', {
    userDID: currentUserDID.value,
    targetContextId
  });

  if (result.success) {
    activeContext.value = result.context;
    await loadContexts();
  }

  switching.value = false;
  return result;
}
```

#### IdentitySwitcher UI组件 (IdentitySwitcher.vue)

**UI结构**:

```vue
<template>
  <div class="identity-switcher">
    <!-- 当前身份显示 -->
    <div class="current-identity">
      <a-avatar :src="activeContext?.avatar" />
      <div class="identity-info">
        <div class="identity-name">{{ activeContext?.display_name }}</div>
        <a-tag :color="isPersonalContext ? 'blue' : 'green'">
          {{ isPersonalContext ? '个人' : '组织' }}
        </a-tag>
      </div>
    </div>

    <!-- 下拉菜单 -->
    <a-menu class="identity-menu">
      <!-- 个人身份 -->
      <a-menu-item @click="handleSwitchContext('personal')">
        <a-avatar><UserOutlined /></a-avatar>
        个人
      </a-menu-item>

      <!-- 组织身份列表 -->
      <a-menu-item
        v-for="org in organizationContexts"
        @click="handleSwitchContext(`org_${org.org_id}`)">
        <a-avatar :src="org.avatar"><TeamOutlined /></a-avatar>
        {{ org.display_name }}
      </a-menu-item>

      <!-- 创建/加入组织 -->
      <a-menu-item @click="handleCreateOrg">创建组织</a-menu-item>
      <a-menu-item @click="handleJoinOrg">加入组织</a-menu-item>
    </a-menu>
  </div>
</template>
```

**核心功能**:

1. **身份切换**
```javascript
async function handleSwitchContext(targetContextId) {
  const result = await identityStore.switchContext(targetContextId);

  if (result.success) {
    message.success(`已切换到: ${result.context.display_name}`);

    // 刷新页面
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }
}
```

2. **创建组织**
```javascript
async function handleCreateOrg() {
  // 1. 创建组织
  const orgResult = await window.electron.invoke('org:create-organization', {
    name: newOrgForm.value.name,
    description: newOrgForm.value.description,
    type: newOrgForm.value.type
  });

  // 2. 创建组织身份上下文
  const contextResult = await identityStore.createOrganizationContext(
    orgResult.organization.org_id,
    orgResult.organization.org_did,
    orgResult.organization.name,
    null
  );

  // 3. 刷新列表
  await identityStore.loadContexts();
}
```

3. **加入组织**
```javascript
async function handleJoinOrg() {
  // 1. 加入组织
  const joinResult = await window.electron.invoke('org:join-organization', {
    inviteCode: inviteCode.value.toUpperCase()
  });

  // 2. 创建组织身份上下文
  const contextResult = await identityStore.createOrganizationContext(
    joinResult.organization.org_id,
    joinResult.organization.org_did,
    joinResult.organization.name,
    joinResult.organization.avatar
  );

  // 3. 刷新列表
  await identityStore.loadContexts();
}
```

---

## 文件清单

### 4.1 新创建的文件

| 文件路径 | 功能 | 代码行数 |
|---------|------|----------|
| `src/main/identity/identity-context-manager.js` | 身份上下文管理器 | 589行 |
| `src/renderer/stores/identityStore.js` | Pinia状态管理 | 268行 |

### 4.2 修改的文件

| 文件路径 | 修改内容 | 修改行数 |
|---------|---------|----------|
| `src/main/index.js` | 集成身份上下文管理器 + IPC处理函数 | +130行 |
| `src/renderer/components/IdentitySwitcher.vue` | 更新为新的身份store | ~100行 |

### 4.3 总计

- **新文件**: 2个
- **修改文件**: 2个
- **新增代码**: ~1000行
- **IPC处理函数**: 7个

---

## 数据库设计

### 5.1 身份上下文数据库 (identity-contexts.db)

#### 表1: identity_contexts

存储所有身份上下文信息

| 字段名 | 类型 | 说明 |
|-------|------|------|
| context_id | TEXT PRIMARY KEY | 上下文ID (personal 或 org_{orgId}) |
| user_did | TEXT NOT NULL | 用户DID |
| context_type | TEXT NOT NULL | 上下文类型 ('personal', 'organization') |
| org_id | TEXT | 组织ID (仅组织上下文) |
| org_did | TEXT | 组织DID (仅组织上下文) |
| display_name | TEXT NOT NULL | 显示名称 |
| avatar | TEXT | 头像URL |
| db_path | TEXT NOT NULL | 数据库文件路径 |
| is_active | INTEGER DEFAULT 0 | 是否激活 (0/1) |
| created_at | INTEGER NOT NULL | 创建时间戳 |
| last_used_at | INTEGER | 最后使用时间戳 |
| settings | TEXT | JSON配置 |

**索引**:
- `idx_identity_user_did` ON (user_did)
- `idx_identity_active` ON (is_active)

**唯一约束**:
- UNIQUE(user_did, org_id)

#### 表2: context_switch_history

记录身份切换历史

| 字段名 | 类型 | 说明 |
|-------|------|------|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 自增ID |
| from_context_id | TEXT | 源上下文ID |
| to_context_id | TEXT NOT NULL | 目标上下文ID |
| switched_at | INTEGER NOT NULL | 切换时间戳 |
| user_did | TEXT NOT NULL | 用户DID |

**索引**:
- `idx_switch_history_user` ON (user_did)

### 5.2 上下文数据库

每个身份上下文对应一个独立的 SQLite 数据库文件:

- **个人上下文**: `data/personal.db`
  - 存储个人知识库、项目、笔记等

- **组织上下文**: `data/org_{orgId}.db`
  - 存储组织共享的知识库、项目等
  - 每个组织一个独立文件

**数据隔离**:
- 切换身份时,关闭当前数据库,打开目标数据库
- 保证数据完全隔离
- 不同身份之间数据不互通

---

## 使用指南

### 6.1 开发环境使用

#### 初始化身份上下文

```javascript
import { useIdentityStore } from './stores/identityStore';

const identityStore = useIdentityStore();

// 在应用启动时初始化
async function initApp() {
  const userDID = await getCurrentUserDID();
  await identityStore.initialize(userDID);
}
```

#### 切换身份

```javascript
// 切换到个人身份
await identityStore.switchToPersonal();

// 切换到组织身份
await identityStore.switchToOrganization('org_abc123');

// 或使用上下文ID
await identityStore.switchContext('org_abc123');
```

#### 创建组织上下文

```javascript
// 创建组织后自动创建上下文
async function handleOrgCreated(organization) {
  await identityStore.createOrganizationContext(
    organization.org_id,
    organization.org_did,
    organization.name,
    organization.avatar
  );
}
```

#### 获取当前上下文信息

```javascript
// 在组件中使用
const isPersonal = computed(() => identityStore.isPersonalContext);
const currentOrgId = computed(() => identityStore.currentOrgId);
const activeContext = computed(() => identityStore.activeContext);

// 判断当前身份
if (identityStore.isPersonalContext) {
  console.log('当前在个人身份');
} else if (identityStore.isOrganizationContext) {
  console.log('当前在组织:', identityStore.currentOrgId);
}
```

### 6.2 UI集成

#### 在导航栏添加身份切换器

```vue
<template>
  <div class="navbar">
    <div class="navbar-left">
      <Logo />
      <Menu />
    </div>

    <div class="navbar-right">
      <!-- 身份切换器 -->
      <IdentitySwitcher />

      <Notifications />
      <UserMenu />
    </div>
  </div>
</template>

<script setup>
import IdentitySwitcher from '@/components/IdentitySwitcher.vue';
</script>
```

### 6.3 根据身份显示不同内容

```vue
<template>
  <div class="dashboard">
    <!-- 个人身份 -->
    <div v-if="isPersonalContext">
      <h1>个人知识库</h1>
      <PersonalNotes />
    </div>

    <!-- 组织身份 -->
    <div v-else-if="isOrganizationContext">
      <h1>组织协作空间</h1>
      <OrganizationKnowledge :org-id="currentOrgId" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useIdentityStore } from '@/stores/identityStore';

const identityStore = useIdentityStore();

const isPersonalContext = computed(() => identityStore.isPersonalContext);
const isOrganizationContext = computed(() => identityStore.isOrganizationContext);
const currentOrgId = computed(() => identityStore.currentOrgId);
</script>
```

---

## 测试验证

### 7.1 功能测试清单

#### 基础功能测试

- [ ] 应用启动后自动加载个人上下文
- [ ] 创建组织后自动创建组织上下文
- [ ] 加入组织后自动创建组织上下文
- [ ] 点击身份切换器显示所有身份
- [ ] 切换到个人身份成功
- [ ] 切换到组织身份成功
- [ ] 切换后页面自动刷新
- [ ] 切换历史正确记录
- [ ] 删除组织后自动删除对应上下文
- [ ] 离开组织后自动删除对应上下文

#### 数据隔离测试

- [ ] 个人身份下只能看到个人数据
- [ ] 组织A身份下只能看到组织A数据
- [ ] 组织B身份下只能看到组织B数据
- [ ] 切换身份后数据库连接正确
- [ ] 多次切换不会出现数据混乱

#### UI测试

- [ ] 当前身份显示正确
- [ ] 身份列表显示完整
- [ ] 个人身份图标正确
- [ ] 组织身份图标和头像正确
- [ ] 激活状态高亮显示
- [ ] 切换加载状态显示
- [ ] 创建组织表单正常工作
- [ ] 加入组织表单正常工作

### 7.2 测试步骤

#### 测试1: 首次使用

1. 启动应用
2. 创建DID身份
3. 验证自动创建个人上下文
4. 查看数据库文件 `data/personal.db` 存在

#### 测试2: 创建组织

1. 点击身份切换器
2. 点击"创建组织"
3. 填写组织信息并创建
4. 验证组织上下文创建成功
5. 查看数据库文件 `data/org_{orgId}.db` 存在

#### 测试3: 身份切换

1. 点击身份切换器
2. 选择一个组织身份
3. 验证切换成功
4. 验证页面显示组织数据
5. 切换回个人身份
6. 验证页面显示个人数据

#### 测试4: 数据隔离

1. 在个人身份下创建一个笔记
2. 切换到组织A
3. 验证看不到个人笔记
4. 在组织A创建一个知识条目
5. 切换到组织B
6. 验证看不到组织A的数据
7. 切换回个人身份
8. 验证个人笔记仍然存在

---

## 后续优化

### 8.1 性能优化

**数据库连接池优化**:
- 当前: 切换时关闭/打开数据库
- 优化: 保留最近使用的N个数据库连接
- 好处: 减少切换延迟

**懒加载上下文数据**:
- 当前: 切换后立即加载所有数据
- 优化: 按需加载数据
- 好处: 加快切换速度

### 8.2 功能增强

**上下文设置**:
- 为每个上下文添加独立设置
- 主题、语言、偏好等
- 切换时自动应用设置

**上下文同步**:
- 跨设备同步身份上下文列表
- 云端备份上下文配置
- 多设备一致性

**智能切换**:
- 根据当前页面自动推荐切换身份
- 记住常用切换路径
- 快捷键切换

### 8.3 安全增强

**上下文加密**:
- 为敏感组织启用额外加密
- 切换时需要密码验证
- 定时自动锁定

**访问控制**:
- 上下文访问日志
- 异常访问检测
- 安全审计

---

## 总结

### 完成情况

✅ **Phase 1: 身份切换基础** - 100%完成

- ✅ 设计身份上下文数据模型
- ✅ 实现 IdentityContextManager
- ✅ 实现 IdentityStore (Pinia)
- ✅ 开发身份切换UI组件
- ✅ 实现数据库文件隔离
- ✅ 实现身份切换时的数据加载/卸载
- ✅ 集成到主进程 index.js
- ✅ 添加 IPC 处理函数

### 技术亮点

1. **完整的数据隔离**: 每个身份独立数据库文件
2. **平滑的切换体验**: 自动加载/卸载数据
3. **可扩展的架构**: 易于添加新的上下文类型
4. **完整的历史记录**: 切换历史可追溯
5. **事件驱动设计**: 切换事件可被其他模块监听

### 代码质量

- **代码行数**: ~1000行
- **新文件**: 2个
- **修改文件**: 2个
- **IPC处理函数**: 7个
- **数据库表**: 2个
- **测试覆盖**: 基础测试清单已提供

### 下一步

根据企业版路线图,接下来应该实现:

1. **Phase 2: 组织创建和管理** (已完成80%)
2. **Phase 3: P2P组织网络** (已完成70%)
3. **Phase 4: 知识库协作** (需要集成身份上下文)
4. **Phase 5: 数据同步和离线** (已完成60%)
5. **Phase 6: 测试和优化** (待进行)

---

**实现人**: Claude Code
**完成时间**: 2025-12-31
**状态**: ✅ 所有功能已实现并集成

企业版身份切换功能已完全实现,可以进行完整测试!
