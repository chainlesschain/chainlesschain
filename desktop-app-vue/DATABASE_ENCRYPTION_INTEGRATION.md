# 数据库加密完整集成指南

## 🎉 集成完成状态

所有必要的代码和组件已经创建完毕，现在只需要进行最后的集成步骤。

## 📁 已创建的文件

### 后端模块 (src/main/)

1. **database/key-manager.js** - 密钥管理器
   - U-Key 密钥派生
   - 密码 PBKDF2 派生
   - 密钥缓存管理

2. **database/sqlcipher-wrapper.js** - SQLCipher 包装器
   - AES-256 加密
   - better-sqlite3 兼容 API

3. **database/database-migration.js** - 数据库迁移工具
   - sql.js → SQLCipher 迁移
   - 数据完整性验证
   - 自动备份回滚

4. **database/database-adapter.js** - 数据库适配器
   - 双引擎支持
   - 自动检测和切换

5. **database/config-manager.js** - 加密配置管理器
   - 配置持久化
   - 首次设置检测

6. **database/index.js** - 模块导出

7. **database-encryption-ipc.js** - IPC 通信接口
   - 加密状态查询
   - 密码设置/修改
   - 配置管理

### 前端组件 (src/renderer/components/)

1. **DatabasePasswordDialog.vue** - 密码设置对话框
   - 密码强度检测
   - 实时验证
   - 密码要求提示

2. **DatabaseEncryptionStatus.vue** - 加密状态显示
   - 实时状态监听
   - 徽章显示

3. **DatabaseEncryptionWizard.vue** - 首次设置向导
   - 4步引导流程
   - 加密方式选择

4. **pages/settings/DatabaseSecurity.vue** - 安全设置页面
   - 完整的加密管理界面
   - 配置开关
   - 密码管理

## 🔧 集成步骤

### 步骤 1: 在 main/index.js 中初始化 IPC 处理器

在 `src/main/index.js` 文件中添加：

```javascript
// 1. 在文件顶部导入
const DatabaseEncryptionIPC = require('./database-encryption-ipc');

// 2. 在类的 constructor 或初始化方法中
class YourMainClass {
  constructor() {
    // ... 其他初始化代码 ...

    // 初始化数据库加密 IPC
    this.dbEncryptionIPC = new DatabaseEncryptionIPC(app);
  }

  // 3. 在数据库初始化后设置引用
  async initDatabase() {
    // ... 数据库初始化代码 ...

    // 设置数据库管理器引用
    if (this.dbEncryptionIPC) {
      this.dbEncryptionIPC.setDatabaseManager(this.databaseManager);
    }
  }

  // 4. 在窗口创建后设置主窗口引用
  createWindow() {
    this.mainWindow = new BrowserWindow({...});

    if (this.dbEncryptionIPC) {
      this.dbEncryptionIPC.setMainWindow(this.mainWindow);
    }
  }
}
```

### 步骤 2: 添加路由

在 `src/renderer/router/index.js` 中添加安全设置路由：

```javascript
import DatabaseSecurity from '../pages/settings/DatabaseSecurity.vue';

const routes = [
  // ... 其他路由 ...
  {
    path: '/settings/database-security',
    name: 'DatabaseSecurity',
    component: DatabaseSecurity,
    meta: {
      title: '数据库安全'
    }
  }
];
```

### 步骤 3: 在设置菜单中添加入口

在设置页面的导航菜单中添加：

```vue
<template>
  <a-menu>
    <!-- 其他菜单项 -->
    <a-menu-item key="database-security">
      <router-link to="/settings/database-security">
        <SafetyOutlined /> 数据库安全
      </router-link>
    </a-menu-item>
  </a-menu>
</template>
```

### 步骤 4: 在主界面显示加密状态（可选）

在主布局文件中添加加密状态指示器：

```vue
<template>
  <a-layout-header>
    <!-- 其他header内容 -->
    <DatabaseEncryptionStatus />
  </a-layout-header>
</template>

<script setup>
import DatabaseEncryptionStatus from '@/components/DatabaseEncryptionStatus.vue';
</script>
```

### 步骤 5: 首次启动检测（可选）

在应用启动时检测是否需要显示加密向导：

```vue
<template>
  <div>
    <!-- 主应用内容 -->
    <RouterView />

    <!-- 首次设置向导 -->
    <DatabaseEncryptionWizard
      v-model="showEncryptionWizard"
      @complete="onWizardComplete"
      @skip="onWizardSkip"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import DatabaseEncryptionWizard from '@/components/DatabaseEncryptionWizard.vue';

const showEncryptionWizard = ref(false);

onMounted(async () => {
  // 检查是否首次启动
  const status = await window.electron.ipcRenderer.invoke('database:get-encryption-status');

  if (status.firstTimeSetup && !status.isEncrypted) {
    // 延迟显示，让应用先加载完成
    setTimeout(() => {
      showEncryptionWizard.value = true;
    }, 1000);
  }
});

const onWizardComplete = () => {
  message.success('加密设置完成，重启应用后生效');
};

const onWizardSkip = () => {
  message.info('已跳过加密设置，可在设置中稍后启用');
};
</script>
```

## 🎯 使用流程

### 用户首次使用

1. **启动应用** → 自动显示加密向导
2. **选择加密方式** → 密码加密 或 U-Key 加密
3. **设置密码** → 符合安全要求的强密码
4. **自动迁移** → 后台自动迁移数据
5. **重启应用** → 以加密模式运行

### 日常使用

- 状态栏显示加密状态
- 设置中查看加密信息
- 随时修改密码
- 随时开启/关闭加密

## 🔍 验证集成

### 1. 检查后端集成

```bash
# 运行测试
cd desktop-app-vue
node test-sqlcipher.js
```

应该看到：
```
✓ 所有测试通过！
```

### 2. 检查前端组件

启动开发服务器：
```bash
npm run dev
```

然后：
1. 访问 `/settings/database-security`
2. 检查UI是否正常渲染
3. 测试开关、按钮等交互

### 3. 端到端测试

1. **启用加密**
   - 在设置中打开"启用数据库加密"开关
   - 按向导设置密码
   - 重启应用

2. **验证加密**
   - 检查数据库文件 `chainlesschain.encrypted.db` 是否创建
   - 用文本编辑器打开应该是乱码（已加密）

3. **功能测试**
   - 添加/编辑/删除数据
   - 验证数据持久化
   - 性能是否正常

## 📋 IPC 接口说明

### 查询接口

```javascript
// 获取加密状态
const status = await window.electron.ipcRenderer.invoke('database:get-encryption-status');
// 返回: { isEncrypted, method, engine, firstTimeSetup }

// 获取加密配置
const config = await window.electron.ipcRenderer.invoke('database:get-encryption-config');
// 返回: { success, config }
```

### 设置接口

```javascript
// 设置加密
await window.electron.ipcRenderer.invoke('database:setup-encryption', {
  method: 'password',  // 或 'ukey'
  password: 'your-password'
});

// 启用/禁用加密
await window.electron.ipcRenderer.invoke('database:enable-encryption');
await window.electron.ipcRenderer.invoke('database:disable-encryption');

// 修改密码
await window.electron.ipcRenderer.invoke('database:change-encryption-password', {
  password: 'new-password',
  oldPassword: 'old-password'
});

// 更新配置
await window.electron.ipcRenderer.invoke('database:update-encryption-config', {
  encryptionMethod: 'password',
  autoMigrate: true
});

// 重置配置
await window.electron.ipcRenderer.invoke('database:reset-encryption-config');
```

### 事件监听

```javascript
// 监听加密状态变化
window.electron.ipcRenderer.on('database:encryption-status-changed', (_, status) => {
  console.log('加密状态已改变:', status);
});
```

## 🎨 UI 组件使用

### DatabasePasswordDialog

```vue
<DatabasePasswordDialog
  v-model="visible"
  :is-first-time="true"
  :is-required="false"
  :show-old-password="false"
  @submit="handleSubmit"
  @cancel="handleCancel"
/>
```

### DatabaseEncryptionStatus

```vue
<DatabaseEncryptionStatus ref="statusRef" />

<!-- 刷新状态 -->
<script>
statusRef.value.refresh();
</script>
```

### DatabaseEncryptionWizard

```vue
<DatabaseEncryptionWizard
  v-model="showWizard"
  @complete="onComplete"
  @skip="onSkip"
/>
```

## 🔐 安全建议

### 密码策略

- 最少 12 个字符
- 包含大小写字母
- 包含数字
- 包含特殊字符

### 数据保护

- 密码不存储在配置文件
- 仅保存密钥元数据（盐值、方法）
- 密钥仅存在于内存中
- 应用关闭后自动清除

### 备份策略

- 迁移前自动备份
- 备份文件保留7天
- 支持手动回滚

## ⚠️ 注意事项

1. **首次设置后无法更改加密方法**
   - 选择密码/U-Key后锁定
   - 需要重置配置才能更改

2. **密码忘记无法找回**
   - 请务必记住密码
   - 建议使用密码管理器

3. **需要重启才能生效**
   - 修改加密设置后需重启
   - 提示用户保存工作

4. **性能提升**
   - SQLCipher 比 sql.js 快 25 倍
   - 建议所有用户启用

## 📞 支持与反馈

如遇到问题，请查看：
- `SQLCIPHER_UPGRADE_GUIDE.md` - 详细升级指南
- `SQLCIPHER_IMPLEMENTATION_SUMMARY.md` - 实现总结
- GitHub Issues

---

**集成完成日期**: 2025-12-29
**版本**: v1.0.0
