# 性能基准测试指南

本目录包含 ChainlessChain mobile-app-uniapp 的性能基准测试。

## 测试内容

性能基准测试覆盖以下方面：

### 1. 页面加载性能
- **首页加载时间**: 测量从导航到首页完全加载的时间
- **知识库列表页**: 测试列表渲染和数据加载性能
- **AI 对话页**: 测试对话界面的加载性能
- **DOM Content Loaded**: DOM 解析完成时间
- **Load Complete**: 所有资源加载完成时间

### 2. 用户交互性能
- **First Contentful Paint (FCP)**: 首次内容绘制时间
- **DOM Interactive**: DOM 可交互时间
- **搜索响应时间**: 搜索功能的响应速度（包含 debounce）
- **页面交互响应**: 用户操作的响应时间

### 3. 资源加载
- **资源数量**: 总资源数统计
- **资源大小**: 各类型资源的大小
- **加载时间**: 各资源的加载耗时
- **资源类型分组**: JavaScript, CSS, 图片等资源的详细统计

### 4. 内存使用
- **JS Heap 使用情况**: JavaScript 堆内存使用
- **内存使用率**: 相对于限制的使用百分比
- **内存泄漏检测**: 长时间运行后的内存增长情况

### 5. 代码覆盖率
- **JavaScript 覆盖率**: 执行的 JS 代码占比
- **CSS 覆盖率**: 使用的 CSS 代码占比

## 性能评分标准

我们使用以下标准评估性能指标：

| 指标 | 🟢 优秀 | 🟡 良好 | 🟠 可接受 | 🔴 差 |
|------|---------|---------|-----------|-------|
| 页面加载 | < 1s | < 2s | < 3s | > 3s |
| FCP | < 1s | < 2s | < 3s | > 3s |
| LCP | < 2.5s | < 4s | < 5s | > 5s |
| TTI | < 3s | < 5s | < 7s | > 7s |
| API 响应 | < 200ms | < 500ms | < 1s | > 1s |

## 运行测试

### 前置条件

1. 确保已安装依赖：
```bash
cd mobile-app-uniapp
npm install
```

2. 启动 H5 开发服务器：
```bash
npm run dev:h5
```
服务器将运行在 `http://localhost:5173`

### 运行所有性能测试

```bash
npm run test:e2e tests/performance/benchmark.spec.js
```

### 运行特定测试

```bash
# 只测试首页性能
npx playwright test tests/performance/benchmark.spec.js -g "首页加载性能"

# 只测试内存泄漏
npx playwright test tests/performance/benchmark.spec.js -g "内存泄漏检测"
```

### 使用 UI 模式运行

UI 模式提供可视化的测试结果：

```bash
npx playwright test tests/performance/benchmark.spec.js --ui
```

### 生成性能报告

```bash
# 运行测试并生成报告
npx playwright test tests/performance/benchmark.spec.js --reporter=html

# 查看报告
npx playwright show-report
```

## 测试输出示例

```
=== 首页性能报告 ===
🟢 页面加载时间: 856ms (EXCELLENT)
🟢 DOM Content Loaded: 623ms (EXCELLENT)
🟡 Load Complete: 1432ms (GOOD)
🟢 First Contentful Paint: 734ms (EXCELLENT)
🟢 DOM Interactive: 589ms (EXCELLENT)

📊 代码覆盖率: 67.45%

=== 资源加载统计 ===
总资源数: 23
总大小: 456.78 KB
总加载时间: 1234.56 ms

按类型分组:
  script: 8个, 256.34 KB, 456.78 ms
  stylesheet: 3个, 45.67 KB, 123.45 ms
  image: 12个, 154.77 KB, 654.33 ms

=== 内存使用情况 ===
已使用: 25.67 MB
总分配: 32.45 MB
限制: 512.00 MB
使用率: 5.01%
```

## 性能优化建议

根据测试结果，如果发现性能问题，可以采取以下优化措施：

### 页面加载慢
- 启用代码分割（已在 vite.config.js 中配置）
- 使用路由懒加载
- 优化图片资源（使用 WebP 格式）
- 减少初始 bundle 大小

### 交互响应慢
- 使用 debounce/throttle（已集成到 @utils/performance）
- 虚拟滚动长列表
- 优化组件渲染逻辑
- 使用 `requestAnimationFrame` 优化动画

### 内存使用高
- 及时清理事件监听器
- 避免创建过多的闭包
- 使用 LRU 缓存限制缓存大小（已提供 @utils/performance/LRUCache）
- 定期清理不需要的数据

### 资源过多/过大
- 压缩图片（已提供 compressImage 工具）
- 启用 gzip/brotli 压缩
- 使用 CDN 加载第三方库
- 移除未使用的依赖

## 持续监控

建议将性能测试集成到 CI/CD 流程中：

```yaml
# .github/workflows/performance.yml
name: Performance Tests

on:
  pull_request:
    branches: [main]

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - name: Install dependencies
        run: cd mobile-app-uniapp && npm ci
      - name: Install Playwright
        run: cd mobile-app-uniapp && npx playwright install chromium
      - name: Run dev server
        run: cd mobile-app-uniapp && npm run dev:h5 &
      - name: Wait for server
        run: npx wait-on http://localhost:5173
      - name: Run performance tests
        run: cd mobile-app-uniapp && npm run test:e2e tests/performance/benchmark.spec.js
```

## 性能指标追踪

建议建立性能指标历史记录，跟踪以下关键指标：

- 首页加载时间
- FCP (First Contentful Paint)
- LCP (Largest Contentful Paint)
- TTI (Time to Interactive)
- 总 bundle 大小
- 内存使用峰值

可以使用工具如 [performance-budgets](https://web.dev/performance-budgets-101/) 设置性能预算。

## Lighthouse 集成

除了 Playwright 测试，还可以使用 Lighthouse 进行更全面的性能审计：

```bash
# 安装 Lighthouse
npm install -g lighthouse

# 运行 Lighthouse 测试
lighthouse http://localhost:5173 --output html --output-path ./lighthouse-report.html

# 查看报告
open lighthouse-report.html  # macOS
start lighthouse-report.html # Windows
```

Lighthouse 会提供额外的性能指标和优化建议。

## 故障排除

### 测试失败: 无法连接到 http://localhost:5173

确保 H5 开发服务器正在运行：
```bash
npm run dev:h5
```

### 性能指标不稳定

性能测试结果可能受以下因素影响：
- 系统负载
- 网络状况
- 浏览器缓存

建议：
- 多次运行取平均值
- 在相对稳定的环境中运行
- 使用 `--repeat-each=3` 参数运行多次

### 内存测试失败

某些浏览器可能不支持 `performance.memory` API。这是正常情况，不影响其他测试。

## 相关文档

- [Playwright 性能测试](https://playwright.dev/docs/test-performance)
- [Web Vitals](https://web.dev/vitals/)
- [Lighthouse 文档](https://developers.google.com/web/tools/lighthouse)
- [优化报告](../../OPTIMIZATION_REPORT.md)
