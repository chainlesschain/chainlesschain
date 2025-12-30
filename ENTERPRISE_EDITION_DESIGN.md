# ChainlessChain 企业版技术设计方案

**版本**: v1.0
**日期**: 2025-12-30
**状态**: 设计阶段
**部署模式**: 私有化部署

---

## 目录

1. [概述](#1-概述)
2. [现有架构分析](#2-现有架构分析)
3. [企业版核心功能](#3-企业版核心功能)
4. [多租户架构设计](#4-多租户架构设计)
5. [团队协作功能设计](#5-团队协作功能设计)
6. [集中管理控制台设计](#6-集中管理控制台设计)
7. [企业安全增强方案](#7-企业安全增强方案)
8. [私有化部署方案](#8-私有化部署方案)
9. [数据库设计](#9-数据库设计)
10. [技术选型](#10-技术选型)
11. [实施路线图](#11-实施路线图)
12. [风险评估](#12-风险评估)

---

## 1. 概述

### 1.1 设计目标

ChainlessChain 企业版旨在将个人版的去中心化AI知识库能力扩展到企业级应用场景，支持：

- **多租户管理**: 支持多个企业/部门独立使用，数据完全隔离
- **团队协作**: 知识库共享、协同编辑、权限管理
- **集中管理**: 统一用户管理、资源配额、审计日志
- **企业安全**: SSO单点登录、LDAP集成、数据加密、合规审计
- **私有化部署**: 完全本地化部署，数据主权完全掌控

### 1.2 设计原则

1. **数据安全优先**: 企业数据完全隔离，支持端到端加密
2. **向后兼容**: 保持与个人版的兼容性，平滑升级
3. **可扩展性**: 支持从小团队到大型企业的扩展
4. **易部署性**: 简化私有化部署流程，提供一键部署方案
5. **合规性**: 满足企业级安全合规要求（等保、SOC2等）

---

## 2. 现有架构分析

### 2.1 个人版架构

#### 应用层
```
Desktop App (Electron + Vue3)
├── Main Process (Node.js)
│   ├── Database (SQLite + SQLCipher)
│   ├── U-Key Integration
│   ├── LLM Service Client
│   ├── RAG Engine
│   ├── P2P Network (libp2p)
│   ├── DID Identity
│   └── Git Sync
└── Renderer Process (Vue3 + Pinia)
    ├── Knowledge Base UI
    ├── Chat UI
    ├── Project Management UI
    └── Social/Trade UI
```

#### 后端服务层
```
Backend Services
├── AI Service (FastAPI + Python)
│   ├── Ollama (LLM)
│   ├── Qdrant (Vector DB)
│   └── RAG Pipeline
├── Project Service (Spring Boot)
│   ├── PostgreSQL
│   ├── Redis
│   └── MyBatis Plus
└── Infrastructure
    ├── Docker Compose
    └── Git Storage
```

### 2.2 个人版数据模型

#### Desktop App数据表 (SQLite)
- **知识库**: knowledge_items, tags, knowledge_tags, knowledge_relations
- **对话**: conversations, messages
- **项目**: projects, project_files, project_tasks, project_collaborators
- **P2P通信**: p2p_chat_messages, chat_sessions, notifications
- **区块链**: blockchain_wallets, blockchain_assets, blockchain_transactions
- **模板**: project_templates, template_usage_history

#### Backend数据表 (PostgreSQL)
- **项目管理**: projects, project_files, project_tasks, project_conversations
- **协作**: project_collaborators, project_comments
- **市场**: project_marketplace_listings
- **自动化**: project_automation_rules
- **统计**: project_stats, project_logs

### 2.3 架构特点

**优势**:
- 数据本地化，隐私保护强
- 离线可用
- DID去中心化身份
- P2P直连，无需中心服务器

**限制**:
- 缺乏企业级多租户支持
- 协作功能依赖P2P，企业内网受限
- 缺乏集中管理能力
- 审计和合规能力不足

---

## 3. 企业版核心功能

### 3.1 功能矩阵

| 功能模块 | 个人版 | 企业版 | 说明 |
|---------|-------|-------|------|
| 知识库管理 | ✅ | ✅ | 企业版增强团队共享 |
| AI对话 | ✅ | ✅ | 企业版支持部门隔离 |
| 项目管理 | ✅ | ✅ | 企业版增强协作 |
| P2P通信 | ✅ | ⚠️ | 企业版改为内网通信 |
| DID身份 | ✅ | ✅ | 企业版集成SSO/LDAP |
| 多租户管理 | ❌ | ✅ | **新增** |
| 团队协作 | ⚠️ | ✅ | **增强** |
| 权限管理 | ⚠️ | ✅ | **增强** |
| 集中管理控制台 | ❌ | ✅ | **新增** |
| SSO/LDAP | ❌ | ✅ | **新增** |
| 审计日志 | ⚠️ | ✅ | **增强** |
| 资源配额 | ❌ | ✅ | **新增** |
| 数据备份恢复 | ⚠️ | ✅ | **增强** |

### 3.2 企业版独有功能

1. **组织架构管理**
   - 多级组织/部门结构
   - 用户、组、角色管理
   - 跨部门协作

2. **高级权限控制**
   - RBAC (基于角色的访问控制)
   - ABAC (基于属性的访问控制)
   - 知识库/项目级权限
   - 字段级数据脱敏

3. **企业级安全**
   - SSO单点登录 (SAML 2.0, OAuth 2.0, OIDC)
   - LDAP/Active Directory集成
   - 数据加密 (传输层TLS + 存储层AES-256)
   - 合规审计 (操作日志、访问日志、变更日志)

4. **管理员控制台**
   - 组织管理
   - 用户管理
   - 资源配额管理
   - 审计日志查看
   - 系统监控
   - 数据备份恢复

5. **高级协作**
   - 实时协同编辑
   - 知识库版本控制
   - 评论和批注
   - 工作流审批

---

## 4. 多租户架构设计

### 4.1 租户隔离模型

采用 **混合隔离模式**:

#### 方案对比

| 模式 | 数据隔离 | 性能 | 成本 | 适用场景 |
|-----|---------|------|------|---------|
| 独立数据库 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 高 | 大型企业客户 |
| 共享数据库+独立Schema | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | 中型企业 |
| 共享数据库+tenant_id | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 低 | 小型团队 |
| **混合模式** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | **推荐** |

#### 混合隔离策略

```
企业级隔离层次:
Level 1: 独立数据库实例 (可选，超大客户)
Level 2: 独立Schema (推荐，中大型客户)
Level 3: tenant_id字段隔离 (小型团队)
```

**实施策略**:
- 默认使用 Level 3 (tenant_id 隔离)
- 中大型客户使用 Level 2 (独立 Schema)
- 超大客户/特殊需求使用 Level 1 (独立数据库)

### 4.2 租户管理架构

```
┌─────────────────────────────────────────┐
│      Enterprise Management Layer        │
│   (租户管理、认证中心、审计中心)          │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│         Tenant Isolation Layer          │
│   (租户路由、数据隔离、资源配额)          │
└─────────────────────────────────────────┘
                    ↓
┌──────────┬──────────┬──────────┬─────────┐
│ Tenant A │ Tenant B │ Tenant C │  ...    │
│ (企业A)  │ (企业B)  │ (部门C)  │         │
└──────────┴──────────┴──────────┴─────────┘
     ↓           ↓           ↓
┌─────────────────────────────────────────┐
│        Shared Infrastructure            │
│  (PostgreSQL, Redis, Qdrant, Ollama)    │
└─────────────────────────────────────────┘
```

### 4.3 租户数据隔离

#### 后端数据库隔离 (PostgreSQL)

**方案**: 共享数据库 + tenant_id 隔离（默认）

所有表添加 `tenant_id` 字段：

```sql
-- 租户表
CREATE TABLE tenants (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL, -- 'enterprise', 'department', 'team'
    parent_tenant_id VARCHAR(36), -- 支持多级租户
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'suspended', 'deleted'
    max_users INT DEFAULT 100,
    max_storage_gb INT DEFAULT 1000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_tenant_id) REFERENCES tenants(id)
);

-- 示例：projects表添加tenant_id
CREATE TABLE projects (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL, -- 租户隔离字段
    name VARCHAR(255) NOT NULL,
    -- ... 其他字段
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 行级安全策略 (Row-Level Security)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON projects
    USING (tenant_id = current_setting('app.current_tenant_id')::VARCHAR);
```

**优势**:
- 成本低，易于扩展
- 查询性能好（单库查询）
- 备份恢复简单

**隔离保障**:
- 应用层强制 tenant_id 过滤
- 数据库层 Row-Level Security (RLS)
- ORM层拦截器自动注入 tenant_id

#### Desktop App数据隔离 (SQLite)

**方案**: 每个用户独立数据库文件 + 租户元数据同步

```
数据存储结构:
data/
├── tenants/
│   ├── tenant_a/
│   │   ├── user1.db (SQLCipher加密)
│   │   ├── user2.db
│   │   └── shared_knowledge.db (团队共享知识库)
│   └── tenant_b/
│       ├── user3.db
│       └── shared_knowledge.db
└── metadata.db (租户元数据)
```

**共享知识库机制**:
- 每个租户有独立的 `shared_knowledge.db`
- 用户可读写自己的数据库
- 根据权限只读或读写团队共享库
- 通过后端服务同步到向量数据库

#### 向量数据库隔离 (Qdrant/ChromaDB)

**方案**: Collection 级别隔离

```python
# Qdrant collection命名
collection_name = f"tenant_{tenant_id}_knowledge"

# 写入时带租户标签
qdrant_client.upsert(
    collection_name=f"tenant_{tenant_id}_knowledge",
    points=[{
        "id": doc_id,
        "vector": embedding,
        "payload": {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "content": content
        }
    }]
)

# 查询时强制过滤
qdrant_client.search(
    collection_name=f"tenant_{tenant_id}_knowledge",
    query_filter={
        "must": [
            {"key": "tenant_id", "match": {"value": tenant_id}}
        ]
    }
)
```

### 4.4 租户资源配额

```sql
-- 租户配额表
CREATE TABLE tenant_quotas (
    tenant_id VARCHAR(36) PRIMARY KEY,
    max_users INT DEFAULT 100,
    max_storage_gb INT DEFAULT 1000,
    max_knowledge_items INT DEFAULT 100000,
    max_projects INT DEFAULT 1000,
    max_llm_tokens_per_month BIGINT DEFAULT 10000000,
    current_users INT DEFAULT 0,
    current_storage_gb DECIMAL(10, 2) DEFAULT 0,
    current_knowledge_items INT DEFAULT 0,
    current_projects INT DEFAULT 0,
    current_llm_tokens_this_month BIGINT DEFAULT 0,
    quota_reset_at TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 配额使用记录表
CREATE TABLE tenant_quota_usage (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    resource_type VARCHAR(50) NOT NULL, -- 'storage', 'users', 'llm_tokens', etc.
    usage_amount BIGINT NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

**配额控制策略**:
1. **软限制**: 达到90%时告警
2. **硬限制**: 达到100%时拒绝新增
3. **超限策略**: 临时超限（110%）+ 邮件通知管理员

---

## 5. 团队协作功能设计

### 5.1 协作功能矩阵

| 功能 | 描述 | 技术方案 |
|-----|------|---------|
| 知识库共享 | 团队成员共享知识库 | 共享数据库 + 权限控制 |
| 实时协同编辑 | 多人同时编辑文档 | OT/CRDT + WebSocket |
| 权限管理 | 细粒度权限控制 | RBAC + 资源级ACL |
| 评论批注 | 文档评论和批注 | 基于现有 project_comments |
| 版本历史 | 知识库版本控制 | Git + 快照 |
| 工作流审批 | 知识发布审批 | 状态机 + 通知 |

### 5.2 知识库共享机制

#### 共享级别

```
1. 私有 (Private)
   - 仅创建者可见
   - 默认级别

2. 团队共享 (Team Shared)
   - 同租户用户可见
   - 可设置查看/编辑权限

3. 全企业共享 (Organization Shared)
   - 整个组织可见
   - 通常用于公司知识库

4. 公开 (Public)
   - 跨租户可见（需管理员审批）
   - 用于最佳实践分享
```

#### 数据模型

```sql
-- 知识库共享配置表
CREATE TABLE knowledge_sharing (
    id VARCHAR(36) PRIMARY KEY,
    knowledge_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    share_scope VARCHAR(20) DEFAULT 'private', -- 'private', 'team', 'organization', 'public'
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 知识库权限表 (ACL)
CREATE TABLE knowledge_permissions (
    id VARCHAR(36) PRIMARY KEY,
    knowledge_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    principal_type VARCHAR(20) NOT NULL, -- 'user', 'group', 'role'
    principal_id VARCHAR(255) NOT NULL, -- user_id, group_id, role_id
    permission VARCHAR(20) NOT NULL, -- 'read', 'write', 'admin'
    granted_by VARCHAR(255) NOT NULL,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (knowledge_id, principal_type, principal_id)
);
```

### 5.3 实时协同编辑

**技术选型**: Yjs (CRDT) + WebSocket

```javascript
// 协同编辑架构
Client A ←→ WebSocket ←→ Collaboration Server ←→ WebSocket ←→ Client B
             ↓
        Y.js Document (CRDT)
             ↓
        PostgreSQL (持久化)
```

**实施方案**:

1. **协同编辑服务** (新增 Node.js 服务)
```javascript
// collaboration-service (Node.js + y-websocket)
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');

// 文档持久化到PostgreSQL
CREATE TABLE collaborative_documents (
    id VARCHAR(36) PRIMARY KEY,
    knowledge_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    yjs_state BYTEA NOT NULL, -- Y.js state
    version INT DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

2. **前端集成**:
```javascript
// Desktop App集成Y.js
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(
  'ws://localhost:4000',
  `doc_${knowledgeId}`,
  ydoc,
  { params: { tenant_id: tenantId, user_id: userId } }
);

// 绑定到Milkdown编辑器
const ytext = ydoc.getText('content');
```

### 5.4 权限管理 (RBAC)

#### 角色设计

```sql
-- 角色表
CREATE TABLE roles (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_builtin BOOLEAN DEFAULT FALSE, -- 内置角色不可删除
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id, name)
);

-- 权限表
CREATE TABLE permissions (
    id VARCHAR(36) PRIMARY KEY,
    resource_type VARCHAR(50) NOT NULL, -- 'knowledge', 'project', 'user', 'admin'
    action VARCHAR(50) NOT NULL, -- 'create', 'read', 'update', 'delete', 'share', 'admin'
    description TEXT,
    UNIQUE (resource_type, action)
);

-- 角色权限关联表
CREATE TABLE role_permissions (
    role_id VARCHAR(36) NOT NULL,
    permission_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- 用户角色关联表
CREATE TABLE user_roles (
    user_id VARCHAR(255) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    assigned_by VARCHAR(255),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id, tenant_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

#### 内置角色

```sql
-- 初始化内置角色
INSERT INTO roles (id, tenant_id, name, description, is_builtin) VALUES
('role_super_admin', 'system', 'Super Admin', '超级管理员，完全控制', TRUE),
('role_tenant_admin', 'system', 'Tenant Admin', '租户管理员，管理本租户', TRUE),
('role_user_manager', 'system', 'User Manager', '用户管理员，管理用户', TRUE),
('role_knowledge_admin', 'system', 'Knowledge Admin', '知识库管理员', TRUE),
('role_member', 'system', 'Member', '普通成员', TRUE),
('role_viewer', 'system', 'Viewer', '只读用户', TRUE);
```

#### 权限检查

```java
// Spring Boot权限检查服务
@Service
public class PermissionService {

    @Autowired
    private UserRoleRepository userRoleRepository;

    @Autowired
    private RolePermissionRepository rolePermissionRepository;

    /**
     * 检查用户是否有权限
     */
    public boolean hasPermission(String userId, String tenantId,
                                 String resourceType, String action) {
        // 1. 获取用户角色
        List<Role> roles = userRoleRepository.findByUserIdAndTenantId(userId, tenantId);

        // 2. 检查角色权限
        for (Role role : roles) {
            List<Permission> permissions = rolePermissionRepository.findByRoleId(role.getId());
            for (Permission perm : permissions) {
                if (perm.getResourceType().equals(resourceType)
                    && perm.getAction().equals(action)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * 检查资源级权限 (ACL)
     */
    public boolean hasResourcePermission(String userId, String resourceId, String action) {
        // 检查 knowledge_permissions 表
        KnowledgePermission perm = knowledgePermissionRepository
            .findByKnowledgeIdAndPrincipalId(resourceId, userId);

        if (perm != null) {
            return perm.getPermission().equals(action)
                   || perm.getPermission().equals("admin");
        }

        return false;
    }
}
```

---

## 6. 集中管理控制台设计

### 6.1 控制台架构

```
┌────────────────────────────────────────────┐
│       Admin Console (Vue3 SPA)             │
│  ┌──────────┬──────────┬──────────┬─────┐  │
│  │组织管理  │用户管理  │资源配额  │审计│  │
│  └──────────┴──────────┴──────────┴─────┘  │
└────────────────────────────────────────────┘
                    ↓ REST API
┌────────────────────────────────────────────┐
│    Admin Service (Spring Boot)             │
│  ┌──────────────────────────────────────┐  │
│  │ - Tenant Management                  │  │
│  │ - User Management (LDAP/SSO)         │  │
│  │ - Quota Management                   │  │
│  │ - Audit Log                          │  │
│  │ - System Monitoring                  │  │
│  │ - Backup & Recovery                  │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### 6.2 核心功能模块

#### 6.2.1 组织管理

**功能**:
- 租户创建/编辑/删除
- 组织架构树形管理
- 部门/团队管理
- 租户配置 (配额、功能开关)

**UI页面**:
```
组织管理页面
├── 租户列表 (表格)
│   ├── 租户名称
│   ├── 类型 (企业/部门/团队)
│   ├── 用户数 / 最大用户数
│   ├── 存储使用 / 配额
│   ├── 状态 (active/suspended)
│   └── 操作 (编辑/删除/查看详情)
├── 组织架构树 (树形图)
│   └── 拖拽调整结构
└── 租户详情抽屉
    ├── 基本信息
    ├── 配额设置
    ├── 功能开关
    └── 用户列表
```

#### 6.2.2 用户管理

**功能**:
- 用户增删改查
- 用户角色分配
- 用户禁用/启用
- 批量导入 (CSV/Excel)
- LDAP用户同步

**数据模型**:
```sql
-- 用户表
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    tenant_id VARCHAR(36) NOT NULL,
    auth_type VARCHAR(20) DEFAULT 'local', -- 'local', 'ldap', 'sso'
    ldap_dn VARCHAR(500), -- LDAP DN
    password_hash VARCHAR(255), -- local auth only
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'disabled', 'locked'
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 用户组表
CREATE TABLE user_groups (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id, name)
);

-- 用户组成员表
CREATE TABLE user_group_members (
    group_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### 6.2.3 资源配额管理

**功能**:
- 配额查看和调整
- 使用量实时监控
- 配额告警设置
- 配额使用趋势分析

**UI页面**:
```
资源配额页面
├── 配额总览 (卡片)
│   ├── 用户数使用情况 (进度条)
│   ├── 存储使用情况
│   ├── LLM Token使用情况
│   └── 知识库条目数
├── 配额设置表单
│   ├── 最大用户数
│   ├── 最大存储 (GB)
│   ├── 月度LLM Token配额
│   └── 最大项目数
├── 使用趋势图表 (ECharts)
│   ├── 存储使用趋势
│   ├── Token消耗趋势
│   └── 用户增长趋势
└── 配额告警配置
    ├── 告警阈值 (%)
    ├── 告警通知方式 (邮件/短信)
    └── 告警接收人
```

#### 6.2.4 审计日志

**功能**:
- 操作日志记录
- 访问日志记录
- 数据变更日志
- 日志查询和导出
- 合规报告生成

**数据模型**:
```sql
-- 审计日志表
CREATE TABLE audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(100) NOT NULL, -- 'login', 'create_knowledge', 'delete_project', etc.
    resource_type VARCHAR(50), -- 'knowledge', 'project', 'user', etc.
    resource_id VARCHAR(36),
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_data TEXT, -- JSON格式请求数据
    response_status INT, -- HTTP状态码
    error_message TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 数据变更日志表 (Change Data Capture)
CREATE TABLE data_change_logs (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id VARCHAR(36) NOT NULL,
    operation VARCHAR(20) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    old_data JSONB, -- 旧数据快照
    new_data JSONB, -- 新数据快照
    changed_by VARCHAR(36) NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 索引优化
CREATE INDEX idx_audit_logs_tenant_timestamp ON audit_logs(tenant_id, timestamp DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_data_change_logs_tenant_table ON data_change_logs(tenant_id, table_name);
```

**审计日志拦截器**:
```java
// Spring Boot AOP拦截器
@Aspect
@Component
public class AuditLogAspect {

    @Autowired
    private AuditLogRepository auditLogRepository;

    @Around("@annotation(Audited)")
    public Object logAudit(ProceedingJoinPoint joinPoint) throws Throwable {
        HttpServletRequest request = ((ServletRequestAttributes)
            RequestContextHolder.currentRequestAttributes()).getRequest();

        String userId = SecurityContextHolder.getContext().getAuthentication().getName();
        String tenantId = (String) request.getAttribute("tenant_id");
        String action = joinPoint.getSignature().getName();

        AuditLog log = new AuditLog();
        log.setTenantId(tenantId);
        log.setUserId(userId);
        log.setAction(action);
        log.setIpAddress(request.getRemoteAddr());
        log.setUserAgent(request.getHeader("User-Agent"));

        Object result;
        try {
            result = joinPoint.proceed();
            log.setResponseStatus(200);
        } catch (Exception e) {
            log.setResponseStatus(500);
            log.setErrorMessage(e.getMessage());
            throw e;
        } finally {
            auditLogRepository.save(log);
        }

        return result;
    }
}

// 使用示例
@RestController
@RequestMapping("/api/knowledge")
public class KnowledgeController {

    @Audited
    @PostMapping
    public ResponseEntity<?> createKnowledge(@RequestBody KnowledgeDTO dto) {
        // ...
    }
}
```

#### 6.2.5 系统监控

**监控指标**:
- 服务健康状态
- 数据库连接池
- Redis缓存命中率
- LLM服务响应时间
- 向量数据库查询性能
- 磁盘使用率

**技术方案**: Spring Boot Actuator + Prometheus + Grafana

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true
```

---

## 7. 企业安全增强方案

### 7.1 SSO单点登录

#### 支持协议
- **SAML 2.0**: 企业级标准 (推荐)
- **OAuth 2.0 + OIDC**: 现代Web应用标准
- **CAS**: 高校常用

#### SAML 2.0集成

```java
// Spring Security SAML配置
@Configuration
@EnableWebSecurity
public class SAMLSecurityConfig extends WebSecurityConfigurerAdapter {

    @Bean
    public SAMLAuthenticationProvider samlAuthenticationProvider() {
        SAMLAuthenticationProvider samlAuthenticationProvider = new SAMLAuthenticationProvider();
        samlAuthenticationProvider.setUserDetails(samlUserDetailsService());
        return samlAuthenticationProvider;
    }

    @Bean
    public MetadataGenerator metadataGenerator() {
        MetadataGenerator metadataGenerator = new MetadataGenerator();
        metadataGenerator.setEntityId("chainlesschain-enterprise");
        metadataGenerator.setExtendedMetadata(extendedMetadata());
        metadataGenerator.setIncludeDiscoveryExtension(false);
        metadataGenerator.setKeyManager(keyManager());
        return metadataGenerator;
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .authorizeRequests()
                .antMatchers("/saml/**").permitAll()
                .anyRequest().authenticated()
            .and()
            .apply(samlConfigurer());
    }
}
```

**SSO配置表**:
```sql
CREATE TABLE sso_configurations (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    protocol VARCHAR(20) NOT NULL, -- 'saml', 'oauth', 'oidc'
    idp_entity_id VARCHAR(500), -- SAML Identity Provider Entity ID
    idp_sso_url VARCHAR(500), -- SAML SSO URL
    idp_metadata_url VARCHAR(500), -- SAML Metadata URL
    idp_certificate TEXT, -- SAML Certificate
    oauth_client_id VARCHAR(255), -- OAuth Client ID
    oauth_client_secret VARCHAR(255), -- OAuth Client Secret (加密存储)
    oauth_authorize_url VARCHAR(500),
    oauth_token_url VARCHAR(500),
    oauth_user_info_url VARCHAR(500),
    is_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id)
);
```

### 7.2 LDAP/Active Directory集成

#### 认证流程

```
1. 用户输入用户名密码
2. 应用查询users表，获取auth_type
3. 如果auth_type='ldap':
   a. 连接LDAP服务器
   b. 使用用户DN绑定认证
   c. 认证成功后同步用户信息到本地
4. 如果auth_type='local':
   a. 使用本地密码hash验证
```

#### LDAP配置

```java
// Spring Security LDAP配置
@Configuration
public class LDAPSecurityConfig {

    @Bean
    public LdapAuthenticationProvider ldapAuthenticationProvider() {
        BindAuthenticator authenticator = new BindAuthenticator(contextSource());
        authenticator.setUserDnPatterns(new String[]{"uid={0},ou=people"});

        LdapAuthenticationProvider provider = new LdapAuthenticationProvider(authenticator);
        provider.setUserDetailsContextMapper(new LdapUserDetailsMapper());
        return provider;
    }

    @Bean
    public LdapContextSource contextSource() {
        LdapContextSource contextSource = new LdapContextSource();
        contextSource.setUrl(ldapConfig.getUrl());
        contextSource.setBase(ldapConfig.getBase());
        contextSource.setUserDn(ldapConfig.getManagerDn());
        contextSource.setPassword(ldapConfig.getManagerPassword());
        return contextSource;
    }
}
```

**LDAP配置表**:
```sql
CREATE TABLE ldap_configurations (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    ldap_url VARCHAR(500) NOT NULL, -- ldap://ldap.company.com:389
    base_dn VARCHAR(500) NOT NULL, -- dc=company,dc=com
    user_dn_pattern VARCHAR(500), -- uid={0},ou=people
    manager_dn VARCHAR(500), -- cn=admin,dc=company,dc=com
    manager_password VARCHAR(255), -- 加密存储
    user_search_base VARCHAR(500), -- ou=people
    user_search_filter VARCHAR(255), -- (uid={0})
    group_search_base VARCHAR(500), -- ou=groups
    group_search_filter VARCHAR(255), -- (member={0})
    is_enabled BOOLEAN DEFAULT FALSE,
    sync_interval_hours INT DEFAULT 24, -- 自动同步间隔
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id)
);
```

### 7.3 数据加密

#### 传输层加密 (TLS)

```yaml
# 强制HTTPS
server:
  port: 443
  ssl:
    enabled: true
    key-store: classpath:keystore.p12
    key-store-password: ${SSL_KEYSTORE_PASSWORD}
    key-store-type: PKCS12
    key-alias: chainlesschain
    protocol: TLS
    enabled-protocols: TLSv1.2,TLSv1.3
```

#### 存储层加密

**PostgreSQL**: 透明数据加密 (TDE)
```bash
# 使用pg_crypto扩展
CREATE EXTENSION IF NOT EXISTS pgcrypto;

# 敏感字段加密
CREATE TABLE users (
    -- ...
    password_hash VARCHAR(255), -- bcrypt hash
    api_key TEXT, -- 使用pgp_sym_encrypt加密
);

-- 插入加密数据
INSERT INTO users (api_key) VALUES (
    pgp_sym_encrypt('secret_api_key', 'encryption_key')
);

-- 查询解密数据
SELECT pgp_sym_decrypt(api_key::bytea, 'encryption_key') FROM users;
```

**SQLite/SQLCipher**: 已内置，使用U-Key派生密钥

**向量数据库**: Collection级别加密（Qdrant Enterprise）

#### 敏感数据脱敏

```java
// 数据脱敏注解
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
public @interface Sensitive {
    SensitiveStrategy strategy();
}

public enum SensitiveStrategy {
    PHONE,    // 手机号: 138****5678
    EMAIL,    // 邮箱: a***@example.com
    ID_CARD,  // 身份证: 330***********1234
    NAME      // 姓名: 张*
}

// Jackson序列化器
public class SensitiveSerializer extends JsonSerializer<String> {
    @Override
    public void serialize(String value, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        Sensitive sensitive = // 获取字段注解
        String maskedValue = mask(value, sensitive.strategy());
        gen.writeString(maskedValue);
    }
}

// 使用示例
public class UserDTO {
    @Sensitive(strategy = SensitiveStrategy.PHONE)
    private String phone;

    @Sensitive(strategy = SensitiveStrategy.EMAIL)
    private String email;
}
```

### 7.4 合规审计

#### 审计标准支持

- **等保2.0**: 三级等保认证
- **SOC 2 Type II**: 国际安全合规
- **ISO 27001**: 信息安全管理体系
- **GDPR**: 欧盟数据保护条例（如需海外部署）

#### 审计功能清单

| 审计项 | 实现方式 | 数据保留 |
|-------|---------|---------|
| 用户登录日志 | AuditLog | 1年 |
| 操作日志 | AuditLog | 1年 |
| 数据访问日志 | AuditLog | 6个月 |
| 数据变更日志 | DataChangeLog | 6个月 |
| 权限变更日志 | AuditLog | 1年 |
| 系统配置变更 | AuditLog | 永久 |

#### 审计报告生成

```java
@Service
public class AuditReportService {

    /**
     * 生成合规审计报告
     */
    public byte[] generateComplianceReport(String tenantId,
                                          LocalDate startDate,
                                          LocalDate endDate) {
        // 1. 收集审计数据
        List<AuditLog> logs = auditLogRepository.findByTenantIdAndDateRange(
            tenantId, startDate, endDate
        );

        // 2. 统计分析
        Map<String, Object> statistics = new HashMap<>();
        statistics.put("totalLogins", countLogins(logs));
        statistics.put("totalOperations", logs.size());
        statistics.put("failedLogins", countFailedLogins(logs));
        statistics.put("privilegedOperations", countPrivilegedOps(logs));

        // 3. 生成PDF报告
        return generatePDF(statistics, logs);
    }
}
```

---

## 8. 私有化部署方案

### 8.1 部署架构

```
┌─────────────────────────────────────────────────────┐
│                  Client Layer                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │Desktop App │  │Desktop App │  │Desktop App │    │
│  │  (User1)   │  │  (User2)   │  │  (User3)   │    │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘    │
└────────┼────────────────┼────────────────┼──────────┘
         │                │                │
         └────────────────┼────────────────┘
                          │
         ┌────────────────▼──────────────────┐
         │      Load Balancer (Nginx)        │
         └────────────────┬──────────────────┘
                          │
┌─────────────────────────┼──────────────────────────┐
│              Application Layer                     │
│  ┌──────────────────────┴────────────────────┐    │
│  │         API Gateway (Nginx)               │    │
│  └──────────────────────┬────────────────────┘    │
│           ┌─────────────┼─────────────┐           │
│           │             │             │           │
│  ┌────────▼──────┐ ┌───▼────┐ ┌─────▼──────────┐ │
│  │Admin Service  │ │ Project│ │  AI Service    │ │
│  │ (Spring Boot) │ │ Service│ │  (FastAPI)     │ │
│  └───────────────┘ └────────┘ └────────────────┘ │
│                                                    │
│  ┌───────────────────────────────────────────┐   │
│  │  Collaboration Service (Node.js + Y.js)   │   │
│  └───────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┼──────────────────────────┐
│              Data Layer                            │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ PostgreSQL  │  │  Redis   │  │   Qdrant    │  │
│  │  (Main DB)  │  │ (Cache)  │  │ (Vector DB) │  │
│  └─────────────┘  └──────────┘  └─────────────┘  │
│                                                    │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────┐  │
│  │   Ollama    │  │  MinIO   │  │   GitLab    │  │
│  │   (LLM)     │  │(Object S)│  │(Git Repo)   │  │
│  └─────────────┘  └──────────┘  └─────────────┘  │
└────────────────────────────────────────────────────┘
```

### 8.2 Docker Compose部署

#### 完整docker-compose配置

```yaml
# docker-compose.enterprise.yml
version: '3.8'

services:
  # ===== Infrastructure Layer =====

  # PostgreSQL主数据库
  postgres:
    image: postgres:16-alpine
    container_name: chainlesschain-postgres
    environment:
      POSTGRES_DB: chainlesschain_enterprise
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
      - ./backend/admin-service/src/main/resources/db/migration:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # Redis缓存
  redis:
    image: redis:7-alpine
    container_name: chainlesschain-redis
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - ./data/redis:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # Qdrant向量数据库
  qdrant:
    image: qdrant/qdrant:latest
    container_name: chainlesschain-qdrant
    volumes:
      - ./data/qdrant:/qdrant/storage
    ports:
      - "6333:6333"
      - "6334:6334"
    environment:
      QDRANT__SERVICE__GRPC_PORT: 6334
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # Ollama LLM服务
  ollama:
    image: ollama/ollama:latest
    container_name: chainlesschain-ollama
    volumes:
      - ./data/ollama:/root/.ollama
    ports:
      - "11434:11434"
    environment:
      OLLAMA_MODELS: /root/.ollama/models
    networks:
      - chainlesschain-network
    restart: unless-stopped
    # 如果有GPU，添加:
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]

  # MinIO对象存储
  minio:
    image: minio/minio:latest
    container_name: chainlesschain-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - ./data/minio:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # ===== Application Layer =====

  # Admin Service
  admin-service:
    build:
      context: ./backend/admin-service
      dockerfile: Dockerfile
    container_name: chainlesschain-admin-service
    environment:
      SPRING_PROFILES_ACTIVE: production
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/chainlesschain_enterprise
      SPRING_DATASOURCE_USERNAME: ${DB_USER}
      SPRING_DATASOURCE_PASSWORD: ${DB_PASSWORD}
      SPRING_DATA_REDIS_HOST: redis
      SPRING_DATA_REDIS_PASSWORD: ${REDIS_PASSWORD}
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"]
      interval: 30s
      timeout: 10s
      retries: 5
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # Project Service
  project-service:
    build:
      context: ./backend/project-service
      dockerfile: Dockerfile
    container_name: chainlesschain-project-service
    environment:
      SPRING_PROFILES_ACTIVE: production
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/chainlesschain_enterprise
      SPRING_DATASOURCE_USERNAME: ${DB_USER}
      SPRING_DATASOURCE_PASSWORD: ${DB_PASSWORD}
      SPRING_DATA_REDIS_HOST: redis
      SPRING_DATA_REDIS_PASSWORD: ${REDIS_PASSWORD}
      AI_SERVICE_URL: http://ai-service:8000
    ports:
      - "9090:9090"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # AI Service
  ai-service:
    build:
      context: ./backend/ai-service
      dockerfile: Dockerfile
    container_name: chainlesschain-ai-service
    environment:
      OLLAMA_HOST: http://ollama:11434
      QDRANT_HOST: qdrant
      QDRANT_PORT: 6333
      REDIS_HOST: redis
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      LLM_PROVIDER: ${LLM_PROVIDER:-ollama}
    ports:
      - "8001:8000"
    depends_on:
      - ollama
      - qdrant
      - redis
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # Collaboration Service (NEW)
  collaboration-service:
    build:
      context: ./backend/collaboration-service
      dockerfile: Dockerfile
    container_name: chainlesschain-collaboration-service
    environment:
      POSTGRES_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/chainlesschain_enterprise
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/1
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "4000:4000"
    depends_on:
      - postgres
      - redis
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # Nginx API Gateway
  nginx:
    image: nginx:alpine
    container_name: chainlesschain-nginx
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - admin-service
      - project-service
      - ai-service
      - collaboration-service
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # ===== Monitoring Layer (Optional) =====

  # Prometheus
  prometheus:
    image: prom/prometheus:latest
    container_name: chainlesschain-prometheus
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./data/prometheus:/prometheus
    ports:
      - "9091:9090"
    networks:
      - chainlesschain-network
    restart: unless-stopped

  # Grafana
  grafana:
    image: grafana/grafana:latest
    container_name: chainlesschain-grafana
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}
    volumes:
      - ./data/grafana:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
    ports:
      - "3000:3000"
    depends_on:
      - prometheus
    networks:
      - chainlesschain-network
    restart: unless-stopped

networks:
  chainlesschain-network:
    driver: bridge

volumes:
  postgres-data:
  redis-data:
  qdrant-data:
  ollama-data:
  minio-data:
  prometheus-data:
  grafana-data:
```

### 8.3 一键部署脚本

```bash
#!/bin/bash
# deploy-enterprise.sh

set -e

echo "==================================="
echo "ChainlessChain Enterprise Deployment"
echo "==================================="

# 1. 环境检查
echo "Step 1: Checking environment..."
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "Error: Docker Compose is not installed"
    exit 1
fi

# 2. 创建环境配置
echo "Step 2: Creating environment configuration..."
if [ ! -f .env ]; then
    cp .env.enterprise.example .env
    echo "Please edit .env file and configure your settings"
    exit 0
fi

# 3. 创建数据目录
echo "Step 3: Creating data directories..."
mkdir -p data/{postgres,redis,qdrant,ollama,minio,prometheus,grafana}
mkdir -p logs

# 4. 初始化数据库
echo "Step 4: Initializing database..."
docker-compose -f docker-compose.enterprise.yml up -d postgres redis
sleep 10

# 5. 启动所有服务
echo "Step 5: Starting all services..."
docker-compose -f docker-compose.enterprise.yml up -d

# 6. 等待服务就绪
echo "Step 6: Waiting for services to be ready..."
sleep 30

# 7. 健康检查
echo "Step 7: Health check..."
curl -f http://localhost:8080/actuator/health || echo "Admin Service not ready"
curl -f http://localhost:9090/actuator/health || echo "Project Service not ready"
curl -f http://localhost:8001/health || echo "AI Service not ready"

# 8. 初始化管理员账号
echo "Step 8: Creating admin user..."
docker-compose -f docker-compose.enterprise.yml exec admin-service \
  java -jar /app/admin-service.jar --init-admin

echo "==================================="
echo "Deployment completed!"
echo "Admin Console: https://localhost/admin"
echo "Default admin: admin / changeme"
echo "==================================="
```

### 8.4 系统要求

#### 最小配置（小型团队 < 50人）

```
CPU: 8核
内存: 16GB
存储: 500GB SSD
网络: 100Mbps
操作系统: Ubuntu 22.04 / CentOS 8 / RHEL 8
```

#### 推荐配置（中型企业 < 500人）

```
CPU: 16核
内存: 64GB
存储: 2TB SSD
网络: 1Gbps
GPU: NVIDIA RTX 4090 (可选，用于本地LLM)
操作系统: Ubuntu 22.04 LTS
```

#### 高可用配置（大型企业 > 500人）

```
负载均衡: 2台 (8核 16GB)
应用服务器: 3台 (16核 32GB)
数据库服务器: 3台 (16核 64GB) - PostgreSQL主从复制
Redis集群: 3台 (8核 16GB)
向量数据库: 3台 (16核 32GB)
LLM服务器: 2台 (32核 128GB + NVIDIA A100)
对象存储: 3台 (8核 32GB + 10TB)
```

---

## 9. 数据库设计

### 9.1 企业版新增表

```sql
-- ===== 租户管理 =====

-- 租户表
CREATE TABLE tenants (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL, -- 'enterprise', 'department', 'team'
    parent_tenant_id VARCHAR(36),
    status VARCHAR(20) DEFAULT 'active',
    max_users INT DEFAULT 100,
    max_storage_gb INT DEFAULT 1000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_tenant_id) REFERENCES tenants(id)
);

-- 租户配额表
CREATE TABLE tenant_quotas (
    tenant_id VARCHAR(36) PRIMARY KEY,
    max_users INT DEFAULT 100,
    max_storage_gb INT DEFAULT 1000,
    max_knowledge_items INT DEFAULT 100000,
    max_projects INT DEFAULT 1000,
    max_llm_tokens_per_month BIGINT DEFAULT 10000000,
    current_users INT DEFAULT 0,
    current_storage_gb DECIMAL(10, 2) DEFAULT 0,
    current_knowledge_items INT DEFAULT 0,
    current_projects INT DEFAULT 0,
    current_llm_tokens_this_month BIGINT DEFAULT 0,
    quota_reset_at TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- ===== 用户管理 =====

-- 用户表
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    tenant_id VARCHAR(36) NOT NULL,
    auth_type VARCHAR(20) DEFAULT 'local', -- 'local', 'ldap', 'sso'
    ldap_dn VARCHAR(500),
    password_hash VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active',
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 用户组表
CREATE TABLE user_groups (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id, name)
);

-- 用户组成员表
CREATE TABLE user_group_members (
    group_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== 权限管理 =====

-- 角色表
CREATE TABLE roles (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_builtin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id, name)
);

-- 权限表
CREATE TABLE permissions (
    id VARCHAR(36) PRIMARY KEY,
    resource_type VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    description TEXT,
    UNIQUE (resource_type, action)
);

-- 角色权限关联表
CREATE TABLE role_permissions (
    role_id VARCHAR(36) NOT NULL,
    permission_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- 用户角色关联表
CREATE TABLE user_roles (
    user_id VARCHAR(36) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    assigned_by VARCHAR(36),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id, tenant_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- ===== 知识库共享 =====

-- 知识库共享配置表
CREATE TABLE knowledge_sharing (
    id VARCHAR(36) PRIMARY KEY,
    knowledge_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    share_scope VARCHAR(20) DEFAULT 'private',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 知识库权限表
CREATE TABLE knowledge_permissions (
    id VARCHAR(36) PRIMARY KEY,
    knowledge_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    principal_type VARCHAR(20) NOT NULL,
    principal_id VARCHAR(255) NOT NULL,
    permission VARCHAR(20) NOT NULL,
    granted_by VARCHAR(255) NOT NULL,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (knowledge_id, principal_type, principal_id)
);

-- ===== 协同编辑 =====

-- 协同文档表
CREATE TABLE collaborative_documents (
    id VARCHAR(36) PRIMARY KEY,
    knowledge_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    yjs_state BYTEA NOT NULL,
    version INT DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- ===== 审计日志 =====

-- 审计日志表
CREATE TABLE audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(36),
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_data TEXT,
    response_status INT,
    error_message TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 数据变更日志表
CREATE TABLE data_change_logs (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id VARCHAR(36) NOT NULL,
    operation VARCHAR(20) NOT NULL,
    old_data JSONB,
    new_data JSONB,
    changed_by VARCHAR(36) NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- ===== SSO/LDAP配置 =====

-- SSO配置表
CREATE TABLE sso_configurations (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    protocol VARCHAR(20) NOT NULL,
    idp_entity_id VARCHAR(500),
    idp_sso_url VARCHAR(500),
    idp_metadata_url VARCHAR(500),
    idp_certificate TEXT,
    oauth_client_id VARCHAR(255),
    oauth_client_secret VARCHAR(255),
    oauth_authorize_url VARCHAR(500),
    oauth_token_url VARCHAR(500),
    oauth_user_info_url VARCHAR(500),
    is_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id)
);

-- LDAP配置表
CREATE TABLE ldap_configurations (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    ldap_url VARCHAR(500) NOT NULL,
    base_dn VARCHAR(500) NOT NULL,
    user_dn_pattern VARCHAR(500),
    manager_dn VARCHAR(500),
    manager_password VARCHAR(255),
    user_search_base VARCHAR(500),
    user_search_filter VARCHAR(255),
    group_search_base VARCHAR(500),
    group_search_filter VARCHAR(255),
    is_enabled BOOLEAN DEFAULT FALSE,
    sync_interval_hours INT DEFAULT 24,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id)
);

-- ===== 索引 =====

CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_tenant_id ON user_roles(tenant_id);
CREATE INDEX idx_knowledge_sharing_tenant_id ON knowledge_sharing(tenant_id);
CREATE INDEX idx_knowledge_permissions_knowledge_id ON knowledge_permissions(knowledge_id);
CREATE INDEX idx_audit_logs_tenant_timestamp ON audit_logs(tenant_id, timestamp DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_data_change_logs_tenant_table ON data_change_logs(tenant_id, table_name);
```

### 9.2 现有表改造

为现有表添加 `tenant_id` 字段：

```sql
-- Projects表添加租户字段
ALTER TABLE projects ADD COLUMN tenant_id VARCHAR(36);
ALTER TABLE projects ADD FOREIGN KEY (tenant_id) REFERENCES tenants(id);
CREATE INDEX idx_projects_tenant_id ON projects(tenant_id);

-- Project Files表
ALTER TABLE project_files ADD COLUMN tenant_id VARCHAR(36);
CREATE INDEX idx_project_files_tenant_id ON project_files(tenant_id);

-- Project Tasks表
ALTER TABLE project_tasks ADD COLUMN tenant_id VARCHAR(36);
CREATE INDEX idx_project_tasks_tenant_id ON project_tasks(tenant_id);

-- Conversations表
ALTER TABLE conversations ADD COLUMN tenant_id VARCHAR(36);
CREATE INDEX idx_conversations_tenant_id ON conversations(tenant_id);

-- Messages表
ALTER TABLE messages ADD COLUMN tenant_id VARCHAR(36);
CREATE INDEX idx_messages_tenant_id ON messages(tenant_id);

-- 其他所有业务表均需添加tenant_id...
```

---

## 10. 技术选型

### 10.1 新增技术栈

| 组件 | 技术选型 | 版本 | 说明 |
|-----|---------|------|------|
| Admin Service | Spring Boot | 3.1.11 | 新增管理后台服务 |
| Collaboration Service | Node.js + Y.js | 18 LTS | 协同编辑服务 |
| Admin Console | Vue 3 + Ant Design Vue | 3.4 | 管理控制台前端 |
| SSO/SAML | Spring Security SAML | 2.0 | SAML 2.0集成 |
| LDAP | Spring LDAP | 3.1.0 | LDAP/AD集成 |
| 实时协同 | Yjs + y-websocket | Latest | CRDT协同编辑 |
| 对象存储 | MinIO | Latest | S3兼容对象存储 |
| 监控 | Prometheus + Grafana | Latest | 系统监控 |
| 负载均衡 | Nginx | Latest | API网关 |
| 容器编排 | Docker Compose | Latest | 简化部署 |

### 10.2 依赖升级

```xml
<!-- Spring Boot版本保持3.1.11 -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.1.11</version>
</parent>

<!-- 新增依赖 -->
<dependencies>
    <!-- Spring Security SAML -->
    <dependency>
        <groupId>org.springframework.security.extensions</groupId>
        <artifactId>spring-security-saml2-core</artifactId>
        <version>2.0.0.M31</version>
    </dependency>

    <!-- Spring LDAP -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-ldap</artifactId>
    </dependency>

    <!-- Prometheus Metrics -->
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-registry-prometheus</artifactId>
    </dependency>

    <!-- MyBatis Plus升级到3.5.9 -->
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-boot-starter</artifactId>
        <version>3.5.9</version>
    </dependency>
</dependencies>
```

---

## 11. 实施路线图

### 11.1 阶段划分

#### Phase 1: 基础架构 (4周)

**目标**: 搭建企业版基础架构

**任务**:
- [ ] 创建Admin Service项目
- [ ] 数据库Schema设计和迁移
- [ ] tenant_id隔离机制实现
- [ ] 租户管理API
- [ ] 用户管理API
- [ ] 基础权限控制 (RBAC)
- [ ] Docker Compose企业版配置

**交付物**:
- Admin Service运行
- 租户和用户管理API
- 基础权限系统

#### Phase 2: 团队协作 (3周)

**目标**: 实现团队协作功能

**任务**:
- [ ] 知识库共享机制
- [ ] 知识库权限控制 (ACL)
- [ ] Collaboration Service (Y.js)
- [ ] 实时协同编辑
- [ ] 评论批注功能
- [ ] Desktop App协作功能集成

**交付物**:
- 知识库共享功能
- 实时协同编辑
- 评论批注

#### Phase 3: 管理控制台 (3周)

**目标**: 开发管理员控制台

**任务**:
- [ ] Admin Console前端项目搭建
- [ ] 组织管理页面
- [ ] 用户管理页面
- [ ] 角色权限管理页面
- [ ] 资源配额管理页面
- [ ] 审计日志查看页面
- [ ] 系统监控仪表盘

**交付物**:
- 完整的Admin Console
- 管理员功能

#### Phase 4: 企业安全 (3周)

**目标**: 实现企业级安全功能

**任务**:
- [ ] SSO SAML 2.0集成
- [ ] OAuth 2.0/OIDC集成
- [ ] LDAP/AD集成
- [ ] LDAP用户自动同步
- [ ] 数据加密增强
- [ ] 审计日志完善
- [ ] 合规报告生成

**交付物**:
- SSO单点登录
- LDAP集成
- 完善的审计系统

#### Phase 5: 部署优化 (2周)

**目标**: 优化部署体验

**任务**:
- [ ] 一键部署脚本
- [ ] 健康检查和监控
- [ ] 数据备份恢复方案
- [ ] 高可用架构设计
- [ ] 性能优化
- [ ] 部署文档

**交付物**:
- 一键部署方案
- 完整部署文档
- 运维手册

#### Phase 6: 测试与发布 (2周)

**目标**: 测试和发布

**任务**:
- [ ] 单元测试 (覆盖率>80%)
- [ ] 集成测试
- [ ] 性能测试
- [ ] 安全测试
- [ ] 用户验收测试 (UAT)
- [ ] 发布v1.0企业版

**交付物**:
- 测试报告
- 企业版v1.0发布包

### 11.2 里程碑

| 里程碑 | 时间 | 目标 |
|-------|------|------|
| M1: 基础架构完成 | 第4周 | Admin Service可运行 |
| M2: 协作功能完成 | 第7周 | 团队协作可用 |
| M3: 控制台完成 | 第10周 | Admin Console可用 |
| M4: 安全功能完成 | 第13周 | SSO/LDAP可用 |
| M5: 部署方案完成 | 第15周 | 一键部署可用 |
| M6: 企业版v1.0发布 | 第17周 | 正式发布 |

### 11.3 人员配置

**推荐团队规模**: 5-7人

- **后端开发**: 2-3人 (Spring Boot + FastAPI)
- **前端开发**: 1-2人 (Vue3)
- **全栈开发**: 1人 (Node.js Collaboration Service)
- **测试工程师**: 1人
- **DevOps**: 0.5人 (兼职)

---

## 12. 风险评估

### 12.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|-----|------|------|---------|
| 协同编辑性能问题 | 中 | 高 | 1. 采用成熟的Y.js库<br>2. 限制并发编辑人数<br>3. 增量同步优化 |
| 多租户数据泄露 | 低 | 极高 | 1. Row-Level Security<br>2. 应用层强制过滤<br>3. 定期安全审计 |
| LDAP集成兼容性 | 中 | 中 | 1. 支持多种LDAP服务器<br>2. 提供配置向导<br>3. 详细文档 |
| 性能瓶颈 | 中 | 高 | 1. 数据库查询优化<br>2. Redis缓存<br>3. 读写分离 |
| 向量数据库扩展性 | 中 | 中 | 1. Collection分片<br>2. 支持集群部署 |

### 12.2 业务风险

| 风险 | 概率 | 影响 | 缓解措施 |
|-----|------|------|---------|
| 个人版用户迁移困难 | 中 | 中 | 1. 提供数据迁移工具<br>2. 向后兼容 |
| 部署复杂度高 | 高 | 中 | 1. 一键部署脚本<br>2. Docker Compose简化<br>3. 详细文档 |
| 合规认证成本高 | 中 | 中 | 1. 分阶段认证<br>2. 优先等保3级 |
| 运维成本高 | 中 | 中 | 1. 自动化运维<br>2. 监控告警<br>3. 运维文档 |

---

## 13. 总结

### 13.1 核心优势

1. **数据主权**: 私有化部署,企业完全掌控数据
2. **安全合规**: 等保认证、SOC2合规
3. **易于部署**: 一键部署脚本,Docker Compose简化
4. **平滑升级**: 与个人版向后兼容
5. **灵活扩展**: 从小团队到大型企业

### 13.2 技术亮点

1. **混合隔离**: tenant_id + Schema + 独立数据库三级隔离
2. **CRDT协同**: 基于Y.js的无冲突协同编辑
3. **RBAC+ACL**: 灵活的权限控制
4. **多协议SSO**: SAML/OAuth/OIDC全支持
5. **审计溯源**: 完整的操作和数据变更日志

### 13.3 下一步行动

1. **技术验证**: 搭建POC环境,验证关键技术点
2. **需求确认**: 与潜在客户沟通,确认功能优先级
3. **团队组建**: 招募/分配开发团队
4. **项目启动**: 按照路线图Phase 1开始开发

---

**文档变更历史**:

| 版本 | 日期 | 作者 | 变更说明 |
|-----|------|------|---------|
| v1.0 | 2025-12-30 | Claude Code | 初始版本,完整技术设计 |

---

**附录**:

- 附录A: API接口设计
- 附录B: 数据库ER图
- 附录C: 部署架构图
- 附录D: 安全加固清单

(附录内容可根据需要补充)
