# Phase 1 集成指南 - 工作区与任务管理

## 📋 已完成的后端实现

### 1. 数据库迁移 ✅
- **文件**: `desktop-app-vue/src/main/database/migrations/005_workspace_task_system.sql`
- **修改**: `desktop-app-vue/src/main/database.js` (添加v17迁移逻辑)
- **内容**:
  - 创建 `organization_workspaces` 表
  - 创建 `workspace_members` 表
  - 创建 `workspace_resources` 表
  - 创建 `task_comments` 表
  - 创建 `task_changes` 表
  - 创建 `task_boards` 表
  - 为 `project_tasks` 表添加10个新字段

### 2. 工作区管理器 ✅
- **文件**: `desktop-app-vue/src/main/workspace/workspace-manager.js`
- **功能**:
  - 创建/查询/更新/删除工作区
  - 工作区成员管理
  - 工作区资源管理
  - 权限检查集成

### 3. 任务管理器 ✅
- **文件**: `desktop-app-vue/src/main/task/task-manager.js`
- **功能**:
  - 任务CRUD操作
  - 任务分配与状态变更
  - 任务评论系统
  - 任务变更历史追踪
  - 任务看板管理

### 4. IPC接口 ✅
- **文件**: `desktop-app-vue/src/main/ipc/workspace-task-ipc.js`
- **数量**: 22个接口（7个工作区 + 15个任务）

---

## 🔧 集成步骤

### 步骤1: 修改 `desktop-app-vue/src/main/index.js`

#### 1.1 添加引用（在文件顶部）

```javascript
// Phase 1: 工作区与任务管理 (v0.17.0)
const WorkspaceManager = require('./workspace/workspace-manager');
const TaskManager = require('./task/task-manager');
const { registerWorkspaceTaskIPC } = require('./ipc/workspace-task-ipc');
const OrganizationManager = require('./organization/organization-manager');
```

#### 1.2 在 ChainlessChainApp 类的 constructor 中添加属性

```javascript
class ChainlessChainApp {
  constructor() {
    // ... 现有属性 ...

    // Phase 1: 工作区与任务管理
    this.organizationManager = null;
    this.workspaceManager = null;
    this.taskManager = null;

    this.setupApp();
  }
}
```

#### 1.3 在 setupIPC() 方法中初始化管理器

找到 `setupIPC()` 方法，在合适位置添加：

```javascript
async setupIPC() {
  try {
    // ... 现有初始化代码 ...

    // ==================== Phase 1: 工作区与任务管理 ====================
    console.log('[Main] 初始化工作区与任务管理系统...');

    // 1. 初始化组织管理器（如果还没有）
    if (!this.organizationManager) {
      this.organizationManager = new OrganizationManager(
        this.database.db,
        this.didManager,
        this.p2pManager
      );
      console.log('[Main] ✓ 组织管理器初始化成功');
    }

    // 2. 初始化工作区管理器
    this.workspaceManager = new WorkspaceManager(
      this.database.db,
      this.organizationManager
    );
    console.log('[Main] ✓ 工作区管理器初始化成功');

    // 3. 初始化任务管理器
    this.taskManager = new TaskManager(
      this.database.db,
      this.organizationManager
    );
    console.log('[Main] ✓ 任务管理器初始化成功');

    // 4. 注册IPC处理器
    registerWorkspaceTaskIPC(this);
    console.log('[Main] ✓ 工作区与任务IPC已注册 (22个接口)');

    console.log('[Main] ✓ Phase 1 初始化完成');

  } catch (error) {
    console.error('[Main] setupIPC failed:', error);
  }
}
```

---

## 🧪 测试验证

### 测试1: 数据库迁移

```bash
cd desktop-app-vue
npm run dev
```

启动应用后，检查控制台输出：
```
[Database] Phase 1 迁移 - 创建工作区与任务管理系统表...
[Database] 工作区与任务管理系统表创建完成
[Database] project_tasks 表字段扩展完成
```

### 测试2: IPC接口

在前端控制台测试（浏览器DevTools）：

```javascript
// 测试创建工作区
const result = await window.electron.invoke('organization:workspace:create', {
  orgId: 'your-org-id',
  workspaceData: {
    name: '开发环境',
    description: '开发团队工作区',
    type: 'development',
    color: '#52c41a',
    icon: 'code'
  }
});
console.log('工作区创建结果:', result);

// 测试获取工作区列表
const workspaces = await window.electron.invoke('organization:workspace:list', {
  orgId: 'your-org-id'
});
console.log('工作区列表:', workspaces);

// 测试创建任务
const taskResult = await window.electron.invoke('tasks:create', {
  taskData: {
    project_id: 'your-project-id',
    org_id: 'your-org-id',
    workspace_id: 'your-workspace-id',
    title: '实现用户登录功能',
    description: '需要支持邮箱和手机号登录',
    status: 'pending',
    priority: 'high',
    labels: ['功能开发', '高优先级']
  }
});
console.log('任务创建结果:', taskResult);
```

### 测试3: 数据库完整性

```bash
# 进入数据库目录
cd data

# 使用 SQLite 查看表结构
sqlite3 chainlesschain.db

# 查看工作区表
.schema organization_workspaces

# 查看任务表字段
PRAGMA table_info(project_tasks);

# 查看新增的表
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%workspace%' OR name LIKE '%task%';
```

---

## 📊 Phase 1 完成度统计

| 项目 | 状态 | 完成度 |
|------|------|--------|
| 数据库迁移 | ✅ 完成 | 100% |
| 工作区管理器 | ✅ 完成 | 100% |
| 任务管理器 | ✅ 完成 | 100% |
| IPC接口 | ✅ 完成 | 100% |
| 前端组件 | ⏳ 待开发 | 0% |
| 单元测试 | ⏳ 待开发 | 0% |
| **总体进度** | - | **50%** |

---

## 🎯 下一步工作

### Week 3: 前端开发

#### 1. 工作区选择器组件
- **文件**: `desktop-app-vue/src/renderer/components/workspace/WorkspaceSelector.vue`
- **功能**:
  - 显示工作区列表
  - 切换当前工作区
  - 创建新工作区

#### 2. 任务看板组件
- **文件**: `desktop-app-vue/src/renderer/components/task/TaskBoard.vue`
- **功能**:
  - Kanban看板视图
  - 拖拽任务卡片
  - 任务筛选

#### 3. 任务详情页面
- **文件**: `desktop-app-vue/src/renderer/pages/task/TaskDetail.vue`
- **功能**:
  - 任务详情展示
  - 任务编辑
  - 评论功能

---

## 📝 API接口文档

### 工作区接口（7个）

#### 1. 创建工作区
```javascript
window.electron.invoke('organization:workspace:create', {
  orgId: string,
  workspaceData: {
    name: string,           // 必填
    description?: string,
    type?: 'default' | 'development' | 'testing' | 'production',
    color?: string,         // 十六进制颜色
    icon?: string,
    visibility?: 'members' | 'admins' | 'specific_roles',
    allowedRoles?: string[],
    isDefault?: boolean
  }
})
// 返回: { success: boolean, workspace?: Object, error?: string }
```

#### 2. 获取工作区列表
```javascript
window.electron.invoke('organization:workspace:list', {
  orgId: string,
  includeArchived?: boolean
})
// 返回: { success: boolean, workspaces?: Array, error?: string }
```

#### 3. 更新工作区
```javascript
window.electron.invoke('organization:workspace:update', {
  workspaceId: string,
  updates: {
    name?: string,
    description?: string,
    type?: string,
    color?: string,
    icon?: string,
    visibility?: string,
    allowedRoles?: string[]
  }
})
// 返回: { success: boolean, error?: string }
```

#### 4. 删除工作区
```javascript
window.electron.invoke('organization:workspace:delete', {
  workspaceId: string
})
// 返回: { success: boolean, error?: string }
```

#### 5. 添加工作区成员
```javascript
window.electron.invoke('organization:workspace:addMember', {
  workspaceId: string,
  memberDID: string,
  role: 'admin' | 'member' | 'viewer'
})
// 返回: { success: boolean, memberId?: string, error?: string }
```

#### 6. 移除工作区成员
```javascript
window.electron.invoke('organization:workspace:removeMember', {
  workspaceId: string,
  memberDID: string
})
// 返回: { success: boolean, error?: string }
```

#### 7. 添加资源到工作区
```javascript
window.electron.invoke('organization:workspace:addResource', {
  workspaceId: string,
  resourceType: 'knowledge' | 'project' | 'conversation',
  resourceId: string
})
// 返回: { success: boolean, error?: string }
```

### 任务接口（15个）

#### 1. 创建任务
```javascript
window.electron.invoke('tasks:create', {
  taskData: {
    project_id: string,     // 必填
    org_id?: string,
    workspace_id?: string,
    title: string,          // 必填
    description?: string,
    status?: 'pending' | 'in_progress' | 'completed' | 'cancelled',
    priority?: 'low' | 'medium' | 'high' | 'urgent',
    assigned_to?: string,   // DID
    collaborators?: string[],
    labels?: string[],
    due_date?: number,      // 时间戳
    reminder_at?: number,
    blocked_by?: string[],
    estimate_hours?: number
  }
})
// 返回: { success: boolean, task?: Object, error?: string }
```

#### 2. 更新任务
```javascript
window.electron.invoke('tasks:update', {
  taskId: string,
  updates: {
    // 同创建任务的字段（除了project_id）
  }
})
// 返回: { success: boolean, error?: string }
```

#### 3. 删除任务
```javascript
window.electron.invoke('tasks:delete', {
  taskId: string
})
// 返回: { success: boolean, error?: string }
```

#### 4. 获取任务列表
```javascript
window.electron.invoke('tasks:list', {
  filters: {
    org_id?: string,
    workspace_id?: string,
    project_id?: string,
    status?: string,
    assigned_to?: string,
    limit?: number,
    offset?: number
  }
})
// 返回: { success: boolean, tasks?: Array, error?: string }
```

#### 5. 获取任务详情
```javascript
window.electron.invoke('tasks:detail', {
  taskId: string
})
// 返回: { success: boolean, task?: Object, error?: string }
```

#### 6. 分配任务
```javascript
window.electron.invoke('tasks:assign', {
  taskId: string,
  assignedTo: string  // DID
})
// 返回: { success: boolean, error?: string }
```

#### 7. 变更任务状态
```javascript
window.electron.invoke('tasks:changeStatus', {
  taskId: string,
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
})
// 返回: { success: boolean, error?: string }
```

#### 8. 添加任务评论
```javascript
window.electron.invoke('tasks:comment:add', {
  taskId: string,
  content: string,
  mentions?: string[]  // DIDs
})
// 返回: { success: boolean, comment?: Object, error?: string }
```

#### 9. 获取任务评论列表
```javascript
window.electron.invoke('tasks:comment:list', {
  taskId: string
})
// 返回: { success: boolean, comments?: Array, error?: string }
```

#### 10. 删除任务评论
```javascript
window.electron.invoke('tasks:comment:delete', {
  commentId: string
})
// 返回: { success: boolean, error?: string }
```

#### 11. 创建任务看板
```javascript
window.electron.invoke('tasks:board:create', {
  orgId: string,
  boardData: {
    name: string,
    workspace_id?: string,
    description?: string,
    columns?: Array<{
      id: string,
      name: string,
      status: string,
      order: number
    }>,
    filters?: Object
  }
})
// 返回: { success: boolean, board?: Object, error?: string }
```

#### 12. 获取任务看板列表
```javascript
window.electron.invoke('tasks:board:list', {
  orgId: string,
  workspaceId?: string
})
// 返回: { success: boolean, boards?: Array, error?: string }
```

#### 13. 更新任务看板
```javascript
window.electron.invoke('tasks:board:update', {
  boardId: string,
  updates: Object
})
// 返回: { success: boolean, error?: string }
```

#### 14. 删除任务看板
```javascript
window.electron.invoke('tasks:board:delete', {
  boardId: string
})
// 返回: { success: boolean, error?: string }
```

#### 15. 获取任务变更历史
```javascript
window.electron.invoke('tasks:getHistory', {
  taskId: string
})
// 返回: { success: boolean, changes?: Array, error?: string }
```

---

## ⚠️ 注意事项

1. **依赖检查**: 确保 `OrganizationManager` 已正确初始化
2. **DID管理**: 确保 `didManager.getDefaultIdentity()` 返回有效身份
3. **权限检查**: 所有操作都会进行权限验证
4. **数据库备份**: 首次运行迁移前建议备份数据库
5. **错误处理**: 所有IPC接口都返回统一格式的结果对象

---

## 🐛 常见问题

### Q1: 数据库迁移失败
**A**: 检查 `desktop-app-vue/src/main/database/migrations/` 目录是否存在且有读取权限

### Q2: IPC接口返回 "管理器未初始化"
**A**: 确保在 `setupIPC()` 中正确初始化了WorkspaceManager和TaskManager

### Q3: 权限检查失败
**A**: 确保用户是组织成员，并且有相应权限

### Q4: 找不到组织
**A**: 先使用 `organization:create` 创建组织，或加入现有组织

---

## 📞 支持

如有问题，请查看：
1. 控制台日志
2. 数据库表结构
3. IPC接口返回的错误信息

---

**Phase 1 后端实现完成！接下来开始前端开发。** 🎉
