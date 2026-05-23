# 隐性风险陷阱手册（#6-#18）

> Internal engineering reference. 项目内每一次"代码能跑 / CI 全绿 / dev 没问题但生产 / 用户 / 下次重装炸"事件的总结。
>
> 编号 6-18 是历史顺序（1-5 在本文档创建前已沉淀于 CLAUDE.md 或个人 memory，未编号统一）。
>
> 触发条件 = 你打算改某文件 / 跑某命令 / 进某状态时，对应陷阱就该读。
>
> 内部链接里的 memory 路径指 `~/.claude/projects/.../memory/`（个人 / session memory），不是 git tracked。本文档是 git tracked 的、可分享的副本。

---

## 快速索引

| # | 主题 | 触发条件（开工前必读） | 核心 memory |
|---|---|---|---|
| 6 | 文档同步陷阱 | 编辑 `docs-site/docs/design/**` 或 `docs-site-design/docs/**`；加新中文-named design doc | `docs_site_sync_unmapped_fallthrough.md` |
| 7 | npm 发版漏发 | 改 `packages/*/{lib,src}`；加新 `packages/*` 包；发版前 | `npm_publish_audit_and_dep_chain.md` |
| 8 | CI 假绿 mask | 改 `.github/workflows/*.yml`；大发版前；任何"明明应该失败但绿了"事件后 | `feedback_ci_false_green_audit_checklist.md` |
| 9 | 并行 session git race | 多 session 同时活跃；`git add .` / `git commit -a`；rebase / reset / autostash | `feedback_parallel_session_git_race.md` |
| 10 | lint-staged untracked sweep | worktree 含 `??` 状态文件 commit；改 CHANGELOG/README/package.json | `feedback_lint_staged_sweep_unstaged_files.md` |
| 11 | E2E web-shell opt-out 失效 | 写 / 维护针对 V5 baseline 的 E2E 测试；预写 app-config.json | `e2e_helper_web_shell_opt_out_trap.md` |
| 12 | Node 23 native-dep prebuild gap | `node -v` 显示 odd-numbered 版本；`npm install` 后启动 MODULE_NOT_FOUND；CI runner image 升级 | `node_23_native_dep_trap.md` |
| 13 | Desktop release npm workspace hoisting | `desktop-app-vue` 加新 dep；release 跑得通 dev 跑得通但用户装完启动崩 | `desktop_release_npm_workspace_hoisting.md` |
| 14 | Android in-app update 5 traps | 改 `UpdateChecker.kt`；改 `release.yml` Android 段；改 keystore；用户报"装不上新版" | `feedback_android_update_loop_immutable_apk.md` |
| 15 | better-sqlite3 Number→TEXT `"1.0"` trap | 写 SQLite TEXT 列；JS Number 绑定；`WHERE col = '1'` silent miss | `better_sqlite3_text_number_trap.md` |
| 16 | commit-msg hook scope regex 拒数字 | 写 commit message；想用 `feat(p2p)` / `feat(v6)` / `feat(b4)` 类带数字 scope | `feedback_commit_msg_hook_scope_regex.md` |
| 17 | Android remote file skill 接通 6 雷 | 加新 `RemoteCommandClient.invoke` 类 Android skill；接 Plan C signaling 路径 | `android_remote_file_skill_traps.md` |
| 18 | GitHub immutable releases burn tag | `gh release create` / `gh release delete`；release pipeline 失败救援；测试发版命名 | `github_immutable_release_tag_burn.md` |
| 19 | Android release-mode R8 minify 只在 CI 暴露 | 加新重 lib dep（Ktor / gRPC / SLF4J / 大反射）；发版前 | `android_release_r8_minify_hotfix_chain.md` |

**按维度归类**（一个陷阱可能属多类）：

```
Release / 打包   : 7, 13, 14, 18, 19
Git / 并发       : 9, 10
CI / 测试        : 8, 11, 19
Toolchain        : 12, 16
Runtime / 数据   : 15
Mobile 平台      : 14, 17, 19
Docs             : 6
```

**4 个跨条共性**（所有陷阱都满足至少 2 条）：

1. **失败 silent**（无 error / 错误 misleading）→ 不会被常规测试 / CI 抓到
2. **dev vs prod 行为分裂**（或 session 1 vs session 2 / 桌面 vs 用户机分裂）→ 本地复现困难
3. **修法靠 SOP / checklist 不是代码** → 不能 "一次性彻底解决"，只能记忆
4. **触发条件具体**（改 X 文件 / 跑 Y 命令 / 进 Z 状态）→ 适合做"开工前 grep memory"

**使用方式建议**：

- 新 session 开始 + 看到本表对应触发条件 → 读对应章节 5 分钟
- 大发版前必跑：8（CI mask audit）+ 13（hoisting check）+ 18（draft-first 流程验证）三个 SOP
- 团队新人 onboarding 必读：6, 7, 9, 14, 18（覆盖最常踩 + 损失最大）

---

## 6. 文档同步陷阱（隐性风险）

**陷阱本质** — `docs-site/docs/design/**/*.md` 和 `docs-site-design/docs/**/*.md`（除 `index.md`）是**自动同步生成的副本**，不是 git tracked 源文件。直接编辑这些副本会：

1. 被下次 `sync-*.js` 脚本静默覆盖
2. `git status` 看不到（不在 tracked 范围）
3. 定位极其隐蔽，可能丢失数小时工作

**源文件真实位置**：

| 副本（❌ 不要改） | 同步脚本 | 真源（✅ 改这里） |
|---|---|---|
| `docs-site/docs/design/**/*.md` | `docs-site/scripts/sync-design-docs.js` | `docs/design/**/*.md`（项目根） |
| `docs-site-design/docs/**/*.md` | `docs-site-design/scripts/sync-docs.js` | 同上 |

**白名单例外**（每个 docs site 自管，可直接改）：
- `docs-site/docs/guide/**`（git tracked 源）
- 两站的 `index.md` 和 `.vitepress/`（在 sync EXCLUDE 里）

**衍生陷阱 — ROOT_FILE_MAP 缺映射 silent fall-through**：

- 两个 sync 脚本各自维护独立 `ROOT_FILE_MAP`
- 加新中文-named design doc 时，**两个 map 都得加**
- 缺映射 → silent 落入 `unknown-unmapped.md` 互相覆盖（前一个 doc 丢失，无报错）

**改设计文档 SOP**：

1. `git ls-files --error-unmatch <path>` 确认是否 tracked（非 0 退出码 = 你改的是副本不是源）
2. 若不是 → 找对应 `sync-*.js` 看 `sourceDir` 找真源
3. 改源 + 跑 `node <sync-script>` 让两份副本刷新
4. 加新 doc 还要同步加 ROOT_FILE_MAP 两处条目

**自动护栏**（2026-05-21 起）：`.husky/pre-commit` 加了 step 0.5 — 检测 staged 文件落在 `docs-site/docs/design/**` 或 `docs-site-design/docs/**`（除 `index.md`/`.vitepress/`）就**直接 reject** + 打印 SOP 提示。强制走源→sync→commit 路径。绕过用 `git commit --no-verify`（仅在确认源已对齐、副本只是 sync 输出的极特殊情况）。

**类似陷阱位置**：`desktop-app-vue/docs/api/generated/`、`packages/web-panel/dist/`（编辑前先确认是否生成产物）。

---

## 7. npm 包发版漏发（隐性风险）

改 `packages/*/{lib,src}` 或新加 `packages/*` 包时，发布常常静默漏发——dev 全绿、CI 通过、release 也"成功"，但 npm registry 上没有新版本，下游 `npm install -g` 拿到的还是旧码。

**两个独立根因**：

| 根因 | 失败模式 | 检测 |
|---|---|---|
| 本地 `version` 不 bump | 27 个 src commits 但 `packages/personal-data-hub/package.json` 版本号不变 → `npm publish` 走的还是已发布版本号 → 422 already exists，CI 当 idempotent 跳过 | `git log --oneline -- packages/<pkg>/lib packages/<pkg>/src \| head -30` vs `package.json` 的 version 字段 |
| `release.yml` 不含该包 | 新加的 `packages/<new-pkg>/` 根本没在 publish matrix / script 列表里 → 永远不会被发 | grep `release.yml` 看 publish 步骤是否枚举该包名 |

**衍生陷阱 — 依赖链 propagation**：

改了 `@chainlesschain/A`，但 `@chainlesschain/B`（依赖 A）的 `package.json` 没 bump → B 的 lockfile 还锁旧 A → 用户装 B 拿不到 A 的修复。

规则：A 改 + bump 后，所有 `dependencies` 含 `@chainlesschain/A` 的 consumer 包都必须跟 bump。

**SOP**（发版前必跑）：

```bash
# 1. 查最近 30 天每个 package 的 src commit 数 vs 当前 version 是否一致
for pkg in packages/*/; do
  changes=$(git log --since="30 days ago" --oneline -- "$pkg/lib" "$pkg/src" 2>/dev/null | wc -l)
  ver=$(jq -r .version "$pkg/package.json" 2>/dev/null)
  [ "$changes" -gt 0 ] && echo "$pkg: $changes commits, current=$ver"
done

# 2. 验 release.yml 枚举包名 vs packages/ 实际目录
diff <(ls packages/) <(grep -oP '@chainlesschain/[\w-]+' .github/workflows/release.yml | sort -u)

# 3. 发完核对 registry 真实状态
npm view @chainlesschain/<pkg> versions --json | tail -5
```

**实战触发**：2026-05-20 `packages/personal-data-hub` 27 src commits 漏发，下游 desktop app + CLI 都拿不到新 adapter 类。

---

## 8. CI 假绿 mask（隐性风险）

Workflow 全绿 ≠ 代码真编译过。多层"宽容"配置叠起来，能让真实失败一路 silent 漂到 release。最痛的是历史绿色基线是假的——你以为某个 Phase 已验证，回头发现根本没编过。

**4 种 mask 来源**（按隐蔽度排）：

| Mask | 失败模式 | 检测 |
|---|---|---|
| Job 级 `continue-on-error: true` | 整个 job fail 但 workflow 显示 success；3/3 OS 全挂 PR 仍可 merge | `rg 'continue-on-error:\s*true' .github/workflows/` |
| Pipe 级 `\|\| true` / `\|\| exit 0` | 编译错被 `cmd \|\| true` 吞掉；`xcodebuild \| xcpretty` 类格式化器会 silent drop 不识别的 error 行 | `rg '\|\|\s*(true\|exit 0)' .github/workflows/ && rg 'xcpretty\\\|fmt\\\|prettier' .github/workflows/` |
| 缺 `set -e` 的多行 `run:` | 第 1 行 fail，第 2-N 行继续跑，最后退出码 0 | `rg -A1 'run: \\\|' .github/workflows/` 找无 `set -e` 的多行块 |
| Stale scaffolding | Xcode 工程文件 / SPM Package.swift 引用根本不存在的 target，xcodebuild "found 0 schemes, success" | grep 工程文件里的 target 名 vs 真目录是否存在 |

**iOS Phase 1-5 实战教训**（2026-05-16，`e000057e9` → `9dfbc1b8e` 29 commits 收口）：

- `ios-build.yml` 同时有 job 级 `continue-on-error` + pipe 级 `xcodebuild | xcpretty || true` 双层 mask
- 加上 stale `create_xcode_project.rb` 不接 SPM target
- 结果：**8 个 Phase 1-5 commit 的 iOS CI 全显示 ✅，实际一行 Swift 都没编译过**
- 收口时拔双层 mask + 接 SPM wiring → app target 暴露 **412 个老 compile error**

**SOP — 大发版前 / 任何 CI 假绿事件后**：

```bash
# 5 rg 全树扫，任一非空都得审
rg 'continue-on-error:\s*true' .github/workflows/
rg '\|\|\s*(true\|exit 0\|:)' .github/workflows/
rg '\|\s*(xcpretty\|xcbeautify\|fmt)' .github/workflows/  # 静默格式化器
rg 'run: \|' .github/workflows/ -A 2 | grep -v 'set -e'  # 多行无 set -e
rg 'allow.failure\|soft.fail' .github/workflows/  # 别名变种
```

**自动化已 land**（commit `4e3ae4f57`）：`scripts/audit-ci-masks.sh` + `.github/workflows/ci-mask-audit.yml` 作 PR advisory gate。**但是 advisory ≠ blocking**——大发版前仍要人肉跑一遍 5 rg。

**合法 mask 白名单**（不算 false-green）：

- 矩阵里实验性 target（如 `experimental-windows: continue-on-error: true` 显式标注）
- Linter / advisory check 单独 job（不影响主 build 绿）
- Notification / artifact-upload 失败不应阻塞 build

---

## 9. 并行 session git race（隐性风险）

多个 Claude session 同时跑在同一个仓库（共享 `.git/`），任何一方的 `git add` / `commit` / `reset` / `rebase` / `checkout` 都会移动对方看到的 HEAD / index / worktree。错误的提交命令会把另一个 session 正在改的文件**静默拖进自己的 commit**，或者反过来——你以为提交的文件，被对方 `lint-staged --no-stash` 倒退给删了。最痛的是绝大多数失败模式没有报错，只是 commit 里多了/少了文件。

**5 种 race 模式**：

| 模式 | 失败结果 | 防御 |
|---|---|---|
| `git add .` / `git commit -a` | 扫到对方 modified 但 unstaged 的文件，全打包进你的 commit | **永远用** `git commit --only -- <显式路径>`（race-immune，只看路径不看 index）|
| `lint-staged --no-stash` + 对方并发 push | 对方 push 后你的 lint-staged 把 worktree reset 到 HEAD，**你 staged 但未 commit 的改动全丢，无报错** | pre-commit snapshot hook 已 land（`210f82074`），恢复用 `.git/last-precommit-snapshots.log` 里的 SHA |
| `git reset --hard <remote>/main` | 抹掉对方 staged 的 NEW files（untracked → 不在 reset 范围 ≠ 不在 worktree！staged-new 会丢）| `git fsck --lost-found` + `cat-file -p` grep 内容关键字命中 blob，写回 |
| `git rebase --autostash` 当对方 worktree 脏（MM 状态） | Win 上**无声 hang** + `.git/index.lock` 卡死，僵尸 git.exe 不退出 | 改用 `git merge-tree --write-tree` + `git commit-tree` plumbing（零触工作区），见 #9 增订 |
| 文档 sweep 类（CHANGELOG / README / package.json） | 你改了 README 没 stage，对方的 lint-staged `package.json` glob 把你的 README 一起扫进他们的 commit | 改完**立刻** `git add <file>`，缩短 unstaged 窗口到接近 0 |

**核心防御原则**：

```bash
# ❌ race-prone（看 index 状态）
git add .
git commit -am "msg"
git commit -a

# ✅ race-immune（只看显式路径，不看 index 当前状态）
git commit --only -- packages/foo/file.js docs/bar.md

# ✅ 改完立刻 stage，闭合 unstaged 窗口
edit file.js && git add file.js  # 一行内完成
```

**实战恢复 SOP**：

```bash
# 场景 A：lint-staged --no-stash 倒退后丢 modified
cat .git/last-precommit-snapshots.log | tail -5  # 找最近 snapshot SHA
git checkout <snapshot-sha> -- packages/foo/file.js
# untracked 新文件不在 snapshot 里 → 必须重写

# 场景 B：git reset --hard 抹掉 staged NEW files
git fsck --lost-found
git cat-file -p <dangling-blob-sha> | grep "你记得的关键字"  # 命中 1 秒
git cat-file -p <matched-sha> > path/to/file.swift  # 写回

# 场景 C：rebase hang + index.lock 卡死（Win）— 见 #9 增订
```

**CI 衍生陷阱**：`cancel-in-progress: true` 的 workflow 在多 session 高频 push 时会被**下一个 commit 在 19 秒内 cancel** 掉。判据：cancel 时间窗 < 30s 且来自同 branch = race 受害，不是你代码问题——直接重跑。

**双 remote push 场景**：`.husky/post-commit` 自动 push gitee + github。force-push（amend / rebase 后）**不会**自动跑，hook 探测到 rewritten HEAD 只打 warn。手动用 `git push --force-with-lease=main:<expected-sha>` 防覆盖对方 push。

**2026-05-19 Phase 5.5 实战**：另一 session `git reset --hard github/main` 抹掉本 session 4 个 staged NEW files。`git fsck --lost-found` + `cat-file -p | grep "Phase 5.5"` 1 秒命中 4 blob，全部写回。

### #9 增订 — Plumbing rebase（替代 `rebase --autostash`）

**场景**：你想把本地几个 commit rebase 到 `origin/main` 之上，但另一个 session 的工作区有 `MM` 脏文件，不能跑标准 `git rebase`（会 stash 它们的改动 → 出问题）。

**Plumbing 替代**（不动 worktree、不动 index、不动对方文件）：

```bash
# 1. 找出你的 commit 范围
BASE=$(git merge-base HEAD origin/main)
YOUR_COMMITS=$(git log --reverse --format=%H $BASE..HEAD)

# 2. 对每个 commit，用 merge-tree 算出 rebase 后的 tree（不写 worktree）
#    然后 commit-tree 写新 commit
PARENT=$(git rev-parse origin/main)
for c in $YOUR_COMMITS; do
  NEW_TREE=$(git merge-tree --write-tree --merge-base=$BASE $PARENT $c)
  MSG=$(git log -1 --format=%B $c)
  AUTHOR_NAME=$(git log -1 --format=%an $c)
  AUTHOR_EMAIL=$(git log -1 --format=%ae $c)
  AUTHOR_DATE=$(git log -1 --format=%ad $c)
  PARENT=$(GIT_AUTHOR_NAME="$AUTHOR_NAME" \
           GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
           GIT_AUTHOR_DATE="$AUTHOR_DATE" \
           git commit-tree $NEW_TREE -p $PARENT -m "$MSG")
  BASE=$c
done

# 3. 最后把 HEAD 指到新 chain 顶（仍不动 worktree）
git update-ref refs/heads/main $PARENT
# 注意：不要跑 git checkout / reset --hard，那会触工作区
```

**特点**：
- 整个过程零 `git checkout` / `git reset` / `git stash` / `git rebase`
- 对方 session 的 `MM` 文件完全没被碰
- `.git/index.lock` 不会被本流程持有（plumbing 命令操作 object DB 不操作 index）
- 失败可恢复：HEAD 没动直到最后一步 `update-ref`

**如果已经卡在 `.git/index.lock`（Win 上 rebase --autostash hang 的状态）**：

```powershell
# 1. 杀僵尸 git 进程
Get-Process git -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 强删 lock 文件
Remove-Item -Force .git/index.lock
Remove-Item -Force .git/HEAD.lock -ErrorAction SilentlyContinue
Remove-Item -Force .git/refs/heads/main.lock -ErrorAction SilentlyContinue

# 3. 检查 rebase 中间状态有没有残留
ls .git/rebase-merge/ -ErrorAction SilentlyContinue
ls .git/rebase-apply/ -ErrorAction SilentlyContinue
# 有的话 → git rebase --abort（这步不会动 worktree，只清 .git/ 状态）

# 4. 如果 autostash 已经创建（stash 列表里看得到）
git stash list | grep autostash
git stash apply stash@{0}  # 不用 pop，保留 stash 防再丢
```

**何时仍用标准 `git rebase`**（不动 plumbing）：

- 你**独占** repo（没其他 session 活跃）
- worktree 干净（`git status` 全绿）
- 在 macOS / Linux（Win `.git/index.lock` 卡死是 Win-specific 病）

---

## 10. lint-staged untracked sweep（隐性风险）

`lint-staged` 的 glob（如 `"*.{js,ts,vue}"` 或 `"package.json"`）行为有一个反直觉的非对称：**worktree 含任何 untracked 文件时 sweep 全部匹配文件**，而**纯 modified-tracked 状态时只处理 staged 文件**。结果：你 `git commit --only -- specific-file.js`，但 lint-staged 默默把另一个 session 还在改的、未 commit 的 .vue / package.json 一起跑了 prettier / eslint —— 改完它**不会**自动写回那些非 staged 改动，但格式化后的内容已经在文件系统里覆盖了对方未保存的工作。

**两个失败维度叠加**：

| 维度 | 触发 | 损失 |
|---|---|---|
| Sweep 维度（本条） | worktree 有 untracked → glob 扫所有匹配文件 | 对方 modified-but-unstaged 的文件被 lint-staged 改格式（diff 变了，可能 stash 救不回因 stash 本身就是改后内容） |
| `--no-stash` 维度（#9 已提精简版） | 配置含 `--no-stash`（速度优化） + 跑完前对方 push 进来 | lint-staged 跑完 reset 到 HEAD，你 staged 但未 commit 的改动**静默清零**，无报错 |

**两维度交集 = 数据丢失高发区**：你 staged 文件 A，对方刚 push 改了文件 B，你的 lint-staged 同时（1）格式化对方未 stage 的 B（2）reset worktree 抹掉你 staged 的 A。两个都 silent。

**commit 前必跑（race-immune 探针）**：

```bash
# 1. 看 worktree 状态全貌（不止 staged）
git status --porcelain
# 输出第 1 字符 = index 状态，第 2 字符 = worktree 状态
# ?? = untracked，会触发 sweep
# M_ / A_ = staged
# _M / _D = unstaged

# 2. 如有 ?? 行，先决定：要么 stage 进来，要么先 commit 不带 lint-staged
# 反模式：??  packages/foo/new-file.js
#         M  packages/bar/file.js
# 这状态下跑 lint-staged 会扫所有匹配 glob 的文件，包含未 stage 的 foo/

# 3. 如必须在脏 worktree 下提交某个具体文件，绕过 hook（一次性）
git commit --only -- path/to/file.js --no-verify
# 但 --no-verify 必须用户明确授权，CLAUDE.md 全局禁
```

**已 land 的防御**（commit `210f82074`，2026-05-18）：

```bash
# .husky/pre-commit 自动 snapshot 所有即将被 lint-staged 触碰的文件
# SHA 写入 .git/last-precommit-snapshots.log
# 恢复：
tail -5 .git/last-precommit-snapshots.log  # 找最近 SHA
git checkout <snapshot-sha> -- packages/foo/file.js
```

**snapshot 的覆盖盲区**：

- **untracked NEW files 不在 snapshot 里** —— 因为 snapshot 走 `git stash create`，stash 只抓 tracked。`git reset` 类失败导致 NEW files 丢，必须走 `git fsck --lost-found`（见 #9）
- **binary 大文件**（>100MB）可能被 git 自身拒 snapshot

**衍生 — 文档 sweep race**（实战高发）：

- 改 `CHANGELOG.md` / `README.md` / `package.json` 后**立刻** `git add`，闭合 unstaged 窗口
- 这三个文件几乎所有 session 都会顺手碰一下；任何 session 的 lint-staged `package.json` glob 都会扫到对方的 README 未 stage 改动
- "立刻 add" 不是洁癖，是 race 防御

**自检 SOP（5 秒）**：

```bash
git status --porcelain | grep -E '^(\?\?|.M|.D)' && \
  echo "⚠️ worktree dirty, lint-staged will sweep — stage or commit first" || \
  echo "✅ safe to commit"
```

---

## 11. E2E web-shell opt-out 失效（隐性风险）

V6 shell hard-flip 后（commit `caaddf530`，2026-04-26），`/` 路由默认重定向到 `/v6-preview`。开发期常用的 CLI flag / 环境变量 opt-out 通道**全部失效**——这些原本由 V5 启动逻辑读取，hard-flip 把判断点移到了 unified-config 加载阶段，启动时已读完。E2E 测试如果还按"传 `--v5` 或 `CC_USE_V6_SHELL=false`"启动，会**进 V6 shell 但断言写在 V5 DOM 上**，结果是 Playwright 选不到目标 selector → timeout → 测试报"页面没渲染"但其实页面渲染了，只是 V6 模板。

**为什么排查难**：

- 进程退出码正常（Electron 启动成功）
- 主进程日志没异常（V6 是合法路径）
- 截图能看到 UI（只是 UI 不是测试期望的那个）
- selector timeout 错误指向"等不到 V5 元素"，让人以为是 V5 渲染失败，去查 store / IPC / 路由配置——全是死路

**唯一生效的 opt-out 路径**：

测试启动前**预写** `app-config.json` 把 `ui.useV6ShellByDefault` 显式置 false。`unified-config-manager.js` 在 Electron `app.whenReady()` 之前读这个文件，是唯一在 hard-flip 判断点之前生效的入口。

```js
// E2E helper 必做（启 Electron 之前）
const path = require('path');
const fs = require('fs');

const configDir = path.join(
  process.env.APPDATA ||
  (process.platform === 'darwin'
    ? path.join(process.env.HOME, 'Library/Application Support')
    : path.join(process.env.HOME, '.config')),
  'chainlesschain-desktop-vue',
  '.chainlesschain'
);
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(
  path.join(configDir, 'config.json'),
  JSON.stringify({ ui: { useV6ShellByDefault: false } }, null, 2)
);
// 然后才能 spawn Electron / 跑 Playwright
```

**反模式（已知失效）**：

- ❌ `electron . --v5` —— 没有这个 CLI flag 解析
- ❌ `CC_USE_V6_SHELL=false electron .` —— 没有这个 env 读取
- ❌ 在 test setup 跑 `app.commandLine.appendSwitch` —— 时机太晚
- ❌ test 里 `await page.goto('/')` 再 `evaluate` 改 store —— 路由已 redirect

**对称提醒（V6 hard-flip 的测试影响）**：

- 新写的 E2E 默认应该针对 V6，没必要 opt-out。只有维护**老 V5 baseline 测试**才需要这个 helper
- V5 dead-page cleanup（2026-05-04，commit `5066a718d`）后某些 V5 路由甚至**不存在了**（`/did` `/community` `/friends` 等已删）。即使正确 opt-out 到 V5，导航这些路径也会 silent no-op + vue-router warn。这类 E2E 必须改针对 V6 路径

**诊断 SOP**（E2E 报 selector timeout 时先验路由）：

```js
// 失败时必 throw 含 diagnostic（不要 catch+warn+continue）
const url = await page.url();
const keys = await page.evaluate(() => Object.keys(window));
const html = await page.content();
throw new Error(JSON.stringify({
  url,                              // 看是不是 /v6-preview
  windowKeys: keys.slice(0, 30),    // 看 Pinia / Vue 实例挂没挂
  htmlSnippet: html.slice(0, 500),  // 看真实 DOM
}, null, 2));
```

如果 `url` 是 `/v6-preview` 而测试期望 `/`，opt-out 没生效，回去检查 `app-config.json` 预写有没有跑到。

**衍生 — cc ui WS gateway 测试**：

- 跨壳功能（V5 + V6 + web-shell + cc ui）一个 web-panel SPA 被两个 WS gateway 服务（desktop 的 + cc ui 的）。E2E 跑 `cc ui` 时不需要这个 opt-out（cc ui 默认就是 web-shell，不走 V5/V6 路由判断），但需要确认测的是 cc 那个 WS endpoint 而不是 desktop 的
- 测 workspace web-panel 改动用全局 `cc ui` 不行（global ships pre-packed assets）。改用 `node packages/cli/bin/chainlesschain.js ui`

---

## 12. Node 23 native-dep prebuild gap（隐性风险）

Node 23 是 odd-numbered（非 LTS），ABI 版本 `v131`。大量 native-dep（含本项目核心的 `better-sqlite3-multiple-ciphers`、`sqlcipher`、`@libp2p/*` C++ binding 等）**只为 LTS ABI 发 prebuild**（v127 = Node 22 LTS、v137 = Node 24 LTS）。`npm install` 在 Node 23 下走 source rebuild 路径，需要 node-gyp + Python + 完整 C++ toolchain，**任何一环缺就级联失败**——而失败信号往往埋在 npm warning 堆里，最终错误是 N 层下游的 `Cannot find module 'better-sqlite3-multiple-ciphers'`，让人去查依赖配置而不是 Node 版本。

**为什么排查难**：

- `node -v` 显示 v23.x，看起来"新就是好"
- `npm install` 退出码可能是 0（warnings 不是 errors）
- 真正的 build fail 在控制台滚过去几屏，被 npm 进度条覆盖
- 启动时报 `MODULE_NOT_FOUND`，stack 指向应用代码而不是装包阶段
- 切换 Node 22/24 立刻好——但很多人不会想到回退是因为"版本号高"

**触发场景清单**：

- 全新 clone + 全新 npm install
- macOS/Linux 用 nvm/fnm 自动切到 latest（默认 odd 版本）
- CI runner image 升级到含 Node 23 的版本
- Volta / asdf 读 `.tool-versions` 但仓库没钉版本
- Electron rebuild 阶段（`electron-rebuild` 走自己的 ABI 路径，雪上加霜）

**项目已有的硬保护**：

`package.json` 已锁：

```json
{
  "engines": {
    "node": ">=22.12 <23 || >=24"
  }
}
```

这会让 npm 在 Node 23 下**警告**但不阻止安装（npm 的 engines 默认是 advisory）。配 `.npmrc` 加 `engine-strict=true` 才会变 hard fail，但项目目前没开（理由：不想阻塞用 Node 24 的早期 adopter）。

**检测 SOP**：

```bash
# 1. 装包前先验 Node
node -v                          # 必须 v22.x 或 v24.x
node -p "process.versions.modules" # ABI: 127 (Node 22) / 131 (Node 23 ❌) / 137 (Node 24)

# 2. 真要排查 native rebuild 是否成功
ls node_modules/better-sqlite3-multiple-ciphers/build/Release/
# 看到 .node 文件 = 成功
# 空 / 不存在 = build 失败但被 npm 吞了

# 3. CI 也要钉死
# .github/workflows/*.yml 里 actions/setup-node@v4 必须显式 node-version: '22'
# 不能用 'lts/*' 因为遇到 odd-LTS 切换窗口可能拿到 23
```

**已踩过的衍生坑**：

- **B4 ASAR surgery + Node 23 叠加**（2026-05-07）：electron-builder 打包时用宿主 Node 编译 native dep，宿主装的 Node 23 让 prebuild 走 source 路径失败，最终 .exe 里塞的是 broken `better-sqlite3-multiple-ciphers`，安装能装但启动黑屏。修法：CI runner 钉 Node 22.12+，本地开发也按 engines 钉死
- **CLI workspace dep + Node 23**：`@chainlesschain/core-mtc` 等含 libp2p 间接依赖，Node 23 下 sqlcipher native 失败级联让整个 CLI 无法启动

**反模式**：

- ❌ "用 Node latest 试试"——native dep 区从来不要 latest，永远 LTS
- ❌ 用 `--ignore-engines` 强装——绕开 advisory 但不解决 ABI 不匹配
- ❌ Docker base image 写 `FROM node:latest`——容器里也会拿到 odd 版本
- ❌ 改 engines 范围让 Node 23 "通过"——治标，下次重装还是 broken

**正确恢复路径**（已经在 Node 23 上 broken）：

```bash
# 1. 装 Node 22 LTS
# Windows: winget install OpenJS.NodeJS.LTS 或 nvm-windows
# macOS: nvm install 22 && nvm alias default 22
# Linux: 用 distro 包管理器或 NodeSource

# 2. 全删 node_modules 重装（必须，否则 ABI v131 .node 文件残留）
rm -rf node_modules package-lock.json
npm install

# 3. 验
ls node_modules/better-sqlite3-multiple-ciphers/build/Release/*.node
```

**Lockfile 注意**：

- `package-lock.json` 不存 ABI 版本，删 lockfile 重装不会"自动选对版本"
- 但 lockfile 里钉了的 prebuild URL 是 ABI-specific 的；混 Node 版本装会让 lockfile 飘
- 团队成员都应该用同一 Node major 版本，避免 lockfile 翻来覆去重写

---

## 13. Desktop release npm workspace hoisting（隐性风险）

`desktop-app-vue` 是 monorepo workspace 成员（`packages/*` 兄弟），`npm install` 在 root 跑时会把**所有兄弟共享的依赖往上提到 root `node_modules/`**（npm hoisting）。dev 模式从 root 加载，`require('foo')` 找到 hoisted 版本——全绿。`electron-builder` 打包时**只从 `desktop-app-vue/node_modules/`** 抓文件进 `.asar`——hoisted 在 root 的依赖**根本不进安装包**，安装出来的 .exe 启动直接 `MODULE_NOT_FOUND`，但 dev 一切正常。最痛的是：bug 与 commit 解耦——某个无关 commit 改变了 hoisting 拓扑，下次 release 突然炸。

**两个独立故障层**（必须都修才能根治）：

| 层 | 失败机制 | 检测 |
|---|---|---|
| npm workspace hoisting | 依赖被 npm 提到 root，`desktop-app-vue/node_modules/` 看不到，electron-builder 漏抓 | `ls desktop-app-vue/node_modules/<dep>` 不存在 + `ls node_modules/<dep>` 存在 = 中招 |
| electron-builder walker nested-only | walker 只递归 `node_modules/<dep>/node_modules/<nested>`，对**顶层兄弟** package 完全无视。即使 hoisting 修了，4 个 walker-dropped 包（`call-bind-apply-helpers` / `side-channel-{list,map,weakmap}`）还是会漏 | 装好后 `asar list app.asar | grep call-bind-apply-helpers` 为空 = 中招 |

**Dev 跑得通 + release 跑不通**几乎 100% 是这俩之一（或两者）。

**已 land 修复**（B4 ASAR surgery，v5.0.3.39，commit `e11b46913`）：

- `scripts/asar-surgery.js` afterPack hook：打包后**手动注入** 4 个 walker-dropped 包到 asar header 的 `node_modules/<pkg>/` 顶层
- `asar: true` 翻回来（之前用 `asar: false` + 7 个 `extraResources` 兜底，文件数爆炸让 install 跑 1201s）
- **Result**：install 时间 1201s → 190.9s（−84% / 6.3× 加速），47% headroom 在 360s gate 之下

**新增依赖时的 checklist**（不踩同一坑）：

```bash
# 1. 加完依赖后立刻验 hoisting 行为
cd desktop-app-vue
npm install <new-dep>
ls node_modules/<new-dep>          # 必须本地有
ls ../node_modules/<new-dep>       # 看是不是 hoisted 到 root
# 如果只在 root 不在 desktop-app-vue/，asar 会漏

# 2. 试打个本地包验
npm run build:dist
node scripts/asar-list.js          # 或手动 asar list
# 验新加的 dep 在 .asar 里 node_modules/<dep>/ 路径下

# 3. 看 dep tree 有无 walker-dropped 嫌疑
# 这些类型容易漏：顶层只被 import 一次、且依赖了它的包用 dynamic require
npm ls <new-dep> --all
```

**B4 surgery 自身的 7 个 operational gotchas**（改 `scripts/asar-surgery.js` 前必看）：

1. **`filesystemCache` 必须 `delete cache[absPath]`**：electron-builder 缓存了 asar 内文件树，注入新文件后不清缓存 → 二次打包看不到注入
2. **`minimatch` 必须 `matchBase: true`**：default 模式下 `**/node_modules/foo` 不匹配 asar 内的 `node_modules/foo`
3. **Win junction `lstat` 不可靠**：surgery 走 `fs.cpSync` 时遇到 npm 创建的 junction（不是 symlink）`lstat().isSymbolicLink()` 返回 false，触发死循环复制
4. **devDep transitive prod-chain**：根 devDep 的 transitive 可能被 prod code import；裁 devDep 前先 `npm ls <dep> --prod`
5. **`cpSync` symlinks EPERM**：Win 上非管理员 mode 不能创建 symlink；用 `dereference: true`
6. **`winCodeSign` 自带 darwin dylib**：~50MB 死重，可在 surgery 里删（小心：未来跨平台签名工具可能要用）
7. **asar:false 文件数天花板**：用 `asar: false` 当兜底时，10w+ 小文件让 install 走 1200s+；不要回退到这个方案

**调试 SOP**（release 启动 MODULE_NOT_FOUND）：

```bash
# 1. 找到装包后的位置
# Win: %LOCALAPPDATA%\Programs\chainlesschain-desktop-vue\
# 看 resources\app.asar 或 app\

# 2. 列 asar 内容
npx asar list path/to/app.asar | grep <missing-module>
# 空 = 没打进去

# 3. 验 surgery hook 跑了没
# 打包日志里搜 "asar-surgery" 应该有 "injected N packages" 行
# 没看到 = hook 没触发，检查 electron-builder.yml 的 afterPack 配置

# 4. 验 hoisting 状态
ls desktop-app-vue/node_modules/<missing-module>
# 不存在 = npm install 把它提到 root 了，要么改 nohoist 要么 surgery 注入
```

**对称提醒 — workspace 新加 dep 的发版前提**（与 #7 npm 发版漏发相关）：

- CLI 加 `@chainlesschain/A` workspace dep 时，npm install 创建 symlink → 本地能跑
- `npm pack` 把 dep 写成**字面版本号**进 .tgz（不是 symlink）
- `npm install -g chainlesschain` 走真 registry lookup → 如果 `@chainlesschain/A` 那个版本还没发布 → 404 → install fail
- 规则：CLI 加 workspace dep 前，**先确认那个版本已 publish 到 npm**，再 merge CLI bump

---

## 14. Android in-app update 5 traps（隐性风险）

`UpdateChecker.kt` 走 GitHub Releases API 查最新 tag、下载 APK、调 PackageInstaller 装新版。这条链路有 5 个独立陷阱，**任何一个失败都让用户卡在"检查更新→无反应"或"下完装不上"**，且大多无前台报错（后台 catch 掉了或 PackageInstaller 默默拒装）。每一个都炸过线上。

**5 个陷阱**：

| # | 陷阱 | 失败模式 | 修法 |
|---|---|---|---|
| 1 | `startsWith` null NPE | `BuildConfig.VERSION_NAME` 或 release tag 在某些构建路径为 null，`current.startsWith("v")` 抛 NPE 被外层 catch 静默吞 | 显式 `current ?: return false` + 单测覆盖 null/空串/无 `v` 前缀三态 |
| 2 | versionCode / versionName 漏 bump | release tag 是 v5.0.3.47 但 `android-app/app/build.gradle.kts` 的 `versionCode` 没升 → `installed >= latest` 判定无更新 | 发版脚本同步 bump（已 land 自动化）+ release 前 grep `versionCode = .*` 与 tag 对账 |
| 3 | Ephemeral CI keystore | release.yml 每次跑生成新 keystore（没配 secret 或 secret 失效）→ 新 APK 签名与已装版本不匹配 → PackageInstaller 拒装 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 4 个 Android signing secrets 必须配死（`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`）+ release.yml fail-fast 如果 secret 缺 |
| 4 | Ghost release | `gh release create` 创建后 assets 上传还在跑，但 Android 此时 poll 到 release → 下载 404 → 用户看到"检查到新版本"然后报错 | release.yml 必须 `--draft` 创建 → 全部 assets 上传完 → `PATCH draft:false` 一次性 publish；同时 mobile 端 update check **必须** wait `gh release view <tag> --json isDraft` = false |
| 5 | `gh dl` EOF mid-stream | CDN 偶发抽风让 GitHub Releases asset 下载在 80% 处断流，Android `OkHttpClient` 收到 EOF 但**不**抛 IOException（部分 buffer 模式下安静截断），APK 文件落地大小 < 期望 → PackageInstaller 报 `INSTALL_FAILED_INVALID_APK` | 下完必校验 `Content-Length` 头 vs 实际写入字节数；mismatch → 删 cache 重下；3 次重试上限避免死循环 |

**衍生 — keystore path convention**（v5.0.3.47 verified）：

```
android-app/app/build.gradle.kts:
  storeFile = file("keystore/<name>.keystore")   # 相对 module 根
android-app/keystore/<name>.keystore             # 物理位置
```

release.yml decode secret 到 `android-app/keystore/`，不是 `android-app/app/keystore/`（gradle 解析路径会找错地方，silent fail 用 ephemeral keystore 兜底 → 触发陷阱 3）。

**检测 SOP**（发 Android 版本前必跑）：

```bash
# 1. versionCode 与 tag 对账
tag=$(git describe --tags --abbrev=0)
gradle_code=$(grep -oP 'versionCode = \K\d+' android-app/app/build.gradle.kts)
echo "tag=$tag gradle_code=$gradle_code"
# 人脑判断 gradle_code 必须 > 上一个 release 的 versionCode

# 2. release.yml 所有必需 secret 都配
gh secret list | grep -E 'ANDROID_(KEYSTORE_BASE64|KEYSTORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD)'
# 必须 4 行齐

# 3. 发完验 release 不是 draft
gh release view "$tag" --json isDraft,assets | jq '{isDraft, assetCount: (.assets | length)}'
# isDraft=false + assetCount = 期望（含 arm64 / v7a / universal / aab）

# 4. 验 APK 真能装到已签名旧版本之上（不要从 fresh install 测）
# 在已装 v5.0.3.X 的真机上 sideload v5.0.3.X+1.apk
# 看 logcat: adb logcat | grep -i 'INSTALL_FAILED'
```

**Android downloads ride desktop tag**（与陷阱 4 相关）：

- `desktop-app-vue/docs-website-v2/src/data/release-sizes.json` 的 `ANDROID_TAG = releaseSizes.tag`，**与 desktop tag 同步**
- 改 release-sizes / mobile.astro 前：`classify()` 必须识 4 个 assets（`arm64-v8a` / `armeabi-v7a` / `universal` / `.aab`）
- 缺一个 asset → 官网下载页显示该架构"暂不可用"，但 release 里其实有，只是 classify 漏识

**反模式**：

- ❌ "测试发版用 ephemeral keystore 没事吧"——只要任何用户装过，下次 release 就装不上
- ❌ `gh release create` 不带 `--draft` → ghost release 必现
- ❌ 下载 catch 后 silent retry → 死循环 + 流量爆炸；必须有重试上限
- ❌ `BuildConfig.VERSION_NAME?.startsWith("v")` 用 `?.` 当 NPE 防御 → 返回 `null` 给后续比较，逻辑还是错

---

## 15. better-sqlite3 Number→TEXT `"1.0"` trap（隐性风险）

SQLite 用 "type affinity" 而非严格类型——列声明 `TEXT` 但实际存储类型由**绑定时的值类型**决定。JavaScript 所有数字都是 64-bit double，better-sqlite3 把 JS Number 绑到 TEXT 列时，**SQLite 把它存为 REAL 而不是 TEXT**。后续 `WHERE col = '1'`（字符串字面量比较）会让 SQLite 把存的 REAL `1.0` 转回字符串得到 `"1.0"`——和 `"1"` 不等——**查不到**。但你 `SELECT col` 看到的还是 `1`（数字显示），人肉对比觉得"明明就是 1，怎么查不到"，去查 WHERE 子句、collation、索引——全是死路。

**为什么排查难**：

- `SELECT col FROM table` 输出 `1`，看起来一切正常
- `SELECT typeof(col) FROM table` 才暴露真相，返回 `'real'` 而不是 `'text'`
- 单条记录手动 INSERT 字面量 `'1'` 查得到，但应用代码绑 JS Number 后查不到——同一张表行为不一致
- 失败是 silent miss（返回空结果），不是 error；上层逻辑当"不存在"处理
- 调试时 `console.log(value)` 显示 `1` 而不是 `1.0`，让人以为 binding 没问题

**5 处实战 fix 位置**（项目内已修）：

- `desktop-app-vue/src/main/skill-tool-system/tools/knowledge-handler.js` `_snapshotVersion`
- 同文件其余 4 处类似的 version / id / sequence 字段 binding

**修法（强制字符串绑定）**：

```js
// ❌ broken
stmt.run({
  noteId,
  snapshotVersion: Number(version),   // 绑为 REAL，列即使声明 TEXT
});
// 后续 WHERE snapshot_version = '1' 查不到，因为存的是 1.0

// ✅ correct
stmt.run({
  noteId,
  snapshotVersion: String(version),   // 强制 TEXT 绑定
});
// 存为 "1"，WHERE snapshot_version = '1' 命中
```

`String()` 包一层让 better-sqlite3 走 text 路径，SQLite type affinity 也按 TEXT 存，存的字面就是 `"1"`。

**检测 SOP**（diagnose existing data + 防回归）：

```sql
-- 1. 看现有数据真实存储类型
SELECT col, typeof(col), CAST(col AS TEXT) FROM your_table LIMIT 5;
-- typeof 应该全是 'text'；出现 'real' / 'integer' 说明历史写入时已 broken

-- 2. 修法（一次性数据修复）
UPDATE your_table SET col = CAST(col AS TEXT)
WHERE typeof(col) != 'text';
-- 但 CAST(1.0 AS TEXT) 在 SQLite 给 '1.0' 不是 '1'，仍 broken
-- 真正的迁移要逐行处理：
UPDATE your_table SET col = CAST(CAST(col AS INTEGER) AS TEXT)
WHERE typeof(col) = 'real' AND col = CAST(col AS INTEGER);
-- 仅当 REAL 真是整数值时安全
```

**对称提醒 — 不止 Number 一种 binding 坑**：

| JS 值 | 绑 TEXT 列实际存储类型 | 修法 |
|---|---|---|
| `Number(1)` / `1` / `1.0` | REAL（值 `1.0`） | `String(value)` |
| `true` / `false` | INTEGER（值 `1` / `0`） | `value ? '1' : '0'` 或 `String(value)` |
| `null` | NULL（不变） | 按业务需要，通常不变 |
| `undefined` | 抛 SQLITE_RANGE error | 显式 `?? null` |
| `Date` 对象 | 报 `unsupported type`（better-sqlite3 拒） | `.toISOString()` |
| `BigInt` | 取决于编译选项，默认抛 error | 走 `safeIntegers(true)` mode |

**反模式**：

- ❌ 改列声明 `TEXT` → `INTEGER` "让它接受数字"——绕开问题但破坏现有数据语义，且 version / id 类字段未来可能要支持非数字（如 `"v1"`、UUID），TEXT 是对的
- ❌ 应用层加 `WHERE col = ?` + `[Number(v)]` 让查询也走 REAL —— silent works，但混存 TEXT + REAL，下次有人写 `WHERE col = '1'` 又炸
- ❌ `parseInt(value, 10) + ''` 当 `String()` 替代——丢小数信息；如果 version 字段未来允许 `"1.2"`、`"v1"`，整个数据迁移又得重做
- ❌ 信赖 ORM 自动处理——better-sqlite3 不是 ORM，且即使 ORM 层（drizzle / kysely）做了类型映射，**raw query 路径绕开**

**衍生 — 跨 SQLite-engine 兼容性**：

- 标准 `sqlite3` npm 包（async）的 binding 行为与 `better-sqlite3` 不完全一致
- `better-sqlite3-multiple-ciphers`（项目用的加密版，与 #12 Node 23 prebuild gap 相关）继承 better-sqlite3 行为
- 切换 driver 时必须重跑数据完整性测试，type affinity 行为不保证一致

**单测覆盖建议**：

```js
// 任何写 TEXT 列的 handler 都该有这俩测试
it('binds version as TEXT, not REAL', () => {
  db.prepare('INSERT INTO notes (id, version) VALUES (?, ?)').run('n1', '1');
  const row = db.prepare("SELECT typeof(version) AS t FROM notes WHERE id = 'n1'").get();
  expect(row.t).toBe('text');  // 不是 'real'
});

it('WHERE version = string literal hits row after JS Number write', () => {
  handler._snapshotVersion('n1', 1);  // 走真实代码路径
  const row = db.prepare("SELECT * FROM notes WHERE version = '1'").get();
  expect(row).toBeDefined();  // 不是 undefined
});
```

---

## 16. commit-msg hook scope regex 拒数字（隐性风险）

`.husky/commit-msg` 用 Conventional Commits 校验提交信息格式：`<type>(<scope>): <subject>`。当前 scope 部分的正则是 `[a-z-]+`——**字符集里没有数字**。任何带数字的 scope 都会被拒：`feat(p2p)` / `feat(v6)` / `feat(b4)` / `fix(http2)` / `refactor(b2b)` 全 reject，错误信息是通用的"commit message format invalid"，**不指明具体哪一段炸**。

**为什么排查难**：

- hook 报错只说"format invalid"，不告诉你违规的字符在第几位
- type 部分（`feat` / `fix` 等）看起来没问题
- 反引号 / 中文 / 标点等明显违规更容易想到，数字这种"看起来字母"的字符不在嫌疑名单
- 团队约定文档里 scope 例子常带数字（`p2p`、`v6`、`b4`、产品代号），更没人意识到 regex 不允许
- IDE / CLI git client 提交后才报错，编辑器内没提示

**当前 regex**（`.husky/commit-msg`）：

```bash
# 大致结构（简化）
pattern='^(feat|fix|security|docs|refactor|test|chore|perf)(\([a-z-]+\))?: .+'
#                                                              ^^^^^^^
#                                                              scope 字符集 — 缺 0-9
grep -qE "$pattern" "$1" || {
  echo "commit message format invalid"
  exit 1
}
```

**已知 reject 实例**：

| 想用的 scope | reject 原因 | workaround（不改 hook 的话） |
|---|---|---|
| `feat(p2p)` | `2` 不在字符集 | `feat(peer)` / `feat(mobile)` |
| `feat(v6)` | `6` 不在字符集 | `feat(shell)` / `feat(ui)` |
| `feat(b4)` | `4` 不在字符集（B4 是 surgery 代号） | `feat(release)` / `feat(packaging)` |
| `fix(http2)` | `2` 不在字符集 | `fix(http)` / `fix(transport)` |
| `feat(mtc-v0-5)` | `0` / `5` 都不在 | `feat(mtc)` |
| `feat(ios-1-7)` | `1` / `7` 不在 | `feat(ios)` / `feat(pairing)` |

**实战影响**：项目本身的产品代号大量带数字（`v6`、`B4`、`MTC v0.5`、`iOS Phase 1.7`、`P2P`），最终约定形成"绕开数字"的写法：

```
✅ 已 land 的纯字母 scope
feat(mobile): ...
feat(android): ...
feat(desktop): ...
feat(cli): ...
feat(shell): ...
feat(plugin): ...
feat(hub): ...
```

数字版本号 / Phase 号往往挪到 subject 部分：

```bash
# ❌ scope 带数字 reject
feat(p2p-1.7): land iOS pairing real-device E2E

# ✅ 数字移到 subject
feat(ios): land iOS Phase 1.7 pairing real-device E2E
```

**两个选项 — 改 hook 还是绕**：

| 方案 | 工作量 | 风险 |
|---|---|---|
| 改 regex 为 `[a-z0-9-]+` | 1 行 + 1 commit | 历史 commit 已全部走"绕"模式，开放数字后团队风格分裂（旧 commit `feat(mobile)` vs 新 `feat(p2p)`）；约定漂移 |
| 维持现状，记忆"scope 纯字母" | 0 | 新人持续踩坑；产品代号带数字时不直观 |

**当前选择**：维持现状 + 文档化。理由：历史一致性 > 灵活性；项目内已有~1500+ commit 走纯字母路径，改了反而割裂。

**触发场景清单**：

- 写 commit 前给 scope 起名时，**默认假设**字符集没数字
- 看到别人 `feat(mobile)` 类似 commit，复用模板里的 scope name
- IDE 模板 / git commit message template 里硬编码 scope name，不靠现场决定
- husky allowlist type 已知是 `feat|fix|security|docs|refactor|test|chore|perf`——超出这 8 个 type 也会 reject（与 scope 是两条独立规则，别混淆）

**反模式**：

- ❌ `--no-verify` 绕过 hook——CLAUDE.md 全局禁，必须用户明确授权
- ❌ 把数字改成英文（`feat(ptwop)` 替代 `feat(p2p)`）——可读性更差
- ❌ 给 scope 加空格 `feat(v 6)`——括号内空格也违反 conventional commits
- ❌ scope 留空 `feat: ...`——合法，但失去归类信息

**检测 SOP**（写完 commit 信息预检）：

```bash
# 拒之前在 stage 阶段就验
msg='feat(p2p): land pairing'
echo "$msg" | grep -qE '^(feat|fix|security|docs|refactor|test|chore|perf)(\([a-z-]+\))?: .+' \
  && echo "✅ pass" || echo "❌ reject — check scope chars"

# 项目里如果有更复杂 hook（multi-line body / footer），跑实际 hook 文件
bash .husky/commit-msg <(echo "$msg")
```

**衍生 — type allowlist 同步更新**：

- 当前 allowlist：`feat|fix|security|docs|refactor|test|chore|perf`
- **缺**：`build` / `ci` / `revert` / `style`（Conventional Commits 标准型）→ reject
- 想加新 type 必须同步改 hook + 团队约定
- 加新 type 不是数字问题但与 scope 一同被 hook 拒，错误信息一样模糊

---

## 17. Android remote file skill 接通 6 雷（隐性风险）

Android 端新加 `RemoteCommandClient.invoke` 系列命令（file / clipboard / notification / screenshot 任一）时，需要同时跨越 4 个 Plan C 路径互锁雷 + 2 个 UX 坑。**任一未修，整条链路就断**——最坏情况调用方 30s 超时报 "Job was cancelled"，没有具体错误信号指向真因。2026-05-17 接通 remote file skill 时一晚踩齐，本条把组合拳记录下来防回归。

> 下面的 file:line 引用以提示思路为主，使用前需 `grep` 验证当前代码。

**4 个传输互锁雷**（必须**同时**修才能工作）：

**雷 1 — `P2PClient` chainlesschain:* skip guard 太宽**

```kotlin
// android-app/.../P2PClient.kt:538 附近（旧 guard）
if (raw.contains("\"type\":\"chainlesschain:")) return
```

`SignalingRpcClient` 用 `chainlesschain:*` envelope；后加的 guard 把所有 `chainlesschain:*` 一刀切，**连 `P2PClient.sendCommand` 自己发的命令的 response 也吞了**，`pendingRequests` 永远不 resolve → 30s 超时。修法：缩窄到只 skip `chainlesschain:command:request`，放行 `chainlesschain:command:response`。

新加 RPC client 前必 grep `chainlesschain:` skip 类 guard，确认 demux 不互相吃响应。

**雷 2 — Plan C 路径下 `P2PClient._connectionState` 永远 DISCONNECTED**

```kotlin
fun sendCommand(...) {
  if (_connectionState.value != ConnectionState.CONNECTED) return failure("Not connected")
  // ...
}
```

`P2PClient` 是为带 DID 认证 + permissionGate 的 trust 路径设计；Plan C（`RemoteOperateScreen` → signaling forward）**根本没调过 `P2PClient.connect()`**，state 一直 DISCONNECTED → 所有命令立刻失败。

**不要**用 `P2PClient.sendCommand` 当 transport。改用 `SignalingRpcClient.invoke(pcPeerId, method, params)`，`pcPeerId` 从 `PairedDesktopsStore.devices.firstOrNull()?.pcPeerId` 拿；模板看 `RemoteCommandClient.invokeTyped` 的 delegate。

**雷 3 — 桌面 `handleFileCommand` 是简陋 stub**

`desktop-app-vue/src/main/index.js` 里的 inline `handleFileCommand` switch 只有 `case "list"` + `case "requestUpload"`（后者会**弹 `dialog.showOpenDialog` PC 文件夹选择框**——用户体验灾难），其余 case 全部 `throw "Unknown file action: X"`。

Plan C 的 `routeMobileCommand` 是简陋 dispatch，跟正式的 `remote-gateway.commandRouter`（注册 14 个 namespace handler）**没接上**。

新加 PC 端 mobile-bridge 命令 namespace **不要复用**这个 inline switch。写专门的 handler（`android-<feature>-handler.js` 模式）然后让 `handleXxxCommand` delegate。

**雷 4 — `FileTransferHandler` 复用诱惑**

`remote-gateway` 注册的 `FileTransferHandler` 命名相似，容易当作可复用，但：

- `_resolvePath` 把所有 path 强制 prefix `app.getPath("userData")` → 浏览 `C:\Users\...` 一律 `Access denied`
- 字段命名跟 Android 不一致（`dirPath` vs Android `path` / `items` vs `entries` / `isDirectory bool` vs `type "directory"|"file"`）
- 是给某个 web-shell 子项目写的，**不是给 Android remote 用**

正确做法：Android remote 自己写 handler（`android-file-handler.js` 模式），**无 sandbox**（trusted paired mobile peer）+ 字段对齐 Android `FileCommands.kt` 的 `@Serializable` model。

**2 个 UX 坑**：

**雷 5 — checksum 算法不匹配 → repository 自删下载文件**

`AndroidFileHandler.requestDownload` 第一版返 `checksum: "sha256-prefix:abc..."`（头部 32KB SHA256），但 `FileTransferRepository.kt` 期望 `"md5:" + 完整 MD5`——对不上**立刻删本地文件** + 标 FAILED + 抛 "Checksum mismatch"。用户看到的：下载完了但文件没了。

协议没强制 checksum 格式 → handler 自由发挥踩雷。

修：对齐 `"md5:" + crypto.createHash("md5").update(buf).digest("hex")`（全量 MD5），或 `checksum: null` 让 Repository 跳过验证。**不要自创 prefix**。

**雷 6 — `getExternalFilesDir(null)` 用户找不到下载的文件**

老路径 `/sdcard/Android/data/com.chainlesschain.android.debug/files/downloads/` 在 Android 13+ scoped storage 下**普通文件管理器看不到**（要点 5 层 + 开"显示隐藏"）——app-private external storage 是个 dev-only 路径，对普通用户 = "文件下载失败"。

API 29+ 用 `MediaStore.Downloads.EXTERNAL_CONTENT_URI` insert 写公共 Download 目录（`/storage/emulated/0/Download/`），原生文件管理器 / 相册 / 阅读器都能直接看到；不需要 `WRITE_EXTERNAL_STORAGE` 权限。返给 UI 的 `content://` uri 直接喂 `Intent.ACTION_VIEW` 拉起系统 viewer。

**新加 remote skill checklist**（防回归）：

```bash
# 1. transport 选对了吗？
grep -n 'P2PClient.sendCommand' android-app/.../<NewSkill>Commands.kt
# 应该是 0 匹配；用 SignalingRpcClient.invoke 或 RemoteCommandClient.invokeTyped

# 2. envelope guard 没误伤新命令的 response
grep -rn 'chainlesschain:' android-app/.../P2PClient.kt
# 看 skip 规则是否只针对 request 不针对 response

# 3. 桌面端有专门 handler 不是 inline switch
ls desktop-app-vue/src/main/remote/handlers/android-*.js
# 新 skill 应该在这里有对应文件

# 4. 字段命名跨端对齐
# Android Kotlin @Serializable data class 字段名 ≡ JS handler 返回 JSON key 字段名
# 容易漏：camelCase 大小写 / 单数 vs 复数 / type-string vs boolean

# 5. 文件落地路径用户能看到（仅文件传输类）
grep -n 'getExternalFilesDir' android-app/.../FileTransferRepository.kt
# 应优先 MediaStore.Downloads.EXTERNAL_CONTENT_URI 路径
```

**反模式**：

- ❌ "复用现有 `FileTransferHandler`，命名都一样应该兼容"——上面雷 4 全套都吃
- ❌ skip guard 用宽松字符串匹配（`contains("chainlesschain:")`）——必踩雷 1
- ❌ 走 `P2PClient.sendCommand`（"看起来更正式"）——必踩雷 2
- ❌ 桌面 handler 直接 `throw` 未实现 case——前端 0 错误恢复，调用方只看到通用超时
- ❌ Android 端用 `getExternalFilesDir`——dev 测得通（adb shell 进去看就行），用户找不到 → 反馈"下载坏了"

**衍生 — Plan C 架构 reference**：

- Plan C = signaling-relay only（mobile → relay → desktop，无 WebRTC）
- Plan A = full WebRTC P2P
- Plan A.1 = WebRTC + xterm.js 远程终端（已 v5.0.3.54 闭环）
- 新 skill 默认走 Plan C（最简单 + signaling-relay + TURN 47.111.5.128 已部署）；Plan A 需要 trust 路径，工作量大

**stash trap 提醒**（与 #9 并行 session race 关联）：

接 remote file 那晚同时遭遇并行 session 把未 commit 改动 `git stash` 成 `WIP-other-sessions-2026-05-17`。看起来像 user "revert" 改动，实际没丢，`git stash list` 能找到。Untracked 新文件（如新 handler `.js`）**默认不进 stash**，仍在工作树。怀疑改动消失先 `git stash list` 看 `WIP-other-sessions-*`；`git stash apply stash@{N}` 比 `git stash pop` 安全（保留 stash 防误删）。

---

## 18. GitHub immutable releases burn tag namespace（隐性风险）

`chainlesschain/chainlesschain` 开启了 GitHub **immutable releases**（Repo Settings → Code, planning, and automation → General → "Enforce immutable releases"），通常出于 supply-chain provenance / SLSA-style 保证。这给 release pipeline 加了两条不直观的硬约束：

1. **任何 release publish 后，asset 不可再上传**——只 draft 可改
2. **删除任何 release 永久 burn 它的 `tag_name`**——以后没人能再用这个 tag 名（HTTP 422 — `tag_name was used by an immutable release`）

后者特别痛：不是 "24h 冷却"，是**永久**。GitHub UI 完全不警告，删除按钮没标注后果。一次"测试发布"用了真打算发的 tag 名 → 这个 tag 永远报废。

**为什么排查难**：

- 报错只在创建 release 时出现，且是单一 422，错误文案"used by an immutable release"很多人第一反应去找正在用这个 tag 的 release（找不到，因为已删）
- git tag 本身没事（`git tag -l` 还在），只是 GitHub Releases API 拒绝再绑定
- 修法是给 release 起新 tag 名（`v1.0.0` → `v1.0.0-mirror` / `-ga` / 类似后缀），用户看到的 release 名/URL 永久带这个后缀

**当前已知 burned tags**（不要再尝试）：

| Tag | 烧毁时间 | 替代 |
|---|---|---|
| `android-v1.0.0` | 2026-05-13 测 Android update channel parity | 真 release 在 `android-v1.0.0-mirror` |

新踩到一个就追加到这表，**不要忘记记录**——下次想"为什么这个 tag 报 422"时 grep 这里。

**完整 release 流程必须遵守的 4 条规则**（draft-until-complete pattern）：

**规则 A — 永远 draft-first**

```yaml
# release.yml 必须的三段式
1. gh release create <tag> --draft --target <sha>  # 创 draft（tag 还可救）
2. for asset in <assets>; do
     curl -X POST -H "Authorization: Bearer $(gh auth token)" \
       --data-binary @$asset \
       "https://uploads.github.com/.../assets?name=$asset"
   done                                            # 全部上传完
3. gh api -X PATCH "/repos/.../releases/$id" -f draft=false  # 最后一步 publish
```

如果中间任何一步失败：draft 还在 → **可以删 + 重创**（draft delete 不 burn tag）；但是 **publish 后任何 asset 缺失 = 切下一个版本号**，没有补救路径。

**规则 B — 失败清理必须删 release 在删 tag 之前**

```bash
# ❌ 反模式（顺序错）
git push github :refs/tags/v5.0.3.42                       # 先删 tag
gh release delete v5.0.3.42 --yes                          # 再删 release
# → 中间窗口 release 变 "orphan-tagged"，gh release list 看着混乱

# ✅ 正确顺序
gh release delete v5.0.3.42 --yes                          # 1. release 先（draft 不 burn）
git push github :refs/tags/v5.0.3.42                       # 2. tag 后
git tag -d v5.0.3.42                                       # 3. 本地 tag 清

# 关键：步骤 1 仅当是 DRAFT 状态时安全。已 published 的 release delete = tag burn
gh release view v5.0.3.42 --json isDraft
```

**规则 C — 强制移动 tag 仅当尚无 release**

```bash
# 探测
gh release view v5.0.3.42 2>/dev/null && echo "release exists, do NOT force-move" \
                                       || echo "safe to force-move"

# 仅当无 release 时
git tag -f v5.0.3.42 <new-sha>
git push github --force v5.0.3.42      # workflow 重触发
```

如果 release 已存在（即使 draft），force-move tag 会让 release 的 `tag_commit` 与远端 tag 不一致——GitHub UI 可能仍展示旧 commit 的 changelog。

**规则 D — `gh run rerun --failed` 用原 event SHA 的 workflow 文件**

> GitHub docs: "Re-running a workflow uses the same workflow file, secrets, and code that ran in the failed run, even if you have made changes to those files since."

意思：tag-push 触发的 release run，rerun 用**那个 tag commit 时的** `.github/workflows/release.yml`，**不是当前 main 上的**。你修了 workflow bug 然后 rerun → 修复**不会**生效。

**Workaround**：用 `gh workflow run release.yml --ref main -f version=vX.Y.Z` (workflow_dispatch) → dispatch 走 main HEAD 的 workflow 文件。代价：全平台重 build ~30-40min，丢弃原 run 的成功 artifacts。

何时 `--failed` rerun 仍然对：workflow 文件本身没问题，只是 transient 故障（network blip、signing race、runner flake）。

**create-release hang 救援 SOP**（>30min 无进展 = hung 不是慢）：

```bash
# 基线：v5.0.3.40 create-release 步骤 6min，v5.0.3.39 ~5min
# 如果跑 >30min 是 hung 状态，default job timeout 是 360min — 不救会浪费 4h+

gh run cancel <run-id>
# 等 status 变 completed (cancelled conclusion, ~30s)
gh run rerun <run-id> --failed
```

**注意**：`gh run rerun --failed` 要求 workflow 整体 `completed`。如果其他 job 还 `in_progress`（如 build-linux fail 但 build-windows 还在跑）→ rerun 拒绝："This workflow is already running"。必须等所有 job 完成才能 rerun。

**操作 footguns**：

- ❌ `gh release create v5.0.3.X --notes ...`（直接 published）→ 一旦 upload fail，整个 release 是废的，tag 也没了
- ❌ `gh release upload <tag> <new-asset>` on published release → 422
- ❌ `gh release upload <tag> <existing> --clobber` on published → 422（内部 DELETE 步骤 fail）
- ❌ `gh api --hostname uploads.github.com` → gh 前缀 `api.` → 试 `api.uploads.github.com` DNS fail。用 `curl` 直接上传
- ❌ `target_commitish: <historical-sha-not-at-branch-HEAD>` → 即使 `GET /commits/SHA` 200，Releases API 给 404。Workaround：先 `git tag X SHA && git push github X` 再创 release 不带 `target_commitish`
- ❌ "测试 release 用真 tag 试试看"——一次失误永久 burn
- ❌ `gh release create` 因 `workflow` scope 缺失 403 → 用 `gh api -X POST /repos/.../releases --input -`（底层 REST 只需 `repo`）

**绝对安全的测试 tag 命名**：

```
zztest-yyyymmdd-<n>     # 排序排到最后，明显不可用
junk-<purpose>          # 删了无所谓
sandbox-<feature>       # 用完就 burn
```

**CLI 版本陷阱**（与 #7 npm 发版漏发关联）：

- `publish-cli-precheck` 严格从 `packages/cli/package.json` 读 CLI npm 版本（**不能**从 `inputs.version`/tag 解析）
- tag 是 4 段（`v5.0.3.49`）vs npm 需要 3 段 semver
- CLI src 改动**必须**同步 bump `packages/cli/package.json`，否则 precheck 看到已发布 → `ALREADY_PUBLISHED=true` → cli-tests **跳过** → broken code 上 GitHub Releases tarball 用户视角
- 检测：`git diff <prev-tag>..HEAD -- packages/cli/src/` 有任何改动 → 必 bump

**ECONNRESET hardening**（已 land，post-v5.0.3.44 commit `0989d1ac4`）：

- release.yml 16 个 `npm install`/`npm ci` 调用全部走 3-attempt retry（15s / 30s backoff）
- `.github/actions/setup-node-deps/action.yml`（composite，4 site）+ `.github/scripts/ci-npm-retry.sh`（12 inline site）
- 单次 ECONNRESET 不再触发 rerun—— pre-hardening 时单字节网络 blip 烧 20-30min 等其他 job 完成才能 rerun

**正确 release flow 总览**：

```
1. git tag v5.0.3.X <sha>
2. git push github v5.0.3.X            # 触发 release.yml
3. workflow:
   a. build all platforms              # 失败 → --failed rerun（前提：workflow 文件无 bug）
   b. create-release --draft           # 失败 → 删 draft + force-move tag + 重 push
   c. upload all assets to draft       # 失败 → cancel + rerun (draft 还在)
   d. PATCH draft=false                # 失败 → draft 还在，可救
4. post-publish:
   - 缺 asset → 切下一版本（无补救）
   - workflow file bug 触发 → 用 dispatch 跑 main HEAD
```

---

## 19. Android release-mode R8 minify 只在 CI 暴露（隐性风险）

**陷阱本质** — Android debug build 走 `isMinifyEnabled = false`，**完全跳过 R8**；release build (`./gradlew :app:assembleRelease`) 才跑 `:app:minifyReleaseWithR8`。任何新引入的"重 lib dep"（Ktor / gRPC / SLF4J / 大反射 / 引用 `java.lang.management.*` 的 JVM-only lib）只在 release 模式才暴露 R8 失败。

新 lib commit 之后跑 `./gradlew assembleDebug` 全绿 + unit tests 全绿 + 真机 debug APK 跑得动 → **以为没事** → 直接打 tag 推 release → CI 跑 `:app:minifyReleaseWithR8` → 失败 → 整条 release pipeline 已经 `gh release create --draft` 成功了一半（desktop 全绿，Android 缺 4 个 asset），但 GitHub immutable releases 让这个 tag 永久 burn，要发 Android 必须再打个新 tag。

**为什么排查难**：

1. 失败延迟到 release CI 才出现（dev / CI debug 全绿）
2. R8 错误信息形态多样且 misleading：
   - `Missing class java.lang.management.ManagementFactory` — 看着像缺依赖，实际只需 `-dontwarn`
   - `R8: java.util.ConcurrentModificationException`（没行号没类名）— 像 R8 内部 bug，实际是 fullMode 触发，需要切 compat mode
3. `release.yml` 里 `create-release` 条件只 require **3 个 desktop build** 成功，Android 失败不阻塞 release 创建（best-effort 设计）→ "workflow conclusion=failure 但 release 已 published 缺 Android assets" 隐性现象
4. memory `feedback_android_tag_follows_desktop.md` 记录 Android 自更新走 desktop tag → release 缺 Android assets = Android 用户彻底无法收到这个版本的自更新（silent）

**SOP — 任何引入新重 lib 的 PR 必跑**：

```bash
cd android-app

# 1. 本地 release-mode 试 R8（5-8 min）
./gradlew :app:assembleRelease

# 2. 验产物存在
ls app/build/outputs/apk/release/*.apk

# 3. 通过后再 bump 版本 / tag
```

**两种 R8 失败的修法（按错误形态分流）**：

```
# 形态 A — Missing class X
ERROR: Missing classes detected while running R8.
ERROR: R8: Missing class java.lang.management.ManagementFactory
       (referenced from: io.ktor.util.debug.IntellijIdeaDebugDetector)
Missing class org.slf4j.impl.StaticLoggerBinder

→ 在 android-app/app/proguard-rules.pro 加：
  -dontwarn java.lang.management.**
  -dontwarn org.slf4j.impl.**
  -dontwarn org.slf4j.**
  -dontwarn <lib>.util.debug.**
  -keep class <lib>.** { *; }
  -dontwarn <lib>.**

→ R8 也会自动生成 app/build/outputs/mapping/release/missing_rules.txt
  可以直接 cat 那个文件抄进 proguard-rules.pro 一次性解决多个

# 形态 B — ConcurrentModificationException（无类名/无行号）
ERROR: R8: java.util.ConcurrentModificationException
> Task :app:minifyReleaseWithR8 FAILED

→ 是 AGP 8.x R8 full-mode 在大 Hilt+Ktor+SLF4J 合并 dex 时的 upstream bug
  (issuetracker.google.com/issues/238045415)
→ 改 android-app/gradle.properties:
  android.enableR8.fullMode=false
→ Trade-off: DEX ~3-5% 大，无 runtime perf 回归
```

**反模式**：

- ❌ "release.yml 里加 `sed` 改 gradle.properties 兜底" — 历史教训：v5.0.3.80 之前的 release.yml 注释写着 "Disable R8 full mode" 但 sed 只改了 `org.gradle.jvmargs` 完全没改 `enableR8.fullMode`，所以 release CI 永远跑 fullMode=true 直到 v5.0.3.81 才发现。**修法：改 source 文件 (gradle.properties)，让 CI + 本地一致。**
- ❌ "等下次 release 顺便修" — 缺 Android asset 这个 tag 就废了，Android 用户卡在老版本直到下次有完整 Android assets 的 release
- ❌ "只跑 unit test 就以为没事" — JVM unit test 走 mockable Android jar 不触 R8

**实战记录** — v5.0.3.80 → v5.0.3.82 hotfix 链（2026-05-22 → 23, ~4h）：

| Tag | 失败形态 | 修法 commit | 经验 |
|---|---|---|---|
| v5.0.3.80 | `Missing class java.lang.management.*` + slf4j `StaticLoggerBinder` | `c42aa603c5` 加 5 行 `-dontwarn` | A3 端侧 LLM 引入 Ktor 后**首次** release-mode build；本地 `assembleDebug` 没暴露 |
| v5.0.3.81 | `ConcurrentModificationException` | `14d574c046` `enableR8.fullMode=false` | release.yml 早有注释承诺 disable 但 sed 漏改 property |
| v5.0.3.82 | (全绿，首次完整 success) | — | 验证两个修法稳定 |

烧 3 个 immutable tag namespace + ~4h CI 时间，全部因为没在加 Ktor 时本地跑 `assembleRelease`。

**关联陷阱**：

- #14 Android in-app update — 缺 Android assets 时 UpdateChecker.kt 拉不到下载
- #18 GitHub immutable releases — burnt tag 不可复用
- memory `feedback_android_tag_follows_desktop.md` — Android 下载链跟 desktop tag

---

## 维护说明

- 新踩到的隐性陷阱按编号顺序追加（#19, #20, ...），不要插入到已有编号之间
- 每条至少包含：**陷阱本质**、**为什么排查难**、**SOP / checklist**、**反模式**
- "burned tags" / 其他实战记录类清单（如 #18 的 burned tags 表）踩到一个就追加一行
- 本文档存 `docs/internal/`（不是 `docs/`、不是 `docs-site/`），故意不被 sync 脚本扫到——确保只在仓库内可见，不发到公开 docs site
- 关联的个人 memory 在 `~/.claude/projects/.../memory/` 路径下，本文档引用它们的 slug 名供个人 session 查找；外部访问者只看本文档即可
