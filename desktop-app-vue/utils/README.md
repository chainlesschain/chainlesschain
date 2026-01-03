# 实用工具目录

本目录包含开发和生产环境使用的各类实用工具（11个文件）。

## 📁 目录结构

### 📊 监控工具（monitoring/）
生产环境和开发过程监控

**脚本列表**:
- `monitor-distillation.js` - 知识蒸馏监控
- `monitor-production.js` - 生产环境监控

### 🚀 部署工具（deployment/）
生产环境部署和集成

**脚本列表**:
- `production-integration.js` - 生产环境集成
- `deploy-config.js` - 部署配置
- `verify-deployment.js` - 验证部署

### 🔨 构建工具（build/）
应用构建和打包脚本

**脚本列表**:
- `auto-test-office.sh` - 自动测试Office功能
- `build-windows-package-standalone.sh` - 独立Windows打包
- `quick-test.sh` - 快速测试
- `start-video-project.sh` - 启动视频项目

### 🎨 界面工具（根目录）
控制面板和仪表盘

**文件列表**:
- `control-panel.html` - 系统控制面板（47KB）
- `control-panel-api.js` - 控制面板API
- `dashboard.html` - 监控仪表盘（27KB）
- `dashboard-api.js` - 仪表盘API
- `debug-preview.html` - 调试预览界面

### ⚙️ 优化工具（根目录）
性能优化和自动化

**脚本列表**:
- `cache-optimizer.js` - 缓存优化器
- `online-learning.js` - 在线学习系统
- `tune-distillation-threshold.js` - 调优知识蒸馏阈值
- `workflow-automation.js` - 工作流自动化

## 🚀 使用方法

### 监控生产环境
```bash
# 生产环境监控
node utils/monitoring/monitor-production.js

# 知识蒸馏监控
node utils/monitoring/monitor-distillation.js
```

### 部署和验证
```bash
# 部署配置
node utils/deployment/deploy-config.js

# 生产集成
node utils/deployment/production-integration.js

# 验证部署
node utils/deployment/verify-deployment.js
```

### 构建和打包
```bash
# Windows独立打包
./utils/build/build-windows-package-standalone.sh

# 快速测试
./utils/build/quick-test.sh

# Office自动测试
./utils/build/auto-test-office.sh
```

### 访问控制面板
```bash
# 启动应用后访问
# 控制面板: http://localhost:PORT/control-panel.html
# 仪表盘: http://localhost:PORT/dashboard.html
```

### 性能优化
```bash
# 缓存优化
node utils/cache-optimizer.js

# 在线学习
node utils/online-learning.js

# 调优蒸馏阈值
node utils/tune-distillation-threshold.js
```

## 📊 控制面板功能

### control-panel.html
系统控制面板，提供以下功能：
- P2智能层配置
- 自适应优化设置
- 在线学习管理
- 知识蒸馏控制
- 生产环境监控

### dashboard.html
监控仪表盘，显示：
- 系统性能指标
- P2智能层统计
- 缓存命中率
- 响应时间分布
- 实时日志

## 📝 注意事项

1. **生产环境**: 监控和部署工具仅在生产环境使用
2. **权限要求**: 某些工具需要系统管理员权限
3. **配置检查**: 运行前检查 `.env` 配置文件
4. **Shell脚本**: `.sh` 文件需要可执行权限（`chmod +x`）

## 🔗 相关目录

- **scripts/performance/** - 性能分析脚本
- **scripts/build/** - 构建脚本
- **data/reports/** - 监控报告

---

**最后更新**: 2026-01-03
