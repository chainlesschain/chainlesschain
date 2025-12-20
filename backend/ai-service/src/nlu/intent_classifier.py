"""
Intent Classifier - 意图识别引擎
基于LLM的意图识别，支持多轮对话上下文管理
"""
import os
import json
from typing import List, Dict, Any, Optional
import ollama
from openai import AsyncOpenAI


class IntentClassifier:
    """意图识别分类器"""

    def __init__(self):
        self.llm_provider = os.getenv("LLM_PROVIDER", "ollama")
        self.model_name = os.getenv("LLM_MODEL", "qwen2:7b")
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        self.openai_base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

        if self.llm_provider == "openai" and self.openai_api_key:
            self.client = AsyncOpenAI(api_key=self.openai_api_key, base_url=self.openai_base_url)
        else:
            self.client = None  # 使用ollama时不需要async client

        self._ready = False
        self._initialize()

    def _initialize(self):
        """初始化检查"""
        try:
            if self.llm_provider == "ollama":
                # 检查Ollama是否可用
                try:
                    ollama.list()
                    self._ready = True
                except Exception as e:
                    print(f"Ollama not ready: {e}")
                    self._ready = False
            else:
                # OpenAI API 默认认为可用
                self._ready = True
        except Exception as e:
            print(f"Intent classifier initialization error: {e}")
            self._ready = False

    def is_ready(self) -> bool:
        """检查引擎是否就绪"""
        return self._ready

    async def classify(
        self,
        text: str,
        context: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        意图识别主方法

        Args:
            text: 用户输入文本
            context: 对话上下文（可选）

        Returns:
            {
                "intent": "create_project",  # 意图类型
                "project_type": "web",       # 项目类型
                "entities": {...},           # 提取的实体
                "confidence": 0.95,          # 置信度
                "action": "generate_file"    # 动作类型
            }
        """
        if not self._ready:
            raise Exception("Intent classifier not ready")

        # 构建Few-shot Prompt
        prompt = self._build_prompt(text, context)

        # 调用LLM
        try:
            if self.llm_provider == "ollama":
                response = await self._call_ollama(prompt)
            else:
                response = await self._call_openai(prompt)

            # 解析LLM返回的JSON
            result = self._parse_response(response)
            return result

        except Exception as e:
            print(f"Intent classification error: {e}")
            # 返回默认意图
            return self._get_default_intent(text)

    def _build_prompt(self, text: str, context: Optional[List[str]] = None) -> str:
        """构建Few-shot提示词"""

        # Few-shot示例
        examples = """
示例1：
用户: "帮我生成一个博客网站，要有深色主题"
输出: {"intent": "create_project", "project_type": "web", "entities": {"theme": "dark", "template": "blog"}, "confidence": 0.95, "action": "generate_file"}

示例2：
用户: "生成一份本月工作报告，包含业绩数据图表"
输出: {"intent": "create_project", "project_type": "document", "entities": {"doc_type": "report", "period": "month", "include_chart": true}, "confidence": 0.92, "action": "generate_file"}

示例3：
用户: "分析这个销售数据Excel，生成可视化图表"
输出: {"intent": "create_project", "project_type": "data", "entities": {"data_source": "sales_excel", "task": "visualization"}, "confidence": 0.90, "action": "analyze_and_visualize"}

示例4：
用户: "修改项目的背景色为蓝色"
输出: {"intent": "modify_project", "project_type": "web", "entities": {"property": "background_color", "value": "blue"}, "confidence": 0.88, "action": "update_file"}

示例5：
用户: "给我看看这个项目有哪些文件"
输出: {"intent": "query_project", "project_type": "unknown", "entities": {"query_type": "list_files"}, "confidence": 0.85, "action": "query_info"}
"""

        # 上下文信息
        context_str = ""
        if context and len(context) > 0:
            context_str = f"\n对话上下文:\n" + "\n".join([f"- {c}" for c in context[-3:]])  # 只保留最近3轮

        # 完整提示词
        full_prompt = f"""你是一个意图识别专家。根据用户输入，识别其意图并提取关键实体。

意图类型:
- create_project: 创建新项目
- modify_project: 修改现有项目
- query_project: 查询项目信息
- delete_project: 删除项目

项目类型:
- web: 网页/网站项目
- document: 文档项目 (Word, PDF)
- data: 数据分析项目 (Excel, CSV, 可视化)
- app: 应用程序
- unknown: 未知类型

动作类型:
- generate_file: 生成文件
- update_file: 更新文件
- analyze_and_visualize: 分析并可视化
- query_info: 查询信息

{examples}
{context_str}

现在请分析以下用户输入:
用户: "{text}"

请严格按照JSON格式输出，只返回JSON对象，不要有其他文字:
{{"intent": "...", "project_type": "...", "entities": {{}}, "confidence": 0.0, "action": "..."}}
"""
        return full_prompt

    async def _call_ollama(self, prompt: str) -> str:
        """调用Ollama API"""
        try:
            response = ollama.chat(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "你是一个专业的意图识别助手，总是返回有效的JSON格式。"},
                    {"role": "user", "content": prompt}
                ],
                options={
                    "temperature": 0.1,  # 低温度保证输出稳定
                    "num_predict": 256
                }
            )
            return response['message']['content']
        except Exception as e:
            print(f"Ollama call error: {e}")
            raise

    async def _call_openai(self, prompt: str) -> str:
        """调用OpenAI API"""
        try:
            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "你是一个专业的意图识别助手，总是返回有效的JSON格式。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=256
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"OpenAI call error: {e}")
            raise

    def _parse_response(self, response: str) -> Dict[str, Any]:
        """解析LLM返回的JSON"""
        try:
            # 尝试直接解析
            result = json.loads(response)

            # 验证必需字段
            required_fields = ["intent", "project_type", "entities", "confidence", "action"]
            for field in required_fields:
                if field not in result:
                    result[field] = self._get_default_value(field)

            return result

        except json.JSONDecodeError:
            # 如果解析失败，尝试提取JSON部分
            try:
                # 查找第一个 { 和最后一个 }
                start = response.find("{")
                end = response.rfind("}") + 1
                if start >= 0 and end > start:
                    json_str = response[start:end]
                    result = json.loads(json_str)
                    return result
            except Exception as e:
                print(f"JSON parse error: {e}")

            # 完全失败，返回默认结果
            return {
                "intent": "create_project",
                "project_type": "unknown",
                "entities": {},
                "confidence": 0.5,
                "action": "generate_file",
                "error": "Failed to parse LLM response"
            }

    def _get_default_value(self, field: str) -> Any:
        """获取字段默认值"""
        defaults = {
            "intent": "create_project",
            "project_type": "unknown",
            "entities": {},
            "confidence": 0.5,
            "action": "generate_file"
        }
        return defaults.get(field, None)

    def _get_default_intent(self, text: str) -> Dict[str, Any]:
        """基于规则的默认意图识别（降级方案）"""
        text_lower = text.lower()

        # 简单的关键词匹配
        result = {
            "intent": "create_project",
            "project_type": "unknown",
            "entities": {},
            "confidence": 0.5,
            "action": "generate_file"
        }

        # 识别项目类型
        if any(kw in text_lower for kw in ["网站", "网页", "html", "web", "博客", "作品集"]):
            result["project_type"] = "web"
        elif any(kw in text_lower for kw in ["文档", "报告", "word", "pdf", "简历", "提案"]):
            result["project_type"] = "document"
        elif any(kw in text_lower for kw in ["数据", "excel", "csv", "图表", "分析", "可视化"]):
            result["project_type"] = "data"

        # 识别动作
        if any(kw in text_lower for kw in ["修改", "更新", "改"]):
            result["intent"] = "modify_project"
            result["action"] = "update_file"
        elif any(kw in text_lower for kw in ["查看", "显示", "看", "列出"]):
            result["intent"] = "query_project"
            result["action"] = "query_info"
        elif any(kw in text_lower for kw in ["删除", "移除"]):
            result["intent"] = "delete_project"
            result["action"] = "delete_file"

        return result
