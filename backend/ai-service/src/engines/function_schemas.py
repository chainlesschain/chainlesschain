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

You can perform file operations using the `file_operations` function. When the user asks you to:
- Create files: Use type "CREATE"
- Modify existing files: Use type "UPDATE"
- Delete files: Use type "DELETE"
- Read file content: Use type "READ"

## Guidelines

1. **File Paths**: Always use relative paths within the project directory
2. **Content**: Provide complete, working code - don't use placeholders or "..."
3. **Language**: Specify the correct language/file type
4. **Reasoning**: Explain your decisions briefly
5. **Safety**: Never include sensitive information (API keys, passwords) in files

## Response Format

When you need to perform file operations, respond with:
1. A conversational message explaining what you're doing
2. A JSON code block containing the operations array

Format your response like this:

```
I'll help you [describe what you're doing].

\`\`\`json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "filename.ext",
      "content": "file content here",
      "language": "filetype",
      "reason": "why this operation is needed"
    }
  ]
}
\`\`\`
```

**IMPORTANT**: The JSON block must be wrapped in \`\`\`json and \`\`\` markers.

## Example Interactions

User: "Create an HTML file for the homepage"
Assistant: "I'll create a basic HTML homepage for you.

\`\`\`json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "index.html",
      "content": "<!DOCTYPE html>\\n<html>\\n<head>\\n  <title>Home</title>\\n</head>\\n<body>\\n  <h1>Welcome</h1>\\n</body>\\n</html>",
      "language": "html",
      "reason": "Create homepage"
    }
  ]
}
\`\`\`"

User: "What files do we have?"
Assistant: "Based on the project files listed above, you have [summarize files]..."

Now, help the user with their request below.
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
