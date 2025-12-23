"""
代码审查器
使用LLM分析代码并提供改进建议
"""
import logging
from typing import Dict, Any, List, Optional
from src.llm.llm_client import get_llm_client

logger = logging.getLogger(__name__)


class CodeReviewer:
    """AI代码审查器"""

    def __init__(self):
        """初始化代码审查器"""
        self.llm_client = get_llm_client()

    async def review(
        self,
        code: str,
        language: str,
        focus_areas: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        审查代码

        Args:
            code: 要审查的代码
            language: 编程语言
            focus_areas: 关注领域 (security, performance, style, maintainability)

        Returns:
            包含审查结果的字典
        """
        try:
            # 构建提示词
            prompt = self._build_review_prompt(code, language, focus_areas)

            # 调用LLM进行审查
            response = await self.llm_client.generate(
                prompt,
                temperature=0.3,
                max_tokens=2000
            )

            # 解析审查结果
            result = self._parse_review_result(response)

            return result

        except Exception as e:
            logger.error(f"代码审查失败: {e}")
            return {
                "error": str(e),
                "score": 0,
                "suggestions": []
            }

    def _build_review_prompt(
        self,
        code: str,
        language: str,
        focus_areas: Optional[List[str]]
    ) -> str:
        """构建代码审查提示词"""

        areas_text = ""
        if focus_areas:
            areas_map = {
                "security": "安全性（SQL注入、XSS、命令注入等）",
                "performance": "性能优化（算法效率、资源使用）",
                "style": "代码风格（命名规范、格式）",
                "maintainability": "可维护性（模块化、可读性）",
                "best_practices": "最佳实践"
            }
            areas_text = "重点关注：\n" + "\n".join(
                f"- {areas_map.get(area, area)}"
                for area in focus_areas
            )
        else:
            areas_text = "全面审查所有方面"

        prompt = f"""你是一个资深的{language}代码审查专家。请对以下代码进行专业审查。

代码：
```{language}
{code}
```

{areas_text}

请按以下格式输出审查结果：

【评分】（1-10分）
评分：X分

【主要问题】
1. [优先级] 问题描述
   建议：改进方案

【优点】
- 优点1
- 优点2

【改进代码】（如有必要）
```{language}
改进后的代码
```

请开始审查："""

        return prompt

    def _parse_review_result(self, response: str) -> Dict[str, Any]:
        """解析审查结果"""
        # 提取评分
        score = self._extract_score(response)

        # 提取建议
        suggestions = self._extract_suggestions(response)

        # 提取改进代码
        improved_code = self._extract_improved_code(response)

        return {
            "score": score,
            "suggestions": suggestions,
            "improved_code": improved_code,
            "raw_review": response
        }

    def _extract_score(self, response: str) -> int:
        """提取评分"""
        import re

        # 查找评分模式
        patterns = [
            r'评分[：:]\s*(\d+)',
            r'(\d+)\s*分',
            r'Score[：:]\s*(\d+)'
        ]

        for pattern in patterns:
            match = re.search(pattern, response)
            if match:
                score = int(match.group(1))
                return min(max(score, 1), 10)  # 限制在1-10范围

        return 5  # 默认评分

    def _extract_suggestions(self, response: str) -> List[Dict[str, str]]:
        """提取改进建议"""
        suggestions = []
        lines = response.split('\n')

        current_suggestion = None
        for line in lines:
            line = line.strip()

            # 匹配建议项
            if line and (line[0].isdigit() or line.startswith('-')):
                if current_suggestion:
                    suggestions.append(current_suggestion)

                # 提取优先级和问题
                priority = "medium"
                if "[高" in line or "[High" in line or "[critical" in line.lower():
                    priority = "high"
                elif "[低" in line or "[Low" in line:
                    priority = "low"

                current_suggestion = {
                    "priority": priority,
                    "issue": line,
                    "advice": ""
                }

            # 匹配建议内容
            elif current_suggestion and ("建议" in line or "Advice" in line):
                current_suggestion["advice"] = line

        if current_suggestion:
            suggestions.append(current_suggestion)

        return suggestions

    def _extract_improved_code(self, response: str) -> Optional[str]:
        """提取改进后的代码"""
        lines = response.split('\n')
        code_lines = []
        in_code_block = False
        in_improved_section = False

        for i, line in enumerate(lines):
            # 检查是否进入改进代码段
            if "改进代码" in line or "Improved" in line:
                in_improved_section = True
                continue

            if in_improved_section:
                if line.strip().startswith('```'):
                    in_code_block = not in_code_block
                    continue

                if in_code_block:
                    code_lines.append(line)

                # 如果遇到新的section标题，结束
                if line.startswith('【') or line.startswith('##'):
                    break

        if code_lines:
            return '\n'.join(code_lines)
        else:
            return None
