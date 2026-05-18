"""
代码重构器
使用LLM重构代码以提高质量
"""
import logging
from typing import Dict, Any, Optional
from src.llm.llm_client import get_llm_client

logger = logging.getLogger(__name__)


class CodeRefactorer:
    """AI代码重构器"""

    def __init__(self):
        """初始化代码重构器"""
        self.llm_client = get_llm_client()

    async def refactor(
        self,
        code: str,
        language: str,
        refactor_type: str = "general",
        target: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        重构代码

        Args:
            code: 要重构的代码
            language: 编程语言
            refactor_type: 重构类型
                - general: 通用优化
                - extract_function: 提取函数
                - rename_variables: 重命名变量
                - simplify: 简化逻辑
                - optimize: 性能优化
                - modernize: 现代化改造
                - add_types: 添加类型注解
            target: 重构目标（可选，如函数名等）

        Returns:
            包含重构后代码的字典
        """
        try:
            # 构建提示词
            prompt = self._build_refactor_prompt(
                code, language, refactor_type, target
            )

            # 调用LLM进行重构
            response = await self.llm_client.generate(
                prompt,
                temperature=0.2,
                max_tokens=2000
            )

            # 提取重构后的代码
            refactored_code = self._extract_code(response)

            # 提取变更说明
            explanation = self._extract_explanation(response)

            return {
                "original_code": code,
                "refactored_code": refactored_code,
                "refactor_type": refactor_type,
                "explanation": explanation,
                "language": language
            }

        except Exception as e:
            logger.error(f"代码重构失败: {e}")
            return {
                "error": str(e),
                "refactored_code": None
            }

    def _build_refactor_prompt(
        self,
        code: str,
        language: str,
        refactor_type: str,
        target: Optional[str]
    ) -> str:
        """构建重构提示词"""

        refactor_instructions = {
            "general": "进行通用代码优化，提高可读性和可维护性",
            "extract_function": f"提取代码中的重复逻辑为独立函数{f'（特别是{target}相关）' if target else ''}",
            "rename_variables": "重命名变量，使用更具描述性的名称",
            "simplify": "简化复杂的逻辑，减少嵌套层次",
            "optimize": "优化代码性能，改进算法和数据结构",
            "modernize": f"使用{language}的现代特性改造代码",
            "add_types": "添加类型注解，提高类型安全性"
        }

        instruction = refactor_instructions.get(refactor_type, "重构代码")

        prompt = f"""你是一个专业的{language}重构专家。请对以下代码进行重构。

原始代码：
```{language}
{code}
```

重构任务：{instruction}

要求：
- 保持原有功能不变
- 提高代码质量
- 遵循{language}最佳实践
- 添加必要的注释说明变更
- 确保代码可读性和可维护性

请按以下格式输出：

【变更说明】
简要说明进行了哪些改动和原因

【重构后代码】
```{language}
重构后的代码
```

请开始重构："""

        return prompt

    def _extract_code(self, response: str) -> str:
        """从响应中提取代码"""
        lines = response.split('\n')
        code_lines = []
        in_code_block = False
        found_refactored = False

        for line in lines:
            # 检查是否进入重构后代码段
            if "重构后" in line or "Refactored" in line:
                found_refactored = True
                continue

            if found_refactored:
                if line.strip().startswith('```'):
                    in_code_block = not in_code_block
                    continue

                if in_code_block:
                    code_lines.append(line)

        if code_lines:
            return '\n'.join(code_lines)
        else:
            # 如果没有找到特定格式，尝试提取所有代码块
            return self._extract_any_code(response)

    def _extract_any_code(self, response: str) -> str:
        """提取任意代码块"""
        lines = response.split('\n')
        code_lines = []
        in_code_block = False

        for line in lines:
            if line.strip().startswith('```'):
                in_code_block = not in_code_block
                continue

            if in_code_block:
                code_lines.append(line)

        return '\n'.join(code_lines) if code_lines else response.strip()

    def _extract_explanation(self, response: str) -> str:
        """提取变更说明"""
        lines = response.split('\n')
        explanation_lines = []
        in_explanation = False

        for line in lines:
            if "变更说明" in line or "Explanation" in line or "【变更" in line:
                in_explanation = True
                continue

            if in_explanation:
                # 遇到代码块或新section则结束
                if line.strip().startswith('```') or line.startswith('【'):
                    break

                if line.strip():
                    explanation_lines.append(line.strip())

        return '\n'.join(explanation_lines) if explanation_lines else "代码已重构"

    async def explain(self, code: str, language: str) -> str:
        """
        解释代码功能

        Args:
            code: 代码
            language: 编程语言

        Returns:
            代码解释
        """
        try:
            prompt = f"""请详细解释以下{language}代码的功能和工作原理：

```{language}
{code}
```

要求：
- 解释主要功能
- 说明关键逻辑
- 指出可能的注意事项
- 使用通俗易懂的语言

请开始解释："""

            response = await self.llm_client.generate(
                prompt,
                temperature=0.5,
                max_tokens=1000
            )

            return response.strip()

        except Exception as e:
            logger.error(f"代码解释失败: {e}")
            return f"解释失败: {e}"

    async def optimize(self, code: str, language: str) -> Dict[str, Any]:
        """
        性能优化

        Args:
            code: 代码
            language: 编程语言

        Returns:
            优化结果
        """
        return await self.refactor(code, language, refactor_type="optimize")

    async def fix_bug(self, code: str, language: str, bug_description: Optional[str] = None) -> Dict[str, Any]:
        """
        修复Bug

        Args:
            code: 有bug的代码
            language: 编程语言
            bug_description: Bug描述

        Returns:
            修复后的代码
        """
        try:
            bug_info = f"\nBug描述：{bug_description}" if bug_description else ""

            prompt = f"""你是一个专业的{language}调试专家。请分析并修复以下代码中的bug。

代码：
```{language}
{code}
```
{bug_info}

请找出问题并提供修复后的代码。

格式：
【问题分析】
说明发现的问题

【修复后代码】
```{language}
修复后的代码
```

请开始分析："""

            response = await self.llm_client.generate(
                prompt,
                temperature=0.2,
                max_tokens=2000
            )

            fixed_code = self._extract_code(response)
            analysis = self._extract_bug_analysis(response)

            return {
                "original_code": code,
                "fixed_code": fixed_code,
                "bug_analysis": analysis,
                "language": language
            }

        except Exception as e:
            logger.error(f"Bug修复失败: {e}")
            return {
                "error": str(e),
                "fixed_code": None
            }

    def _extract_bug_analysis(self, response: str) -> str:
        """提取Bug分析"""
        lines = response.split('\n')
        analysis_lines = []
        in_analysis = False

        for line in lines:
            if "问题分析" in line or "Analysis" in line:
                in_analysis = True
                continue

            if in_analysis:
                if line.strip().startswith('```') or line.startswith('【'):
                    break

                if line.strip():
                    analysis_lines.append(line.strip())

        return '\n'.join(analysis_lines) if analysis_lines else "已分析问题"
