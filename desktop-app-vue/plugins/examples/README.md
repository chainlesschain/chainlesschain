# ChainlessChain 示例插件集合

这个目录包含了三个完整的示例插件，展示了如何为 ChainlessChain 开发自定义插件。

## 📦 包含的插件

### 1. 天气查询插件 (weather-query)

提供实时天气查询和天气预报功能。

**功能**:
- 查询当前天气状况
- 获取未来7天天气预报
- 支持摄氏度/华氏度切换

**技能**: 1个 | **工具**: 2个

[查看详细文档](./weather-query/README.md)

---

### 2. 多语言翻译插件 (translator)

提供多语言文本翻译和语言检测功能。

**功能**:
- 支持8种语言互译
- 自动检测源语言
- 批量文本翻译

**技能**: 1个 | **工具**: 3个

[查看详细文档](./translator/README.md)

---

### 3. Markdown增强导出插件 (markdown-exporter)

提供Markdown文档的高级导出和美化功能。

**功能**:
- Markdown文档美化
- 导出为HTML/PDF
- 自动生成目录

**技能**: 1个 | **工具**: 4个

[查看详细文档](./markdown-exporter/README.md)

---

## 🚀 快速开始

### 方法1: 使用安装脚本（推荐）

```bash
# 安装所有示例插件
cd desktop-app-vue/plugins/examples
node install-plugins.js

# 仅安装特定插件
node install-plugins.js weather-query
node install-plugins.js translator
node install-plugins.js markdown-exporter
```

### 方法2: 手动安装

1. 复制插件目录到用户插件目录:

   **Windows**:
   ```bash
   cp -r weather-query %APPDATA%/ChainlessChain/plugins/custom/
   cp -r translator %APPDATA%/ChainlessChain/plugins/custom/
   cp -r markdown-exporter %APPDATA%/ChainlessChain/plugins/custom/
   ```

   **macOS/Linux**:
   ```bash
   cp -r weather-query ~/Library/Application Support/ChainlessChain/plugins/custom/
   cp -r translator ~/Library/Application Support/ChainlessChain/plugins/custom/
   cp -r markdown-exporter ~/Library/Application Support/ChainlessChain/plugins/custom/
   ```

2. 重启 ChainlessChain 应用

3. 在 设置 > 插件管理 中启用插件

### 方法3: 通过界面安装

1. 打开 ChainlessChain 应用
2. 进入 **设置** > **插件管理**
3. 点击 **"安装本地插件"**
4. 选择对应的插件文件夹

---

## 📚 插件开发教程

### 插件结构

一个标准的插件包含以下文件:

```
my-plugin/
├── plugin.json          # 插件配置清单（必需）
├── index.js             # 插件入口文件（必需）
├── README.md            # 插件说明文档（推荐）
└── package.json         # NPM包配置（可选）
```

### plugin.json 示例

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "插件描述",
  "category": "custom",
  "main": "index.js",
  "chainlesschain": {
    "apiVersion": "1.0",
    "minVersion": "0.16.0",
    "permissions": ["file:read", "file:write"],
    "skills": [...],
    "tools": [...]
  }
}
```

### index.js 示例

```javascript
/**
 * 插件激活钩子
 */
async function activate(context) {
  console.log('[MyPlugin] 插件已激活');

  // 注册工具
  context.registerTool('my_tool', async (params) => {
    return {
      success: true,
      result: 'Hello from my plugin!'
    };
  });

  // 获取配置
  const config = context.getConfig();
  console.log('[MyPlugin] 配置:', config);
}

/**
 * 插件停用钩子
 */
async function deactivate(context) {
  console.log('[MyPlugin] 插件已停用');
}

module.exports = { activate, deactivate };
```

---

## 🛠️ 插件API

### Context 对象

插件的 `activate` 和 `deactivate` 函数会接收一个 `context` 对象,提供以下API:

#### registerTool(toolName, handler)

注册工具处理函数

```javascript
context.registerTool('my_tool', async (params) => {
  // 处理逻辑
  return { success: true, result: '...' };
});
```

#### getConfig()

获取插件配置

```javascript
const config = context.getConfig();
```

#### emit(eventName, data)

发送事件

```javascript
context.emit('my-event', { data: '...' });
```

#### on(eventName, handler)

监听事件

```javascript
context.on('system-event', (data) => {
  console.log('Event received:', data);
});
```

---

## 🔐 权限系统

插件需要在 `plugin.json` 中声明所需权限:

| 权限 | 说明 |
|------|------|
| `file:read` | 读取文件 |
| `file:write` | 写入文件 |
| `file:delete` | 删除文件 |
| `network:http` | HTTP/HTTPS请求 |
| `network:dns` | DNS查询 |
| `database:read` | 读取数据库 |
| `database:write` | 写入数据库 |
| `system:execute` | 执行系统命令 |
| `crypto:execute` | 加密解密操作 |

---

## 📊 技能和工具

### 技能 (Skills)

技能是更高层次的能力集合,可以包含多个工具。定义在 `plugin.json` 的 `chainlesschain.skills` 数组中。

### 工具 (Tools)

工具是具体的功能实现,提供特定操作。定义在 `plugin.json` 的 `chainlesschain.tools` 数组中,并在 `index.js` 中实现。

---

## 🧪 测试插件

### 单元测试

在插件目录中创建测试文件:

```javascript
// test/my-tool.test.js
const { activate } = require('../index');

describe('MyPlugin', () => {
  it('should register tool successfully', async () => {
    const context = {
      registerTool: jest.fn(),
      getConfig: () => ({})
    };

    await activate(context);

    expect(context.registerTool).toHaveBeenCalled();
  });
});
```

运行测试:

```bash
npm test
```

---

## 📝 最佳实践

1. **遵循单一职责原则** - 每个插件应专注于一个特定功能领域

2. **完善的错误处理** - 始终返回 `{ success, error }` 格式的结果

3. **清晰的文档** - 提供详细的 README.md 和使用示例

4. **合理的权限申请** - 只申请必需的权限

5. **性能优化** - 避免阻塞操作,使用异步API

6. **语义化版本** - 使用 [Semantic Versioning](https://semver.org/lang/zh-CN/)

7. **国际化支持** - 支持多语言消息

8. **测试覆盖** - 编写单元测试确保功能正确

---

## 📖 参考资源

- [ChainlessChain 插件开发文档](../../docs/plugin-development.md)
- [技能工具系统设计](../../docs/skills/README.md)
- [API 参考文档](../../docs/api/README.md)
- [贡献指南](../../../CONTRIBUTING.md)

---

## 🤝 贡献

欢迎提交更多示例插件!请参考 [贡献指南](../../../CONTRIBUTING.md)。

### 提交示例插件的要求:

1. 完整的 `plugin.json` 配置
2. 清晰的代码实现和注释
3. 详细的 README.md 文档
4. 实用的功能和良好的用户体验
5. 符合代码规范

---

## 📄 许可证

所有示例插件均采用 MIT License。

---

## ❓ 常见问题

### Q: 如何调试插件?

A: 在插件代码中使用 `console.log()`,日志会输出到 ChainlessChain 的开发者工具中。

### Q: 插件可以访问哪些API?

A: 插件可以访问 Node.js 标准库和插件 Context API,但需要申请相应权限。

### Q: 如何发布插件?

A: 可以发布到 NPM,或提交到 ChainlessChain 官方插件仓库。

### Q: 插件如何持久化数据?

A: 使用 `context.getDataPath()` 获取插件数据目录,然后使用文件系统API保存数据。

---

**Happy Plugin Development! 🎉**
