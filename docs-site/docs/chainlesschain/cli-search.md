# 混合搜索 (search)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 概述

执行 BM25 关键词搜索，对笔记和知识库内容进行智能检索。支持多种搜索模式和结果重排序。

## 命令参考

```bash
chainlesschain search <query>                    # 默认 BM25 搜索
chainlesschain search "JavaScript" --top-k 5     # 限制结果数
chainlesschain search "机器学习" --mode bm25     # 指定搜索模式
chainlesschain search "API设计" --json           # JSON 输出
```

## 选项

| 选项       | 说明               | 默认值 |
| ---------- | ------------------ | ------ |
| `--mode`   | 搜索模式 (bm25)    | bm25   |
| `--top-k`  | 返回结果数         | 10     |
| `--json`   | 以 JSON 格式输出   | false  |

## 搜索模式

### BM25 关键词搜索

基于 Okapi BM25 算法的关键词搜索，适合精确的关键词匹配：

```bash
chainlesschain search "React hooks" --mode bm25
```

**特点：**
- 基于词频和逆文档频率 (TF-IDF) 的统计模型
- 支持中英文分词
- 适合精确关键词查找

## 使用示例

```bash
# 搜索包含 "TypeScript" 的笔记
chainlesschain search "TypeScript"

# 限制返回前 3 条结果
chainlesschain search "数据库优化" --top-k 3

# 以 JSON 格式输出，便于脚本处理
chainlesschain search "API" --json | jq '.results[0]'
```

## 依赖

- 需要先初始化数据库：`chainlesschain db init`
- 需要已��笔记数据：`chainlesschain note add ...`
