# 笔记/知识库管理 (note)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 命令参考

```bash
chainlesschain note add "我的笔记" -c "笔记内容" -t "标签1,标签2"
chainlesschain note list                # 列出最近笔记
chainlesschain note list --category dev --tag 重要
chainlesschain note list --json         # JSON格式输出
chainlesschain note show <id>           # 按ID前缀查看笔记
chainlesschain note search "关键词"      # 全文搜索
chainlesschain note delete <id>         # 软删除
```

## 子命令说明

### add

创建新笔记，支持标题、内容和标签。

```bash
chainlesschain note add "学习笔记" -c "今天学了 WebRTC" -t "学习,webrtc"
```

### list

列出笔记，支持按分类和标签筛选。

```bash
chainlesschain note list
chainlesschain note list --category dev --tag 重要
chainlesschain note list --json
```

### show

按 ID 前缀查看笔记详情。

```bash
chainlesschain note show abc123
```

### search

全文搜索笔记内容。

```bash
chainlesschain note search "关键词"
```

### delete

软删除笔记（可恢复）。

```bash
chainlesschain note delete abc123
```
