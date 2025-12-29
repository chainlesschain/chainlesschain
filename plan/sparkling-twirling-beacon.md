# 项目文件树组件全面修复计划

## 问题严重程度评估

**所有场景都失败**：
- ❌ 项目切换时文件树不更新
- ❌ 手动点击刷新按钮无效
- ❌ 初次打开项目看不到文件
- ❌ 两种文件树组件（VirtualFileTree 和 EnhancedFileTree）都有问题

**日志显示的多种失败情况**：
1. 文件数量显示为 0（数据未加载）
2. 文件数量正确但界面不显示（响应式失败）
3. 根本没有加载日志（流程未触发）
4. 项目根路径为 undefined（数据库问题）

## 根本原因分析

### 问题 1：数据库层 - root_path 为 null
**位置**：`src/main/index.js:5534`
```javascript
if (!rootPath) {
  return [];  // 直接返回空数组，没有尝试修复
}
```
**影响**：无法扫描文件系统，导致文件列表为空

### 问题 2：VirtualFileTree 响应式失效
**位置**：`src/renderer/components/projects/VirtualFileTree.vue:220-231`
```javascript
current[part] = {
  children: isLeaf ? null : {},  // 普通对象，非响应式
  expanded: expandedKeys.value.has(...)  // 快照，非响应式绑定
};
```
**影响**：树结构变化不触发 UI 更新

### 问题 3：EnhancedFileTree 缺少显式监听
**位置**：`src/renderer/components/projects/EnhancedFileTree.vue:266-405`
- 只依赖 computed 的自动追踪
- **没有显式 watch 监听 props.files**
- 某些情况下 computed 不会重新计算

### 问题 4：projectFiles computed 引用透传
**位置**：`src/renderer/pages/projects/ProjectDetailPage.vue:507-514`
```javascript
return files;  // 直接返回，未创建新引用
```
**影响**：Vue 可能检测不到数组内容变化

### 问题 5：时序和竞态问题
```javascript
await projectStore.loadProjectFiles(projectId.value);
fileTreeKey.value++;  // 可能在数据未完全刷新前执行
```
**影响**：组件用旧数据重新挂载

## 修复方案

### 🔴 第一阶段：数据库层修复（关键路径）

**优先级**：CRITICAL - 必须首先修复

**目标**：确保所有项目都有有效的 root_path

**文件**：`src/main/index.js`

**修改位置 1**：主进程初始化后自动修复（新增）
```javascript
// 在数据库初始化后添加
async initializeDatabase() {
  // ... 现有初始化代码

  // 自动修复缺失 root_path 的项目
  console.log('[Main] 检查并修复项目路径...');
  try {
    const result = await this.repairAllProjectRootPaths();
    if (result.fixed > 0) {
      console.log(`[Main] 自动修复了 ${result.fixed} 个项目的路径`);
    }
  } catch (error) {
    console.error('[Main] 自动修复失败:', error);
  }
}
```

**修改位置 2**：增强 project:get-files 错误处理（Line 5534）
```javascript
if (!rootPath) {
  console.error('[Main] ⚠️ 项目缺少 root_path，尝试自动修复');
  console.error('[Main] 项目ID:', projectId);

  // 尝试自动修复
  try {
    const repairResult = await this.repairProjectRootPath(projectId);

    if (repairResult.success) {
      console.log('[Main] ✅ 自动修复成功，重试文件扫描');
      // 重新获取项目信息
      const repairedProject = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      const repairedPath = repairedProject.root_path;

      if (repairedPath) {
        // 使用修复后的路径继续扫描
        // （将现有的扫描逻辑包装成函数调用）
        return await this.scanProjectFiles(projectId, repairedPath);
      }
    }
  } catch (repairError) {
    console.error('[Main] ❌ 自动修复失败:', repairError);
  }

  console.error('[Main] 建议：手动运行 project:repair-root-path');
  return [];
}
```

**修改位置 3**：添加辅助方法 repairProjectRootPath（新增）
```javascript
async repairProjectRootPath(projectId) {
  const project = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    throw new Error('项目不存在');
  }

  const projectType = project.project_type || project.projectType;
  if (projectType !== 'document') {
    return { success: false, message: '只能修复document类型的项目' };
  }

  if (project.root_path) {
    return { success: true, message: '项目已有root_path', rootPath: project.root_path };
  }

  const { getProjectConfig } = require('./project/project-config');
  const projectConfig = getProjectConfig();
  const projectRootPath = require('path').join(
    projectConfig.getProjectsRootPath(),
    projectId
  );

  await require('fs').promises.mkdir(projectRootPath, { recursive: true });

  await this.database.updateProject(projectId, {
    root_path: projectRootPath,
  });

  return { success: true, message: '修复成功', rootPath: projectRootPath };
}
```

**验证方法**：
1. 启动应用，查看控制台是否有"自动修复了 X 个项目"
2. 运行：`await window.electronAPI.project.repairAllRootPaths()`
3. 确认所有项目都能正常显示文件

---

### 🟠 第二阶段：VirtualFileTree 响应式修复（高优先级）

**文件**：`src/renderer/components/projects/VirtualFileTree.vue`

**修改 1**：导入 reactive 和 nextTick（Line 顶部）
```javascript
import { ref, computed, watch, reactive, nextTick } from 'vue';
```

**修改 2**：优化 watch 监听器（Line 275-282）
```javascript
// 监听文件列表变化 - 增强版
watch(
  () => props.files,
  async (newFiles, oldFiles) => {
    console.log('[VirtualFileTree] 文件列表变化');
    console.log('  旧长度:', oldFiles?.length || 0);
    console.log('  新长度:', newFiles?.length || 0);
    console.log('  引用改变:', newFiles !== oldFiles);

    buildTree();

    // 等待 DOM 更新
    await nextTick();
    console.log('[VirtualFileTree] 树构建完成，节点数:', flattenedNodes.value.length);
  },
  { immediate: true, deep: true }
);

// 添加文件数量变化监听（备用）
watch(
  () => props.files?.length,
  (newLen, oldLen) => {
    if (newLen !== oldLen) {
      console.log('[VirtualFileTree] 文件数量变化:', oldLen, '->', newLen);
      nextTick(() => buildTree());
    }
  }
);
```

**修改 3**：强制更新 flattenedNodes 引用（Line 270）
```javascript
// 构建扁平化列表后，强制创建新引用
flattenedNodes.value = [...flattened];  // 创建新数组引用
console.log('[VirtualFileTree] 扁平化完成，节点数:', flattenedNodes.value.length);
```

**修改 4**：添加生命周期日志（新增）
```javascript
onMounted(() => {
  console.log('[VirtualFileTree] onMounted, files:', props.files?.length || 0);
});

onUpdated(() => {
  console.log('[VirtualFileTree] onUpdated, files:', props.files?.length || 0);
});
```

---

### 🟠 第三阶段：EnhancedFileTree 监听增强（高优先级）

**文件**：`src/renderer/components/projects/EnhancedFileTree.vue`

**修改 1**：导入 nextTick（Line 顶部）
```javascript
import { ref, computed, watch, nextTick } from 'vue';
```

**修改 2**：添加显式 props.files 监听（Line 387 之后新增）
```javascript
// 显式监听 props.files 变化
watch(
  () => props.files,
  (newFiles, oldFiles) => {
    console.log('[EnhancedFileTree] Files prop 变化');
    console.log('  旧:', oldFiles?.length || 0);
    console.log('  新:', newFiles?.length || 0);
    console.log('  引用:', newFiles !== oldFiles ? '已改变' : '相同');

    // 强制 treeData computed 重新计算
    if (newFiles && newFiles.length > 0) {
      nextTick(() => {
        console.log('[EnhancedFileTree] 触发 treeData 重新计算');
        const _ = treeData.value;  // 访问 computed 强制计算
      });
    }
  },
  { immediate: true, deep: true }
);

// 文件数量变化监听（备用）
watch(
  () => props.files?.length,
  (newLen, oldLen) => {
    if (newLen !== oldLen) {
      console.log('[EnhancedFileTree] 文件数量变化:', oldLen, '->', newLen);
    }
  }
);
```

**修改 3**：增强 treeData computed 日志（Line 266-270）
```javascript
const treeData = computed(() => {
  console.log('[EnhancedFileTree] ========== treeData computed 执行 ==========');
  console.log('[EnhancedFileTree] props.files:', props.files?.length || 0);
  console.log('[EnhancedFileTree] 时间戳:', Date.now());

  if (!props.files || props.files.length === 0) {
    console.log('[EnhancedFileTree] 文件列表为空，返回空数组');
    return [];
  }

  // ... 现有树构建逻辑

  console.log('[EnhancedFileTree] 树构建完成，节点数:', result.length);
  console.log('[EnhancedFileTree] ========== treeData computed 结束 ==========');
  return result;
});
```

---

### 🟡 第四阶段：ProjectDetailPage 引用和时序修复（中优先级）

**文件**：`src/renderer/pages/projects/ProjectDetailPage.vue`

**修改 1**：projectFiles computed 创建新引用（Line 507-514）
```javascript
const projectFiles = computed(() => {
  const files = projectStore.projectFiles;
  console.log('[ProjectDetail] projectFiles computed 执行');
  console.log('  文件数量:', files?.length || 0);
  console.log('  时间戳:', Date.now());

  if (!files || files.length === 0) {
    console.log('[ProjectDetail] 返回空数组');
    return [];
  }

  if (files.length > 0 && files.length <= 3) {
    console.log('[ProjectDetail] 文件列表:', files.map(f => f.file_name).join(', '));
  } else if (files.length > 3) {
    console.log('[ProjectDetail] 前3个文件:', files.slice(0, 3).map(f => f.file_name).join(', '));
  }

  // 🔑 关键：创建新数组引用确保响应式
  const newRef = [...files];
  console.log('[ProjectDetail] 创建新引用，长度:', newRef.length);
  return newRef;
});
```

**修改 2**：handleRefreshFiles 增加 nextTick（Line 857-870）
```javascript
// 刷新文件列表
const handleRefreshFiles = async () => {
  refreshing.value = true;
  try {
    console.log('[ProjectDetail] ===== 开始刷新文件列表 =====');
    console.log('[ProjectDetail] 项目ID:', projectId.value);

    // 1. 加载文件到 store
    await projectStore.loadProjectFiles(projectId.value);
    console.log('[ProjectDetail] ✓ 文件已加载到 store');

    // 2. 等待 Vue 响应式传播
    await nextTick();
    console.log('[ProjectDetail] ✓ Vue 响应式第一轮传播完成');

    // 3. 再等待一轮确保所有 computed 更新
    await nextTick();
    console.log('[ProjectDetail] ✓ 所有 computed 已更新');

    // 4. 强制组件重新挂载
    fileTreeKey.value++;
    console.log('[ProjectDetail] ✓ 文件树 key 已更新:', fileTreeKey.value);

    // 5. 最后一轮等待渲染
    await nextTick();
    console.log('[ProjectDetail] ✓ 渲染完成');

    message.success('文件列表已刷新');
    console.log('[ProjectDetail] ===== 刷新完成 =====');
  } catch (error) {
    console.error('[ProjectDetail] ===== 刷新失败 =====');
    console.error('Refresh files failed:', error);
    message.error('刷新失败：' + error.message);
  } finally {
    refreshing.value = false;
  }
};
```

**修改 3**：创建统一的加载辅助函数（新增，Line 850 之前）
```javascript
/**
 * 统一的文件加载函数，确保响应式和时序正确
 */
const loadFilesWithSync = async (targetProjectId) => {
  console.log('[ProjectDetail] loadFilesWithSync 开始, projectId:', targetProjectId);

  // 1. 加载文件
  await projectStore.loadProjectFiles(targetProjectId);
  console.log('[ProjectDetail]   ✓ Store 已更新');

  // 2-3. 双重 nextTick 确保响应式完成
  await nextTick();
  await nextTick();
  console.log('[ProjectDetail]   ✓ 响应式已传播');

  // 4. 强制重新渲染
  fileTreeKey.value++;
  console.log('[ProjectDetail]   ✓ Key 已更新:', fileTreeKey.value);

  // 5. 等待渲染
  await nextTick();
  console.log('[ProjectDetail] loadFilesWithSync 完成');
};
```

**修改 4**：在所有加载点使用 loadFilesWithSync
- Line 1191（onMounted）：`await loadFilesWithSync(projectId.value);`
- Line 1155（AI 创建）：`await loadFilesWithSync(result.projectId);`
- Line 1360（项目切换）：`await loadFilesWithSync(newId);`
- Line 1239/1248/1262/1277（文件监听事件）：`await loadFilesWithSync(projectId.value);`

---

### 🔵 第五阶段：Store 层日志增强（低优先级）

**文件**：`src/renderer/stores/project.js`

**修改**：增强 loadProjectFiles 日志（Line 551-568）
```javascript
async loadProjectFiles(projectId) {
  const startTime = Date.now();
  console.log('[Store] ========== loadProjectFiles 开始 ==========');
  console.log('[Store] 项目ID:', projectId);
  console.log('[Store] 当前文件数:', this.projectFiles.length);

  try {
    const files = await window.electronAPI.project.getFiles(projectId);
    const elapsed = Date.now() - startTime;

    console.log('[Store] ✓ IPC 返回，耗时:', elapsed, 'ms');
    console.log('[Store] 接收文件数:', files?.length || 0);

    if (files && files.length > 0) {
      console.log('[Store] 前3个文件:', files.slice(0, 3).map(f => f.file_name).join(', '));
    }

    // 强制创建新数组引用，确保 Vue 响应式系统能检测到变化
    this.projectFiles = files ? [...files] : [];

    console.log('[Store] ✓ projectFiles 已更新');
    console.log('[Store] 新长度:', this.projectFiles.length);
    console.log('[Store] 引用已改变: true');
    console.log('[Store] 更新时间戳:', Date.now());
    console.log('[Store] ========== loadProjectFiles 结束 ==========');

    return this.projectFiles;
  } catch (error) {
    console.error('[Store] ========== loadProjectFiles 错误 ==========');
    console.error('[Store] Error:', error);
    throw error;
  }
}
```

---

## 实施顺序（关键路径）

### 必须首先完成（阻塞性问题）：
1. ✅ **第一阶段**：数据库层修复 - 没有数据，其他修复无意义
2. ✅ **第四阶段**：引用和时序修复 - 确保数据能正确传递

### 然后完成（响应式问题）：
3. ✅ **第二阶段**：VirtualFileTree 修复
4. ✅ **第三阶段**：EnhancedFileTree 修复

### 最后完成（辅助性）：
5. ✅ **第五阶段**：日志增强

## 测试验证计划

### 测试场景 A：初始加载
**步骤**：
1. 打开应用
2. 导航到任意项目
3. 检查文件树是否显示

**预期日志**：
```
[Main] ========== 开始获取项目文件 ==========
[Main] 项目根路径: C:\code\chainlesschain\data\projects\xxx
[Main] ✅ 项目目录存在，开始扫描...
[Main] ========== 返回 X 个文件 ==========
[Store] ========== loadProjectFiles 开始 ==========
[Store] ✓ projectFiles 已更新
[ProjectDetail] projectFiles computed 执行
[VirtualFileTree] 文件列表变化
[VirtualFileTree] 树构建完成，节点数: X
```

### 测试场景 B：手动刷新
**步骤**：
1. 在项目文件夹中添加新文件
2. 点击刷新按钮
3. 验证新文件显示

**预期日志**：
```
[ProjectDetail] ===== 开始刷新文件列表 =====
[ProjectDetail] ✓ 文件已加载到 store
[ProjectDetail] ✓ Vue 响应式第一轮传播完成
[ProjectDetail] ✓ Key 已更新: X
[ProjectDetail] ===== 刷新完成 =====
```

### 测试场景 C：项目切换
**步骤**：
1. 从项目A切换到项目B
2. 验证文件树显示项目B的文件

**预期日志**：
```
[ProjectDetail] 路由变化，切换项目
[ProjectDetail] loadFilesWithSync 开始
[Store] ========== loadProjectFiles 开始 ==========
[ProjectDetail] ✓ Key 已更新
```

### 测试场景 D：空项目
**步骤**：
1. 创建新的空项目
2. 验证显示"暂无文件"

**预期日志**：
```
[Store] 接收文件数: 0
[ProjectDetail] 返回空数组
```

### 测试场景 E：快速切换
**步骤**：
1. 快速在3个项目间切换
2. 验证最终显示正确项目的文件

**预期**：无竞态条件错误

## 关键文件清单

1. **src/main/index.js** (Lines 5200-5250, 5534-5600)
   - 数据库修复逻辑
   - 文件扫描错误处理

2. **src/renderer/components/projects/VirtualFileTree.vue** (Lines 196-290)
   - 响应式优化
   - watch 增强
   - 日志添加

3. **src/renderer/components/projects/EnhancedFileTree.vue** (Lines 266-406)
   - 显式 watch 添加
   - treeData 日志增强

4. **src/renderer/pages/projects/ProjectDetailPage.vue** (Lines 507-514, 857-870, 1155-1195, 1360-1370)
   - computed 引用修复
   - 时序优化
   - 统一加载函数

5. **src/renderer/stores/project.js** (Lines 551-568)
   - 日志增强

## 预期效果

修复完成后：
- ✅ 初次打开项目：文件树立即显示
- ✅ 项目切换：文件树立即更新
- ✅ 手动刷新：新文件立即显示
- ✅ 控制台日志：清晰追踪数据流
- ✅ 无竞态条件错误
- ✅ 用户体验：流畅无卡顿

## 回滚方案

如果出现问题：
1. 第二阶段回滚：移除 reactive() 包装
2. 第三阶段回滚：移除显式 watch
3. 第四阶段回滚：恢复直接返回引用
4. 保留第一阶段和第五阶段（无副作用）
