# Pre-commit 代码质量门禁

## 概述

ChainlessChain 项目集成了多层代码质量检查，在每次 `git commit` 时自动运行，确保代码质量和安全性。

## 检查流程

Pre-commit hook 按以下顺序执行：

### 1. ESLint 和代码格式化（lint-staged）

**自动运行的检查：**

- **ESLint**: 检查并自动修复 JavaScript/TypeScript 代码风格问题
- **Prettier**: 自动格式化代码（JS/TS/JSON/YAML/MD）
- **安全扫描**: 检测敏感信息泄露（API keys、密码、JWT tokens 等）

**检查的文件类型：**

```json
{
  "*.{js,jsx,ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"],
  "*.{js,jsx,ts,tsx,json,md}": ["node scripts/security-check.js"]
}
```

### 2. 项目规则验证器

**检查内容：**

- **SQL 注入防护**: 检测不安全的 `db.exec()` 调用
- **P2P 加密规范**: 验证 Signal Protocol 正确使用
- **敏感信息泄露**: 检测日志中的密码、PIN 码、密钥等
- **依赖项漏洞**: 扫描 npm 依赖安全漏洞

**严重级别：**

- **HIGH**: 必须修复的错误（SQL 注入、明文密码等）
- **MEDIUM**: 警告级别（日志泄露、过时依赖等）

## 使用方法

### 正常提交

```bash
git add .
git commit -m "your message"
```

如果所有检查通过，提交成功。

### 跳过检查（不推荐）

```bash
git commit --no-verify -m "your message"
```

⚠️ **警告**: 仅在紧急情况下使用，可能引入安全问题。

### 仅运行 lint-staged（不包括规则验证）

```bash
npx lint-staged
```

### 手动运行安全扫描

```bash
node scripts/security-check.js
```

### 手动运行规则验证

```bash
cd desktop-app-vue
npm run validate:rules
```

## 安全扫描模式

### 检测的敏感信息类型

1. **API Keys**:
   - 格式: `api_key = "xxx"`
   - 长度: 20+ 字符

2. **AWS 密钥**:
   - 格式: `AKIA[0-9A-Z]{16}`

3. **数据库连接字符串**:
   - MySQL: `mysql://user:password@host`
   - PostgreSQL: `postgres://user:password@host`
   - MongoDB: `mongodb://user:password@host`

4. **JWT Tokens**:
   - 格式: `eyJ...`

5. **密码**:
   - 格式: `password = "xxx"`
   - 长度: 8+ 字符

### 白名单文件

以下文件会被跳过扫描：

- `.env.example` (示例配置)
- `security-check.js` (脚本本身)
- `test-database.js` (测试文件)
- `test-ukey.js` (测试文件)

**添加新的白名单文件**:

编辑 `scripts/security-check.js`:

```javascript
const ALLOWED_FILES = [
  '.env.example',
  'your-file.js',  // 添加新文件
];
```

## 常见问题

### Q: 提交时 ESLint 报错怎么办？

A: 查看错误信息，手动修复后重新提交。常见问题：

```bash
# 自动修复大部分问题
npm run lint -- --fix

# 查看所有 lint 问题
npm run lint
```

### Q: 安全扫描误报怎么办？

A: 两种方法：

1. **添加到白名单**（推荐）: 编辑 `scripts/security-check.js` 的 `ALLOWED_FILES`
2. **临时跳过**: `git commit --no-verify`（不推荐）

### Q: 规则验证失败怎么办？

A:
1. **修复错误**: 根据提示修复代码问题
2. **查看详细报告**: 检查输出的文件路径和行号
3. **紧急提交**: 使用 `--no-verify`（需要后续修复）

### Q: 如何禁用某个检查？

A: 编辑 `.husky/pre-commit`，注释相应部分：

```bash
# # 1. 运行 lint-staged（ESLint + Prettier + 安全扫描）
# echo "📝 运行 ESLint 和代码格式化..."
# npx lint-staged
```

### Q: 提交很慢怎么办？

A: 检查可能在多个文件上运行。优化方法：

1. **分批提交**: 减少一次提交的文件数量
2. **使用 lint-staged**: 只检查暂存的文件
3. **升级依赖**: 确保 ESLint、Prettier 是最新版本

## ESLint 配置

### 当前规则

```javascript
{
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  '@typescript-eslint/no-var-requires': 'off',  // 允许 CommonJS
  'no-console': 'off',                          // 允许 console.log
  'no-debugger': 'warn',                        // 警告 debugger
  'react/react-in-jsx-scope': 'off',            // React 17+
  'react/prop-types': 'off',                    // 使用 TypeScript
}
```

### 自定义规则

编辑 `.eslintrc.js`:

```javascript
module.exports = {
  rules: {
    // 添加或覆盖规则
    'your-rule': 'error',
  },
};
```

## 相关文件

- **`.husky/pre-commit`**: Pre-commit hook 脚本
- **`.eslintrc.js`**: ESLint 配置
- **`package.json`**: lint-staged 配置
- **`scripts/security-check.js`**: 安全扫描脚本
- **`desktop-app-vue/scripts/rules-validator.js`**: 规则验证器

## 最佳实践

1. ✅ **提交前先运行测试**: `npm test`
2. ✅ **使用有意义的提交信息**: 遵循 [Conventional Commits](https://www.conventionalcommits.org/)
3. ✅ **小步提交**: 每次提交解决一个问题
4. ✅ **修复所有 HIGH 级别错误**: 不要跳过 SQL 注入等严重问题
5. ❌ **避免使用 --no-verify**: 除非紧急情况

## 更新历史

- **2026-01-16**: 初始版本，集成 Husky + lint-staged + 安全扫描
