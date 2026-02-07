# 快速菜单验证指南

**应用状态**: ✅ 运行中 (http://127.0.0.1:5173)

## 前置条件

1. 应用已启动并显示登录页面
2. 使用测试账号登录（或注册新账号）

## 测试URL列表

登录后，可以直接在应用中按 `Ctrl+Shift+I` 打开开发工具，在 Console 中输入以下命令快速跳转：

### 监控与诊断 (6项)

```javascript
// 1. LLM性能监控
window.location.hash = "#/llm/performance";

// 2. 数据库性能监控
window.location.hash = "#/database/performance";

// 3. 错误监控
window.location.hash = "#/error/monitor";

// 4. 会话管理
window.location.hash = "#/sessions";

// 5. 内存仪表板
window.location.hash = "#/memory";

// 6. 标签管理
window.location.hash = "#/tags";
```

### MCP和AI配置 (2项)

```javascript
// 7. MCP服务器
window.location.hash = "#/settings?tab=mcp";

// 8. Token使用统计
window.location.hash = "#/settings?tab=token-usage";
```

### P2P高级功能 (6项)

```javascript
// 9. 设备配对
window.location.hash = "#/p2p/device-pairing";

// 10. 设备管理
window.location.hash = "#/p2p/device-management";

// 11. 文件传输
window.location.hash = "#/p2p/file-transfer";

// 12. 安全号码验证
window.location.hash = "#/p2p/safety-numbers";

// 13. 会话指纹
window.location.hash = "#/p2p/session-fingerprint";

// 14. 消息队列
window.location.hash = "#/p2p/message-queue";
```

## 一键测试所有路由

在浏览器控制台中运行以下代码：

```javascript
const testRoutes = [
  "/llm/performance",
  "/database/performance",
  "/error/monitor",
  "/sessions",
  "/memory",
  "/tags",
  "/settings?tab=mcp",
  "/settings?tab=token-usage",
  "/p2p/device-pairing",
  "/p2p/device-management",
  "/p2p/file-transfer",
  "/p2p/safety-numbers",
  "/p2p/session-fingerprint",
  "/p2p/message-queue",
];

let index = 0;
function testNext() {
  if (index >= testRoutes.length) {
    console.log("✅ 所有路由测试完成！");
    return;
  }
  const route = testRoutes[index];
  console.log(`[${index + 1}/14] 测试路由: ${route}`);
  window.location.hash = "#" + route;
  index++;
  setTimeout(testNext, 2000); // 每2秒切换一次
}
testNext();
```

## 手动点击测试

### 方式1: 通过左侧菜单

1. **系统设置** → **监控与诊断**
   - 应该看到6个新菜单项（带"新"或"AI"标签）

2. **系统设置** → **AI配置**
   - 应该看到 MCP服务器 和 Token使用统计

3. **社交网络** → 展开菜单
   - 应该看到6个P2P功能项

### 方式2: 通过搜索功能

如果应用有全局搜索（Ctrl+K），搜索：

- "LLM性能"
- "设备配对"
- "错误监控"
- 等关键词

## 验证要点

每个页面检查：

- [ ] 页面正常加载（无白屏）
- [ ] 页面标题正确
- [ ] 无控制台错误
- [ ] 组件渲染完整

## 已知问题

1. **MCP服务器页面**可能显示"服务未启动"（这是正常的，需要配置后端）
2. **P2P功能**可能需要先配对设备才能看到数据

## 快速诊断

如果某个页面无法加载，在控制台运行：

```javascript
// 查看当前路由状态
console.log("当前路由:", window.location.hash);
console.log("路由器实例:", window.$router);
console.log("所有路由:", window.$router?.getRoutes());
```

## 报告格式

测试完成后，请报告：

```
✅ 成功: X/14
⚠️  警告: X/14 (页面加载但有警告)
❌ 失败: X/14 (页面无法加载)

失败详情:
- [页面名称]: [错误描述]
```
