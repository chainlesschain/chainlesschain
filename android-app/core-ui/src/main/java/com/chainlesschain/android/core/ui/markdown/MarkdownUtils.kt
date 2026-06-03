package com.chainlesschain.android.core.ui.markdown

/**
 * Markdown辅助工具函数
 *
 * 提供Markdown格式插入、转换等功能
 *
 * @since v0.31.0
 */

/**
 * 在文本中插入Markdown格式
 *
 * @param text 原始文本
 * @param format Markdown格式类型
 * @param selection 当前选中的文本范围（可选）
 * @return 格式化后的文本
 */
fun insertMarkdown(
    text: String,
    format: MarkdownFormat,
    selection: IntRange? = null
): String {
    return when (format) {
        MarkdownFormat.BOLD -> insertBold(text, selection)
        MarkdownFormat.ITALIC -> insertItalic(text, selection)
        MarkdownFormat.STRIKETHROUGH -> insertStrikethrough(text, selection)
        MarkdownFormat.HEADING -> insertHeading(text, selection)
        MarkdownFormat.UNORDERED_LIST -> insertUnorderedList(text, selection)
        MarkdownFormat.ORDERED_LIST -> insertOrderedList(text, selection)
        MarkdownFormat.CODE_BLOCK -> insertCodeBlock(text, selection)
        MarkdownFormat.LINK -> insertLink(text, selection)
    }
}

/**
 * 插入粗体格式 **text**
 */
private fun insertBold(text: String, selection: IntRange?): String {
    return if (selection != null && selection.first < selection.last) {
        val selectedText = text.substring(selection.first, selection.last)
        text.replaceRange(selection, "**$selectedText**")
    } else {
        "$text**粗体文本**"
    }
}

/**
 * 插入斜体格式 *text*
 */
private fun insertItalic(text: String, selection: IntRange?): String {
    return if (selection != null && selection.first < selection.last) {
        val selectedText = text.substring(selection.first, selection.last)
        text.replaceRange(selection, "*$selectedText*")
    } else {
        "$text*斜体文本*"
    }
}

/**
 * 插入删除线格式 ~~text~~
 */
private fun insertStrikethrough(text: String, selection: IntRange?): String {
    return if (selection != null && selection.first < selection.last) {
        val selectedText = text.substring(selection.first, selection.last)
        text.replaceRange(selection, "~~$selectedText~~")
    } else {
        "$text~~删除线文本~~"
    }
}

/**
 * 插入标题格式 # text
 */
private fun insertHeading(text: String, selection: IntRange?): String {
    val lines = text.lines().toMutableList()

    if (selection != null) {
        // 找到选中文本所在的行
        var currentPos = 0
        for (i in lines.indices) {
            val lineLength = lines[i].length + 1 // +1 for newline
            if (currentPos + lineLength > selection.first) {
                // 在该行前添加 #
                lines[i] = if (lines[i].startsWith("#")) {
                    // 如果已经是标题，增加级别
                    val level = lines[i].takeWhile { it == '#' }.length
                    if (level < 6) {
                        "#${lines[i]}"
                    } else {
                        lines[i].removePrefix("######").trim()
                    }
                } else {
                    "# ${lines[i]}"
                }
                break
            }
            currentPos += lineLength
        }
    } else {
        // 在末尾添加标题
        lines.add("# 标题")
    }

    return lines.joinToString("\n")
}

/**
 * 插入无序列表格式 - item
 */
private fun insertUnorderedList(text: String, selection: IntRange?): String {
    val lines = text.lines().toMutableList()

    if (selection != null) {
        var currentPos = 0
        for (i in lines.indices) {
            val lineLength = lines[i].length + 1
            if (currentPos <= selection.first && selection.first < currentPos + lineLength) {
                // 在该行前添加 -
                lines[i] = if (lines[i].trim().startsWith("-")) {
                    lines[i].replaceFirst("-", "").trim()
                } else {
                    "- ${lines[i]}"
                }
                break
            }
            currentPos += lineLength
        }
    } else {
        lines.add("- 列表项")
    }

    return lines.joinToString("\n")
}

/**
 * 插入有序列表格式 1. item
 */
private fun insertOrderedList(text: String, selection: IntRange?): String {
    val lines = text.lines().toMutableList()

    if (selection != null) {
        var currentPos = 0
        for (i in lines.indices) {
            val lineLength = lines[i].length + 1
            if (currentPos <= selection.first && selection.first < currentPos + lineLength) {
                // 在该行前添加数字
                lines[i] = if (lines[i].trim().matches(Regex("^\\d+\\..*"))) {
                    lines[i].replaceFirst(Regex("^\\d+\\.\\s*"), "").trim()
                } else {
                    "1. ${lines[i]}"
                }
                break
            }
            currentPos += lineLength
        }
    } else {
        lines.add("1. 列表项")
    }

    return lines.joinToString("\n")
}

/**
 * 插入代码块格式 ```code```
 */
private fun insertCodeBlock(text: String, selection: IntRange?): String {
    return if (selection != null && selection.first < selection.last) {
        val selectedText = text.substring(selection.first, selection.last)
        text.replaceRange(selection, "```\n$selectedText\n```")
    } else {
        "$text```\n代码块\n```"
    }
}

/**
 * 插入链接格式 [text](url)
 */
private fun insertLink(text: String, selection: IntRange?): String {
    return if (selection != null && selection.first < selection.last) {
        val selectedText = text.substring(selection.first, selection.last)
        text.replaceRange(selection, "[$selectedText](https://example.com)")
    } else {
        "$text[链接文本](https://example.com)"
    }
}

/**
 * 检测文本是否包含Markdown语法
 */
fun containsMarkdown(text: String): Boolean {
    val markdownPatterns = listOf(
        Regex("\\*\\*.*?\\*\\*"),        // 粗体
        Regex("\\*.*?\\*"),              // 斜体
        Regex("~~.*?~~"),                // 删除线
        Regex("^#+\\s+.*", RegexOption.MULTILINE), // 标题
        Regex("^-\\s+.*", RegexOption.MULTILINE),  // 无序列表
        Regex("^\\d+\\.\\s+.*", RegexOption.MULTILINE), // 有序列表
        Regex("```[\\s\\S]*?```"),       // 代码块
        Regex("\\[.*?\\]\\(.*?\\)")      // 链接
    )

    return markdownPatterns.any { it.find(text) != null }
}

/**
 * 估算Markdown渲染后的文本长度（用于字数统计）
 */
fun estimateRenderedLength(markdown: String): Int {
    var text = markdown

    // 移除Markdown语法
    text = text.replace(Regex("\\*\\*|\\*|~~"), "")  // 粗体、斜体、删除线
    text = text.replace(Regex("^#+\\s+", RegexOption.MULTILINE), "") // 标题
    text = text.replace(Regex("^[-*]\\s+", RegexOption.MULTILINE), "") // 列表
    text = text.replace(Regex("^\\d+\\.\\s+", RegexOption.MULTILINE), "") // 有序列表
    text = text.replace(Regex("```[\\s\\S]*?```"), "[代码]") // 代码块
    text = text.replace(Regex("\\[([^\\]]+)\\]\\([^)]+\\)"), "$1") // 链接

    return text.length
}

/**
 * 提取Markdown中的所有链接
 */
fun extractLinks(markdown: String): List<String> {
    val linkPattern = Regex("\\[([^\\]]+)\\]\\(([^)]+)\\)")
    return linkPattern.findAll(markdown).map { it.groupValues[2] }.toList()
}

/**
 * 提取Markdown中的所有图片URL
 */
fun extractImages(markdown: String): List<String> {
    val imagePattern = Regex("!\\[([^\\]]*)\\]\\(([^)]+)\\)")
    return imagePattern.findAll(markdown).map { it.groupValues[2] }.toList()
}

/**
 * 将纯文本转换为Markdown（保留换行和链接）
 */
fun plainTextToMarkdown(plainText: String): String {
    var markdown = plainText

    // 转换URL为Markdown链接
    val urlPattern = Regex("https?://[^\\s]+")
    markdown = urlPattern.replace(markdown) { matchResult ->
        val url = matchResult.value
        "[$url]($url)"
    }

    return markdown
}

/**
 * Markdown转纯文本（移除所有格式）
 */
fun markdownToPlainText(markdown: String): String {
    var text = markdown

    // 移除所有Markdown语法
    text = text.replace(Regex("!?\\[([^\\]]+)\\]\\([^)]+\\)"), "$1") // 链接和图片
    text = text.replace(Regex("\\*\\*([^*]+)\\*\\*"), "$1") // 粗体
    text = text.replace(Regex("\\*([^*]+)\\*"), "$1") // 斜体
    text = text.replace(Regex("~~([^~]+)~~"), "$1") // 删除线
    text = text.replace(Regex("^#+\\s+", RegexOption.MULTILINE), "") // 标题
    text = text.replace(Regex("^[-*]\\s+", RegexOption.MULTILINE), "") // 列表
    text = text.replace(Regex("^\\d+\\.\\s+", RegexOption.MULTILINE), "") // 有序列表
    text = text.replace(Regex("```[\\s\\S]*?```"), "") // 代码块
    text = text.replace(Regex("`([^`]+)`"), "$1") // 行内代码

    return text.trim()
}
