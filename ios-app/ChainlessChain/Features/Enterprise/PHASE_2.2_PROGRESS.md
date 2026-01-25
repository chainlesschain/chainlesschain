# Phase 2.2: 组织与工作空间管理 - 实施进度

## 📋 概述

Phase 2.2实现了完整的组织与工作空间管理功能，为企业协作提供多层级的组织结构和灵活的工作空间管理。

**状态**: 🔄 进行中 (70%)
**实施时间**: 2025-01
**预计完成**: 2周
**目标**: 完整的组织与工作空间管理系统

---

## ✅ 已完成部分

### 1. Workspace Model (Workspace.swift - 350+ lines)

#### WorkspaceType枚举

- 6种工作空间类型：default, development, testing, production, personal, temporary
- 每种类型的显示名称和图标
- 适用于不同的工作场景

#### WorkspaceVisibility枚举

- 3种可见性级别：members（所有成员）, admins（仅管理员）, specificRoles（特定角色）
- 灵活的访问控制策略

#### Workspace结构体

- 完整的工作空间实体定义
- 支持自定义颜色和图标
- 默认工作空间标记
- 可见性和角色权限控制
- 统计信息（成员数、项目数、笔记数）
- 归档功能

#### WorkspaceMember结构体

- 工作空间成员实体
- 4种成员角色：owner, admin, member, guest
- 加入时间和活跃时间追踪

#### WorkspaceResource结构体

- 工作空间资源关联
- 5种资源类型：note, project, knowledge, file, task
- 资源添加者和时间记录

#### WorkspaceActivity结构体

- 工作空间活动日志
- 9种活动类型（创建、更新、删除、归档、成员管理、资源管理、设置）
- 元数据支持

### 2. OrganizationManager Service (OrganizationManager.swift - 650+ lines)

#### 核心功能

- 组织CRUD操作（创建、读取、更新、删除）
- 成员管理（添加、移除、更新角色）
- 邀请码管理（创建、验证、加入）
- 活动日志记录
- 数据库持久化
- 与RBACManager集成

#### 主要方法

**组织管理**:

- `createOrganization()` - 创建组织并初始化内置角色
- `updateOrganization()` - 更新组织信息
- `deleteOrganization()` - 删除组织（需Owner权限）
- `loadOrganizations()` - 加载所有组织
- `getOrganization()` - 获取单个组织

**成员管理**:

- `addMember()` - 添加成员到组织
- `removeMember()` - 从组织移除成员
- `updateMemberRole()` - 更新成员角色
- `getMembers()` - 获取组织成员列表

**邀请码管理**:

- `createInvitation()` - 创建邀请码
- `joinWithInvite()` - 使用邀请码加入组织
- `getInvitations()` - 获取组织邀请码列表

**活动日志**:

- `logActivity()` - 记录活动日志
- `getActivities()` - 获取活动历史

### 3. WorkspaceManager Service (WorkspaceManager.swift - 600+ lines)

#### 核心功能

- 工作空间CRUD操作
- 成员管理（工作空间级别）
- 资源关联管理
- 可见性控制
- 活动日志记录
- 数据库持久化（4张表）

#### 主要方法

**工作空间管理**:

- `createWorkspace()` - 创建工作空间
- `updateWorkspace()` - 更新工作空间信息
- `deleteWorkspace()` - 删除工作空间（需权限检查）
- `archiveWorkspace()` / `unarchiveWorkspace()` - 归档/取消归档
- `getWorkspaces()` - 获取组织的工作空间列表
- `getWorkspace()` - 获取单个工作空间

**成员管理**:

- `addWorkspaceMember()` - 添加成员到工作空间
- `removeWorkspaceMember()` - 从工作空间移除成员
- `updateWorkspaceMemberRole()` - 更新成员角色
- `getWorkspaceMembers()` - 获取工作空间成员

**资源管理**:

- `addResource()` - 添加资源到工作空间
- `removeResource()` - 从工作空间移除资源
- `getWorkspaceResources()` - 获取工作空间资源列表

**权限检查**:

- `canAccessWorkspace()` - 检查用户是否可访问工作空间

**活动日志**:

- `logActivity()` - 记录活动
- `getWorkspaceActivities()` - 获取活动历史

#### 数据库表（4张）

- `workspaces` - 工作空间基本信息
- `workspace_members` - 工作空间成员
- `workspace_resources` - 工作空间资源关联
- `workspace_activities` - 工作空间活动日志

### 4. IdentityManager Service (IdentityManager.swift - 550+ lines)

#### 核心功能

- 多身份管理（个人身份 + 多个组织身份）
- 身份切换
- 当前激活身份追踪
- 与组织成员同步
- 数据库持久化

#### 主要方法

**身份管理**:

- `createIdentity()` - 创建新身份
- `updateIdentity()` - 更新身份信息
- `deleteIdentity()` - 删除身份
- `loadIdentities()` - 加载所有身份

**身份切换**:

- `switchIdentity()` - 切换到指定身份
- `switchIdentityByDID()` - 通过DID切换
- `switchIdentityByID()` - 通过ID切换

**查询方法**:

- `getCurrentIdentity()` - 获取当前身份
- `listIdentities()` - 获取所有身份
- `getIdentitiesByOrg()` - 获取组织相关身份
- `getPersonalIdentities()` - 获取个人身份
- `getOrganizationIdentities()` - 获取组织身份

**组织集成**:

- `syncIdentityFromOrganization()` - 从组织成员同步身份
- `removeIdentityForOrganization()` - 移除组织身份
- `syncOrganizationIdentities()` - 批量同步

#### Identity模型

```swift
public struct Identity: Identifiable, Codable {
    public let id: String
    public let did: String
    public var displayName: String
    public var avatar: String?
    public var orgId: String?      // 所属组织（nil=个人身份）
    public var orgName: String?
    public var role: String?
    public var isActive: Bool      // 当前激活状态
    public let createdAt: Date
    public var lastUsedAt: Date?

    public var isPersonal: Bool    // 是否为个人身份
    public var isOrganization: Bool // 是否为组织身份
    public var displayLabel: String // UI显示标签
}
```

### 5. OrganizationViewModel (OrganizationViewModel.swift - 600+ lines)

#### 核心功能

- 组织列表管理
- 当前组织状态管理
- 成员列表展示
- 邀请码管理UI
- 活动日志展示
- 加载状态和错误处理

#### 主要方法

**组织管理**:

- `loadOrganizations()` - 加载组织列表
- `createOrganization()` - 创建新组织
- `updateOrganization()` - 更新组织信息
- `deleteOrganization()` - 删除组织
- `switchOrganization()` - 切换当前组织

**成员管理**:

- `addMember()` - 添加成员
- `removeMember()` - 移除成员
- `updateMemberRole()` - 更新成员角色

**邀请码**:

- `createInvitation()` - 创建邀请码
- `joinWithInvite()` - 使用邀请码加入
- `revokeInvitation()` - 撤销邀请码

**权限检查**:

- `hasPermission()` - 检查权限
- `isOrgAdmin()` - 检查是否为管理员
- `canManageMembers()` - 检查是否可管理成员
- `canManageRoles()` - 检查是否可管理角色

**工具方法**:

- `searchOrganizations()` - 搜索组织
- `filterOrganizations()` - 按类型过滤
- `getOwnedOrganizations()` - 获取拥有的组织
- `getJoinedOrganizations()` - 获取参与的组织

### 6. WorkspaceViewModel (WorkspaceViewModel.swift - 600+ lines)

#### 核心功能

- 工作空间列表管理
- 当前工作空间状态
- 成员列表展示
- 资源列表展示
- 活动日志展示
- 加载状态和错误处理

#### 主要方法

**工作空间管理**:

- `loadWorkspaces()` - 加载工作空间列表
- `createWorkspace()` - 创建工作空间
- `updateWorkspace()` - 更新工作空间
- `deleteWorkspace()` - 删除工作空间
- `archiveWorkspace()` / `unarchiveWorkspace()` - 归档管理
- `switchWorkspace()` - 切换当前工作空间

**成员管理**:

- `addMember()` - 添加成员
- `removeMember()` - 移除成员
- `updateMemberRole()` - 更新成员角色

**资源管理**:

- `addResource()` - 添加资源
- `removeResource()` - 移除资源
- `filterResources()` - 按类型过滤资源

**权限检查**:

- `canAccess()` - 检查访问权限
- `canManage()` - 检查管理权限

**工具方法**:

- `searchWorkspaces()` - 搜索工作空间
- `filterWorkspaces()` - 按类型过滤
- `getActiveWorkspaces()` - 获取活跃的工作空间
- `getArchivedWorkspaces()` - 获取归档的工作空间
- `getDefaultWorkspace()` - 获取默认工作空间
- `getMemberCount()` / `getResourceCount()` - 统计信息

---

## 📊 数据模型总结

### 工作空间类型

| 类型        | 图标        | 用途     |
| ----------- | ----------- | -------- |
| Default     | folder      | 默认     |
| Development | hammer      | 开发环境 |
| Testing     | testtube.2  | 测试环境 |
| Production  | server.rack | 生产环境 |
| Personal    | person.crop | 个人     |
| Temporary   | clock       | 临时     |

### 工作空间角色

| 角色   | 权限范围 |
| ------ | -------- |
| Owner  | 所有权限 |
| Admin  | 管理权限 |
| Member | 基本权限 |
| Guest  | 只读权限 |

### 资源类型

| 类型      | 图标 | 说明   |
| --------- | ---- | ------ |
| Note      | 📝   | 笔记   |
| Project   | 📦   | 项目   |
| Knowledge | 📚   | 知识库 |
| File      | 📄   | 文件   |
| Task      | ✅   | 任务   |

---

## 🔧 核心特性

### 1. 多身份管理

```swift
// 创建个人身份
let personalIdentity = try await identityManager.createIdentity(
    did: "did:example:alice",
    displayName: "Alice"
)

// 创建组织身份（从组织成员同步）
try await identityManager.syncIdentityFromOrganization(
    member: orgMember,
    org: organization
)

// 切换身份
try await identityManager.switchIdentity(to: organizationIdentity)

// 获取当前身份
let current = identityManager.getCurrentIdentity()
```

### 2. 组织层级管理

```swift
// 创建组织
let org = try await organizationManager.createOrganization(
    name: "Acme Inc",
    ownerDID: "did:example:owner",
    settings: OrganizationSettings(...)
)

// 邀请成员
let invitation = try await organizationManager.createInvitation(
    orgId: org.id,
    role: .editor,
    maxUses: 10,
    expireAt: Date().addingTimeInterval(86400 * 7)
)

// 使用邀请码加入
try await organizationManager.joinWithInvite(
    inviteCode: invitation.inviteCode,
    memberDID: "did:example:bob",
    displayName: "Bob"
)
```

### 3. 工作空间管理

```swift
// 创建工作空间
let workspace = try await workspaceManager.createWorkspace(
    orgId: org.id,
    name: "Development",
    type: .development,
    visibility: .members,
    creatorDID: "did:example:owner"
)

// 添加成员
try await workspaceManager.addWorkspaceMember(
    workspaceId: workspace.id,
    memberDID: "did:example:bob",
    displayName: "Bob",
    role: .member
)

// 添加资源（笔记、项目等）
try await workspaceManager.addResource(
    workspaceId: workspace.id,
    resourceType: .note,
    resourceId: "note_123",
    resourceName: "Project Plan"
)
```

### 4. 可见性控制

```swift
// 所有成员可见
workspace.visibility = .members

// 仅管理员可见
workspace.visibility = .admins

// 特定角色可见
workspace.visibility = .specificRoles
workspace.allowedRoles = ["role_senior_dev", "role_manager"]
```

---

## 📁 文件结构

```
ChainlessChain/Features/Enterprise/
├── Models/
│   ├── Role.swift (220+ lines) ✅
│   ├── Permission.swift (320+ lines) ✅
│   ├── Organization.swift (370+ lines) ✅
│   └── Workspace.swift (350+ lines) ✅
├── Services/
│   ├── RBACManager.swift (500+ lines) ✅
│   ├── PermissionChecker.swift (380+ lines) ✅
│   ├── OrganizationManager.swift (650+ lines) ✅
│   ├── WorkspaceManager.swift (600+ lines) ✅
│   └── IdentityManager.swift (550+ lines) ✅
├── ViewModels/
│   ├── OrganizationViewModel.swift (600+ lines) ✅
│   └── WorkspaceViewModel.swift (600+ lines) ✅
├── Views/                                (待实现)
│   ├── OrganizationListView.swift       ⏳
│   ├── OrganizationDetailView.swift     ⏳
│   ├── WorkspaceListView.swift          ⏳
│   ├── WorkspaceDetailView.swift        ⏳
│   └── IdentitySwitcherView.swift       ⏳
├── Database/
│   └── EnterpriseDB.swift (200+ lines) ✅
├── PHASE_2.1_PROGRESS.md ✅
└── PHASE_2.2_PROGRESS.md (本文档)
```

---

## 🎯 待完成部分

### 1. Views (优先级：高)

#### OrganizationListView.swift

```swift
struct OrganizationListView: View {
    @StateObject var viewModel = OrganizationViewModel()

    var body: some View {
        NavigationView {
            List(viewModel.organizations) { org in
                OrganizationRow(organization: org)
            }
            .navigationTitle("我的组织")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("创建组织") {
                        // Show create organization sheet
                    }
                }
            }
        }
    }
}
```

#### WorkspaceListView.swift

```swift
struct WorkspaceListView: View {
    let orgId: String
    @StateObject var viewModel = WorkspaceViewModel()

    var body: some View {
        List(viewModel.workspaces) { workspace in
            WorkspaceRow(workspace: workspace)
        }
        .navigationTitle("工作空间")
        .task {
            await viewModel.loadWorkspaces(orgId: orgId)
        }
    }
}
```

#### IdentitySwitcherView.swift

```swift
struct IdentitySwitcherView: View {
    @StateObject var identityManager = IdentityManager.shared

    var body: some View {
        Menu {
            ForEach(identityManager.identities) { identity in
                Button {
                    Task {
                        try await identityManager.switchIdentity(to: identity)
                    }
                } label: {
                    HStack {
                        Text(identity.displayLabel)
                        if identity.isActive {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack {
                Avatar(url: identityManager.currentIdentity?.avatar)
                Text(identityManager.currentIdentity?.displayName ?? "未登录")
            }
        }
    }
}
```

### 2. 单元测试 (优先级：中)

- OrganizationManagerTests.swift
- WorkspaceManagerTests.swift
- IdentityManagerTests.swift
- ViewModelTests.swift

### 3. 集成示例 (优先级：低)

- 与现有知识库功能集成
- 与项目管理功能集成
- 与消息功能集成

---

## 📚 参考实现

**PC端参考**:

- `desktop-app-vue/src/main/organization/organization-manager.js` - 组织管理
- `desktop-app-vue/src/main/workspace/workspace-manager.js` - 工作空间管理
- `desktop-app-vue/src/renderer/pages/organization/` - UI实现

---

## 📝 总结

**已完成**:

- ✅ 4,350行代码（8个文件）
  - 1个模型文件（Workspace.swift - 350行）
  - 3个服务文件（OrganizationManager, WorkspaceManager, IdentityManager - 1,800行）
  - 2个ViewModel文件（1,200行）
  - EnterpriseDB已在Phase 2.1完成
- ✅ 完整的组织管理服务
- ✅ 完整的工作空间管理服务
- ✅ 多身份切换系统
- ✅ 两个核心ViewModel
- ✅ 数据库表结构（9张表：5张RBAC + 4张Workspace）

**待完成**:

- 🔜 SwiftUI Views（5个视图文件）
- 🔜 单元测试
- 🔜 与现有功能集成

**完成进度**: 70%

**下一步**: 创建SwiftUI Views

---

**当前进度**: Phase 2.2 (70%) 🔄
**下一阶段**: Phase 2.3 - 实时协作
**版本**: v2.2.0-beta
