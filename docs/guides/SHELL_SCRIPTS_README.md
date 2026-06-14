# Shell 脚本快速参考

## 🎯 一分钟开始使用

### 如果你使用 Git Bash

```bash
# 1. 打开 Git Bash 终端
# 2. 运行构建
cd /c/code/chainlesschain
./build-windows-package.sh
```

### 如果你使用 WSL

```bash
# 1. 打开 WSL 终端
# 2. 运行构建
cd /mnt/c/code/chainlesschain
./build-windows-package.sh
```

---

## 📋 所有 Shell 脚本

### 构建脚本

```bash
# 主构建脚本（完整构建流程）
./build-windows-package.sh

# 下载第三方组件
./packaging/download-components.sh

# 检查组件是否准备好
./packaging/scripts/check-components.sh
```

### 服务管理

```bash
# 启动所有后端服务
./packaging/scripts/start-backend-services.sh

# 停止所有后端服务
./packaging/scripts/stop-backend-services.sh

# 检查服务运行状态
./packaging/scripts/check-services.sh
```

---

## 🔧 常用命令

### 添加执行权限

```bash
chmod +x build-windows-package.sh
chmod +x packaging/scripts/*.sh
```

### 查看脚本帮助

```bash
# 查看脚本内容
cat build-windows-package.sh

# 调试模式运行
bash -x build-windows-package.sh
```

---

## 💡 快捷工作流

```bash
# 1. 检查组件
./packaging/scripts/check-components.sh

# 2. 如有缺失，下载组件
./packaging/download-components.sh

# 3. 运行构建
./build-windows-package.sh

# 4. 测试服务（可选）
./packaging/scripts/start-backend-services.sh
./packaging/scripts/check-services.sh
./packaging/scripts/stop-backend-services.sh
```

---

## 📖 详细文档

完整的 Shell 脚本使用指南: `packaging/docs/SHELL_SCRIPTS_GUIDE.md`

---

## 🆚 Shell vs Batch

| 脚本类型 | 适用环境 | 文件扩展名 |
|---------|---------|-----------|
| Batch | Windows CMD/PowerShell | `.bat` |
| Shell | Git Bash/WSL/Cygwin | `.sh` |

**功能完全相同，选择你喜欢的！** ✨

---

## ⚠️ 常见问题

**Q: Permission denied?**
```bash
chmod +x build-windows-package.sh
```

**Q: 找不到命令?**
```bash
# 使用相对路径
./build-windows-package.sh

# 或绝对路径
/c/code/chainlesschain/build-windows-package.sh
```

**Q: Windows 换行符问题?**
```bash
dos2unix build-windows-package.sh
# 或
sed -i 's/\r$//' build-windows-package.sh
```

---

**Happy Building!** 🚀

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。Shell 脚本快速参考：项目 shell 脚本说明。

### 2. 核心特性
shell 脚本 / 快速参考 / 用途。

### 3. 系统架构
见正文 / [系统架构](../design/系统设计_主文档.md)（三端 + 双后端 + P2P）。

### 4. 系统定位
ChainlessChain 的「Shell 脚本快速参考」。

### 5. 核心功能
见正文各节。

### 6. 技术架构
见正文技术 / 环境章节。

### 7. 系统特点
见正文（步骤 / 版本 / 注意事项）。

### 8. 应用场景
见正文使用场景。

### 9. 竞品对比
见正文对比（如有）。

### 10. 配置参考
见正文配置 / 环境变量章节；`.chainlesschain/config.json`。

### 11. 性能指标
见正文性能 / 资源要求（如有）。

### 12. 测试覆盖
见正文验证 / 测试步骤（如有）。

### 13. 安全考虑
见正文安全 / 密钥章节（如适用）。

### 14. 故障排除
见正文故障排查 / 常见问题章节。

### 15. 关键文件
见正文涉及的文件 / 目录 / 脚本。

### 16. 使用示例
见正文命令 / 操作示例。

### 17. 相关文档
[用户指南索引](./README.md)、[快速开始](../quick-start/QUICK_START.md)、其它用户文档。
