# PC端功能测试和部署指南

## 一、测试准备

### 1.1 环境准备

```bash
# 1. 安装依赖
cd desktop-app-vue
npm install

# 2. 安装测试工具
npm install --save-dev @playwright/test
npx playwright install

# 3. 启动开发服务器
npm run dev
```

### 1.2 启动HTTP服务器

确保HTTP服务器在端口23456运行：

```bash
# 检查端口
lsof -i :23456

# 如果没有运行，应用会自动启动
```

## 二、功能测试

### 2.1 语音输入功能测试

#### 手动测试清单

**AI聊天页面测试**:
- [ ] 打开AI聊天页面 (http://localhost:5173/#/ai-chat)
- [ ] 点击语音输入按钮
- [ ] 允许麦克风权限
- [ ] 检查录音模态框是否显示
- [ ] 检查波形动画是否正常
- [ ] 检查音量指示器是否工作
- [ ] 说话并检查实时转录
- [ ] 测试暂停功能
- [ ] 测试继续功能
- [ ] 测试取消功能
- [ ] 测试完成功能
- [ ] 检查识别文本是否填充到输入框

**知识库编辑页面测试**:
- [ ] 打开知识库编辑页面
- [ ] 点击编辑器工具栏的语音按钮
- [ ] 执行相同的录音测试
- [ ] 检查识别文本是否追加到编辑器

#### 自动化测试

```bash
# 运行语音输入测试
npx playwright test tests/integration/pc-features.test.js --grep "语音输入"
```

#### 性能测试

```bash
# 测试识别速度
node tests/performance/speech-performance.js

# 预期结果:
# - 短音频(<10秒): <2秒
# - 中等音频(10-60秒): <5秒
# - 长音频(>60秒): <10秒
```

### 2.2 知识图谱功能测试

#### 手动测试清单

**基础功能**:
- [ ] 打开知识图谱页面 (http://localhost:5173/#/knowledge-graph)
- [ ] 检查图谱是否正常渲染
- [ ] 检查统计信息是否显示
- [ ] 测试布局切换（力导向/环形/层级）
- [ ] 测试缩放和拖拽
- [ ] 测试节点点击
- [ ] 测试节点悬停

**筛选功能**:
- [ ] 测试节点类型筛选
- [ ] 测试关系类型筛选
- [ ] 测试最小权重调整
- [ ] 测试节点数量限制

**高级功能**:
- [ ] 测试节点搜索
- [ ] 测试路径查找
- [ ] 测试社区检测
- [ ] 测试中心性分析

**性能测试**:
- [ ] 测试100个节点的渲染速度
- [ ] 测试500个节点的渲染速度
- [ ] 测试1000个节点的渲染速度
- [ ] 检查FPS是否稳定在30+

#### 自动化测试

```bash
# 运行图谱测试
npx playwright test tests/integration/pc-features.test.js --grep "知识图谱"
```

#### 性能基准测试

```bash
# 运行性能测试
node tests/performance/graph-performance.js

# 预期结果:
# - 100节点: <500ms, FPS>50
# - 500节点: <1500ms, FPS>30
# - 1000节点: <3000ms, FPS>20
```

### 2.3 网页剪藏功能测试

#### HTTP服务器测试

**API测试**:
```bash
# 1. Ping测试
curl -X POST http://localhost:23456/api/ping

# 预期: {"success":true,"data":{"message":"pong"}}

# 2. 单个剪藏测试
curl -X POST http://localhost:23456/api/clip \
  -H "Content-Type: application/json" \
  -d '{
    "title": "测试网页",
    "content": "这是测试内容",
    "url": "https://example.com",
    "tags": ["测试"]
  }'

# 3. 批量剪藏测试
curl -X POST http://localhost:23456/api/batch-clip \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"title": "网页1", "content": "内容1", "url": "https://example.com/1"},
      {"title": "网页2", "content": "内容2", "url": "https://example.com/2"}
    ]
  }'

# 4. 搜索测试
curl -X POST http://localhost:23456/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "测试", "limit": 10}'

# 5. 统计测试
curl -X POST http://localhost:23456/api/stats
```

#### 浏览器扩展测试

**安装测试**:
- [ ] 构建扩展: `cd browser-extension && npm run build:chrome`
- [ ] 在Chrome中加载扩展
- [ ] 检查扩展图标是否显示
- [ ] 点击图标检查连接状态

**功能测试**:
- [ ] 打开任意网页
- [ ] 点击扩展图标
- [ ] 检查内容是否正确提取
- [ ] 测试标题编辑
- [ ] 测试标签添加
- [ ] 测试AI标签生成
- [ ] 测试AI摘要生成
- [ ] 测试截图功能
- [ ] 测试标注工具
- [ ] 测试批量剪藏
- [ ] 点击"剪藏到知识库"
- [ ] 检查是否成功保存

#### 自动化测试

```bash
# 运行HTTP服务器测试
npx playwright test tests/integration/pc-features.test.js --grep "网页剪藏"
```

## 三、性能优化验证

### 3.1 语音识别性能

```bash
# 运行优化器测试
node tests/performance/speech-optimizer-test.js

# 检查指标:
# - 缓存命中率: >50%
# - 平均识别时间: <3秒
# - 音频优化时间: <500ms
```

### 3.2 图谱渲染性能

```bash
# 运行优化器测试
node tests/performance/graph-optimizer-test.js

# 检查指标:
# - 渲染时间: <2秒
# - FPS: >30
# - 缓存命中率: >40%
# - 内存使用: <500MB
```

### 3.3 HTTP服务器性能

```bash
# 运行压力测试
npm install -g autocannon
autocannon -c 10 -d 30 http://localhost:23456/api/ping

# 检查指标:
# - 平均响应时间: <50ms
# - 吞吐量: >100 req/s
# - 错误率: <1%
```

## 四、集成测试

### 4.1 端到端测试

```bash
# 运行完整的端到端测试
npx playwright test tests/e2e/complete-workflow.test.js

# 测试场景:
# 1. 用户打开应用
# 2. 使用语音输入创建笔记
# 3. 查看知识图谱
# 4. 使用浏览器扩展剪藏网页
# 5. 在图谱中查看新增节点
```

### 4.2 回归测试

```bash
# 运行所有测试
npm run test

# 检查测试覆盖率
npm run test:coverage

# 目标覆盖率:
# - 语句覆盖率: >80%
# - 分支覆盖率: >70%
# - 函数覆盖率: >80%
```

## 五、部署准备

### 5.1 构建生产版本

```bash
# 1. 清理旧构建
npm run clean

# 2. 构建主进程
npm run build:main

# 3. 构建渲染进程
npm run build:renderer

# 4. 完整构建
npm run build

# 5. 打包应用
npm run make:win  # Windows
npm run make:mac  # macOS
npm run make:linux  # Linux
```

### 5.2 构建浏览器扩展

```bash
cd browser-extension

# 构建所有浏览器版本
npm run build:all

# 输出目录:
# - build/chrome/  (Chrome/Edge)
# - build/firefox/ (Firefox)
```

### 5.3 版本检查

```bash
# 检查版本号
cat package.json | grep version

# 更新版本号
npm version patch  # 0.20.0 -> 0.20.1
npm version minor  # 0.20.0 -> 0.21.0
npm version major  # 0.20.0 -> 1.0.0
```

## 六、部署清单

### 6.1 桌面应用部署

**Windows**:
- [ ] 构建安装包: `npm run make:win`
- [ ] 测试安装程序
- [ ] 测试自动更新
- [ ] 检查数字签名
- [ ] 上传到发布服务器

**macOS**:
- [ ] 构建DMG: `npm run make:mac`
- [ ] 测试安装
- [ ] 公证应用（Notarization）
- [ ] 上传到发布服务器

**Linux**:
- [ ] 构建AppImage/DEB/RPM
- [ ] 测试安装
- [ ] 上传到发布服务器

### 6.2 浏览器扩展部署

**Chrome Web Store**:
- [ ] 准备商店资料（图标、截图、描述）
- [ ] 上传扩展包
- [ ] 提交审核
- [ ] 发布

**Firefox Add-ons**:
- [ ] 准备商店资料
- [ ] 上传扩展包
- [ ] 提交审核
- [ ] 发布

**Edge Add-ons**:
- [ ] 准备商店资料
- [ ] 上传扩展包
- [ ] 提交审核
- [ ] 发布

## 七、监控和维护

### 7.1 性能监控

```javascript
// 添加性能监控
import { getPerformanceMonitor } from './utils/performance-monitor';

const monitor = getPerformanceMonitor();

// 记录关键指标
monitor.recordMetric('speech-recognition-time', time);
monitor.recordMetric('graph-render-time', time);
monitor.recordMetric('http-response-time', time);

// 定期上报
setInterval(() => {
  const metrics = monitor.getMetrics();
  console.log('Performance Metrics:', metrics);
  // 可选: 上报到分析服务
}, 60000);
```

### 7.2 错误监控

```javascript
// 全局错误处理
window.addEventListener('error', (event) => {
  console.error('Global Error:', event.error);
  // 上报错误
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise Rejection:', event.reason);
  // 上报错误
});
```

### 7.3 用户反馈

- 设置反馈渠道（GitHub Issues、邮件）
- 收集用户使用数据（匿名）
- 定期分析性能指标
- 根据反馈优化功能

## 八、故障排查

### 8.1 常见问题

**语音识别不工作**:
```bash
# 检查麦克风权限
# Chrome: chrome://settings/content/microphone

# 检查Web Speech API支持
console.log('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

# 检查网络连接（在线模式）
```

**图谱渲染缓慢**:
```bash
# 检查节点数量
console.log('Node count:', nodes.length);

# 启用性能优化
# 设置 -> 图谱 -> 启用性能优化

# 减少节点数量
# 使用筛选功能
```

**HTTP服务器连接失败**:
```bash
# 检查服务器状态
curl http://localhost:23456/api/ping

# 检查端口占用
lsof -i :23456

# 重启应用
```

### 8.2 日志收集

```bash
# 主进程日志
tail -f ~/Library/Logs/ChainlessChain/main.log  # macOS
tail -f %APPDATA%/ChainlessChain/logs/main.log  # Windows

# 渲染进程日志
# 打开开发者工具: Ctrl+Shift+I (Windows) / Cmd+Option+I (macOS)
```

## 九、发布说明

### 9.1 版本说明模板

```markdown
# ChainlessChain v0.21.0 发布说明

## 新功能

### 语音输入
- ✨ 增强的语音输入组件，支持暂停/继续
- ✨ 实时转录显示
- ✨ 音量指示器
- ✨ 集成到AI聊天和知识库编辑

### 知识图谱
- ✨ 新增交互面板
- ✨ 节点搜索和筛选
- ✨ 路径查找功能
- ✨ 社区检测分析
- ✨ 中心性分析

### 网页剪藏
- ✨ 批量剪藏API
- ✨ 搜索接口
- ✨ 统计接口
- ✨ 性能优化

## 改进

- 🚀 语音识别性能提升50%
- 🚀 图谱渲染速度提升3倍
- 🚀 HTTP服务器响应时间减少60%

## 修复

- 🐛 修复语音识别在某些浏览器的兼容性问题
- 🐛 修复大规模图谱渲染卡顿
- 🐛 修复批量剪藏失败问题

## 已知问题

- Web Speech API仅支持Chrome/Edge
- 大规模图谱(>5000节点)可能出现性能问题

## 升级说明

1. 备份数据
2. 下载新版本
3. 安装更新
4. 重启应用

## 反馈

如有问题，请访问: https://github.com/your-repo/issues
```

### 9.2 更新日志

维护 `CHANGELOG.md`:

```markdown
# Changelog

## [0.21.0] - 2026-01-11

### Added
- Enhanced voice input component
- Graph interaction panel
- Batch clipping API

### Changed
- Improved speech recognition performance
- Optimized graph rendering

### Fixed
- Voice recognition compatibility issues
- Graph rendering lag
```

## 十、总结

完成以上测试和部署步骤后，PC端功能将达到生产就绪状态。建议：

1. **持续测试**: 每次更新后运行完整测试套件
2. **性能监控**: 定期检查性能指标
3. **用户反馈**: 积极收集和响应用户反馈
4. **迭代优化**: 根据使用情况持续优化

---

**文档版本**: 1.0
**创建日期**: 2026-01-11
**维护者**: ChainlessChain Team
