# ai-commit-message

**Source**: `src/main/git/ai-commit-message.js`

**Generated**: 2026-02-17T10:13:18.244Z

---

## const

```javascript
const
```

* AI Git提交信息生成器
 * 使用LLM分析git diff并生成符合Conventional Commits规范的提交信息

---

## async generateCommitMessage(projectPath)

```javascript
async generateCommitMessage(projectPath)
```

* 生成提交信息

---

## getGitDiff(projectPath)

```javascript
getGitDiff(projectPath)
```

* 获取git diff

---

## async callLLM(diff)

```javascript
async callLLM(diff)
```

* 调用LLM生成提交信息

---

## generateFallbackMessage(diff)

```javascript
generateFallbackMessage(diff)
```

* 生成降级提交信息（当LLM不可用时）

---

## validateCommitMessage(message)

```javascript
validateCommitMessage(message)
```

* 验证提交信息格式

---

## getChangeStats(projectPath)

```javascript
getChangeStats(projectPath)
```

* 分析文件变更统计

---

