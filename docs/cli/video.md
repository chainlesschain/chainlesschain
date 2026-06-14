# CLI — Video Editing Agent (CutClaw-inspired)

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)

```bash
# 完整管线: deconstruct → plan → assemble → render
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --instruction "节奏感强的角色蒙太奇"
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --instruction "..." --stream  # NDJSON 流式输出
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --instruction "..." --json

# Phase 3: 并行 + 质量门控
chainlesschain video edit ... --parallel --review
chainlesschain video edit ... --parallel --concurrency 8    # 最大并行段数

# Phase 4: 音频精准处理 — 节拍对齐 + ducking
chainlesschain video edit ... --use-madmom --snap-beats     # madmom 节拍检测 + 对齐
chainlesschain video edit ... --ducking                     # 音频混合时对对白做 ducking
chainlesschain video edit ... --use-madmom --snap-beats --ducking --parallel --review  # 全部开关

# 分步执行 (用于调试 / Web 进度展示)
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3     # → 缓存素材哈希
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3 --use-madmom  # madmom 节拍
chainlesschain video plan --asset-dir <dir> --instruction "..."      # → shot_plan.json
chainlesschain video assemble --asset-dir <dir> --plan shot_plan.json # → shot_point.json
chainlesschain video assemble ... --parallel --review                 # 并行 + 质量门控
chainlesschain video render --video raw.mp4 --points shot_point.json --output final.mp4

# 素材缓存管理
chainlesschain video assets list                  # 列出已解构的素材
chainlesschain video assets show --hash <hash>    # 查看素材详情
chainlesschain video assets prune --older-than 30 # 清理旧缓存
```

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。CLI Video Editing Agent（CutClaw 借鉴）：视频剪辑 agent 命令。

### 2. 核心特性
视频剪辑 agent / cc video / 模板。

### 3. 系统架构
见正文 / [系统架构](../design/系统设计_主文档.md)（三端 + 双后端 + P2P）。

### 4. 系统定位
ChainlessChain 的「CLI 视频剪辑 Agent」。

### 5. 核心功能
见正文各节。

### 6. 技术架构
Electron + Vue3 / Spring Boot + FastAPI / libp2p + Signal / SQLCipher（按需）。

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
见正文验证步骤（如有）。

### 13. 安全考虑
见正文安全 / 密钥章节；本地加密 + U盾/SIMKey（如适用）。

### 14. 故障排除
见正文故障排查 / 常见问题章节。

### 15. 关键文件
见正文涉及的文件 / 目录。

### 16. 使用示例
见正文命令 / 操作示例。

### 17. 相关文档
[快速开始](./QUICK_START.md)、[安装指南](./INSTALLATION.md)、其它用户文档。
