# AI内容审核系统使用指南

**版本**: v0.32.0
**作者**: Claude Code AI Assistant
**更新时间**: 2026-01-26

---

## 📋 目录

1. [系统概述](#系统概述)
2. [功能特性](#功能特性)
3. [快速开始](#快速开始)
4. [API参考](#api参考)
5. [违规类别](#违规类别)
6. [集成指南](#集成指南)
7. [最佳实践](#最佳实践)
8. [故障排除](#故障排除)

---

## 系统概述

AI内容审核系统使用大语言模型(LLM)对用户生成内容进行自动审核，检测并过滤违反社区规范的内容。

### 核心特性

- ✅ **6种违规类别检测**: 色情、暴力、仇恨言论、骚扰、自残、非法活动
- ✅ **多级严重度**: 高/中/低/无，精细化内容管理
- ✅ **高准确率**: 目标>90%准确率，低误报率
- ✅ **中文支持**: 针对中文语境优化
- ✅ **批量审核**: 支持批量处理，提升效率
- ✅ **可扩展**: 易于添加新的违规类别

### 技术架构

```
ContentModerator
  ↓
LLMAdapter (OpenAI/DeepSeek/Ollama等)
  ↓
LLM模型 (GPT-4o-mini/Qwen等)
```

---

## 功能特性

### 1. 违规类别检测

#### 色情内容 (Sexual Content)

- 露骨的性描述或性暗示
- 色情图片或视频链接
- 性交易信息

#### 暴力内容 (Violence)

- 暴力威胁或煽动暴力
- 血腥、残忍的描述
- 恐怖主义相关内容

#### 仇恨言论 (Hate Speech)

- 基于种族、性别、宗教、性取向等的歧视言论
- 侮辱特定群体
- 煽动仇恨

#### 骚扰/欺凌 (Harassment)

- 人身攻击或侮辱
- 网络霸凌
- 恶意骚扰

#### 自残/自杀 (Self-Harm)

- 鼓励自残或自杀
- 自残方法描述
- 自杀相关讨论

#### 非法活动 (Illegal Activity)

- 毒品交易
- 诈骗信息
- 其他违法活动

### 2. 严重度评估

| 级别       | 说明     | 建议处理                 |
| ---------- | -------- | ------------------------ |
| **HIGH**   | 严重违规 | 立即删除，警告或封禁用户 |
| **MEDIUM** | 中度违规 | 删除内容，警告用户       |
| **LOW**    | 轻微违规 | 提醒用户修改             |
| **NONE**   | 无违规   | 正常发布                 |

### 3. 置信度评分

审核结果包含置信度分数（0.0-1.0），表示AI对判断的确定程度：

- **>0.9**: 高度确定
- **0.7-0.9**: 较为确定
- **<0.7**: 不太确定，建议人工复核

---

## 快速开始

### 1. 依赖注入

```kotlin
@HiltViewModel
class PublishPostViewModel @Inject constructor(
    private val contentModerator: ContentModerator
) : ViewModel() {
    // ...
}
```

### 2. 基本使用

```kotlin
// 审核单条内容
suspend fun moderatePost(content: String) {
    when (val result = contentModerator.moderateContent(content)) {
        is Result.Success -> {
            val moderationResult = result.data
            if (moderationResult.isViolation) {
                // 处理违规内容
                showViolationDialog(moderationResult)
            } else {
                // 正常发布
                publishPost(content)
            }
        }
        is Result.Error -> {
            // 审核失败，可以选择人工审核或允许发布
            handleModerationError(result.exception)
        }
    }
}
```

### 3. 批量审核

```kotlin
suspend fun moderateMultiplePosts(posts: List<String>) {
    when (val result = contentModerator.moderateBatch(posts)) {
        is Result.Success -> {
            val results = result.data
            results.forEachIndexed { index, moderationResult ->
                if (moderationResult.isViolation) {
                    flagPost(index, moderationResult)
                }
            }
        }
        is Result.Error -> {
            handleBatchError(result.exception)
        }
    }
}
```

---

## API参考

### ContentModerator

#### moderateContent()

审核单条内容。

```kotlin
suspend fun moderateContent(
    content: String,
    context: String? = null,
    model: String = DEFAULT_MODEL
): Result<ModerationResult>
```

**参数**:

- `content`: 待审核内容（必填）
- `context`: 内容上下文，帮助AI理解语境（可选）
- `model`: LLM模型ID，默认为`gpt-4o-mini`

**返回**: `Result<ModerationResult>`

#### moderateBatch()

批量审核内容。

```kotlin
suspend fun moderateBatch(
    contents: List<String>,
    model: String = DEFAULT_MODEL
): Result<List<ModerationResult>>
```

**参数**:

- `contents`: 待审核内容列表
- `model`: LLM模型ID

**返回**: `Result<List<ModerationResult>>`

#### checkAvailability()

检查审核器可用性。

```kotlin
suspend fun checkAvailability(): Boolean
```

**返回**: `true`表示可用，`false`表示不可用

### ModerationResult

审核结果数据类。

```kotlin
data class ModerationResult(
    val isViolation: Boolean,           // 是否违规
    val violationCategories: List<ViolationCategory>,  // 违规类别列表
    val severity: ModerationSeverity,   // 严重程度
    val confidence: Double,             // 置信度 (0.0-1.0)
    val reason: String,                 // 违规原因说明
    val suggestion: String              // 处理建议
)
```

---

## 违规类别

### ViolationCategory枚举

```kotlin
enum class ViolationCategory {
    SEXUAL_CONTENT,   // 色情内容
    VIOLENCE,         // 暴力内容
    HATE_SPEECH,      // 仇恨言论
    HARASSMENT,       // 骚扰/欺凌
    SELF_HARM,        // 自残/自杀
    ILLEGAL_ACTIVITY  // 非法活动
}
```

### 使用示例

```kotlin
when {
    moderationResult.violationCategories.contains(ViolationCategory.SEXUAL_CONTENT) -> {
        // 处理色情内容
    }
    moderationResult.violationCategories.contains(ViolationCategory.VIOLENCE) -> {
        // 处理暴力内容
    }
    moderationResult.violationCategories.size > 1 -> {
        // 处理多重违规
    }
}
```

---

## 集成指南

### 1. 发布前审核

在用户发布动态前进行审核：

```kotlin
@HiltViewModel
class PublishPostViewModel @Inject constructor(
    private val contentModerator: ContentModerator,
    private val postRepository: PostRepository
) : ViewModel() {

    fun publishPost(content: String) {
        viewModelScope.launch {
            // 1. 显示审核中状态
            _uiState.update { it.copy(isModeration = true) }

            // 2. 审核内容
            when (val result = contentModerator.moderateContent(content)) {
                is Result.Success -> {
                    val moderationResult = result.data

                    // 3. 处理审核结果
                    if (moderationResult.isViolation) {
                        handleViolation(moderationResult)
                    } else {
                        proceedToPublish(content)
                    }
                }
                is Result.Error -> {
                    // 4. 审核失败，询问用户是否继续
                    _uiState.update {
                        it.copy(
                            isModeration = false,
                            moderationError = result.exception.message
                        )
                    }
                }
            }
        }
    }

    private fun handleViolation(result: ModerationResult) {
        when (result.severity) {
            ModerationSeverity.HIGH -> {
                // 严重违规：直接拒绝
                _uiState.update {
                    it.copy(
                        isModeration = false,
                        violationDialog = ViolationDialogState(
                            show = true,
                            message = "检测到严重违规内容：${result.reason}",
                            canEdit = false
                        )
                    )
                }
            }
            ModerationSeverity.MEDIUM -> {
                // 中度违规：允许修改
                _uiState.update {
                    it.copy(
                        isModeration = false,
                        violationDialog = ViolationDialogState(
                            show = true,
                            message = "检测到不当内容：${result.reason}",
                            suggestion = result.suggestion,
                            canEdit = true
                        )
                    )
                }
            }
            ModerationSeverity.LOW -> {
                // 轻微违规：提醒但允许发布
                _uiState.update {
                    it.copy(
                        isModeration = false,
                        warningMessage = result.reason
                    )
                }
            }
            else -> {
                proceedToPublish(content)
            }
        }
    }
}
```

### 2. 审核队列（后台审核）

创建审核队列表：

```kotlin
@Entity(tableName = "moderation_queue")
data class ModerationQueueEntity(
    @PrimaryKey val id: String,
    val postId: String,
    val content: String,
    val moderationResult: String, // JSON序列化的ModerationResult
    val status: ModerationStatus, // PENDING/APPROVED/REJECTED
    val createdAt: Long,
    val reviewedAt: Long? = null,
    val reviewerNote: String? = null
)

enum class ModerationStatus {
    PENDING,   // 待审核
    APPROVED,  // 已通过
    REJECTED,  // 已拒绝
    APPEALED   // 已申诉
}
```

### 3. UI集成

#### 违规提示对话框

```kotlin
@Composable
fun ViolationDialog(
    moderationResult: ModerationResult,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onAppeal: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Warning,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error
                )
                Spacer(Modifier.width(8.dp))
                Text("内容违规提示")
            }
        },
        text = {
            Column {
                Text(
                    text = "您的内容包含违反社区规范的部分：",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(Modifier.height(8.dp))

                // 违规类别
                moderationResult.violationCategories.forEach { category ->
                    Chip(
                        label = { Text(category.displayName) },
                        colors = ChipDefaults.chipColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        )
                    )
                }

                Spacer(Modifier.height(12.dp))

                // 违规原因
                Text(
                    text = moderationResult.reason,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // 处理建议
                if (moderationResult.suggestion.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "建议：${moderationResult.suggestion}",
                        style = MaterialTheme.typography.bodySmall,
                        fontStyle = FontStyle.Italic
                    )
                }
            }
        },
        confirmButton = {
            when (moderationResult.severity) {
                ModerationSeverity.HIGH -> {
                    TextButton(onClick = onDismiss) {
                        Text("关闭")
                    }
                }
                ModerationSeverity.MEDIUM -> {
                    Row {
                        TextButton(onClick = onAppeal) {
                            Text("申诉")
                        }
                        TextButton(onClick = onEdit) {
                            Text("修改")
                        }
                    }
                }
                else -> {
                    Row {
                        TextButton(onClick = onDismiss) {
                            Text("仍要发布")
                        }
                        TextButton(onClick = onEdit) {
                            Text("修改")
                        }
                    }
                }
            }
        }
    )
}
```

---

## 最佳实践

### 1. 模型选择

**推荐模型**:

- **生产环境**: `gpt-4o-mini` - 成本低，速度快，准确率高
- **高准确率需求**: `gpt-4o` - 更强的理解能力
- **本地部署**: `qwen:7b` (Ollama) - 无API成本，隐私保护

### 2. 性能优化

```kotlin
// 使用缓存避免重复审核
class CachedContentModerator(
    private val contentModerator: ContentModerator,
    private val cache: MutableMap<String, ModerationResult> = mutableMapOf()
) {
    suspend fun moderateContent(content: String): Result<ModerationResult> {
        val contentHash = content.hashCode().toString()

        // 检查缓存
        cache[contentHash]?.let {
            return Result.Success(it)
        }

        // 审核
        val result = contentModerator.moderateContent(content)
        if (result is Result.Success) {
            cache[contentHash] = result.data
        }

        return result
    }
}
```

### 3. 错误处理

```kotlin
suspend fun moderateWithFallback(content: String): ModerationDecision {
    return try {
        when (val result = contentModerator.moderateContent(content)) {
            is Result.Success -> {
                if (result.data.isViolation) {
                    ModerationDecision.REJECT
                } else {
                    ModerationDecision.APPROVE
                }
            }
            is Result.Error -> {
                // 审核失败时的策略选择：
                // 选项1: 保守策略 - 拒绝发布，人工审核
                ModerationDecision.MANUAL_REVIEW

                // 选项2: 宽松策略 - 允许发布，后台审核
                // ModerationDecision.APPROVE_WITH_REVIEW
            }
            else -> ModerationDecision.MANUAL_REVIEW
        }
    } catch (e: Exception) {
        ModerationDecision.MANUAL_REVIEW
    }
}
```

### 4. 测试

```kotlin
// 测试用例
val testCases = listOf(
    TestCase("正常内容", "今天天气真好", expected = false),
    TestCase("色情内容", "...", expected = true),
    TestCase("暴力内容", "...", expected = true),
    TestCase("灰色地带", "边缘内容", expected = null) // 需人工判断
)

testCases.forEach { case ->
    val result = contentModerator.moderateContent(case.content)
    // 验证结果
}
```

---

## 故障排除

### 1. LLM API不可用

**问题**: `checkAvailability()` 返回 `false`

**解决方案**:

- 检查网络连接
- 验证API密钥
- 检查API配额
- 切换到备用模型

### 2. 审核速度慢

**问题**: 审核耗时过长

**解决方案**:

- 使用更快的模型（如`gpt-4o-mini`）
- 实现异步审核
- 添加超时机制
- 使用批量审核

### 3. 误报率高

**问题**: 正常内容被误判为违规

**解决方案**:

- 检查置信度阈值
- 提供更多上下文
- 调整Prompt
- 人工复核机制

### 4. JSON解析失败

**问题**: `parseModerationResult()` 返回默认值

**解决方案**:

- 检查模型响应格式
- 增强JSON提取逻辑
- 添加响应日志
- 使用更稳定的模型

---

## 附录

### A. 系统Prompt

完整的系统Prompt请参考 `ContentModerator.kt` 中的 `SYSTEM_PROMPT`。

### B. 响应示例

**无违规**:

```json
{
  "is_violation": false,
  "violation_categories": [],
  "severity": "none",
  "confidence": 0.95,
  "reason": "内容健康，无违规",
  "suggestion": "无需处理"
}
```

**有违规**:

```json
{
  "is_violation": true,
  "violation_categories": ["sexual_content", "violence"],
  "severity": "high",
  "confidence": 0.98,
  "reason": "包含色情和暴力内容",
  "suggestion": "立即删除，警告用户，考虑封禁"
}
```

### C. 性能指标

| 指标         | 目标值 | 实际值 |
| ------------ | ------ | ------ |
| 准确率       | >90%   | 待测试 |
| 平均响应时间 | <2s    | 待测试 |
| 误报率       | <5%    | 待测试 |
| 漏报率       | <3%    | 待测试 |

---

**版本历史**:

- v0.32.0 (2026-01-26): 初始版本

**维护者**: ChainlessChain团队
