# PC端项目管理模块实施计划

## 项目概述

为ChainlessChain桌面应用(desktop-app-vue)开发完整的项目管理模块，集成AI辅助创建、文件管理、Git版本控制等功能。

**功能范围：**
- 基础CRUD（创建、查看、编辑、删除项目）
- AI辅助项目创建（通过自然语言描述，AI生成项目文件）
- 项目文件管理和在线编辑（文件树浏览、内容查看和编辑）
- 项目模板系统（使用预置模板快速创建）
- Git版本控制集成

**技术架构：**
- 前端：Electron + Vue3 + Pinia + Ant Design Vue
- 数据存储：前端SQLite缓存 + 后端PostgreSQL同步
- 后端服务：Spring Boot (localhost:9090/api)
- UI风格：自定义混合风格（支持列表/卡片视图切换）

---

## 实施步骤

### Phase 1: 数据层基础（优先级：高）

**目标：** 建立本地SQLite缓存和HTTP客户端

**文件修改：**
- `src/main/database.js` - 添加3个表（projects, project_files, project_templates）

**文件新建：**
- `src/main/project/http-client.js` - 封装后端API调用

**关键任务：**
1. 在database.js的createTables()方法中添加：
   - `projects`表：包含id, user_id, name, description, project_type, status, tags, sync_status等字段
   - `project_files`表：缓存项目文件信息，用于文件树展示
   - `project_templates`表：缓存项目模板
   - 创建索引优化查询性能

2. 添加数据库操作方法：
   - getProjects(userId)
   - saveProject(project)
   - updateProject(projectId, updates)
   - deleteProject(projectId)
   - getProjectFiles(projectId)
   - saveProjectFiles(projectId, files)

3. 创建HTTP客户端：
   - 基于axios封装
   - baseURL: http://localhost:9090
   - 实现createProject, listProjects, getProject, deleteProject等方法
   - 响应拦截器统一处理错误

**验证：** 运行`npm run test:db`测试数据库操作

---

### Phase 2: IPC通信层（优先级：高）

**目标：** 建立前端渲染进程与Main进程的通信桥梁

**文件修改：**
- `src/preload/index.js` - 扩展window.electronAPI
- `src/main/index.js` - 注册IPC处理器

**关键任务：**
1. 在preload.js中添加project API组（17个方法）：
   ```javascript
   project: {
     getAll, get, create, update, delete, save, deleteLocal,
     fetchFromBackend, getFiles, saveFiles, updateFile,
     getTemplates, sync, syncOne,
     gitInit, gitStatus, gitCommit, gitPush, gitPull
   }
   ```

2. 在main/index.js的setupIPC()中注册30+个处理器：
   - `project:get-all` - 从SQLite获取项目列表
   - `project:create` - 调用后端API创建项目
   - `project:save` - 保存项目到SQLite
   - `project:sync` - 双向同步（本地⇄后端）
   - `project:git-*` - Git操作集成isomorphic-git

3. 实现同步逻辑：
   - 启动时增量同步（基于synced_at时间戳）
   - 操作后后台异步推送
   - 冲突检测（本地和远程都有更新）

**验证：** 在浏览器控制台测试`await window.electronAPI.project.getAll('userId')`

---

### Phase 3: Pinia状态管理（优先级：高）

**目标：** 创建集中式状态管理

**文件新建：**
- `src/renderer/stores/project.js` - 项目管理Store

**关键任务：**
1. State定义（10个属性）：
   - projects[], currentProject, projectFiles[], currentFile
   - pagination, filters, sortBy, viewMode
   - loading, syncing, creatingProject

2. Getters实现（4个计算属性）：
   - filteredProjects - 筛选和搜索
   - paginatedProjects - 分页
   - projectStats - 统计信息
   - fileTree - 文件树结构

3. Actions实现（25个方法）：
   - fetchProjects, createProject, updateProject, deleteProject
   - loadProjectFiles, updateFile
   - syncProjects, syncProjectToBackend
   - setFilter, setSort, setViewMode
   - gitInit, gitCommit, gitPush, gitPull

**验证：** Vue DevTools查看store状态和actions

---

### Phase 4: 项目列表页面（优先级：高）

**目标：** 实现我的项目主页

**文件修改：**
- `src/renderer/pages/projects/ProjectsPage.vue`

**文件新建：**
- `src/renderer/components/projects/ProjectCard.vue` - 卡片式项目
- `src/renderer/components/projects/ProjectListItem.vue` - 列表式项目

**关键功能：**
1. 筛选栏：
   - 搜索框（项目名称/描述）
   - 类型筛选（Web/文档/数据/应用）
   - 状态筛选（进行中/已完成/已归档）
   - 排序选择（最近更新/创建时间/名称）
   - 视图切换（网格/列表）
   - 同步按钮

2. 统计栏：
   - 总项目数、进行中、已完成统计

3. 项目展示：
   - 网格视图：ProjectCard组件（响应式布局）
   - 列表视图：ProjectListItem组件
   - 空状态提示

4. 分页组件：
   - 当前页、每页数量、总数显示

**ProjectCard设计：**
- 封面图/占位图标
- 状态标签
- 项目名称和描述
- 标签显示
- 文件数和更新时间
- 编辑/删除按钮

**验证：** 访问/projects路由，测试筛选、排序、分页功能

---

### Phase 5: 新建项目页面（优先级：高）

**目标：** 实现AI辅助创建、模板创建、手动创建三种方式

**文件修改：**
- `src/renderer/pages/projects/NewProjectPage.vue`

**文件新建：**
- `src/renderer/components/projects/AIProjectCreator.vue` - AI创建表单
- `src/renderer/components/projects/TemplateSelector.vue` - 模板选择
- `src/renderer/components/projects/ManualProjectForm.vue` - 手动配置

**关键功能：**
1. Tab切换三种创建模式

2. AIProjectCreator：
   - 自然语言描述输入框（textarea，最多1000字）
   - 可选项目名称和类型
   - 示例需求卡片（点击填充）
   - 提交后显示创建进度（Modal + Progress）

3. TemplateSelector：
   - 模板卡片网格展示
   - 模板预览图、名称、描述
   - 使用次数统计
   - 点击模板直接创建

4. ManualProjectForm：
   - 项目名称、描述、类型
   - 标签输入
   - 提交创建

**创建进度Modal：**
- 进度条（0-100%）
- 状态文本（连接AI服务→生成文件→保存→完成）
- 不可关闭直到完成

**验证：** 测试三种创建方式，验证AI生成、模板应用、手动创建流程

---

### Phase 6: 项目详情页（优先级：中）

**目标：** 实现文件浏览和编辑

**文件新建：**
- `src/renderer/pages/projects/ProjectDetailPage.vue` - 详情页
- `src/renderer/components/projects/FileTree.vue` - 文件树
- `src/renderer/components/projects/FileEditor.vue` - 文件编辑器

**关键功能：**
1. 顶部工具栏：
   - 面包屑导航
   - Git操作下拉菜单（提交/推送/拉取/查看状态）
   - 保存按钮
   - 关闭按钮

2. 左侧FileTree：
   - 树形结构展示（文件夹可展开）
   - 文件图标（根据类型）
   - 点击文件加载内容
   - 当前选中文件高亮

3. 右侧FileEditor：
   - 集成Monaco Editor或CodeMirror
   - 语法高亮（支持多种语言）
   - 自动保存提示
   - 内容变更检测

4. Git操作：
   - 提交：弹出对话框输入commit message
   - 推送/拉取：显示加载状态
   - 查看状态：显示变更文件列表

**验证：** 测试文件树展示、文件编辑、保存、Git操作

---

### Phase 7: 模板页面（优先级：中）

**目标：** 模板浏览和使用

**文件修改：**
- `src/renderer/pages/projects/TemplatesPage.vue`

**文件新建：**
- `src/renderer/components/projects/TemplateCard.vue` - 模板卡片

**关键功能：**
1. 筛选栏：类型筛选、搜索
2. 模板网格展示
3. 内置模板标识
4. 使用按钮跳转到创建页面

**验证：** 测试模板加载、筛选、使用流程

---

### Phase 8: Git功能增强（优先级：低）

**目标：** 完善Git操作UI

**文件新建：**
- `src/renderer/components/projects/GitStatusDialog.vue` - Git状态对话框
- `src/renderer/components/projects/GitHistoryDialog.vue` - 提交历史

**关键功能：**
1. 复用现有src/main/git/git-manager.js
2. Git状态对话框显示变更文件
3. 提交历史查看
4. 版本对比

**验证：** 测试Git完整流程

---

### Phase 9: 性能优化和完善（优先级：中）

**目标：** 提升性能和用户体验

**关键任务：**
1. 虚拟滚动（大量项目）- 使用vue-virtual-scroller
2. 文件树懒加载（只加载第一层，展开时再加载）
3. 防抖节流（搜索、自动保存）
4. 错误处理完善：
   - 网络异常提示
   - 同步冲突UI
   - 离线模式支持
5. 加载状态优化（骨架屏）

**验证：** 性能测试、边界场景测试

---

## 关键文件清单

### 需要修改的文件
- `src/main/database.js` - 添加3个表和操作方法
- `src/preload/index.js` - 添加project API组
- `src/main/index.js` - 添加30+ IPC处理器
- `src/renderer/pages/projects/ProjectsPage.vue` - 实现项目列表
- `src/renderer/pages/projects/NewProjectPage.vue` - 实现创建页面
- `src/renderer/pages/projects/TemplatesPage.vue` - 实现模板页面

### 需要新建的文件（共14个）

**Main进程：**
1. `src/main/project/http-client.js` - HTTP客户端

**Store：**
2. `src/renderer/stores/project.js` - 项目Store

**页面：**
3. `src/renderer/pages/projects/ProjectDetailPage.vue` - 详情页

**组件（11个）：**
4. `src/renderer/components/projects/ProjectCard.vue`
5. `src/renderer/components/projects/ProjectListItem.vue`
6. `src/renderer/components/projects/AIProjectCreator.vue`
7. `src/renderer/components/projects/TemplateSelector.vue`
8. `src/renderer/components/projects/ManualProjectForm.vue`
9. `src/renderer/components/projects/FileTree.vue`
10. `src/renderer/components/projects/FileEditor.vue`
11. `src/renderer/components/projects/TemplateCard.vue`
12. `src/renderer/components/projects/GitStatusDialog.vue` (可选)
13. `src/renderer/components/projects/GitHistoryDialog.vue` (可选)

---

## 技术要点

### 数据同步策略
- **离线优先：** 操作立即写入本地SQLite
- **后台同步：** 异步推送到后端PostgreSQL
- **增量同步：** 基于updated_at和synced_at时间戳
- **冲突解决：** 检测冲突，默认后端优先，可配置

### SQLite表结构关键字段
```sql
-- projects表
id, user_id, name, description, project_type, status,
tags (JSON), sync_status, created_at, updated_at, synced_at

-- project_files表
id, project_id, file_path, file_name, content,
version, created_at, updated_at

-- project_templates表
id, name, project_type, config_json, file_structure,
is_builtin, usage_count
```

### IPC通信模式
```
Renderer → Preload → IPC → Main → SQLite/HTTP → Backend
```

### Git集成
- 使用isomorphic-git（纯JS实现）
- 支持init, status, add, commit, push, pull
- 复用现有git-manager.js

### 错误处理
- 三层错误处理（Main/IPC/UI）
- 统一错误格式和错误码
- 用户友好的错误消息
- 自动重试机制（网络错误）

### 性能优化
- 虚拟滚动（大量项目）
- 文件树懒加载
- 大文件不缓存到SQLite（只缓存元数据）
- 防抖节流（搜索300ms，自动保存1000ms）

---

## 前置条件

**后端服务需运行：**
```bash
# 启动Docker服务
docker-compose up -d

# 启动项目服务
cd backend/project-service
mvn spring-boot:run
```

**服务端口：**
- PostgreSQL: 5432
- Redis: 6379
- AI服务: 8001
- Project服务: 9090

**前端开发：**
```bash
cd desktop-app-vue
npm install
npm run dev
```

---

## 实施顺序建议

**第一周（核心功能）：**
- Phase 1: 数据层基础
- Phase 2: IPC通信层
- Phase 3: Pinia状态管理
- Phase 4: 项目列表页面

**第二周（创建和详情）：**
- Phase 5: 新建项目页面
- Phase 6: 项目详情页
- Phase 7: 模板页面

**第三周（优化和完善）：**
- Phase 8: Git功能增强
- Phase 9: 性能优化和完善

---

## 验收标准

✅ 能够查看项目列表，支持筛选、搜索、排序
✅ 能够通过AI描述创建项目，显示创建进度
✅ 能够通过模板快速创建项目
✅ 能够查看项目文件树和编辑文件内容
✅ 能够执行Git操作（提交、推送、拉取）
✅ 本地SQLite和后端PostgreSQL数据同步正常
✅ 离线模式下可正常使用（查看、编辑本地缓存）
✅ 列表/卡片视图切换流畅
✅ 错误处理完善，用户体验友好
