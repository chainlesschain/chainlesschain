# 数据库管理 (db)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 命令参考

```bash
chainlesschain db init                  # 初始化数据库
chainlesschain db init --path ./my.db   # 指定数据库路径
chainlesschain db info                  # 查看数据库信息（驱动、表数、大小）
chainlesschain db info --json           # JSON格式输出
chainlesschain db backup [output]       # 创建备份
chainlesschain db restore <backup>      # 从备份恢复
```

## 子命令说明

### init

初始化 SQLite 数据库，自动创建所有表和索引。

```bash
chainlesschain db init
chainlesschain db init --path ./custom.db
```

### info

显示数据库基本信息，包括驱动类型、表数量、文件大小等。

```bash
chainlesschain db info
chainlesschain db info --json
```

### backup / restore

创建数据库备份或从备份恢复。

```bash
chainlesschain db backup                    # 备份到默认位置
chainlesschain db backup ./my-backup.db     # 备份到指定路径
chainlesschain db restore ./my-backup.db    # 从备份恢复
```
