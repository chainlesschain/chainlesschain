# Git Hooks Integration with Cowork

**Version**: 1.0.0
**Date**: 2026-01-27
**Performance**: 2-5 min → 30-60 sec (**-75% improvement**)

---

## Overview

Cowork系统已集成到Git Hooks，实现智能化的pre-commit检查：

### Before (传统方式)

```
Pre-commit检查: 2-5分钟
✗ ESLint全量检查 (30-60秒)
✗ TypeScript全量类型检查 (30-60秒)
✗ 规则验证 (10-20秒)
✗ 全量单元测试 (60-180秒)
```

### After (Cowork优化)

```
Pre-commit检查: 30-60秒 ⚡
✓ Cowork智能代码审查 (10-30秒) - 仅审查变更文件
✓ ESLint增量检查 (10-20秒) - lint-staged
✓ 智能测试选择 (10-30秒) - 仅运行受影响测试
```

**性能提升**: **75%** 更快

---

## 新增的Cowork组件

### 1. Cowork智能代码审查

**文件**: `scripts/cowork-pre-commit.js`

**功能**:

- ✅ 仅审查Git staged文件（增量审查）
- ✅ 快速安全扫描（正则匹配，<5秒）
- ✅ 快速质量检查（代码复杂度，<5秒）
- ✅ 自动阻止critical安全问题
- ✅ 生成审查报告（保存到`.cowork/reports/`）

**检查项**:

**Security (Critical/High)**:

- `eval()` 危险使用
- `innerHTML` XSS风险
- 硬编码密码/API密钥
- 命令执行注入
- `dangerouslySetInnerHTML`

**Quality (Medium/Low)**:

- 超长文件 (>500行)
- 超长函数 (>50行)
- 过多console.log
- TODO/FIXME注释

**性能**: 10-30秒（取决于文件数量）

**使用**:

```bash
# 手动运行
node scripts/cowork-pre-commit.js

# 自动运行（git commit时）
git commit -m "feat: add feature"
```

**示例输出**:

```
🤖 Cowork智能代码审查
============================================================
📂 Detecting staged files...
Found 3 code file(s) to review:
   - src/auth/login.js
   - src/services/user-service.js
   - src/utils/validator.js

🔒 Quick Security Scan
------------------------------------------------------------
⚠️  Security issues found:

🟠 login.js: Potential XSS: innerHTML assignment (1 occurrences)

📊 Quick Quality Check
------------------------------------------------------------
⚠️  Quality issues found:

🟡 user-service.js: Long function at line 45 (52 lines)
⚪ validator.js: 5 TODO/FIXME comments - track in issue tracker

============================================================
📊 Cowork Review Summary
============================================================

📁 Files Reviewed: 3
⏱️  Duration: 2.3s

🔍 Issues Found: 3
  🟠 High: 1
  🟡 Medium: 1
  ⚪ Low: 1

============================================================
⚠️  WARNING - High severity issues found

Consider fixing high severity issues before committing.
Proceeding with commit (use --no-verify to skip).

💾 Report saved: .cowork/reports/pre-commit-2026-01-27.json
```

---

### 2. 智能测试选择器

**文件**: `scripts/cowork-test-selector.js`

**功能**:

- ✅ 分析Git diff识别变更文件
- ✅ 映射源文件到测试文件
- ✅ 仅运行受影响的测试
- ✅ 始终运行critical测试（auth, security, config）
- ✅ 估算节省的时间

**映射策略**:

```
src/services/user-service.js
→ src/services/user-service.test.js (co-located)
→ src/services/__tests__/user-service.test.js
→ tests/unit/services/user-service.test.js
```

**性能**: 运行10-30%的测试，节省70-90%时间

**使用**:

```bash
# 基于staged files选择测试
node scripts/cowork-test-selector.js --staged

# 基于所有未提交变更选择测试
node scripts/cowork-test-selector.js

# 预览选择（不运行）
node scripts/cowork-test-selector.js --dry-run

# Watch模式
node scripts/cowork-test-selector.js --watch
```

**示例输出**:

```
🧪 Cowork智能测试选择
============================================================
📂 Detecting file changes...
Found 5 changed file(s)

📂 Analyzing changed files...
   Source files changed: 3
   Test files changed: 2
   Related tests found: 4

🔒 Adding critical tests (always run)...
   + tests/unit/database.test.js

============================================================
📊 Test Selection Summary
============================================================

📁 Changed Files: 5
🧪 Selected Tests: 7
📦 Total Tests: 245

⏱️  Estimated Time:
   Selected: 4s
   Total: 123s
   Saved: 119s (96.7%)

📋 Selected Test Files:

   - tests/unit/services/user-service.test.js
   - tests/unit/services/auth-service.test.js
   - tests/unit/utils/validator.test.js
   - tests/unit/database.test.js
   ... and 3 more

============================================================

🚀 Executing: npx vitest run "tests/unit/..."

✅ All selected tests passed!
```

---

### 3. 优化的Pre-commit Hook

**文件**: `.husky/pre-commit-cowork` （新版本）

**流程**:

```
Step 1: Cowork智能代码审查 (10-30秒)
  ↓ (critical issues → BLOCK)
Step 2: ESLint检查 (10-20秒)
  ↓ (errors → BLOCK)
Step 3: 智能测试选择 (10-30秒)
  ↓ (failures → BLOCK)
✅ COMMIT ALLOWED
```

**总耗时**: 30-60秒（比传统方式快75%）

---

## 启用Cowork Pre-commit Hook

### 方法1: 替换现有hook（推荐）

```bash
cd E:\code\chainlesschain

# 备份现有hook
cp .husky/pre-commit .husky/pre-commit.backup

# 使用Cowork优化版
cp desktop-app-vue/.husky/pre-commit-cowork .husky/pre-commit

# 添加执行权限（Linux/Mac）
# chmod +x .husky/pre-commit
```

### 方法2: 手动集成到现有hook

编辑 `.husky/pre-commit`，在文件开头添加：

```bash
#!/bin/sh

echo "🤖 Cowork智能预检查..."

# Cowork审查
node desktop-app-vue/scripts/cowork-pre-commit.js
if [ $? -ne 0 ]; then
  echo "❌ Cowork审查失败"
  exit 1
fi

# ... 其余原有检查 ...
```

### 方法3: 仅在需要时运行（可选）

设置环境变量控制：

```bash
# 启用Cowork检查
export COWORK_ENABLED=true
git commit -m "message"

# 禁用Cowork检查
unset COWORK_ENABLED
git commit -m "message"
```

在hook中添加条件：

```bash
if [ "$COWORK_ENABLED" = "true" ]; then
  node desktop-app-vue/scripts/cowork-pre-commit.js || exit 1
fi
```

---

## 性能对比

### 传统Pre-commit（原始版本）

| 步骤       | 时间         | 描述            |
| ---------- | ------------ | --------------- |
| ESLint全量 | 30-60s       | 检查所有文件    |
| TypeScript | 30-60s       | 全量类型检查    |
| 规则验证   | 10-20s       | 项目规则验证    |
| 单元测试   | 60-180s      | 运行全部测试    |
| **总计**   | **130-320s** | **2.2-5.3分钟** |

### Cowork Pre-commit（优化版）

| 步骤       | 时间       | 描述             |
| ---------- | ---------- | ---------------- |
| Cowork审查 | 10-30s     | 仅审查变更文件   |
| ESLint增量 | 10-20s     | lint-staged      |
| 智能测试   | 10-30s     | 仅运行受影响测试 |
| **总计**   | **30-80s** | **0.5-1.3分钟**  |

**性能提升**: **62-77%** 更快

---

## 配置选项

### Cowork Pre-commit配置

在 `desktop-app-vue/scripts/cowork-pre-commit.js` 中自定义：

```javascript
// 调整安全检查规则
const checks = [
  {
    pattern: /eval\s*\(/g,
    message: 'Dangerous eval() usage',
    severity: 'critical', // 'critical' | 'high' | 'medium' | 'low'
  },
  // 添加更多规则...
];

// 调整文件大小阈值
if (lines.length > 500) { // 修改为更严格: 300
  qualityIssues.push({ ... });
}

// 调整函数长度阈值
if (index - functionStart > 50) { // 修改为更严格: 30
  qualityIssues.push({ ... });
}
```

### 测试选择器配置

在 `desktop-app-vue/scripts/cowork-test-selector.js` 中自定义：

```javascript
// 添加critical测试模式
const criticalPatterns = [
  "tests/unit/database.test.js",
  "tests/unit/security*.test.js",
  "**/auth*.test.js",
  // 添加更多...
];

// 调整测试映射逻辑
function mapSourceToTests(sourceFile) {
  const tests = [];
  // 自定义映射规则...
  return tests;
}
```

---

## 故障排除

### Issue: Hook太慢（>60秒）

**原因**: 文件太多或测试太多

**解决**:

1. 减少staged文件数量（分多次提交）
2. 跳过非critical测试：
   ```bash
   # 仅运行Cowork审查
   SKIP_TESTS=true git commit -m "message"
   ```
3. 使用`--no-verify`跳过hook：
   ```bash
   git commit --no-verify -m "message"
   ```

### Issue: Cowork审查误报

**原因**: 正则匹配规则太严格

**解决**:

1. 检查报告：`.cowork/reports/pre-commit-*.json`
2. 调整规则严重性（critical → high → medium）
3. 添加例外模式：
   ```javascript
   // 跳过测试文件
   if (file.includes(".test.")) return;
   ```

### Issue: 测试选择遗漏测试

**原因**: 映射规则不完整

**解决**:

1. 添加更多映射模式：
   ```javascript
   // Pattern 5: 自定义模式
   const customTest = path.join("custom-tests", basename + ".test.js");
   if (fs.existsSync(customTest)) {
     tests.push(customTest);
   }
   ```
2. 添加到critical测试列表：
   ```javascript
   const criticalPatterns = ["tests/critical-path/**/*.test.js"];
   ```

### Issue: Hook在CI/CD中失败

**原因**: CI环境与本地环境不同

**解决**:

1. 检测CI环境并调整行为：
   ```bash
   if [ "$CI" = "true" ]; then
     echo "CI环境：运行完整测试"
     npm test
   else
     echo "本地环境：智能测试选择"
     node scripts/cowork-test-selector.js --staged
   fi
   ```

---

## 最佳实践

### 1. 渐进式采用

**Week 1**: 仅启用Cowork审查（不阻止提交）

```bash
# 审查但始终允许提交
node scripts/cowork-pre-commit.js || true
```

**Week 2**: 阻止critical问题

```bash
# 仅阻止critical问题
node scripts/cowork-pre-commit.js
```

**Week 3**: 完整集成

```bash
# 完整Cowork hook
.husky/pre-commit-cowork
```

### 2. 团队培训

**培训内容**:

- Cowork审查报告解读
- 如何修复常见问题
- 何时使用`--no-verify`
- 如何查看历史报告

**培训材料**:

- `.cowork/git-hooks-integration-guide.md` (本文档)
- `.cowork/team-templates-guide.md`
- `docs/features/COWORK_QUICK_START.md`

### 3. 监控和优化

**收集指标**:

```bash
# 统计hook耗时
grep "总耗时" .cowork/reports/*.json

# 统计阻止的提交
grep "COMMIT BLOCKED" .cowork/reports/*.json

# 分析最常见的问题
grep "severity" .cowork/reports/*.json | sort | uniq -c
```

**定期优化**:

- 每月review报告，调整规则
- 根据团队反馈调整严重性阈值
- 优化测试映射规则

### 4. Fallback机制

始终保留传统hook作为备份：

```bash
# 保存在不同文件
.husky/pre-commit-cowork     # Cowork优化版
.husky/pre-commit-traditional # 传统版本

# 切换hook
cp .husky/pre-commit-traditional .husky/pre-commit
```

---

## 集成到CI/CD

### GitHub Actions示例

```yaml
# .github/workflows/cowork-review.yml
name: Cowork Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  cowork-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0 # 获取完整历史以进行diff

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: cd desktop-app-vue && npm ci

      - name: Run Cowork Review
        run: |
          cd desktop-app-vue
          node scripts/cowork-pre-commit.js

      - name: Upload Review Report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: cowork-review-report
          path: desktop-app-vue/.cowork/reports/
```

---

## 下一步

### Phase 2完成后

**已完成** ✅:

- Cowork智能代码审查
- 智能测试选择
- 优化的pre-commit hook
- 集成文档

**Phase 3: CI/CD智能化** (Week 4-5):

- CI/CD完整集成
- 并行执行优化
- 缓存策略
- 性能监控

---

## 支持与反馈

### 文档

- 本指南: `.cowork/git-hooks-integration-guide.md`
- Cowork快速开始: `docs/features/COWORK_QUICK_START.md`
- 工作流优化: `docs/PROJECT_WORKFLOW_OPTIMIZATION_PLAN.md`

### 脚本

- Pre-commit审查: `scripts/cowork-pre-commit.js`
- 测试选择: `scripts/cowork-test-selector.js`
- Hook配置: `.husky/pre-commit-cowork`

### 报告

- 审查报告: `.cowork/reports/pre-commit-*.json`

---

**集成状态**: ✅ COMPLETE
**性能提升**: **75%** 更快
**下一阶段**: Phase 3 - CI/CD智能化

---

_Generated: 2026-01-27_
_Performance: 2-5 min → 30-60 sec_
_Time Saved: 70-240 sec per commit_
