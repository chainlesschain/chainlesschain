# Package.json 更新指南

## 需要添加的依赖

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

## 需要添加的 Scripts

```json
{
  "scripts": {
    "mcp:benchmark": "node src/main/mcp/__tests__/benchmark-mcp-performance.js",
    "mcp:test": "vitest run src/main/mcp/__tests__",
    "mcp:example": "node src/main/mcp/examples/example-integration.js"
  }
}
```

## 完整更新命令

在 `desktop-app-vue` 目录下执行：

```bash
# 安装 MCP SDK
npm install @modelcontextprotocol/sdk

# 验证安装
npx @modelcontextprotocol/server-filesystem --help
```

## 手动更新 package.json

如果自动安装失败，手动编辑 `package.json`：

### 1. 在 dependencies 部分添加

找到 `"dependencies": {` 行，在适当位置添加：

```json
"@modelcontextprotocol/sdk": "^1.0.0",
```

**注意**: 确保在前一行末尾有逗号！

### 2. 在 scripts 部分添加

找到 `"scripts": {` 部分，在末尾添加：

```json
"mcp:benchmark": "node src/main/mcp/__tests__/benchmark-mcp-performance.js",
"mcp:test": "vitest run src/main/mcp/__tests__",
"mcp:example": "node src/main/mcp/examples/example-integration.js"
```

### 3. 运行 npm install

```bash
npm install
```

## 验证安装

运行以下命令验证 MCP SDK 已正确安装：

```bash
# 应该显示 MCP 服务器帮助信息
npx @modelcontextprotocol/server-filesystem --help

# 运行性能基准测试
npm run mcp:benchmark
```

如果看到输出，说明安装成功！
