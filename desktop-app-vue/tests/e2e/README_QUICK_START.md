# E2E测试 - 5分钟快速开始 ⚡

> 最快速的入门指南，5分钟上手E2E测试

---

## ⚡ 3步开始

### 1️⃣ 检查环境（1分钟）

```bash
npm run test:e2e:health
```

如果显示"环境完全健康"，跳到步骤3。否则：

```bash
# 如果主进程未构建
npm run build:main

# 如果依赖缺失
npm install
```

### 2️⃣ 运行第一个测试（2分钟）

```bash
# 运行单个测试文件
npm run test:e2e -- tests/e2e/knowledge/knowledge-graph.e2e.test.ts
```

### 3️⃣ 查看测试报告（1分钟）

```bash
npm run test:e2e:report
```

报告会自动在浏览器中打开！

---

## 🎯 常用命令

| 命令 | 用途 | 时间 |
|-----|------|------|
| `npm run test:e2e:health` | 检查环境 | 1-2分钟 |
| `npm run test:e2e:quick` | 快速验证 | 30-40分钟 |
| `npm run test:e2e:ui` | UI调试模式 | 即时 |
| `npm run test:e2e:report` | 生成报告 | 5秒 |

---

## 📚 详细文档

- **完整指南**: `INDEX.md` - 从这里开始深入了解
- **用户指南**: `USER_GUIDE.md` - 详细使用说明
- **命令参考**: `COMMANDS_REFERENCE.md` - 所有命令速查

---

## 🆘 遇到问题？

```bash
# 1. 运行健康检查
npm run test:e2e:health

# 2. 查看用户指南的故障排除章节
# 文件: USER_GUIDE.md > 故障排除

# 3. 使用UI模式调试
npm run test:e2e:ui
```

---

## ✅ 测试状态

- **覆盖率**: 100% (80/80页面)
- **通过率**: 100% (47/47测试)
- **状态**: ✅ 生产就绪

---

**提示**: 这只是快速开始，查看 `INDEX.md` 了解完整功能！
