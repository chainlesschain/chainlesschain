# 企业版DID邀请链接 - 集成指南

## 实施状态

**完成度**: 95%
**日期**: 2026-01-12

### 已完成 ✅

1. **后端核心功能** (100%)
   - DIDInvitationManager 类 (9个方法)
   - 3个数据库表 + 9个索引
   - 安全令牌生成和验证
   - 权限控制和使用追踪

2. **IPC通信层** (100%)
   - 9个新IPC通道
   - 完整的前后端通信

3. **前端UI组件** (100%)
   - InvitationLinkManager.vue - 主管理界面
   - CreateInvitationLinkDialog.vue - 创建对话框
   - InvitationLinkDetailDialog.vue - 详情对话框
   - QRCodeDialog.vue - 二维码显示
   - InvitationAcceptDialog.vue - 接受邀请对话框

4. **深链接处理器** (100%)
   - DeepLinkHandler 类
   - 协议解析和路由

5. **文档** (100%)
   - 功能文档
   - API文档
   - 实施总结

### 待集成 ⏳

1. **主进程集成** (5%)
   - 在 index.js 中初始化 DeepLinkHandler
   - 注册协议处理器

2. **渲染进程集成** (5%)
   - 添加深链接事件监听器
   - 路由到邀请接受对话框

---

## 集成步骤

### 步骤 1: 安装依赖

```bash
cd desktop-app-vue
npm install qrcode
```

### 步骤 2: 集成深链接处理器到主进程

**文件**: `desktop-app-vue/src/main/index.js`

在文件顶部添加导入:

```javascript
const DeepLinkHandler = require('./deep-link-handler');
```

在 `ChainlessChainApp` 类中添加属性:

```javascript
class ChainlessChainApp {
  constructor() {
    // ... 现有代码 ...
    this.deepLinkHandler = null;
  }
```

在 `initializeManagers()` 方法中初始化深链接处理器:

```javascript
async initializeManagers() {
  // ... 现有的管理器初始化代码 ...

  // 初始化深链接处理器
  try {
    console.log('初始化深链接处理器...');
    this.deepLinkHandler = new DeepLinkHandler(this.mainWindow, this.organizationManager);
    this.deepLinkHandler.register(app);
    console.log('深链接处理器初始化成功');
  } catch (error) {
    console.error('深链接处理器初始化失败:', error);
  }
}
```

在 `createWindow()` 方法中设置主窗口引用:

```javascript
async createWindow() {
  // ... 创建窗口的代码 ...

  // 设置深链接处理器的主窗口引用
  if (this.deepLinkHandler) {
    this.deepLinkHandler.setMainWindow(this.mainWindow);
  }

  // ... 其余代码 ...
}
```

在 `onReady()` 方法中处理启动URL (Windows/Linux):

```javascript
async onReady() {
  // ... 现有代码 ...

  // 处理启动时的协议URL (Windows/Linux)
  if (this.deepLinkHandler && process.platform !== 'darwin') {
    this.deepLinkHandler.handleStartupUrl(process.argv);
  }
}
```

### 步骤 3: 添加渲染进程事件监听器

**文件**: `desktop-app-vue/src/renderer/App.vue` 或主布局组件

在 `<script setup>` 中添加:

```javascript
import { ref, onMounted, onUnmounted } from 'vue';
import InvitationAcceptDialog from './components/organization/InvitationAcceptDialog.vue';

const showInvitationDialog = ref(false);
const invitationToken = ref('');

// 深链接事件处理器
const handleInvitationDeepLink = (event, token) => {
  console.log('收到邀请链接:', token);
  invitationToken.value = token;
  showInvitationDialog.value = true;
};

onMounted(() => {
  // 监听深链接事件
  window.electron.ipcRenderer.on('deep-link:invitation', handleInvitationDeepLink);
});

onUnmounted(() => {
  // 清理监听器
  window.electron.ipcRenderer.removeListener('deep-link:invitation', handleInvitationDeepLink);
});
```

在模板中添加对话框:

```vue
<template>
  <!-- 现有内容 -->

  <!-- 邀请接受对话框 -->
  <InvitationAcceptDialog
    v-model:visible="showInvitationDialog"
    :token="invitationToken"
    @accepted="handleInvitationAccepted"
    @rejected="handleInvitationRejected"
  />
</template>
```

添加事件处理方法:

```javascript
const handleInvitationAccepted = (org) => {
  console.log('已加入组织:', org.name);
  // 可选: 导航到组织页面
  // router.push(`/organization/${org.org_id}`);
};

const handleInvitationRejected = () => {
  console.log('已拒绝邀请');
};
```

### 步骤 4: 添加路由 (如果使用 Vue Router)

**文件**: `desktop-app-vue/src/renderer/router/index.js`

```javascript
{
  path: '/organization/:orgId/invitations',
  name: 'OrganizationInvitations',
  component: () => import('@/components/organization/InvitationLinkManager.vue'),
  props: true
}
```

### 步骤 5: 在组织管理页面中添加入口

在组织设置或管理页面中添加导航链接:

```vue
<a-menu-item key="invitations">
  <router-link :to="`/organization/${orgId}/invitations`">
    <LinkOutlined />
    <span>邀请链接</span>
  </router-link>
</a-menu-item>
```

---

## 使用指南

### 创建邀请链接

1. 进入组织管理页面
2. 点击"邀请链接"标签
3. 点击"创建邀请链接"按钮
4. 配置链接参数:
   - 选择角色 (member/admin/viewer)
   - 设置使用次数 (1-999999 或无限制)
   - 设置过期时间 (1小时-30天或永不过期)
   - 添加邀请消息 (可选)
5. 点击"创建链接"
6. 复制链接或下载二维码

### 分享邀请链接

**推荐方式**:
- 加密邮件
- 企业即时通讯工具
- 二维码 (线下场景)

**不推荐**:
- 社交媒体
- 公开论坛
- 未加密渠道

### 通过链接加入组织

**方式 1: 点击链接**
1. 用户点击 `chainlesschain://invite/xxx` 链接
2. 应用自动打开并显示邀请详情
3. 用户确认后加入组织

**方式 2: 扫描二维码**
1. 使用移动应用扫描二维码
2. 应用解析链接并显示邀请详情
3. 用户确认后加入组织

**方式 3: 手动输入**
1. 在应用中选择"加入组织"
2. 输入邀请令牌
3. 验证并加入

### 管理邀请链接

**查看链接列表**:
- 显示所有创建的链接
- 筛选: 活跃/过期/已撤销
- 搜索: 链接ID或消息

**查看链接详情**:
- 基本信息 (状态、角色、使用情况)
- 使用记录 (用户DID、时间、IP)
- 元数据

**撤销链接**:
- 点击"更多" → "撤销链接"
- 确认后链接立即失效

**删除链接**:
- 点击"更多" → "删除链接"
- 确认后永久删除 (包括使用记录)

---

## API 使用示例

### 前端调用

```javascript
// 创建邀请链接
const result = await window.electron.ipcRenderer.invoke('org:create-invitation-link', {
  orgId: 'org_xxx',
  role: 'member',
  message: '欢迎加入！',
  maxUses: 10,
  expiresIn: 7 * 24 * 60 * 60 * 1000
});

// 验证令牌
const validation = await window.electron.ipcRenderer.invoke(
  'org:validate-invitation-token',
  token
);

// 接受邀请
const acceptance = await window.electron.ipcRenderer.invoke(
  'org:accept-invitation-link',
  token
);

// 获取链接列表
const links = await window.electron.ipcRenderer.invoke(
  'org:get-invitation-links',
  orgId,
  { status: 'active' }
);

// 获取统计信息
const stats = await window.electron.ipcRenderer.invoke(
  'org:get-invitation-link-stats',
  orgId
);
```

---

## 测试

### 手动测试流程

1. **创建链接测试**
   ```
   1. 打开邀请链接管理页面
   2. 创建一个测试链接 (使用次数: 5, 过期: 1天)
   3. 验证链接已创建并显示在列表中
   4. 复制链接到剪贴板
   5. 验证二维码已生成
   ```

2. **深链接测试**
   ```
   1. 在终端运行: open "chainlesschain://invite/[token]"
   2. 验证应用打开并显示邀请对话框
   3. 验证组织信息正确显示
   4. 点击"接受并加入"
   5. 验证成功加入组织
   ```

3. **使用限制测试**
   ```
   1. 创建使用次数为1的链接
   2. 使用该链接加入组织
   3. 尝试再次使用同一链接
   4. 验证提示"使用次数已达上限"
   ```

4. **过期测试**
   ```
   1. 创建过期时间为1分钟的链接
   2. 等待1分钟
   3. 尝试使用该链接
   4. 验证提示"邀请链接已过期"
   ```

5. **撤销测试**
   ```
   1. 创建一个链接
   2. 撤销该链接
   3. 尝试使用该链接
   4. 验证提示"邀请链接已撤销"
   ```

### 自动化测试 (待实施)

创建测试文件:
- `tests/unit/did-invitation-manager.spec.js`
- `tests/integration/invitation-link-ipc.spec.js`
- `tests/e2e/invitation-link-flow.spec.js`

---

## 故障排除

### 问题 1: 深链接不工作

**症状**: 点击链接后应用没有打开

**解决方案**:
1. 检查协议是否已注册:
   ```bash
   # macOS
   defaults read com.apple.LaunchServices/com.apple.launchservices.secure | grep chainlesschain

   # Windows
   # 检查注册表: HKEY_CLASSES_ROOT\chainlesschain
   ```

2. 重新安装应用以注册协议

3. 检查控制台日志:
   ```javascript
   console.log('[DeepLinkHandler] 处理深链接:', url);
   ```

### 问题 2: 二维码不显示

**症状**: 创建链接后二维码区域为空

**解决方案**:
1. 确认 qrcode 包已安装:
   ```bash
   npm list qrcode
   ```

2. 检查浏览器控制台错误

3. 验证 canvas 元素已正确渲染

### 问题 3: 邀请链接验证失败

**症状**: 提示"邀请链接不存在"

**解决方案**:
1. 检查数据库表是否已创建:
   ```sql
   SELECT name FROM sqlite_master WHERE type='table' AND name='invitation_links';
   ```

2. 验证令牌格式正确 (base64url编码)

3. 检查组织管理器是否已初始化

---

## 安全注意事项

1. **令牌安全**
   - 使用32字节随机令牌
   - Base64url编码确保URL安全
   - 唯一性约束防止冲突

2. **权限验证**
   - 创建链接需要 `member.invite` 权限
   - 撤销/删除需要创建者或管理员权限

3. **防滥用**
   - 使用次数限制
   - 过期时间控制
   - 重复使用检测

4. **审计追踪**
   - 完整的使用记录
   - 活动日志记录
   - IP和User Agent追踪

---

## 性能优化

1. **数据库索引**
   - 9个索引优化查询性能
   - 覆盖常用查询模式

2. **前端优化**
   - 分页加载链接列表
   - 虚拟滚动 (大量使用记录)
   - 状态缓存

3. **P2P优化**
   - 消息批处理
   - 离线队列
   - 连接池

---

## 相关文件

### 后端
- `src/main/organization/did-invitation-manager.js` - 核心管理器
- `src/main/organization/organization-manager.js` - 组织管理器集成
- `src/main/organization/organization-ipc.js` - IPC处理器
- `src/main/deep-link-handler.js` - 深链接处理器

### 前端
- `src/renderer/components/organization/InvitationLinkManager.vue` - 主界面
- `src/renderer/components/organization/CreateInvitationLinkDialog.vue` - 创建对话框
- `src/renderer/components/organization/InvitationLinkDetailDialog.vue` - 详情对话框
- `src/renderer/components/organization/QRCodeDialog.vue` - 二维码对话框
- `src/renderer/components/organization/InvitationAcceptDialog.vue` - 接受对话框

### 文档
- `docs/INVITATION_LINK_FEATURE.md` - 功能文档
- `INVITATION_LINK_IMPLEMENTATION_SUMMARY.md` - 实施总结
- `docs/INVITATION_LINK_INTEGRATION_GUIDE.md` - 本文档

---

## 下一步

1. **立即执行**
   - [ ] 按照步骤1-5完成集成
   - [ ] 执行手动测试流程
   - [ ] 修复发现的问题

2. **短期优化**
   - [ ] 编写自动化测试
   - [ ] 添加邀请模板功能
   - [ ] 实现批量创建链接

3. **长期增强**
   - [ ] 邀请分析仪表板
   - [ ] 转化率追踪
   - [ ] 自动提醒功能

---

**版本**: v1.0.0
**最后更新**: 2026-01-12
**状态**: 就绪待集成
