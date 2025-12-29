# ChainlessChain 数据同步机制实施计划

## 概述

在用户登录成功后，实现本地 SQLite 数据库与后端 PostgreSQL 数据库的双向异步同步，采用手动冲突解决策略。

**用户选择的配置**:
- 冲突解决: 手动弹窗选择
- 同步时机: 登录后立即全量同步 + 定期增量同步
- 后端改动: 添加同步字段（sync_status、synced_at 等）
- 实施范围: 一次性实现所有核心表

---

## 实施步骤

### 阶段一：后端数据库和 API（2-3天）

#### 1.1 数据库迁移文件

**新建**: `backend/project-service/src/main/resources/db/migration/V003__add_sync_fields.sql`

```sql
-- 为所有核心表添加同步字段
ALTER TABLE projects ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
ALTER TABLE projects ADD COLUMN synced_at TIMESTAMP;
ALTER TABLE projects ADD COLUMN device_id VARCHAR(100);
ALTER TABLE projects ADD COLUMN deleted INTEGER DEFAULT 0;

ALTER TABLE project_files ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
ALTER TABLE project_files ADD COLUMN synced_at TIMESTAMP;
ALTER TABLE project_files ADD COLUMN content_hash VARCHAR(64);

ALTER TABLE project_conversations ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
ALTER TABLE project_conversations ADD COLUMN synced_at TIMESTAMP;

ALTER TABLE project_tasks ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';
ALTER TABLE project_tasks ADD COLUMN synced_at TIMESTAMP;

ALTER TABLE project_collaborators ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';

ALTER TABLE project_comments ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced';

-- 创建同步日志表
CREATE TABLE IF NOT EXISTS sync_logs (
  id VARCHAR(36) PRIMARY KEY,
  table_name VARCHAR(100) NOT NULL,
  record_id VARCHAR(36) NOT NULL,
  operation VARCHAR(20) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  error_message TEXT,
  device_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 添加索引
CREATE INDEX idx_projects_sync_status ON projects(sync_status);
CREATE INDEX idx_projects_synced_at ON projects(synced_at);
CREATE INDEX idx_project_files_sync_status ON project_files(sync_status);
CREATE INDEX idx_sync_logs_device_id ON sync_logs(device_id);
```

#### 1.2 后端 Entity 更新

**修改以下 Entity**:
- `backend/project-service/src/main/java/com/chainlesschain/project/entity/Project.java`
- `backend/project-service/src/main/java/com/chainlesschain/project/entity/ProjectFile.java`
- 其他相关 Entity

添加字段：
```java
@TableField("sync_status")
private String syncStatus = "synced";

@TableField("synced_at")
private LocalDateTime syncedAt;

@TableField("device_id")
private String deviceId;
```

#### 1.3 后端 DTO 和 Controller

**新建**: `backend/project-service/src/main/java/com/chainlesschain/project/dto/SyncRequestDTO.java`

```java
public class SyncRequestDTO {
    private String tableName;
    private Long lastSyncedAt;  // 毫秒时间戳
    private String deviceId;
    private List<Map<String, Object>> records;  // 上传的数据
}
```

**新建**: `backend/project-service/src/main/java/com/chainlesschain/project/dto/SyncResponseDTO.java`

```java
public class SyncResponseDTO {
    private List<Map<String, Object>> newRecords;      // 新增记录
    private List<Map<String, Object>> updatedRecords;  // 更新记录
    private List<String> deletedIds;                   // 已删除的ID
    private Long serverTimestamp;                      // 服务器时间戳
}
```

**新建**: `backend/project-service/src/main/java/com/chainlesschain/project/controller/SyncController.java`

核心 API 接口：
```java
@RestController
@RequestMapping("/api/sync")
public class SyncController {

    // 批量上传数据
    @PostMapping("/upload")
    public Result<Map<String, Object>> uploadBatch(@RequestBody SyncRequestDTO request);

    // 增量下载数据
    @GetMapping("/download/{tableName}")
    public Result<SyncResponseDTO> downloadIncremental(
        @PathVariable String tableName,
        @RequestParam Long lastSyncedAt,
        @RequestParam String deviceId
    );

    // 获取同步状态
    @GetMapping("/status")
    public Result<Map<String, Object>> getSyncStatus(@RequestParam String deviceId);

    // 解决冲突
    @PostMapping("/resolve-conflict")
    public Result<Void> resolveConflict(@RequestBody ConflictResolutionDTO resolution);
}
```

#### 1.4 后端 Service 实现

**新建**: `backend/project-service/src/main/java/com/chainlesschain/project/service/SyncService.java`

核心逻辑：
- 接收客户端上传的数据
- 比对 `updated_at` 检测冲突
- 返回增量数据
- 记录同步日志

---

### 阶段二：前端数据库表结构更新（0.5天）

#### 2.1 本地数据库迁移

**修改**: `desktop-app-vue/src/main/database.js`

在 `migrateDatabase()` 方法中添加迁移逻辑：

```javascript
// 为现有表添加同步字段（如果不存在）
migrateDatabase() {
  const currentVersion = this.getUserVersion();

  if (currentVersion < 2) {
    console.log('[Database] 执行迁移到版本 2: 添加同步字段');

    // projects 表
    this.db.exec(`
      ALTER TABLE projects ADD COLUMN synced_at INTEGER;
      ALTER TABLE projects ADD COLUMN deleted INTEGER DEFAULT 0;
    `);

    // conversations 表
    this.db.exec(`
      ALTER TABLE conversations ADD COLUMN sync_status TEXT DEFAULT 'pending';
      ALTER TABLE conversations ADD COLUMN synced_at INTEGER;
    `);

    // messages 表
    this.db.exec(`
      ALTER TABLE messages ADD COLUMN sync_status TEXT DEFAULT 'pending';
      ALTER TABLE messages ADD COLUMN synced_at INTEGER;
    `);

    this.setUserVersion(2);
  }

  // 未来的迁移可以继续添加...
}
```

---

### 阶段三：前端同步管理器（3-4天）

#### 3.1 核心文件结构

**新建目录**: `desktop-app-vue/src/main/sync/`

创建以下文件：

```
sync/
├── db-sync-manager.js      # 数据库同步管理器（核心）
├── sync-queue.js            # 异步任务队列
├── sync-strategies.js       # 冲突解决策略
├── field-mapper.js          # 字段映射工具
├── sync-config.js           # 同步配置
└── sync-http-client.js      # 同步HTTP客户端
```

#### 3.2 同步 HTTP 客户端

**新建**: `desktop-app-vue/src/main/sync/sync-http-client.js`

扩展现有的 ProjectHTTPClient：

```javascript
const { ProjectHTTPClient } = require('../project/http-client');

class SyncHTTPClient extends ProjectHTTPClient {
  constructor(baseURL) {
    super(baseURL);
  }

  // 批量上传
  async uploadBatch(tableName, records, deviceId) {
    return this.client.post('/api/sync/upload', {
      tableName,
      records,
      deviceId,
      lastSyncedAt: Date.now()
    });
  }

  // 增量下载
  async downloadIncremental(tableName, lastSyncedAt, deviceId) {
    return this.client.get(`/api/sync/download/${tableName}`, {
      params: { lastSyncedAt, deviceId }
    });
  }

  // 获取同步状态
  async getSyncStatus(deviceId) {
    return this.client.get('/api/sync/status', {
      params: { deviceId }
    });
  }

  // 解决冲突
  async resolveConflict(conflictId, resolution, selectedVersion) {
    return this.client.post('/api/sync/resolve-conflict', {
      conflictId,
      resolution,
      selectedVersion
    });
  }
}

module.exports = SyncHTTPClient;
```

#### 3.3 字段映射工具

**新建**: `desktop-app-vue/src/main/sync/field-mapper.js`

```javascript
class FieldMapper {
  // 时间戳转换：毫秒 → ISO 8601
  toISO8601(milliseconds) {
    return milliseconds ? new Date(milliseconds).toISOString() : null;
  }

  // 时间戳转换：ISO 8601 → 毫秒
  toMillis(isoString) {
    return isoString ? new Date(isoString).getTime() : null;
  }

  // 本地记录 → 后端格式
  toBackend(localRecord, tableName) {
    const base = {
      id: localRecord.id,
      createdAt: this.toISO8601(localRecord.created_at),
      updatedAt: this.toISO8601(localRecord.updated_at),
    };

    // 根据表名特殊处理
    switch (tableName) {
      case 'projects':
        return {
          ...base,
          userId: localRecord.user_id,
          name: localRecord.name,
          description: localRecord.description,
          projectType: localRecord.project_type,
          status: localRecord.status,
          rootPath: localRecord.root_path,
          fileCount: localRecord.file_count,
          totalSize: localRecord.total_size,
          syncStatus: localRecord.sync_status,
          syncedAt: this.toISO8601(localRecord.synced_at),
          deviceId: localRecord.device_id
        };

      case 'project_files':
        return {
          ...base,
          projectId: localRecord.project_id,
          filePath: localRecord.file_path,
          fileName: localRecord.file_name,
          fileType: localRecord.file_type,
          content: localRecord.content,
          contentHash: localRecord.content_hash,
          version: localRecord.version
        };

      // 其他表...
      default:
        return base;
    }
  }

  // 后端格式 → 本地记录
  toLocal(backendRecord, tableName) {
    const base = {
      id: backendRecord.id,
      created_at: this.toMillis(backendRecord.createdAt),
      updated_at: this.toMillis(backendRecord.updatedAt),
      synced_at: Date.now(),
      sync_status: 'synced'
    };

    switch (tableName) {
      case 'projects':
        return {
          ...base,
          user_id: backendRecord.userId,
          name: backendRecord.name,
          description: backendRecord.description,
          project_type: backendRecord.projectType,
          status: backendRecord.status,
          root_path: backendRecord.rootPath,
          file_count: backendRecord.fileCount,
          total_size: backendRecord.totalSize,
          device_id: backendRecord.deviceId
        };

      case 'project_files':
        return {
          ...base,
          project_id: backendRecord.projectId,
          file_path: backendRecord.filePath,
          file_name: backendRecord.fileName,
          file_type: backendRecord.fileType,
          content: backendRecord.content,
          content_hash: backendRecord.contentHash,
          version: backendRecord.version
        };

      // 其他表...
      default:
        return base;
    }
  }
}

module.exports = FieldMapper;
```

#### 3.4 异步任务队列

**新建**: `desktop-app-vue/src/main/sync/sync-queue.js`

```javascript
const { EventEmitter } = require('events');

class SyncQueue extends EventEmitter {
  constructor(maxConcurrency = 3) {
    super();
    this.queue = [];
    this.maxConcurrency = maxConcurrency;
    this.activeCount = 0;
  }

  enqueue(task, priority = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject, priority });
      // 按优先级排序（优先级高的先执行）
      this.queue.sort((a, b) => b.priority - a.priority);
      this.process();
    });
  }

  async process() {
    if (this.activeCount >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    this.activeCount++;

    try {
      const result = await item.task();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.activeCount--;
      this.process();  // 处理下一个任务
    }
  }

  clear() {
    this.queue = [];
  }

  get length() {
    return this.queue.length;
  }
}

module.exports = SyncQueue;
```

#### 3.5 数据库同步管理器（核心）

**新建**: `desktop-app-vue/src/main/sync/db-sync-manager.js`

```javascript
const { EventEmitter } = require('events');
const SyncHTTPClient = require('./sync-http-client');
const FieldMapper = require('./field-mapper');
const SyncQueue = require('./sync-queue');
const crypto = require('crypto');

class DBSyncManager extends EventEmitter {
  constructor(database, mainWindow) {
    super();
    this.database = database;
    this.mainWindow = mainWindow;
    this.httpClient = new SyncHTTPClient();
    this.fieldMapper = new FieldMapper();
    this.syncQueue = new SyncQueue(3);
    this.deviceId = null;
    this.syncLocks = new Map();
    this.isOnline = true;

    // 需要同步的表（按优先级排序）
    this.syncTables = [
      'projects',
      'project_files',
      'knowledge_items',
      'conversations',
      'messages',
      'project_collaborators',
      'project_comments',
      'project_tasks'
    ];
  }

  async initialize(deviceId) {
    this.deviceId = deviceId;
    console.log('[DBSyncManager] 初始化，设备ID:', deviceId);

    // 启动定期同步（5分钟）
    this.startPeriodicSync();

    // 监听在线/离线事件
    this.setupNetworkListeners();
  }

  /**
   * 登录后的完整同步流程
   */
  async syncAfterLogin() {
    console.log('[DBSyncManager] 开始登录后同步');

    this.emit('sync:started', {
      totalTables: this.syncTables.length
    });

    let completedTables = 0;
    const conflicts = [];

    for (const tableName of this.syncTables) {
      try {
        console.log(`[DBSyncManager] 同步表: ${tableName}`);

        this.emit('sync:table-started', {
          table: tableName,
          progress: completedTables / this.syncTables.length * 100
        });

        // 1. 上传本地新数据
        await this.uploadLocalChanges(tableName);

        // 2. 下载远程新数据
        const result = await this.downloadRemoteChanges(tableName);

        // 3. 检测冲突
        if (result.conflicts && result.conflicts.length > 0) {
          conflicts.push(...result.conflicts.map(c => ({ ...c, table: tableName })));
        }

        completedTables++;

        this.emit('sync:table-completed', {
          table: tableName,
          progress: completedTables / this.syncTables.length * 100
        });

      } catch (error) {
        console.error(`[DBSyncManager] 同步表 ${tableName} 失败:`, error);
        this.emit('sync:error', { table: tableName, error });
      }
    }

    // 如果有冲突，通知前端
    if (conflicts.length > 0) {
      this.emit('sync:conflicts-detected', { conflicts });
      // 发送IPC到渲染进程显示冲突对话框
      this.mainWindow.webContents.send('sync:show-conflicts', conflicts);
    }

    this.emit('sync:completed', {
      totalTables: completedTables,
      conflicts: conflicts.length
    });

    console.log('[DBSyncManager] 登录后同步完成');
  }

  /**
   * 上传本地变更
   */
  async uploadLocalChanges(tableName) {
    // 查询所有待同步的记录
    const pendingRecords = this.database.db
      .prepare(`SELECT * FROM ${tableName} WHERE sync_status = ? OR sync_status IS NULL`)
      .all('pending');

    if (pendingRecords.length === 0) {
      console.log(`[DBSyncManager] 表 ${tableName} 无待上传数据`);
      return;
    }

    console.log(`[DBSyncManager] 上传 ${pendingRecords.length} 条记录到表 ${tableName}`);

    // 转换为后端格式
    const backendRecords = pendingRecords.map(record =>
      this.fieldMapper.toBackend(record, tableName)
    );

    // 批量上传
    await this.httpClient.uploadBatch(tableName, backendRecords, this.deviceId);

    // 标记为已同步
    for (const record of pendingRecords) {
      this.database.db.run(
        `UPDATE ${tableName} SET sync_status = ?, synced_at = ? WHERE id = ?`,
        ['synced', Date.now(), record.id]
      );
    }
  }

  /**
   * 下载远程变更
   */
  async downloadRemoteChanges(tableName) {
    // 获取本地最后同步时间
    const lastSyncResult = this.database.db
      .prepare(`SELECT MAX(synced_at) as last_synced FROM ${tableName}`)
      .get();

    const lastSyncedAt = lastSyncResult?.last_synced || 0;

    console.log(`[DBSyncManager] 下载表 ${tableName} 的增量数据，上次同步: ${new Date(lastSyncedAt)}`);

    // 请求增量数据
    const response = await this.httpClient.downloadIncremental(
      tableName,
      lastSyncedAt,
      this.deviceId
    );

    const { newRecords, updatedRecords, deletedIds } = response;
    const conflicts = [];

    // 处理新增记录
    for (const backendRecord of newRecords || []) {
      const localRecord = this.fieldMapper.toLocal(backendRecord, tableName);
      this.insertOrUpdateLocal(tableName, localRecord);
    }

    // 处理更新记录（可能产生冲突）
    for (const backendRecord of updatedRecords || []) {
      const conflict = await this.handleUpdate(tableName, backendRecord);
      if (conflict) {
        conflicts.push(conflict);
      }
    }

    // 处理删除记录
    for (const deletedId of deletedIds || []) {
      this.database.db.run(
        `UPDATE ${tableName} SET deleted = 1 WHERE id = ?`,
        [deletedId]
      );
    }

    return { conflicts };
  }

  /**
   * 处理更新（冲突检测）
   */
  async handleUpdate(tableName, backendRecord) {
    const localRecord = this.database.db
      .prepare(`SELECT * FROM ${tableName} WHERE id = ?`)
      .get(backendRecord.id);

    if (!localRecord) {
      // 本地不存在，直接插入
      const converted = this.fieldMapper.toLocal(backendRecord, tableName);
      this.insertOrUpdateLocal(tableName, converted);
      return null;
    }

    // 检测冲突
    const backendUpdatedAt = this.fieldMapper.toMillis(backendRecord.updatedAt);
    const localUpdatedAt = localRecord.updated_at;
    const localSyncedAt = localRecord.synced_at || 0;

    // 冲突条件：本地在上次同步后被修改过 && 远程也被修改过
    if (localUpdatedAt > localSyncedAt && backendUpdatedAt > localSyncedAt) {
      console.warn('[DBSyncManager] 检测到冲突:', tableName, backendRecord.id);

      return {
        id: backendRecord.id,
        table: tableName,
        localRecord,
        remoteRecord: this.fieldMapper.toLocal(backendRecord, tableName),
        localUpdatedAt,
        remoteUpdatedAt: backendUpdatedAt
      };
    }

    // 无冲突，远程较新，直接更新
    if (backendUpdatedAt > localUpdatedAt) {
      const converted = this.fieldMapper.toLocal(backendRecord, tableName);
      this.insertOrUpdateLocal(tableName, converted);
    }

    return null;
  }

  /**
   * 插入或更新本地记录
   */
  insertOrUpdateLocal(tableName, record) {
    const columns = Object.keys(record);
    const placeholders = columns.map(() => '?').join(', ');
    const updateSet = columns.map(col => `${col} = excluded.${col}`).join(', ');

    this.database.db.run(
      `INSERT INTO ${tableName} (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updateSet}`,
      Object.values(record)
    );
  }

  /**
   * 定期增量同步
   */
  startPeriodicSync() {
    this.periodicSyncTimer = setInterval(() => {
      if (this.isOnline) {
        console.log('[DBSyncManager] 执行定期增量同步');
        this.syncIncremental();
      }
    }, 5 * 60 * 1000);  // 5分钟
  }

  async syncIncremental() {
    // 与 syncAfterLogin 类似，但只同步有变更的表
    for (const tableName of this.syncTables) {
      const hasPending = this.database.db
        .prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE sync_status = 'pending'`)
        .get();

      if (hasPending.count > 0) {
        await this.uploadLocalChanges(tableName);
        await this.downloadRemoteChanges(tableName);
      }
    }
  }

  setupNetworkListeners() {
    // 可以使用 Node.js 的网络检测或在渲染进程监听
    // 这里简化处理
  }

  destroy() {
    if (this.periodicSyncTimer) {
      clearInterval(this.periodicSyncTimer);
    }
  }
}

module.exports = DBSyncManager;
```

---

### 阶段四：主进程集成（1天）

#### 4.1 修改主进程初始化

**修改**: `desktop-app-vue/src/main/index.js`

在 `onReady()` 方法中添加同步管理器初始化：

```javascript
// 在数据库初始化之后
this.database = new DatabaseManager();
await this.database.initialize();

// 初始化同步管理器
const DBSyncManager = require('./sync/db-sync-manager');
this.syncManager = new DBSyncManager(this.database, this.mainWindow);

// 监听同步事件
this.syncManager.on('sync:conflicts-detected', (data) => {
  console.log('[Main] 检测到同步冲突:', data.conflicts.length);
});
```

#### 4.2 添加 IPC 处理

在 `index.js` 中添加 IPC 处理器：

```javascript
// 启动同步
ipcMain.handle('sync:start', async (_event, deviceId) => {
  try {
    if (!this.syncManager) {
      return { success: false, error: '同步管理器未初始化' };
    }

    await this.syncManager.initialize(deviceId || 'default-device');
    await this.syncManager.syncAfterLogin();

    return { success: true };
  } catch (error) {
    console.error('[Main] 同步失败:', error);
    return { success: false, error: error.message };
  }
});

// 解决冲突
ipcMain.handle('sync:resolve-conflict', async (_event, conflictId, resolution) => {
  try {
    await this.syncManager.resolveConflict(conflictId, resolution);
    return { success: true };
  } catch (error) {
    console.error('[Main] 解决冲突失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取同步状态
ipcMain.handle('sync:get-status', async () => {
  try {
    return await this.syncManager.httpClient.getSyncStatus(this.syncManager.deviceId);
  } catch (error) {
    console.error('[Main] 获取同步状态失败:', error);
    return { success: false, error: error.message };
  }
});
```

---

### 阶段五：前端 UI 集成（2天）

#### 5.1 修改登录页面

**修改**: `desktop-app-vue/src/renderer/pages/LoginPage.vue`

在登录成功回调中添加同步触发：

```javascript
if (success) {
  message.success('登录成功!');

  // 设置为已认证
  store.setAuthenticated(true);

  // 启动后台同步（异步，不阻塞）
  const deviceId = store.deviceId || `device-${Date.now()}`;
  store.setDeviceId(deviceId);

  window.electron.ipcRenderer.invoke('sync:start', deviceId)
    .then(() => {
      console.log('[Sync] 同步完成');
      message.success('数据同步完成', 2);
    })
    .catch(error => {
      console.error('[Sync] 同步失败:', error);
      message.warning('数据同步失败，请稍后手动同步', 3);
    });

  // 立即跳转，不等待同步
  try {
    await systemAPI.maximize();
  } catch (error) {
    console.error('窗口最大化失败:', error);
  }

  router.push('/');
}
```

#### 5.2 创建冲突解决对话框

**新建**: `desktop-app-vue/src/renderer/components/SyncConflictDialog.vue`

```vue
<template>
  <a-modal
    v-model:open="visible"
    title="数据同步冲突"
    width="800px"
    :footer="null"
  >
    <div class="conflict-container">
      <a-alert
        message="检测到数据冲突"
        description="本地数据和云端数据都已修改，请选择保留哪个版本"
        type="warning"
        show-icon
        style="margin-bottom: 16px"
      />

      <div v-for="conflict in conflicts" :key="conflict.id" class="conflict-item">
        <h4>{{ conflict.table }} - {{ conflict.id }}</h4>

        <a-row :gutter="16">
          <a-col :span="12">
            <div class="version-card local">
              <h5>本地版本</h5>
              <div class="version-time">
                修改时间: {{ formatTime(conflict.localUpdatedAt) }}
              </div>
              <pre>{{ JSON.stringify(conflict.localRecord, null, 2) }}</pre>
              <a-button type="primary" @click="resolveConflict(conflict.id, 'local')">
                使用本地版本
              </a-button>
            </div>
          </a-col>

          <a-col :span="12">
            <div class="version-card remote">
              <h5>云端版本</h5>
              <div class="version-time">
                修改时间: {{ formatTime(conflict.remoteUpdatedAt) }}
              </div>
              <pre>{{ JSON.stringify(conflict.remoteRecord, null, 2) }}</pre>
              <a-button type="primary" @click="resolveConflict(conflict.id, 'remote')">
                使用云端版本
              </a-button>
            </div>
          </a-col>
        </a-row>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';

const visible = ref(false);
const conflicts = ref([]);

// 监听同步冲突事件
onMounted(() => {
  window.electron.ipcRenderer.on('sync:show-conflicts', (event, data) => {
    conflicts.value = data;
    visible.value = true;
  });
});

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleString('zh-CN');
};

const resolveConflict = async (conflictId, resolution) => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'sync:resolve-conflict',
      conflictId,
      resolution
    );

    if (result.success) {
      message.success('冲突已解决');
      // 移除已解决的冲突
      conflicts.value = conflicts.value.filter(c => c.id !== conflictId);

      if (conflicts.value.length === 0) {
        visible.value = false;
      }
    }
  } catch (error) {
    message.error('解决冲突失败: ' + error.message);
  }
};
</script>

<style scoped>
.conflict-container {
  max-height: 600px;
  overflow-y: auto;
}

.conflict-item {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid #f0f0f0;
}

.version-card {
  padding: 16px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
}

.version-card.local {
  background: #e6f7ff;
}

.version-card.remote {
  background: #fff7e6;
}

.version-time {
  color: #666;
  margin-bottom: 12px;
}

pre {
  max-height: 200px;
  overflow: auto;
  background: #f5f5f5;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
}
</style>
```

#### 5.3 在主布局中添加同步图标

**修改**: `desktop-app-vue/src/renderer/components/MainLayout.vue`

在右上角添加同步状态图标：

```vue
<template>
  <a-layout>
    <a-layout-header>
      <!-- 现有代码... -->

      <!-- 添加同步图标 -->
      <div class="sync-indicator" @click="showSyncStatus">
        <a-spin v-if="isSyncing" :indicator="syncIndicator" />
        <CloudSyncOutlined v-else :style="{ color: syncError ? 'red' : '#52c41a' }" />
      </div>
    </a-layout-header>

    <!-- 添加冲突对话框组件 -->
    <SyncConflictDialog />
  </a-layout>
</template>

<script setup>
import { ref } from 'vue';
import { CloudSyncOutlined, LoadingOutlined } from '@ant-design/icons-vue';
import SyncConflictDialog from './SyncConflictDialog.vue';

const isSyncing = ref(false);
const syncError = ref(false);
const syncIndicator = h(LoadingOutlined, { spin: true });

// 监听同步事件
window.electron.ipcRenderer.on('sync:started', () => {
  isSyncing.value = true;
  syncError.value = false;
});

window.electron.ipcRenderer.on('sync:completed', () => {
  isSyncing.value = false;
});

window.electron.ipcRenderer.on('sync:error', () => {
  isSyncing.value = false;
  syncError.value = true;
});
</script>
```

---

### 阶段六：Preload 桥接（0.5天）

**修改**: `desktop-app-vue/src/preload/index.js`

添加同步相关的 API：

```javascript
const api = {
  // 现有 API...

  // 同步 API
  sync: {
    start: (deviceId) => ipcRenderer.invoke('sync:start', deviceId),
    resolveConflict: (conflictId, resolution) =>
      ipcRenderer.invoke('sync:resolve-conflict', conflictId, resolution),
    getStatus: () => ipcRenderer.invoke('sync:get-status'),

    // 监听同步事件
    onSyncStarted: (callback) => ipcRenderer.on('sync:started', callback),
    onSyncCompleted: (callback) => ipcRenderer.on('sync:completed', callback),
    onSyncError: (callback) => ipcRenderer.on('sync:error', callback),
    onShowConflicts: (callback) => ipcRenderer.on('sync:show-conflicts', callback),
  }
};
```

---

## 测试计划

### 单元测试
1. FieldMapper 时间戳转换测试
2. SyncQueue 队列管理测试
3. 冲突检测逻辑测试

### 集成测试
1. 登录后完整同步流程
2. 增量同步流程
3. 冲突解决流程
4. 网络中断恢复测试
5. 大数据量同步测试（1000+ 记录）

### 边界测试
1. 离线模式测试
2. 并发修改测试
3. 服务器错误处理测试

---

## 关键文件清单

### 后端（7个文件）
1. `backend/project-service/src/main/resources/db/migration/V003__add_sync_fields.sql`
2. `backend/project-service/src/main/java/com/chainlesschain/project/entity/Project.java`
3. `backend/project-service/src/main/java/com/chainlesschain/project/dto/SyncRequestDTO.java`
4. `backend/project-service/src/main/java/com/chainlesschain/project/dto/SyncResponseDTO.java`
5. `backend/project-service/src/main/java/com/chainlesschain/project/controller/SyncController.java`
6. `backend/project-service/src/main/java/com/chainlesschain/project/service/SyncService.java`
7. `backend/project-service/src/main/java/com/chainlesschain/project/service/impl/SyncServiceImpl.java`

### 前端主进程（7个文件）
1. `desktop-app-vue/src/main/sync/db-sync-manager.js` ⭐ 核心
2. `desktop-app-vue/src/main/sync/sync-http-client.js`
3. `desktop-app-vue/src/main/sync/field-mapper.js`
4. `desktop-app-vue/src/main/sync/sync-queue.js`
5. `desktop-app-vue/src/main/sync/sync-config.js`
6. `desktop-app-vue/src/main/database.js` （修改）
7. `desktop-app-vue/src/main/index.js` （修改）

### 前端渲染进程（4个文件）
1. `desktop-app-vue/src/renderer/pages/LoginPage.vue` （修改）
2. `desktop-app-vue/src/renderer/components/MainLayout.vue` （修改）
3. `desktop-app-vue/src/renderer/components/SyncConflictDialog.vue` ⭐ 核心
4. `desktop-app-vue/src/preload/index.js` （修改）

---

## 技术决策说明

### 为什么选择手动冲突解决？
- **优点**: 数据安全可控，用户可见性高
- **缺点**: 需要用户参与
- **决策理由**: 知识库和项目数据价值高，自动覆盖风险大

### 为什么登录后立即全量同步？
- **优点**: 数据一致性强，用户体验流畅
- **缺点**: 首次登录可能耗时较长
- **决策理由**: 用户切换设备时需要最新数据，异步执行不阻塞界面

### 为什么添加后端同步字段？
- **优点**: 同步状态可追溯，支持多设备、冲突检测更准确
- **缺点**: 需要数据库迁移
- **决策理由**: 长期来看，完整的同步机制需要字段支持

### 为什么使用异步队列？
- **优点**: 不阻塞 UI，支持并发控制，容错性好
- **缺点**: 实现复杂度增加
- **决策理由**: 同步操作耗时，队列化可提升用户体验

---

## 预计工作量

| 阶段 | 工作量 | 优先级 |
|------|--------|--------|
| 后端数据库和 API | 2-3天 | 高 |
| 前端数据库迁移 | 0.5天 | 高 |
| 前端同步管理器 | 3-4天 | 高 |
| 主进程集成 | 1天 | 高 |
| 前端 UI 集成 | 2天 | 中 |
| Preload 桥接 | 0.5天 | 高 |
| 测试和调试 | 2-3天 | 高 |

**总计**: 11-14 天

---

## 下一步行动

1. 开始实施阶段一：后端数据库迁移和 API 开发
2. 并行进行阶段二：前端数据库表结构更新
3. 逐步实现阶段三到阶段六
4. 每个阶段完成后进行充分测试
