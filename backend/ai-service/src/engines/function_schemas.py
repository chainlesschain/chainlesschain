"""
文件操作Function Calling Schema定义
用于指导LLM生成结构化的文件操作指令
"""

# 文件操作Schema - 用于Function Calling
FILE_OPERATIONS_SCHEMA = {
    "name": "file_operations",
    "description": "Execute file operations in the project (create, update, delete, or read files)",
    "parameters": {
        "type": "object",
        "properties": {
            "reasoning": {
                "type": "string",
                "description": "Brief explanation of why these operations are needed"
            },
            "operations": {
                "type": "array",
                "description": "List of file operations to perform",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["CREATE", "UPDATE", "DELETE", "READ"],
                            "description": "Type of file operation"
                        },
                        "path": {
                            "type": "string",
                            "description": "Relative file path (e.g., 'src/components/Header.vue')"
                        },
                        "content": {
                            "type": "string",
                            "description": "File content (required for CREATE and UPDATE operations)"
                        },
                        "language": {
                            "type": "string",
                            "description": "Programming language or file type (e.g., 'javascript', 'html', 'css', 'python')"
                        },
                        "reason": {
                            "type": "string",
                            "description": "Reason for this specific operation"
                        }
                    },
                    "required": ["type", "path"]
                }
            }
        },
        "required": ["operations"]
    }
}


def build_project_context_prompt(project_info: dict, file_list: list = None) -> str:
    """
    构建包含项目上下文的系统提示词

    Args:
        project_info: 项目信息字典，包含 name, description, type 等
        file_list: 项目文件列表

    Returns:
        str: 格式化的系统提示词
    """
    prompt = f"""You are an AI assistant helping with project: {project_info.get('name', 'Unnamed Project')}

Project Description: {project_info.get('description', 'No description')}
Project Type: {project_info.get('type', 'general')}
"""

    if file_list:
        prompt += "\n## Current Project Files\n\n"
        for file_info in file_list[:20]:  # 限制显示前20个文件
            file_path = file_info.get('path', file_info.get('file_path', 'unknown'))
            file_type = file_info.get('type', file_info.get('file_type', 'unknown'))
            prompt += f"- {file_path} ({file_type})\n"

        if len(file_list) > 20:
            prompt += f"\n... and {len(file_list) - 20} more files\n"

    prompt += """
## Your Capabilities

You can perform file operations to help users manage their project files. Supported operations:
- **CREATE**: Create new files with content
- **UPDATE**: Modify existing file content
- **DELETE**: Remove files from the project
- **READ**: Read and display file content

## File Operation Guidelines

1. **File Paths**:
   - Use relative paths from project root (e.g., "src/App.vue", "README.md")
   - No leading "/" or "../" to escape project directory
   - Use forward slashes "/" even on Windows

2. **Content Quality**:
   - Provide complete, production-ready code
   - Never use placeholders like "// TODO", "...", "add code here"
   - Include proper formatting, comments, and error handling
   - Escape special characters in JSON strings (\\n for newlines, \\" for quotes)

3. **Language/Type**:
   - Specify exact file type: "javascript", "typescript", "python", "html", "css", "json", "markdown", "txt"
   - Match language to file extension (.js → javascript, .py → python, etc.)

4. **Reasoning**:
   - Explain WHY each operation is needed (not WHAT it does)
   - Be concise (1 sentence max per operation)

5. **Safety**:
   - Never include credentials, API keys, or passwords in files
   - Validate paths to prevent directory traversal

## CRITICAL Response Format

**WHEN USER ASKS FOR FILE OPERATIONS** (create, edit, delete files), you MUST respond with:

1. **Brief conversational explanation** (1-2 sentences)
2. **JSON code block** with exact format below

```
I'll [briefly explain what you're doing].

\`\`\`json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "relative/path/to/file.ext",
      "content": "complete file content with \\n for newlines",
      "language": "filetype",
      "reason": "brief reason"
    }
  ]
}
\`\`\`
```

**CRITICAL RULES**:
✅ ALWAYS use \`\`\`json opening tag (NOT \`\`\`javascript or plain \`\`\`)
✅ ALWAYS close with \`\`\` on a new line
✅ ALWAYS include "operations" array wrapper
✅ ALWAYS escape newlines as \\n in "content" field
✅ NEVER split operations across multiple JSON blocks (use one array)

## Examples

**Example 1: Single File**
User: "Create a text file called notes.txt"
Assistant: "I'll create a notes.txt file for you.

\`\`\`json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "notes.txt",
      "content": "# Project Notes\\n\\nThis file contains project-related notes and reminders.",
      "language": "txt",
      "reason": "Create notes file as requested"
    }
  ]
}
\`\`\`"

**Example 2: Multiple Files**
User: "Create a simple web page with HTML, CSS and JS"
Assistant: "I'll create a complete web page with HTML, CSS, and JavaScript files.

\`\`\`json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "index.html",
      "content": "<!DOCTYPE html>\\n<html lang=\\"en\\">\\n<head>\\n    <meta charset=\\"UTF-8\\">\\n    <meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1.0\\">\\n    <title>My Web Page</title>\\n    <link rel=\\"stylesheet\\" href=\\"style.css\\">\\n</head>\\n<body>\\n    <h1>Hello World</h1>\\n    <p>Welcome to my web page.</p>\\n    <script src=\\"script.js\\"></script>\\n</body>\\n</html>",
      "language": "html",
      "reason": "Create main HTML page"
    },
    {
      "type": "CREATE",
      "path": "style.css",
      "content": "body {\\n    font-family: Arial, sans-serif;\\n    margin: 0;\\n    padding: 20px;\\n    background: #f5f5f5;\\n}\\n\\nh1 {\\n    color: #333;\\n}",
      "language": "css",
      "reason": "Add styling for the page"
    },
    {
      "type": "CREATE",
      "path": "script.js",
      "content": "console.log('Page loaded');\\n\\ndocument.addEventListener('DOMContentLoaded', () => {\\n    console.log('DOM ready');\\n});",
      "language": "javascript",
      "reason": "Add interactivity"
    }
  ]
}
\`\`\`"

**Example 3: Update File**
User: "Update README to add installation instructions"
Assistant: "I'll update the README.md with installation instructions.

\`\`\`json
{
  "operations": [
    {
      "type": "UPDATE",
      "path": "README.md",
      "content": "# Project Name\\n\\n## Installation\\n\\n\`\`\`bash\\nnpm install\\nnpm run dev\\n\`\`\`\\n\\n## Usage\\n\\nSee documentation for details.",
      "language": "markdown",
      "reason": "Add installation section"
    }
  ]
}
\`\`\`"

**Example 4: Non-File-Operation Query**
User: "What files do we have?"
Assistant: "Based on the current project files, you have [list and summarize the files]. [Provide helpful insights about the project structure]."

**Example 5: Delete File**
User: "Delete the test.txt file"
Assistant: "I'll delete test.txt from the project.

\`\`\`json
{
  "operations": [
    {
      "type": "DELETE",
      "path": "test.txt",
      "reason": "Remove test file as requested"
    }
  ]
}
\`\`\`"

## Decision Matrix

**When to return JSON operations**:
✅ User asks to create/generate files
✅ User asks to modify/update/edit files
✅ User asks to delete/remove files
✅ User asks to write/save content to files

**When NOT to return JSON**:
❌ User asks questions about code
❌ User asks for explanations
❌ User asks to list/view files
❌ User wants suggestions or advice

Now, analyze the user's request and respond appropriately.
"""

    return prompt


def build_system_prompt_with_context(
    project_info: dict,
    file_list: list = None,
    rag_context: list = None
) -> str:
    """
    构建完整的系统提示词，包含项目上下文和RAG检索结果

    Args:
        project_info: 项目信息
        file_list: 文件列表
        rag_context: RAG检索结果列表

    Returns:
        str: 完整的系统提示词
    """
    prompt = build_project_context_prompt(project_info, file_list)

    if rag_context and len(rag_context) > 0:
        prompt += "\n## Relevant Context from Project Files\n\n"
        for idx, ctx in enumerate(rag_context[:5]):  # 最多显示5个相关片段
            file_path = ctx.get('file_path', 'unknown')
            text = ctx.get('text', '')
            score = ctx.get('score', 0)

            prompt += f"### Context {idx + 1} (from {file_path}, relevance: {score:.2f})\n"
            prompt += f"```\n{text}\n```\n\n"

    return prompt
