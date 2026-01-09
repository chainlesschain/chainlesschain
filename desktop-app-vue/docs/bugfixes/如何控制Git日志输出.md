# 如何控制 Git 日志输出

## 问题说明

在开发模式下（`npm run dev`），控制台会定时输出以下日志，影响查看关键信息：

```
[BackendClient] 获取Git状态 失败: AxiosError: Request failed with status code 500
```

## 解决方案

现在已经添加了 **Git 日志输出开关**，默认情况下这些定时的错误日志不会再输出。

## 如何在应用内控制日志输出

### 方法一：通过应用设置界面

1. **启动应用**
   ```bash
   cd desktop-app-vue
   npm run dev
   ```

2. **打开设置页面**
   - 在应用中点击"设置"菜单
   - 找到"Git 同步设置"选项卡

3. **启用日志输出**（仅在需要调试时）
   - 找到"启用日志输出"开关
   - 打开开关即可看到详细的 Git 操作和后端 API 调用日志
   - 关闭开关则隐藏这些日志

4. **保存设置**
   - 点击"保存设置"按钮
   - 配置立即生效，无需重启应用

### 方法二：手动编辑配置文件

配置文件位置：
- **Windows**: `%APPDATA%/chainlesschain-desktop/git-config.json`
- **macOS**: `~/Library/Application Support/chainlesschain-desktop/git-config.json`
- **Linux**: `~/.config/chainlesschain-desktop/git-config.json`

编辑配置文件：

```json
{
  "enabled": false,
  "enableLogging": false,  // false = 关闭日志（默认），true = 开启日志
  "repoPath": null,
  "remoteUrl": null,
  "authorName": "ChainlessChain User",
  "authorEmail": "user@chainlesschain.com",
  "autoSync": false,
  "autoSyncInterval": 300000,
  "exportPath": "knowledge"
}
```

修改 `enableLogging` 字段：
- `false`（默认）：不输出 Git 和后端 API 相关的日志
- `true`：输出详细的 Git 和后端 API 日志，用于调试

## 默认行为

- **默认情况下**：`enableLogging` 为 `false`
- **开发模式**：定时的 Git 状态错误日志不会输出
- **错误处理**：仍然会记录严重错误，但不会打扰正常的日志查看

## 何时启用日志输出

建议在以下情况下启用日志输出：

- 🔍 调试 Git 同步问题
- 🔍 排查后端 API 调用失败的原因
- 🔍 开发和测试 Git 相关功能
- 🔍 向开发团队报告问题时需要详细日志

**注意**：在正常使用时，建议关闭日志输出以保持控制台清爽。

## 相关文件

- 配置管理：`desktop-app-vue/src/main/git/git-config.js`
- 后端客户端：`desktop-app-vue/src/main/api/backend-client.js`
- 设置界面：`desktop-app-vue/src/renderer/components/GitSettings.vue`

## 技术细节

### 日志控制机制

1. **配置读取**：每次输出日志前，实时读取 `git-config.json` 中的 `enableLogging` 配置
2. **默认静默**：默认情况下不输出后端 API 调用失败的错误日志
3. **精细控制**：可以通过 UI 或配置文件灵活控制日志输出

### 影响范围

启用/禁用日志输出会影响：
- Git 操作日志（status, commit, push, pull 等）
- 后端 API 调用日志（Java 项目服务、Python AI 服务）
- Git 管理器日志

**不影响**：
- 严重错误的输出（始终输出）
- 应用核心功能的日志
- 开发者工具的控制台输出
