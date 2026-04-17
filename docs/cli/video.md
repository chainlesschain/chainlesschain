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
