"""
Intent Classifier - 意图识别引擎
基于LLM的意图识别，支持多轮对话上下文管理
"""
import os
import json
from typing import List, Dict, Any, Optional
import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from llm.llm_client import get_llm_client, BaseLLMClient


class IntentClassifier:
    """意图识别分类器"""

    def __init__(self):
        self._ready = False
        self._initialize()

    def _initialize(self):
        """初始化LLM客户端"""
        try:
            self.llm_client: BaseLLMClient = get_llm_client()
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
        context: Optional[List[str]] = None,
        project_type_hint: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        意图识别主方法

        Args:
            text: 用户输入文本
            context: 对话上下文（可选）
            project_type_hint: 项目类型提示（如果已知，跳过LLM识别）

        Returns:
            {
                "intent": "create_project",  # 意图类型
                "project_type": "web",       # 项目类型
                "entities": {...},           # 提取的实体
                "confidence": 0.95,          # 置信度
                "action": "generate_file"    # 动作类型
            }
        """
        # 快速路径1：如果项目类型已明确指定，使用规则识别
        if project_type_hint and project_type_hint in ["web", "document", "data", "app"]:
            print(f"Fast path: project_type already specified as {project_type_hint}")
            return self._quick_classify(text, project_type_hint)

        # 快速路径2：使用规则引擎快速识别明确的关键词
        quick_result = self._rule_based_classify(text)
        if quick_result and quick_result.get("confidence", 0) > 0.8:
            print(f"Fast path: rule-based classification with confidence {quick_result['confidence']}")
            return quick_result

        # 慢速路径：使用LLM进行复杂意图识别
        if not self._ready:
            print("Intent classifier not ready, using fallback intent.")
            return self._get_default_intent(text)

        # 构建Few-shot Prompt
        prompt = self._build_prompt(text, context)

        # 调用LLM（统一接口）
        try:
            messages = [
                {"role": "system", "content": "你是一个专业的意图识别助手，总是返回有效的JSON格式。"},
                {"role": "user", "content": prompt}
            ]

            response = await self.llm_client.chat(
                messages=messages,
                temperature=0.1,
                max_tokens=256
            )

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


    def _parse_response(self, response: str) -> Dict[str, Any]:
        """解析LLM返回的JSON"""
        try:
            # 尝试直接解析
            result = json.loads(response)

            # 如果LLM返回了数组而不是对象，取第一个元素
            if isinstance(result, list):
                if len(result) > 0:
                    result = result[0]
                else:
                    # 空数组，返回默认值
                    return self._get_default_intent("")

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

    def _quick_classify(self, text: str, project_type: str) -> Dict[str, Any]:
        """
        快速分类：项目类型已知，只提取实体

        Args:
            text: 用户输入文本
            project_type: 已知的项目类型

        Returns:
            意图识别结果
        """
        text_lower = text.lower()
        entities = {}

        # 根据项目类型提取特定实体
        if project_type == "web":
            # Web项目实体
            if any(kw in text_lower for kw in ["深色", "暗色", "dark"]):
                entities["theme"] = "dark"
            elif any(kw in text_lower for kw in ["浅色", "亮色", "light"]):
                entities["theme"] = "light"

            # 模板识别（优先级从高到低）
            if any(kw in text_lower for kw in ["画板", "绘图", "画画", "涂鸦", "画个", "绘画"]):
                entities["template"] = "drawing"
            elif any(kw in text_lower for kw in ["记账", "账本", "财务", "开支"]):
                entities["template"] = "expense"
            elif any(kw in text_lower for kw in ["计算器", "计算", "算数"]):
                entities["template"] = "calculator"
            elif any(kw in text_lower for kw in ["倒计时", "计时器", "timer", "秒表"]):
                entities["template"] = "timer"
            elif any(kw in text_lower for kw in ["番茄钟", "番茄", "pomodoro", "专注"]):
                entities["template"] = "pomodoro"
            elif any(kw in text_lower for kw in ["笔记", "记事", "note", "备忘"]):
                entities["template"] = "note"
            elif any(kw in text_lower for kw in ["音乐", "播放器", "player", "音频", "音乐播放"]):
                entities["template"] = "music"
            elif any(kw in text_lower for kw in ["视频", "video", "视频播放"]):
                entities["template"] = "video"
            elif any(kw in text_lower for kw in ["日历", "calendar", "日程"]):
                entities["template"] = "calendar"
            elif any(kw in text_lower for kw in ["天气", "weather", "天气预报"]):
                entities["template"] = "weather"
            elif any(kw in text_lower for kw in ["相册", "照片", "图片", "gallery"]):
                entities["template"] = "gallery"
            elif any(kw in text_lower for kw in ["登录", "登陆", "signin", "login"]):
                entities["template"] = "login"
            elif any(kw in text_lower for kw in ["问卷", "调查", "表单", "survey"]):
                entities["template"] = "survey"
            elif any(kw in text_lower for kw in ["待办", "todo", "任务", "清单"]):
                entities["template"] = "todo"
            elif any(kw in text_lower for kw in ["博客", "blog"]):
                entities["template"] = "blog"
            elif any(kw in text_lower for kw in ["作品集", "portfolio"]):
                entities["template"] = "portfolio"
            # 新增8个模板
            elif any(kw in text_lower for kw in ["看板", "kanban", "任务板", "项目板"]):
                entities["template"] = "kanban"
            elif any(kw in text_lower for kw in ["聊天", "chat", "对话", "消息"]):
                entities["template"] = "chat"
            elif any(kw in text_lower for kw in ["颜色选择", "调色板", "color picker", "取色器"]):
                entities["template"] = "colorpicker"
            elif any(kw in text_lower for kw in ["贪吃蛇", "snake", "蛇游戏"]):
                entities["template"] = "snake"
            elif any(kw in text_lower for kw in ["记忆卡片", "记忆游戏", "memory game", "翻卡片"]):
                entities["template"] = "memory"
            elif any(kw in text_lower for kw in ["问答", "quiz", "测验", "答题"]):
                entities["template"] = "quiz"
            elif any(kw in text_lower for kw in ["打字测试", "打字", "typing test", "打字速度"]):
                entities["template"] = "typing"
            elif any(kw in text_lower for kw in ["单位转换", "转换器", "converter", "单位换算"]):
                entities["template"] = "converter"

        elif project_type == "document":
            # 文档项目实体 - PPT优先级最高（必须先检查）
            if any(kw in text_lower for kw in ["ppt", "演示文稿", "幻灯片", "powerpoint", "slides", "发布会"]):
                entities["doc_type"] = "presentation"
                entities["format"] = "ppt"
            elif any(kw in text_lower for kw in ["演示", "展示", "汇报", "讲解"]) and not any(kw in text_lower for kw in ["报告", "简历"]):
                # 如果提到演示相关但没有明确说报告/简历，生成PPT
                entities["doc_type"] = "presentation"
                entities["format"] = "ppt"
            elif any(kw in text_lower for kw in ["报告", "report"]):
                entities["doc_type"] = "report"
                entities["format"] = "word"
            elif any(kw in text_lower for kw in ["简历", "resume"]):
                entities["doc_type"] = "resume"
                entities["format"] = "word"
            elif any(kw in text_lower for kw in ["word", "文档", "docx", "doc"]):
                entities["doc_type"] = "document"
                entities["format"] = "word"
            elif any(kw in text_lower for kw in ["pdf"]):
                entities["doc_type"] = "document"
                entities["format"] = "pdf"
            else:
                # 默认生成Word文档
                entities["doc_type"] = "document"
                entities["format"] = "word"

        elif project_type == "data":
            # 数据项目实体
            if any(kw in text_lower for kw in ["可视化", "图表", "chart"]):
                entities["task"] = "visualization"
            elif any(kw in text_lower for kw in ["分析", "analysis"]):
                entities["task"] = "analysis"

        return {
            "intent": "create_project",
            "project_type": project_type,
            "entities": entities,
            "confidence": 0.95,
            "action": "generate_file",
            "fast_path": True
        }

    def _rule_based_classify(self, text: str) -> Optional[Dict[str, Any]]:
        """
        基于规则的快速分类（用于明确的关键词）

        Args:
            text: 用户输入文本

        Returns:
            如果能高置信度识别则返回结果，否则返回None
        """
        text_lower = text.lower()

        # 定义高置信度的关键词模式
        high_confidence_patterns = {
            "web": [
                # 基础网页
                (["网站", "网页", "html页面"], 0.95),
                (["博客", "个人博客", "技术博客"], 0.90),
                (["作品集", "个人网站", "portfolio"], 0.90),

                # 工具类应用
                (["待办事项", "todo", "任务管理", "清单"], 0.90),
                (["记账", "账本", "财务管理"], 0.90),
                (["计算器", "在线计算"], 0.90),
                (["倒计时", "计时器", "timer"], 0.90),
                (["日历", "日程", "calendar"], 0.90),

                # 创意类
                (["画板", "绘图", "画画", "涂鸦"], 0.90),
                (["相册", "图片展示", "照片墙"], 0.90),
                (["音乐播放器", "播放器"], 0.85),

                # 商业类
                (["登录页", "注册页", "登陆"], 0.90),
                (["电商", "商城", "购物"], 0.85),
                (["预约", "预订", "booking"], 0.85),

                # 信息类
                (["简历", "cv", "resume"], 0.90),
                (["名片", "个人介绍"], 0.90),
                (["FAQ", "常见问题", "帮助中心"], 0.85),

                # 娱乐类
                (["游戏", "小游戏"], 0.80),
                (["问卷", "调查", "表单"], 0.85),

                # 新增8个模板
                (["看板", "任务板", "kanban"], 0.90),
                (["聊天", "对话界面", "chat"], 0.85),
                (["颜色选择器", "调色板", "取色器"], 0.85),
                (["贪吃蛇", "蛇游戏", "snake"], 0.85),
                (["记忆卡片", "记忆游戏", "翻卡片"], 0.85),
                (["问答", "测验", "quiz"], 0.85),
                (["打字测试", "打字速度", "typing"], 0.85),
                (["单位转换", "转换器", "converter"], 0.85)
            ],
            "document": [
                (["工作报告", "月报", "周报", "总结"], 0.95),
                (["个人简历", "求职简历", "CV"], 0.95),
                (["PPT", "演示文稿", "幻灯片", "slides", "powerpoint", "演示", "发布会"], 0.95),
                (["项目提案", "商业计划", "方案"], 0.90),
                (["会议纪要", "会议记录"], 0.90),
                (["合同", "协议"], 0.85)
            ],
            "data": [
                (["数据分析", "数据可视化"], 0.95),
                (["excel", "csv", "数据表"], 0.90),
                (["图表", "可视化", "chart"], 0.90),
                (["统计", "报表"], 0.85),
                (["看板", "dashboard", "仪表盘"], 0.85)
            ]
        }

        # 检查每个模式
        for project_type, patterns in high_confidence_patterns.items():
            for keywords, confidence in patterns:
                if any(kw in text_lower for kw in keywords):
                    return self._quick_classify(text, project_type)

        # 如果没有高置信度匹配，返回None
        return None

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
