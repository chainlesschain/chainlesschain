# E2E测试Timeout优化指南

## 概述

本文档说明E2E测试中的超时设置优化方案，确保测试在各种场景下都能稳定运行。

## 全局配置（playwright.config.ts）

### 当前优化设置

```typescript
{
  // 单个测试超时：120秒（之前60秒）
  timeout: 120000,

  // 全局超时：10分钟
  globalTimeout: 600000,

  // 断言超时：15秒（之前10秒）
  expect: {
    timeout: 15000,
  },

  use: {
    // 操作超时：30秒（新增）
    actionTimeout: 30000,

    // 导航超时：60秒（新增）
    navigationTimeout: 60000,
  }
}
```

### 优化理由

1. **测试超时（120秒）**：
   - AI相关测试需要更长时间（LLM响应、RAG检索、嵌入生成）
   - 文件导入/导出操作可能处理大文件
   - Git同步操作需要网络通信

2. **断言超时（15秒）**：
   - 某些断言需要等待异步操作完成
   - 流式输出需要时间累积完整响应

3. **操作超时（30秒）**：
   - 点击、输入等操作在慢速机器上可能需要更长时间
   - 等待元素可见/可用的时间更充足

4. **导航超时（60秒）**：
   - 页面加载、路由切换在低性能环境下较慢
   - 大型页面（如项目列表、知识库）加载时间较长

## 特定测试的Timeout设置

### AI相关测试

```typescript
// ai-chat.e2e.test.ts
test('AI对话测试', async () => {
  // 方法1: 在test级别设置timeout
  test.setTimeout(180000); // 3分钟

  // 或方法2: 在操作级别设置
  await page.click('button.send', { timeout: 60000 });
  await expect(response).toBeVisible({ timeout: 30000 });
});
```

**推荐timeout**：
- 简单对话：60-90秒
- RAG增强对话：90-120秒
- 流式输出：120-180秒

### 文件操作测试

```typescript
// file-import-export.e2e.test.ts
test('批量导入大文件', async () => {
  test.setTimeout(240000); // 4分钟

  // 文件选择和上传
  await page.setInputFiles('input[type=file]', largeFiles, { timeout: 120000 });

  // 等待导入完成
  await expect(successMessage).toBeVisible({ timeout: 180000 });
});
```

**推荐timeout**：
- 单个小文件：30-60秒
- 批量文件：120-180秒
- 大文件（>10MB）：180-300秒

### Git同步测试

```typescript
// git-sync-conflict.e2e.test.ts
test('Git推送和拉取', async () => {
  test.setTimeout(150000); // 2.5分钟

  // 推送操作
  await page.click('button.git-push', { timeout: 90000 });

  // 等待网络操作完成
  await waitForNetworkIdle({ timeout: 60000 });
});
```

**推荐timeout**：
- 本地Git操作：30-60秒
- 远程推送/拉取：90-150秒
- 冲突解决：120-180秒

### 性能测试

```typescript
// performance.e2e.test.ts
test('大数据集性能测试', async () => {
  test.setTimeout(300000); // 5分钟

  // 允许长时间操作
  await performBulkOperation({ timeout: 240000 });
});
```

**推荐timeout**：
- 轻量级性能测试：120-180秒
- 压力测试：240-300秒

## Timeout最佳实践

### 1. 使用合适的超时层级

```typescript
// 全局配置：适用于大多数测试
// playwright.config.ts: timeout: 120000

// 文件级配置：适用于整个测试文件
// test.use({ timeout: 180000 });

// 测试级配置：适用于单个测试
test('specific test', async () => {
  test.setTimeout(240000);
});

// 操作级配置：适用于单个操作
await page.click('button', { timeout: 60000 });
```

### 2. 避免过度的超时时间

```typescript
// ❌ 不好：超时时间过长，掩盖真正的问题
test.setTimeout(600000); // 10分钟，太长了

// ✅ 好：根据实际需求设置合理的超时
test.setTimeout(120000); // 2分钟，足够大多数操作
```

### 3. 使用条件超时

```typescript
// 根据环境调整超时
const timeout = process.env.CI ? 180000 : 120000;
test.setTimeout(timeout);

// 根据操作类型调整超时
const isHeavyOperation = fileSize > 50 * 1024 * 1024; // 50MB
const operationTimeout = isHeavyOperation ? 300000 : 120000;
```

### 4. 添加超时提示信息

```typescript
try {
  await page.click('button.submit', { timeout: 60000 });
} catch (error) {
  console.error('操作超时：可能原因：');
  console.error('1. 网络连接缓慢');
  console.error('2. 后端服务响应慢');
  console.error('3. 元素未正确渲染');
  throw error;
}
```

### 5. 使用waitFor代替固定延迟

```typescript
// ❌ 不好：固定延迟，浪费时间
await page.waitForTimeout(10000);

// ✅ 好：等待特定条件
await page.waitForSelector('.result', { timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 60000 });
```

## 常见超时问题排查

### 问题1: Test timeout exceeded

**原因**：
- 测试运行时间超过配置的timeout
- 异步操作未正确等待

**解决方案**：
```typescript
// 增加测试级超时
test.setTimeout(180000);

// 或优化等待逻辑
await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/api/chat')),
  page.click('button.send')
]);
```

### 问题2: Action timeout exceeded

**原因**：
- 元素不可见/不可点击
- 页面加载未完成

**解决方案**：
```typescript
// 等待元素准备好
await page.waitForSelector('button', { state: 'visible', timeout: 30000 });
await page.click('button', { timeout: 10000 });

// 或使用更宽松的超时
await page.click('button', { timeout: 60000, force: false });
```

### 问题3: Navigation timeout exceeded

**原因**：
- 页面加载缓慢
- 网络请求阻塞

**解决方案**：
```typescript
// 增加导航超时
await page.goto(url, { timeout: 90000, waitUntil: 'domcontentloaded' });

// 或使用更宽松的加载策略
await page.goto(url, { waitUntil: 'commit' });
```

## 环境变量控制

可以通过环境变量动态调整超时：

```bash
# 运行测试时指定timeout倍数
TIMEOUT_MULTIPLIER=2 npm run test:e2e

# 在慢速机器上运行
SLOW_MACHINE=true npm run test:e2e
```

在playwright.config.ts中使用：

```typescript
const timeoutMultiplier = parseInt(process.env.TIMEOUT_MULTIPLIER || '1');
const isSlowMachine = process.env.SLOW_MACHINE === 'true';

export default defineConfig({
  timeout: isSlowMachine ? 240000 : 120000 * timeoutMultiplier,
  // ...
});
```

## 监控和日志

### 记录实际执行时间

```typescript
test('操作性能监控', async () => {
  const startTime = Date.now();

  await performOperation();

  const duration = Date.now() - startTime;
  console.log(`操作耗时: ${duration}ms`);

  // 如果接近超时，记录警告
  if (duration > 100000) { // 100秒
    console.warn('警告：操作接近超时阈值');
  }
});
```

### 记录超时失败

```typescript
test.afterEach(async ({ }, testInfo) => {
  if (testInfo.status === 'timedOut') {
    console.error(`测试超时: ${testInfo.title}`);
    console.error(`配置的超时: ${testInfo.timeout}ms`);
    console.error(`实际运行时间: ${testInfo.duration}ms`);
  }
});
```

## 总结

1. **全局默认**：120秒足够大多数测试
2. **AI测试**：120-180秒
3. **文件操作**：120-240秒
4. **Git操作**：90-150秒
5. **性能测试**：180-300秒
6. **使用合理的超时层级**：全局 < 文件 < 测试 < 操作
7. **根据环境调整**：CI环境可能需要更长超时
8. **监控和优化**：记录实际执行时间，持续优化
