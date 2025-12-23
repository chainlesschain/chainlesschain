"""
AI提交消息生成器
使用LLM分析Git差异并生成符合Conventional Commits规范的提交消息
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from git import Repo
except ImportError:
    logger.warning("GitPython未安装")


async def generate_commit_message(repo, staged_files: Optional[list] = None, diff_content: Optional[str] = None):
    """
    生成Git提交消息

    Args:
        repo: Git仓库对象或仓库路径
        staged_files: 暂存的文件列表
        diff_content: 差异内容（如果已提供）

    Returns:
        生成的提交消息
    """
    try:
        # 如果repo是字符串路径，转换为Repo对象
        if isinstance(repo, str):
            repo = Repo(repo)

        # 获取差异内容
        if diff_content is None:
            try:
                diff_content = repo.git.diff("--cached")
                if not diff_content:
                    diff_content = repo.git.diff()
            except Exception as e:
                logger.warning(f"获取diff内容失败: {e}")
                diff_content = ""

        # 获取暂存的文件
        if staged_files is None:
            try:
                staged_files = [item.a_path for item in repo.index.diff("HEAD")]
            except Exception:
                staged_files = []

        # 使用LLM生成提交消息
        from src.llm.llm_client import get_llm_client

        llm_client = get_llm_client()

        # 构建提示词
        prompt = build_commit_message_prompt(diff_content, staged_files)

        # 调用LLM
        response = await llm_client.generate(prompt, temperature=0.3, max_tokens=200)

        # 提取提交消息
        commit_message = extract_commit_message(response)

        logger.info(f"生成的提交消息: {commit_message}")

        return commit_message

    except Exception as e:
        logger.error(f"生成提交消息失败: {e}")
        # 返回默认消息
        return "Update files"


def build_commit_message_prompt(diff_content: str, staged_files: list) -> str:
    """
    构建提交消息生成提示词

    Args:
        diff_content: 差异内容
        staged_files: 暂存文件列表

    Returns:
        提示词字符串
    """
    # 限制diff长度以避免超过token限制
    max_diff_length = 3000
    if len(diff_content) > max_diff_length:
        diff_content = diff_content[:max_diff_length] + "\n... (diff truncated)"

    prompt = f"""你是一个专业的Git提交消息生成助手。请根据以下Git差异生成一个符合Conventional Commits规范的提交消息。

Conventional Commits格式：
<type>(<scope>): <subject>

类型（type）：
- feat: 新功能
- fix: 修复bug
- docs: 文档更新
- style: 代码格式（不影响代码运行）
- refactor: 重构
- perf: 性能优化
- test: 测试相关
- chore: 构建过程或辅助工具的变动

暂存的文件：
{', '.join(staged_files) if staged_files else '无'}

差异内容：
```diff
{diff_content if diff_content else '无明显差异'}
```

要求：
1. 提交消息必须简洁明了，不超过50个字符
2. 使用中文
3. 只输出提交消息本身，不要有任何其他说明
4. 如果涉及多个模块，选择主要的模块作为scope

示例：
- feat(auth): 添加用户登录功能
- fix(api): 修复数据返回格式错误
- docs: 更新README文档
- refactor(ui): 重构组件代码结构

请直接输出提交消息："""

    return prompt


def extract_commit_message(response: str) -> str:
    """
    从LLM响应中提取提交消息

    Args:
        response: LLM响应

    Returns:
        提取的提交消息
    """
    # 移除可能的引号和多余空白
    message = response.strip().strip('"').strip("'")

    # 只取第一行
    message = message.split('\n')[0]

    # 限制长度
    if len(message) > 100:
        message = message[:100]

    # 如果为空，返回默认消息
    if not message:
        message = "Update files"

    return message
