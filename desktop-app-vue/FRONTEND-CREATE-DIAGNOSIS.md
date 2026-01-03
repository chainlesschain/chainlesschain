# 前端UI创建项目问题诊断报告

## 测试时间
2026-01-04

## 问题描述
用户反馈：在前端UI或对话框中创建文件会失败

## 诊断过程

### 测试1: 后端逻辑测试
- **文件**: `test-project-create.js`
- **结果**: ✅ 成功
- **说明**: 后端数据库和文件系统操作完全正常

### 测试2: 快速创建逻辑测试
- **文件**: `test-quick-create-fixed.js`
- **结果**: ✅ 成功
- **说明**: 项目创建核心逻辑完全正常

### 测试结果
创建了以下测试项目：
- 项目ID: `c01ef117-3bb3-45f2-b00d-09943cbadaf3`
- 位置: `data/projects/c01ef117-3bb3-45f2-b00d-09943cbadaf3/`
- 文件: README.md, test.txt
- 数据库记录: ✅ 正常
- 文件系统: ✅ 正常

## 诊断结论

**核心功能完全正常！** 测试显示：

✅ 数据库初始化正常
✅ 项目目录创建成功
✅ 文件创建成功 (README.md, test.txt)
✅ 项目信息保存到数据库
✅ 文件记录保存到数据库
✅ 文件系统写入验证通过
✅ 文件内容读取验证通过

## 可能的问题原因

既然后端逻辑正常，前端创建失败可能是以下原因之一：

### 1. 后端服务未启动

**问题**: 前端调用 `project:create` 时需要连接后端 Spring Boot 服务

**检查方法**:
```bash
# 检查后端服务是否运行
curl http://localhost:9090/health

# 或检查项目服务日志
cd backend/project-service
mvn spring-boot:run
```

**解决方案**:
- 使用快速创建 `project:create-quick` 代替 `project:create`（不需要后端）
- 或者确保后端服务已启动

### 2. 权限问题

**问题**: macOS 可能限制了文件系统访问权限

**检查方法**:
```bash
# 检查 data/projects 目录权限
ls -la data/
ls -la data/projects/
```

**解决方案**:
```bash
# 确保目录有正确权限
chmod -R 755 data/projects/
```

### 3. 前端调用方式问题

**当前前端代码**:
```javascript
// ProjectManagementPage.vue:638
await projectStore.createProject(submitData);
```

这会调用 `project:create`，需要后端服务。

**建议修改**为快速创建：
```javascript
// 使用快速创建（不需要后端）
await window.electronAPI.project.createQuick(submitData);
```

### 4. IPC通道未注册

**检查方法**: 查看控制台是否有以下错误
```
Error: No handler registered for 'project:create-quick'
```

**解决方案**: 确保主进程已注册IPC handlers
```javascript
// src/main/index.js
const { registerProjectCoreIPC } = require('./project/project-core-ipc');
registerProjectCoreIPC({ database, ... });
```

## 推荐解决方案

### 方案1: 修改前端使用快速创建（推荐）

**优点**:
- 不需要启动后端服务
- 响应速度快
- 适合简单项目创建

**修改步骤**:

1. 在 `/Users/mac/Documents/code2/chainlesschain/desktop-app-vue/src/renderer/stores/project.js` 中添加快速创建方法：

```javascript
/**
 * 快速创建项目（不使用AI）
 * @param {Object} createData - 创建数据
 */
async createProjectQuick(createData) {
  this.creatingProject = true;
  this.createProgress = 0;
  this.createStatus = '正在创建项目...';

  try {
    this.createProgress = 50;

    const response = await window.electronAPI.project.createQuick(createData);

    this.createProgress = 90;
    this.createStatus = '项目创建成功！';

    // 添加到列表
    this.projects.unshift(response);
    this.pagination.total++;

    this.createProgress = 100;

    return response;
  } catch (error) {
    this.createStatus = '创建失败: ' + error.message;
    throw error;
  } finally {
    setTimeout(() => {
      this.creatingProject = false;
      this.createProgress = 0;
      this.createStatus = '';
    }, 1000);
  }
},
```

2. 在 `ProjectManagementPage.vue` 中使用快速创建：

```javascript
const handleModalOk = async () => {
  try {
    await formRef.value.validate();

    loading.value = true;

    const submitData = {
      name: formData.name,
      description: formData.description,
      projectType: formData.project_type,  // 注意：快速创建用 projectType
      status: formData.status,
      tags: JSON.stringify(formData.tags),
      userId: authStore.currentUser?.id || 'default-user',
    };

    if (isEditing.value) {
      // 编辑
      await projectStore.updateProject(currentEditId.value, submitData);
      message.success('编辑成功');
    } else {
      // 新建 - 使用快速创建
      await projectStore.createProjectQuick(submitData);
      message.success('创建成功');
    }

    modalVisible.value = false;
  } catch (error) {
    if (error.errorFields) {
      return;
    }
    console.error('保存项目失败:', error);
    message.error('保存失败：' + error.message);
  } finally {
    loading.value = false;
  }
};
```

### 方案2: 启动后端服务

如果需要AI生成功能，必须启动后端：

```bash
# 启动Docker服务（Ollama, Qdrant等）
docker-compose up -d

# 启动项目服务
cd backend/project-service
mvn spring-boot:run

# 启动AI服务
cd backend/ai-service
uvicorn main:app --reload --port 8001
```

## 验证修复

创建项目后检查：

1. **数据库记录**:
```bash
# 查看项目列表
sqlite3 data/chainlesschain.db "SELECT id, name, project_type, root_path FROM projects LIMIT 5;"
```

2. **文件系统**:
```bash
# 查看项目目录
ls -la data/projects/
ls -la data/projects/<project-id>/
```

3. **前端UI**:
   - 打开项目列表页面
   - 检查新创建的项目是否显示
   - 点击项目查看文件列表

## 测试文件

创建了以下测试文件供参考：

1. `test-project-create.js` - 基础项目创建测试
2. `test-quick-create-fixed.js` - 快速创建完整流程测试
3. `test-frontend-create.js` - 前端调用模拟测试

## 结论

**项目创建功能本身没有问题！**

如果前端创建失败，最可能的原因是：
1. 后端服务未启动（使用 `project:create` 时）
2. IPC调用方式不正确

**建议使用快速创建方法**（方案1），这样不依赖后端服务，响应更快。

如果问题仍然存在，请提供：
1. 具体的错误信息（浏览器控制台）
2. 主进程日志
3. 操作步骤截图
