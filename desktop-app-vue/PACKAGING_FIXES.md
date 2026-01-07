# Electron 打包问题修复指南

## 问题描述

打包后的Windows exe应用运行时出现 `Cannot find module 'uuid'` 错误，以及其他类似的模块找不到问题。

## 根本原因

1. **asar打包配置不当** - 原生模块被打包进asar归档，导致运行时无法加载
2. **ignore规则过于激进** - 误删除了必要的模块文件（如隐藏文件、README等）
3. **配置冲突** - package.json中的config.forge配置与forge.config.js冲突

## 已修复的问题

### 1. forge.config.js 修复

#### 修复前：
```javascript
asar: true,  // 简单的布尔值，所有文件都打包进asar
```

#### 修复后：
```javascript
asar: {
  unpack: '*.{node,dll,dylib,so,exe}'  // 排除原生模块和可执行文件
}
```

**说明**：这样配置后，所有原生模块（.node文件）和系统库文件会被排除在asar外，放在app.asar.unpacked目录中。

### 2. ignore规则优化

#### 删除的过于激进的规则：
```javascript
// ❌ 删除了以下规则（会误删必要文件）
/node_modules\/.*\/\..*$/,           // 删除所有隐藏文件
/node_modules\/.*\/README\.md$/i,    // 删除README
/node_modules\/.*\/CHANGELOG\.md$/i, // 删除CHANGELOG
/node_modules\/.*\/\.eslintrc/,      // 删除eslint配置
/node_modules\/.*\/\.prettierrc/,    // 删除prettier配置
/.*\.md$/i,                          // 删除所有MD文件
/\.map\.js$/,                        // 这个正则有问题
```

#### 修改后的精确规则：
```javascript
// ✓ 更精确的规则
/node_modules\/.*\/test\//,    // 只删除test目录
/node_modules\/.*\/tests\//,   // 只删除tests目录
/node_modules\/.*\/\.github\//, // 只删除.github目录
/node_modules\/.*\/\.vscode\//, // 只删除.vscode目录
/\.map$/,                      // 删除source map
```

### 3. 删除package.json中的冲突配置

移除了package.json中的`config.forge`配置块，所有配置统一在forge.config.js中管理。

## 影响的关键模块

以下模块在打包时需要特别处理：

### 原生模块（需要unpack）
- `better-sqlite3-multiple-ciphers` - 数据库（.node）
- `sharp` - 图片处理（.node）
- `canvas` - Canvas绘图（.node）
- `koffi` - FFI调用（.node）

### 普通模块（确保不被ignore）
- `uuid` - UUID生成
- `node-forge` - 加密库
- `ethers` - 以太坊SDK
- `libp2p` - P2P网络
- `chromadb` - 向量数据库

## 验证方法

### 1. 本地验证（打包前）
```bash
cd desktop-app-vue
node scripts/verify-packaging.js
```

### 2. 打包后验证
```bash
# 打包
npm run make:win

# 运行打包后的应用
# 检查控制台是否有模块找不到的错误
```

### 3. 检查asar内容
```bash
# 安装asar工具
npm install -g asar

# 列出asar内容
asar list out/ChainlessChain-win32-x64/resources/app.asar

# 提取asar以检查内容
asar extract out/ChainlessChain-win32-x64/resources/app.asar ./temp-asar-check

# 检查unpacked目录
ls out/ChainlessChain-win32-x64/resources/app.asar.unpacked/node_modules
```

## 常见问题排查

### Q: 打包后仍然找不到某个模块？

**A: 按以下步骤检查：**

1. 确认该模块在`dependencies`中（不是devDependencies）
   ```bash
   npm ls <module-name>
   ```

2. 检查是否被ignore规则排除
   - 在forge.config.js的ignore数组中搜索相关规则

3. 如果是原生模块，检查asar.unpack规则
   - 确保文件扩展名包含在unpack模式中

4. 清理后重新打包
   ```bash
   rm -rf out/
   npm run build
   npm run make:win
   ```

### Q: 原生模块加载失败？

**A: 可能需要rebuild：**
```bash
cd desktop-app-vue
npm rebuild better-sqlite3-multiple-ciphers --build-from-source
npm rebuild sharp --build-from-source
```

### Q: 多个uuid版本冲突？

**A: 项目中存在uuid@8.3.2和uuid@9.0.1**
- 这是正常的（来自不同依赖）
- npm会自动处理版本隔离
- 确保两个版本都被正确打包

## 最佳实践

### 1. 添加新的原生模块时
```javascript
// 如果模块包含.node文件以外的扩展名，需要更新unpack规则
asar: {
  unpack: '*.{node,dll,dylib,so,exe,bin}'  // 添加新扩展名
}
```

### 2. 添加ignore规则时
```javascript
// ❌ 避免过于宽泛的规则
/node_modules\/.*\/\..*/,

// ✓ 使用精确的路径
/node_modules\/.*\/test\//,
```

### 3. 定期验证打包
在CI/CD中添加验证步骤：
```yaml
- name: Verify packaging
  run: |
    npm run make:win
    # 运行应用并捕获错误
```

## 相关文件

- `desktop-app-vue/forge.config.js` - 主要配置文件
- `desktop-app-vue/package.json` - 依赖声明
- `desktop-app-vue/scripts/verify-packaging.js` - 验证脚本
- `desktop-app-vue/scripts/build-main.js` - 主进程构建脚本

## 附加说明

### Windows特定问题

Windows平台上需要特别注意：
1. 路径分隔符（使用`path.join()`而非字符串拼接）
2. NUL设备文件（已在ignore规则中排除）
3. 长路径问题（Windows 10需要启用长路径支持）

### 性能优化

打包大小优化建议：
- 源码映射文件（.map）已被排除
- 测试文件已被排除
- 开发工具文件已被排除

当前配置在功能完整性和包大小之间取得了平衡。

## 更新日志

- **2026-01-07**: 初始修复
  - 修改asar配置为对象形式，添加unpack规则
  - 优化ignore规则，移除过于激进的匹配
  - 删除package.json中的冲突配置
  - 创建验证脚本
