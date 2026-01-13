# 移动端同步功能说明

## 概述

ChainlessChain v0.23.0 实现了完整的桌面-移动端数据同步功能，支持知识库、联系人、群聊、消息的双向实时同步。

## 核心功能

### 1. 桌面-移动端数据同步

#### 同步范围
- **知识库同步**: 笔记的创建、编辑、删除实时同步
- **联系人同步**: 好友信息、状态变更同步
- **群聊同步**: 群聊信息、成员列表同步
- **消息同步**: 群聊消息实时推送

#### 同步方式
- **增量同步**: 基于时间戳的增量同步，只传输变更数据
- **批量同步**: 支持批量传输，减少网络请求
- **双向同步**: 桌面端和移动端都可以发起同步

#### 同步策略
- **自动同步**: 可配置自动同步间隔（默认30秒）
- **手动同步**: 支持用户手动触发同步
- **离线队列**: 离线时变更加入队列，上线后自动同步

### 2. 群聊实时同步

#### 消息同步
- **实时推送**: 群聊消息实时推送到所有在线成员
- **消息去重**: 自动检测和过滤重复消息
- **消息顺序**: 保证消息顺序的一致性
- **离线消息**: 离线成员上线后自动接收离线消息

#### 成员管理
- **成员变更**: 成员加入/退出实时通知
- **在线状态**: 实时更新成员在线状态
- **权限同步**: 成员权限变更实时同步

#### 群设置同步
- **群信息**: 群名称、描述、头像变更同步
- **群公告**: 群公告更新实时推送
- **群权限**: 群权限设置变更同步

### 3. 冲突解决

#### 冲突检测
- **时间戳比较**: 基于更新时间检测冲突
- **内容哈希**: 基于内容哈希检测冲突
- **版本号**: 基于版本号检测冲突

#### 解决策略
- **latest-wins**: 最新的变更获胜（默认）
- **manual**: 手动解决冲突
- **merge**: 自动合并变更

### 4. 离线队列管理

#### 队列功能
- **消息缓存**: 离线时消息加入队列
- **队列持久化**: 队列数据持久化到本地存储
- **队列大小限制**: 可配置队列最大大小（默认1000条）
- **自动清理**: 定期清理过期消息

#### 队列同步
- **上线同步**: 设备上线后自动同步队列
- **批量发送**: 批量发送队列中的消息
- **进度跟踪**: 实时显示同步进度

## 技术实现

### 桌面端

#### MobileSyncManager
- 负责管理移动设备连接
- 检测本地数据变更
- 向移动端推送变更
- 接收移动端上传的变更

#### GroupChatSyncManager
- 负责群聊消息同步
- 管理消息队列
- 处理消息去重
- 维护成员在线状态

### 移动端

#### MobileSyncClient
- 连接到桌面端
- 接收桌面端推送的变更
- 上传本地变更
- 管理同步状态

#### 数据库操作
- 使用SQLite存储本地数据
- 支持INSERT OR REPLACE操作
- 支持软删除（deleted标记）

### 通信协议

#### P2P通信
- 基于WebRTC的P2P连接
- 使用DataChannel传输数据
- 支持消息确认和重传

#### 消息格式
```javascript
{
  type: 'mobile-sync:knowledge',  // 消息类型
  changes: [                       // 变更列表
    {
      type: 'upsert',              // 操作类型: upsert/delete
      entity: 'note',              // 实体类型
      id: 'note-001',              // 实体ID
      data: { ... },               // 实体数据
      timestamp: 1234567890        // 时间戳
    }
  ],
  batchIndex: 0,                   // 批次索引
  totalBatches: 1,                 // 总批次数
  timestamp: 1234567890            // 消息时间戳
}
```

## 使用指南

### 桌面端配置

1. **启动同步服务**
```javascript
const MobileSyncManager = require('./sync/mobile-sync-manager');

const syncManager = new MobileSyncManager(database, p2pManager, {
  syncInterval: 30000,        // 同步间隔（毫秒）
  batchSize: 100,             // 批量大小
  enableAutoSync: true,       // 启用自动同步
  syncKnowledge: true,        // 同步知识库
  syncContacts: true,         // 同步联系人
  syncGroupChats: true,       // 同步群聊
  syncMessages: true          // 同步消息
});
```

2. **注册移动设备**
```javascript
await syncManager.registerMobileDevice(deviceId, peerId, deviceInfo);
```

3. **开始同步**
```javascript
await syncManager.startSync(deviceId);
```

### 移动端配置

1. **初始化同步客户端**
```javascript
import { getMobileSyncClient } from '@/services/sync/mobile-sync-client';

const syncClient = getMobileSyncClient({
  enableAutoSync: true,
  syncKnowledge: true,
  syncContacts: true,
  syncGroupChats: true,
  syncMessages: true
});

await syncClient.initialize();
```

2. **连接到桌面端**
```javascript
await syncClient.connectToDesktop(peerId, deviceId);
```

3. **上传本地变更**
```javascript
await syncClient.uploadLocalChanges();
```

### UI组件使用

在移动端页面中使用同步面板组件：

```vue
<template>
  <view>
    <MobileSyncPanel />
  </view>
</template>

<script>
import MobileSyncPanel from '@/components/sync/MobileSyncPanel.vue';

export default {
  components: {
    MobileSyncPanel
  }
}
</script>
```

## 性能优化

### 1. 增量同步
- 只同步变更的数据，减少传输量
- 基于时间戳过滤，避免重复同步

### 2. 批量传输
- 批量发送变更，减少网络请求
- 可配置批量大小，平衡性能和实时性

### 3. 消息去重
- 使用消息ID缓存，避免重复处理
- 定期清理过期缓存，释放内存

### 4. 离线队列
- 离线时缓存消息，上线后批量同步
- 队列大小限制，避免内存溢出

### 5. 连接复用
- 复用P2P连接，减少连接开销
- 连接池管理，提高连接效率

## 安全性

### 1. 数据加密
- 使用Signal Protocol进行端到端加密
- 本地数据使用SQLCipher加密存储

### 2. 身份验证
- 基于DID的身份验证
- 设备配对验证

### 3. 权限控制
- 细粒度的同步权限控制
- 支持禁用特定类型的同步

## 监控和调试

### 统计信息
```javascript
const stats = syncManager.getStats();
console.log('同步统计:', stats);
// {
//   totalSyncs: 10,
//   knowledgeSynced: 50,
//   contactsSynced: 20,
//   groupChatsSynced: 5,
//   messagesSynced: 100,
//   isSyncing: false,
//   mobileDevicesCount: 2,
//   onlineDevicesCount: 1
// }
```

### 事件监听
```javascript
// 同步开始
syncManager.on('sync:started', ({ deviceId }) => {
  console.log('同步开始:', deviceId);
});

// 同步完成
syncManager.on('sync:completed', ({ deviceId, results }) => {
  console.log('同步完成:', deviceId, results);
});

// 同步失败
syncManager.on('sync:failed', ({ deviceId, error }) => {
  console.error('同步失败:', deviceId, error);
});

// 同步进度
syncManager.on('sync:progress', ({ deviceId, type, progress }) => {
  console.log('同步进度:', deviceId, type, progress);
});
```

## 故障排查

### 常见问题

1. **同步失败**
   - 检查网络连接
   - 检查P2P连接状态
   - 查看错误日志

2. **数据不一致**
   - 检查冲突解决策略
   - 手动触发全量同步
   - 检查数据库完整性

3. **性能问题**
   - 调整同步间隔
   - 减小批量大小
   - 检查网络质量

4. **离线消息丢失**
   - 检查队列大小限制
   - 检查队列持久化
   - 查看队列清理日志

## 未来计划

- [ ] 支持更多数据类型同步（设置、模板等）
- [ ] 优化大文件同步性能
- [ ] 支持多设备同步（多个移动设备）
- [ ] 添加同步历史记录
- [ ] 支持选择性同步（按标签、分类等）
- [ ] 添加同步冲突可视化界面
- [ ] 支持同步数据压缩
- [ ] 添加同步带宽限制

## 相关文档

- [P2P通信文档](./P2P_COMMUNICATION.md)
- [数据库设计文档](./DATABASE_DESIGN.md)
- [移动端开发指南](./MOBILE_DEVELOPMENT.md)
- [测试指南](./TESTING_GUIDE.md)

## 版本历史

### v0.23.0 (2026-01-14)
- ✅ 实现桌面-移动端数据双向同步
- ✅ 实现群聊实时同步
- ✅ 实现增量同步和冲突解决
- ✅ 实现离线队列管理
- ✅ 添加同步UI组件
- ✅ 添加单元测试

## 贡献

欢迎提交Issue和Pull Request！

## 许可证

MIT License
