# 错误诊断报告

## 问题概述

应用启动后出现两类重复性错误，每30秒触发一次：

1. **模板加载失败** - `template.js:53:16` `fetchTemplates` 函数
2. **待处理邀请加载失败** - `DIDInvitationNotifier.vue:313:12` `loadPendingInvitations` 函数

## 根本原因分析

### 1. 模板管理器 (TemplateManager) 未正确初始化

**IPC 处理器**: `template:getAll` (template-ipc.js:29)

```javascript
ipcMain.handle('template:getAll', async (_event, filters = {}) => {
  if (!templateManager) {
    throw new Error('模板管理器未初始化'); // ← 可能触发此错误
  }
  // ...
});
```

**IPC 注册**: `ipc-registry.js:747`

```javascript
registerTemplateIPC({
  templateManager: app.templateManager, // ← 可能为 undefined
});
```

### 2. 组织管理器 (OrganizationManager) 未正确初始化

**IPC 处理器**: `org:get-pending-did-invitations` (organization-ipc.js:343)

```javascript
ipcMain.handle('org:get-pending-did-invitations', async (_event) => {
  if (!organizationManager) {
    return []; // ← 返回空数组，但前端可能期望正常响应
  }
  // ...
});
```

**IPC 注册**: `ipc-registry.js:594` (条件注册)

```javascript
if (organizationManager || dbManager) {
  registerOrganizationIPC({
    organizationManager, // ← 可能为 undefined
    dbManager,
    versionManager,
  });
}
```

### 3. 定时任务无限重试

**模板加载定时任务**: `DIDInvitationNotifier.vue:460`
```javascript
refreshInterval = setInterval(() => {
  loadPendingInvitations(); // 每30秒重试
}, 30000);
```

**问题**: 如果管理器未初始化，会无限重试而不会停止。

### 4. 错误日志缺少详细信息

原始代码只记录了错误对象，没有记录详细信息：
```javascript
logger.error('加载待处理邀请失败:', error); // error 对象可能没有被正确序列化
```

## 已实施的修复

### 1. 改进错误日志输出

**文件**: `desktop-app-vue/src/renderer/stores/template.js`

```diff
- logger.error('[TemplateStore] 加载项目模板失败:', result.error)
+ logger.error('[TemplateStore] 加载项目模板失败 - 错误详情:', result.error, '完整结果:', JSON.stringify(result))

- logger.error('[TemplateStore] 加载模板异常:', error)
+ logger.error('[TemplateStore] 加载模板异常 - 错误类型:', error.name, '错误消息:', error.message, '完整错误:', error)
```

**文件**: `desktop-app-vue/src/renderer/components/DIDInvitationNotifier.vue`

```diff
- logger.error('加载待处理邀请失败:', error);
+ logger.error('加载待处理邀请失败 - 错误类型:', error?.name, '错误消息:', error?.message, '完整错误:', error);
```

### 2. 添加管理器初始化状态日志

**文件**: `desktop-app-vue/src/main/template/template-ipc.js`

```diff
function registerTemplateIPC({ templateManager }) {
  logger.info('[Template IPC] Registering Template IPC handlers...');
+ logger.info('[Template IPC] templateManager初始化状态:', {
+   exists: !!templateManager,
+   type: typeof templateManager,
+   constructor: templateManager?.constructor?.name
+ });
```

**文件**: `desktop-app-vue/src/main/organization/organization-ipc.js`

```diff
logger.info('[Organization IPC] Registering Organization IPC handlers...');
+ logger.info('[Organization IPC] organizationManager初始化状态:', {
+   exists: !!organizationManager,
+   type: typeof organizationManager,
+   constructor: organizationManager?.constructor?.name
+ });
```

## 后续排查步骤

### 步骤1: 重启应用并查看详细日志

```bash
cd desktop-app-vue
npm run dev
```

查看控制台输出，重点关注：

1. `[Template IPC] templateManager初始化状态:` - 检查 `exists` 是否为 `false`
2. `[Organization IPC] organizationManager初始化状态:` - 检查 `exists` 是否为 `false`
3. `[TemplateStore] 加载项目模板失败 - 错误详情:` - 查看具体错误消息
4. `加载待处理邀请失败 - 错误类型:` - 查看具体错误消息

### 步骤2: 检查 Bootstrap 初始化日志

在控制台中搜索以下关键字：

- `[Bootstrap]` - Bootstrap 初始化过程
- `templateManager` - 模板管理器创建
- `organizationManager` - 组织管理器创建
- `Bootstrap 初始化失败` - 初始化错误

### 步骤3: 验证管理器是否在 Bootstrap 配置中

检查 `desktop-app-vue/src/main/bootstrap/index.js`:

```javascript
modules: ["fileImporter", "templateManager", "ukeyManager"], // ← 确认包含 templateManager
// ...
"organizationManager", // ← 确认包含 organizationManager
```

## 潜在解决方案

### 方案1: 延迟加载 - 等待管理器初始化后再启动定时任务

**文件**: `DIDInvitationNotifier.vue`

```javascript
onMounted(async () => {
  // 检查 IPC 是否可用
  try {
    await loadPendingInvitations();

    // 只有首次加载成功后才启动定时任务
    refreshInterval = setInterval(() => {
      loadPendingInvitations();
    }, 30000);
  } catch (error) {
    logger.warn('组织邀请功能不可用，跳过定时刷新');
    // 不启动定时任务
  }
});
```

### 方案2: 添加重试限制

```javascript
let retryCount = 0;
const MAX_RETRIES = 5;

const loadPendingInvitations = async () => {
  loading.value = true;
  try {
    const invitations = await window.ipc.invoke('org:get-pending-did-invitations');
    pendingInvitations.value = invitations || [];
    retryCount = 0; // 重置计数
  } catch (error) {
    logger.error('加载待处理邀请失败:', error);
    retryCount++;

    if (retryCount >= MAX_RETRIES) {
      logger.warn(`已重试 ${MAX_RETRIES} 次，停止定时任务`);
      clearInterval(refreshInterval);
    }
  } finally {
    loading.value = false;
  }
};
```

### 方案3: 特性开关 - 根据管理器状态启用/禁用功能

**文件**: `desktop-app-vue/src/preload/index.js`

```javascript
// 添加健康检查 API
healthCheck: {
  isTemplateManagerAvailable: () => ipcRenderer.invoke('health:template-manager'),
  isOrganizationManagerAvailable: () => ipcRenderer.invoke('health:organization-manager'),
}
```

**文件**: 前端组件

```javascript
const isFeatureAvailable = ref(false);

onMounted(async () => {
  // 检查功能是否可用
  isFeatureAvailable.value = await window.ipc.healthCheck.isOrganizationManagerAvailable();

  if (isFeatureAvailable.value) {
    await loadPendingInvitations();
    refreshInterval = setInterval(() => loadPendingInvitations(), 30000);
  } else {
    logger.info('组织邀请功能未启用');
  }
});
```

### 方案4: 修复 Bootstrap 初始化 (如果管理器确实未初始化)

需要检查 `bootstrap/index.js` 中的模块加载逻辑，确保：

1. TemplateManager 正确实例化
2. OrganizationManager 正确实例化
3. 初始化失败时有明确的错误日志

## 诊断清单

- [ ] 重启应用，查看详细错误日志
- [ ] 检查 `templateManager初始化状态` 日志
- [ ] 检查 `organizationManager初始化状态` 日志
- [ ] 检查 Bootstrap 初始化日志
- [ ] 确认管理器在 bootstrap 配置中
- [ ] 实施方案1: 延迟加载
- [ ] 实施方案2: 添加重试限制
- [ ] 实施方案3: 特性开关
- [ ] 如需要，修复 Bootstrap 初始化

## 下一步行动

1. **立即**: 重启应用，查看改进后的日志输出
2. **根据日志**: 确定管理器是否真的未初始化
3. **选择方案**: 根据诊断结果选择合适的修复方案
4. **验证**: 修复后确认错误不再出现

---

**生成时间**: 2026-02-04
**生成者**: Claude Sonnet 4.5
**相关文件**:
- `desktop-app-vue/src/renderer/stores/template.js`
- `desktop-app-vue/src/renderer/components/DIDInvitationNotifier.vue`
- `desktop-app-vue/src/main/template/template-ipc.js`
- `desktop-app-vue/src/main/organization/organization-ipc.js`
- `desktop-app-vue/src/main/ipc/ipc-registry.js`
- `desktop-app-vue/src/main/bootstrap/index.js`
