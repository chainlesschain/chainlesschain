# ChainlessChain 插件系统快速开始指南

**版本**: v0.16.0
**状态**: ✅ Phase 1 完成，UI 集成完成
**测试状态**: ✅ 20/20 测试通过 (100%)
**最后更新**: 2025-12-29

---

## 🎉 功能概览

ChainlessChain 插件系统允许您扩展应用的功能，无需修改核心代码。支持：

- ✅ **本地插件开发**：从本地目录安装自定义插件
- ✅ **NPM 包安装**：从 NPM 仓库安装社区插件
- ✅ **ZIP 文件安装**：导入打包的插件文件
- ✅ **权限管理**：精细化控制插件权限
- ✅ **扩展点系统**：通过 8 个内置扩展点扩展功能
- ✅ **生命周期管理**：完整的插件启用/禁用/卸载流程
- ✅ **可视化管理界面**：友好的 UI 操作界面

---

## 📦 快速开始 - 5 分钟体验

### 步骤 1: 启动应用

```bash
cd desktop-app-vue
npm run dev
```

### 步骤 2: 打开插件管理

1. 在左侧菜单找到 **"系统设置"**
2. 展开后点击 **"插件管理"**（带绿色"新"标签）
3. 您将看到插件管理界面

### 步骤 3: 安装测试插件

1. 点击 **"安装插件"** 按钮
2. 选择安装方式：**"本地目录"**
3. 点击 **"选择目录"**
4. 导航到：`C:\code\chainlesschain\desktop-app-vue\test-plugin`
5. 点击 **"确定"**
6. 等待提示 "插件安装成功"

### 步骤 4: 启用插件

1. 在插件列表找到 **"Hello World Plugin"**
2. 点击右上角的 **开关** 启用插件
3. 观察控制台输出：`[HelloWorldPlugin] 插件已启用`
4. 插件卡片左侧状态指示器变为 **绿色**

### 步骤 5: 测试功能

#### 查看插件详情
- 点击 **"详情"** 按钮
- 检查插件元数据（ID、版本、作者等）

#### 管理权限
- 点击 **"权限"** 按钮
- 查看插件请求的权限：
  - 数据库读取 (database:read)
  - UI组件 (ui:component)
- 尝试切换权限开关
- 点击 "确定" 保存

#### 查看扩展点
- 在插件卡片底部查看扩展点标签
- 应该显示：`ui.menu`

---

## 🔧 测试所有功能

### 测试清单

运行自动化测试：
```bash
cd desktop-app-vue
node test-plugin-installation.js
```

这将显示详细的 10 步测试流程。

#### ✅ 基础功能测试

- [x] 安装插件
- [x] 查看插件详情
- [x] 启用插件
- [x] 禁用插件
- [x] 权限管理
- [x] 扩展点验证
- [x] 搜索功能
- [x] 筛选功能
- [x] 卸载插件
- [x] 打开插件目录

#### 🔍 验证命令（在浏览器控制台 F12 运行）

```javascript
// 1. 检查 plugin API 是否可用
console.log('Plugin API:', window.electronAPI?.plugin);

// 2. 获取所有插件
const plugins = await window.electronAPI.plugin.getPlugins({});
console.log('所有插件:', plugins);

// 3. 获取特定插件
const plugin = await window.electronAPI.plugin.getPlugin('com.chainlesschain.hello-world');
console.log('Hello World Plugin:', plugin);

// 4. 获取插件权限
const permissions = await window.electronAPI.plugin.getPermissions('com.chainlesschain.hello-world');
console.log('插件权限:', permissions);
```

---

## 📝 插件开发指南

### 创建您的第一个插件

#### 1. 创建插件目录

```bash
mkdir my-first-plugin
cd my-first-plugin
```

#### 2. 创建 `plugin.json`

```json
{
  "id": "com.mycompany.my-first-plugin",
  "name": "My First Plugin",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "我的第一个 ChainlessChain 插件",
  "homepage": "https://github.com/yourname/my-first-plugin",
  "license": "MIT",
  "main": "index.js",
  "category": "custom",
  "permissions": [
    "database:read",
    "ui:component"
  ],
  "extensionPoints": [
    {
      "point": "ui.menu",
      "config": {
        "label": "我的插件",
        "position": "tools"
      }
    }
  ],
  "compatibility": {
    "chainlesschain": ">=0.16.0"
  }
}
```

#### 3. 创建 `index.js`

```javascript
/**
 * My First Plugin
 */
class MyFirstPlugin {
  constructor() {
    this.name = 'My First Plugin';
  }

  /**
   * 插件启用时调用
   */
  onEnable() {
    console.log('[MyFirstPlugin] 插件已启用');
  }

  /**
   * 插件禁用时调用
   */
  onDisable() {
    console.log('[MyFirstPlugin] 插件已禁用');
  }

  /**
   * 插件卸载时调用
   */
  onUninstall() {
    console.log('[MyFirstPlugin] 插件已卸载');
  }

  /**
   * 自定义方法
   */
  doSomething() {
    return {
      success: true,
      message: 'Hello from my plugin!',
    };
  }
}

module.exports = MyFirstPlugin;
```

#### 4. 安装并测试

1. 在插件管理界面点击 "安装插件"
2. 选择 "本地目录"
3. 选择您的插件目录
4. 安装完成后启用插件

---

## 🎨 插件 API 参考

### Manifest 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识符，建议使用反向域名格式 |
| `name` | string | ✅ | 插件显示名称 |
| `version` | string | ✅ | 语义化版本号 (semver) |
| `main` | string | ✅ | 入口文件路径，默认 `index.js` |
| `author` | string | ❌ | 作者名称 |
| `description` | string | ❌ | 插件描述 |
| `homepage` | string | ❌ | 插件主页 URL |
| `license` | string | ❌ | 许可证类型 |
| `category` | string | ❌ | 分类：`official`, `community`, `custom` |
| `permissions` | array | ❌ | 请求的权限列表 |
| `extensionPoints` | array | ❌ | 注册的扩展点 |
| `dependencies` | object | ❌ | NPM 依赖和插件依赖 |
| `compatibility` | object | ❌ | 兼容性要求 |

### 权限类型

| 权限 | 说明 |
|------|------|
| `database:read` | 读取数据库数据 |
| `database:write` | 修改数据库数据 |
| `database:admin` | 管理数据库结构 |
| `llm:query` | 调用 LLM 服务 |
| `llm:stream` | 使用 LLM 流式响应 |
| `llm:embed` | 文本向量化 |
| `ui:component` | 注册 UI 组件 |
| `ui:page` | 添加页面 |
| `ui:menu` | 添加菜单项 |
| `file:read` | 读取文件 |
| `file:write` | 写入文件 |
| `network:request` | 发起网络请求 |
| `system:notification` | 显示系统通知 |

### 扩展点

| 扩展点 | 说明 |
|--------|------|
| `ui.page` | UI 页面扩展 |
| `ui.menu` | 菜单扩展 |
| `ui.component` | 组件扩展 |
| `data.importer` | 数据导入器 |
| `data.exporter` | 数据导出器 |
| `ai.llm-provider` | LLM 提供商 |
| `ai.function-tool` | AI Function 工具 |
| `lifecycle.hook` | 生命周期钩子 |

### 生命周期方法

```javascript
class YourPlugin {
  // 插件加载时调用（Phase 2 支持）
  onLoad() { }

  // 插件启用时调用
  onEnable() { }

  // 插件禁用时调用
  onDisable() { }

  // 插件卸载时调用
  onUninstall() { }

  // 插件卸载前调用（Phase 2 支持）
  onBeforeUninstall() { }
}
```

---

## 🚀 高级功能（即将推出）

### Phase 2: 沙箱和权限系统

- [ ] VM2/isolated-vm 沙箱隔离
- [ ] 运行时权限检查
- [ ] 权限对话框 UI
- [ ] 插件 API 接口层
- [ ] 资源配额管理

### Phase 3: UI 扩展

- [ ] 插件市场 UI
- [ ] 插件开发者工具
- [ ] 调试工具
- [ ] 性能分析

### Phase 4: 高级功能

- [ ] 插件热重载
- [ ] 自动更新
- [ ] 插件商店集成
- [ ] 遥测和分析

---

## 📊 系统状态

### 自动化测试结果

```
总测试数: 20
✅ 通过: 20
❌ 失败: 0
通过率: 100.0%
```

### 测试覆盖

- ✅ 测试插件文件验证 (10/10)
- ✅ 插件管理器组件验证 (5/5)
- ✅ Preload 脚本验证 (3/3)
- ✅ 前端组件验证 (2/2)

### 数据库架构

7 个插件系统表已创建：
- `plugins` - 插件注册表
- `plugin_permissions` - 权限管理
- `plugin_dependencies` - 依赖关系
- `plugin_extensions` - 扩展点
- `plugin_settings` - 插件设置
- `plugin_event_logs` - 事件日志
- `plugin_api_stats` - API 统计

---

## 🐛 故障排除

### 问题 1: `window.electronAPI.plugin` 未定义

**原因**: Preload 脚本未正确加载

**解决方案**:
1. 完全关闭应用
2. 重新构建：`npm run build:main`
3. 重新启动：`npm run dev`
4. 在浏览器控制台验证：`console.log(window.electronAPI)`

### 问题 2: 插件安装失败

**检查清单**:
- [ ] `plugin.json` 格式是否正确？
- [ ] 必需字段是否都存在？
- [ ] `id` 是否唯一？
- [ ] `main` 字段指向的文件是否存在？

**验证 manifest**:
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('./plugin.json', 'utf-8')))"
```

### 问题 3: 插件启用后没有反应

**检查**:
1. 打开控制台 (F12)
2. 查看是否有错误日志
3. 验证生命周期方法是否被调用
4. 检查插件类是否正确导出

---

## 📚 相关文档

- **技术实现**: [PLUGIN_SYSTEM_IMPLEMENTATION_PHASE1.md](./PLUGIN_SYSTEM_IMPLEMENTATION_PHASE1.md)
- **系统设计**: [系统设计_个人移动AI管理系统.md](./系统设计_个人移动AI管理系统.md) - 第15章
- **项目进度**: [PROJECT_PROGRESS_REPORT_2025-12-18.md](./PROJECT_PROGRESS_REPORT_2025-12-18.md)
- **贡献指南**: [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 💬 反馈与支持

如有问题或建议，请：
- 提交 Issue: https://github.com/chainlesschain/chainlesschain/issues
- 查看文档: ./docs/plugins/
- 联系开发团队

---

**Happy Coding!** 🎉

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：ChainlessChain 插件系统快速开始指南。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
