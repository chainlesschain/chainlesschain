"""
代码生成器
使用LLM根据描述生成代码
"""
import logging
from typing import Dict, Any, Optional
from src.llm.llm_client import get_llm_client

logger = logging.getLogger(__name__)


class CodeGenerator:
    """AI代码生成器"""

    def __init__(self):
        """初始化代码生成器"""
        self.llm_client = get_llm_client()

    async def generate(
        self,
        description: str,
        language: str,
        style: str = "modern",
        include_tests: bool = False,
        include_comments: bool = True,
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        生成代码

        Args:
            description: 功能描述
            language: 编程语言
            style: 编码风格 (modern, classic, functional)
            include_tests: 是否包含测试
            include_comments: 是否包含注释
            context: 上下文信息（可选）

        Returns:
            包含生成代码的字典
        """
        try:
            # 构建提示词
            prompt = self._build_prompt(
                description, language, style,
                include_tests, include_comments, context
            )

            # 调用LLM生成
            response = await self.llm_client.generate(
                prompt,
                temperature=0.2,  # 较低温度保证代码质量
                max_tokens=2000
            )

            # 提取代码
            code = self._extract_code(response)

            result = {
                "code": code,
                "language": language,
                "description": description
            }

            # 如果需要测试，生成测试代码
            if include_tests:
                test_code = await self._generate_tests(code, language)
                result["tests"] = test_code

            return result

        except Exception as e:
            logger.error(f"代码生成失败: {e}")
            return {
                "error": str(e),
                "code": None
            }

    def _build_prompt(
        self,
        description: str,
        language: str,
        style: str,
        include_tests: bool,
        include_comments: bool,
        context: Optional[str]
    ) -> str:
        """构建代码生成提示词"""

        style_desc = {
            "modern": "现代化、简洁的风格",
            "classic": "传统、稳健的风格",
            "functional": "函数式编程风格"
        }.get(style, "现代化风格")

        prompt = f"""你是一个专业的{language}开发者。请根据以下需求生成代码。

需求描述：
{description}

要求：
- 使用{language}编程语言
- 采用{style_desc}
- {'包含详细注释' if include_comments else '简洁无注释'}
- 遵循{language}最佳实践和设计模式
- 代码应该清晰、可维护、高效
- 考虑错误处理和边界情况
"""

        if context:
            prompt += f"\n上下文信息：\n{context}\n"

        if include_tests:
            prompt += "\n同时生成对应的单元测试代码。\n"

        prompt += f"\n请直接输出{language}代码，用```{language}代码块包裹："

        return prompt

    def _extract_code(self, response: str) -> str:
        """从LLM响应中提取代码"""
        # 提取代码块
        lines = response.split('\n')
        code_lines = []
        in_code_block = False

        for line in lines:
            if line.strip().startswith('```'):
                in_code_block = not in_code_block
                continue

            if in_code_block:
                code_lines.append(line)

        if code_lines:
            return '\n'.join(code_lines)
        else:
            # 如果没有代码块，返回整个响应
            return response.strip()

    async def _generate_tests(self, code: str, language: str) -> str:
        """生成测试代码"""
        try:
            test_prompt = f"""为以下{language}代码生成完整的单元测试：

```{language}
{code}
```

要求：
- 覆盖主要功能和边界情况
- 使用{language}常用的测试框架
- 测试代码清晰易懂

请直接输出测试代码："""

            response = await self.llm_client.generate(
                test_prompt,
                temperature=0.2,
                max_tokens=1500
            )

            return self._extract_code(response)

        except Exception as e:
            logger.error(f"生成测试失败: {e}")
            return f"# 测试生成失败: {e}"
