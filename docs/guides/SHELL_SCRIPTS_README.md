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

完整的 Shell 脚本使用指南: `packaging/SHELL_SCRIPTS_GUIDE.md`

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
