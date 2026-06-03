"""
Web Engine - 网页生成引擎
生成HTML/CSS/JavaScript文件
"""
import os
import json
from typing import Dict, Any, Optional, AsyncGenerator
from jinja2 import Environment, FileSystemLoader, select_autoescape
import ollama
from openai import AsyncOpenAI
from src.llm.llm_client import get_llm_client
from src.templates.web_templates import get_template, has_template
from src.utils.stream_utils import (
    stream_ollama_chat,
    stream_openai_chat,
    stream_custom_llm_chat,
    merge_stream_content
)


class WebEngine:
    """Web开发引擎"""

    def __init__(self):
        self.llm_provider = os.getenv("LLM_PROVIDER", "dashscope")
        self.model_name = os.getenv("LLM_MODEL", "qwen-turbo")
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        self.openai_base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

        # 模板引擎
        template_dir = os.path.join(os.path.dirname(__file__), "..", "templates", "web")
        os.makedirs(template_dir, exist_ok=True)

        self.jinja_env = Environment(
            loader=FileSystemLoader(template_dir),
            autoescape=select_autoescape(['html', 'xml'])
        )

        self.client = None
        self.llm_client = None
        self._ready = True

        if self.llm_provider == "openai":
            if self.openai_api_key:
                self.client = AsyncOpenAI(api_key=self.openai_api_key, base_url=self.openai_base_url)
            else:
                self._ready = False
        elif self.llm_provider != "ollama":
            try:
                self.llm_client = get_llm_client()
            except Exception as e:
                print(f"LLM client initialization error: {e}")
                self._ready = False

    def is_ready(self) -> bool:
        """检查引擎是否就绪"""
        return self._ready

    async def generate(
        self,
        prompt: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        生成Web项目文件

        Args:
            prompt: 用户需求描述
            context: 意图识别结果（包含项目类型、实体等）

        Returns:
            {
                "files": [
                    {"path": "index.html", "content": "..."},
                    {"path": "styles.css", "content": "..."},
                    {"path": "script.js", "content": "..."}
                ],
                "metadata": {...}
            }
        """
        if not self._ready:
            raise Exception("Web engine not ready")

        try:
            # 提取上下文信息
            # 防御性编程：确保context是字典而不是列表
            if isinstance(context, list):
                context = context[0] if len(context) > 0 else {}
            entities = context.get("entities", {}) if context else {}
            template_type = entities.get("template", "basic")
            theme = entities.get("theme", "light")

            # 快速路径：如果请求了预定义模板，直接返回
            if has_template(template_type):
                print(f"Fast path: Using predefined template '{template_type}'")
                template_files = get_template(template_type)
                files = [
                    {
                        "path": "index.html",
                        "content": template_files["index.html"],
                        "language": "html"
                    },
                    {
                        "path": "styles.css",
                        "content": template_files["styles.css"],
                        "language": "css"
                    },
                    {
                        "path": "script.js",
                        "content": template_files["script.js"],
                        "language": "javascript"
                    }
                ]
                return {
                    "files": files,
                    "metadata": {
                        "template": template_type,
                        "theme": theme,
                        "source": "predefined_template"
                    }
                }

            # 慢速路径：使用LLM生成
            print(f"Slow path: Generating with LLM for template '{template_type}'")

            # 生成项目规格说明
            spec = await self._generate_spec(prompt, entities)

            # 生成HTML
            html_content = await self._generate_html(spec, theme)

            # 生成CSS
            css_content = await self._generate_css(spec, theme)

            # 生成JavaScript
            js_content = await self._generate_js(spec)

            # 组装文件列表
            files = [
                {
                    "path": "index.html",
                    "content": html_content,
                    "language": "html"
                },
                {
                    "path": "styles.css",
                    "content": css_content,
                    "language": "css"
                },
                {
                    "path": "script.js",
                    "content": js_content,
                    "language": "javascript"
                }
            ]

            return {
                "files": files,
                "metadata": {
                    "template": template_type,
                    "theme": theme,
                    "spec": spec,
                    "source": "llm_generated"
                }
            }

        except Exception as e:
            print(f"Web generation error: {e}")
            raise

    async def _generate_spec(self, prompt: str, entities: Dict[str, Any]) -> Dict[str, Any]:
        """生成项目规格说明"""

        spec_prompt = f"""根据用户需求，生成Web项目规格说明。

用户需求: {prompt}
提取的实体: {json.dumps(entities, ensure_ascii=False)}

请生成包含以下信息的JSON规格说明:
{{
    "title": "项目标题",
    "description": "项目描述",
    "sections": ["首页", "关于", "联系"],
    "features": ["响应式设计", "深色模式"],
    "color_scheme": {{"primary": "#3498db", "secondary": "#2ecc71"}},
    "fonts": ["Arial", "sans-serif"],
    "layout": "single-page"
}}

只返回JSON，不要其他文字:
"""

        try:
            if self.llm_provider == "ollama":
                response = ollama.chat(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是Web项目规格专家，总是返回有效的JSON。"},
                        {"role": "user", "content": spec_prompt}
                    ],
                    options={"temperature": 0.3}
                )
                content = response['message']['content']
            elif self.client is not None:
                response = await self.client.chat.completions.create(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是Web项目规格专家，总是返回有效的JSON。"},
                        {"role": "user", "content": spec_prompt}
                    ],
                    temperature=0.3
                )
                content = response.choices[0].message.content
            elif self.llm_client is not None:
                content = await self.llm_client.chat(
                    messages=[
                        {"role": "system", "content": "You are a web spec assistant. Return valid JSON only."},
                        {"role": "user", "content": spec_prompt}
                    ],
                    temperature=0.3,
                    max_tokens=1024
                )
            else:
                raise Exception("LLM client not initialized")

            # 解析JSON
            spec = json.loads(content)
            return spec

        except Exception as e:
            print(f"Spec generation error: {e}")
            # 返回默认规格
            return {
                "title": "我的网站",
                "description": "使用AI生成的网站",
                "sections": ["首页"],
                "features": ["响应式设计"],
                "color_scheme": {"primary": "#3498db", "secondary": "#2ecc71"},
                "fonts": ["Arial", "sans-serif"],
                "layout": "single-page"
            }

    async def _generate_html(self, spec: Dict[str, Any], theme: str) -> str:
        """生成HTML内容"""

        html_prompt = f"""生成一个完整的HTML5网页。

项目规格:
{json.dumps(spec, ensure_ascii=False, indent=2)}

主题: {theme}

要求:
1. 使用语义化HTML5标签
2. 包含必要的meta标签
3. 引用styles.css和script.js
4. 响应式设计
5. 代码整洁规范

只返回HTML代码，不要markdown标记:
"""

        try:
            if self.llm_provider == "ollama":
                response = ollama.chat(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的前端开发工程师，擅长编写简洁优雅的HTML代码。"},
                        {"role": "user", "content": html_prompt}
                    ],
                    options={"temperature": 0.2, "num_predict": 2048}
                )
                html = response['message']['content']
            elif self.client is not None:
                response = await self.client.chat.completions.create(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的前端开发工程师，擅长编写简洁优雅的HTML代码。"},
                        {"role": "user", "content": html_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                )
                html = response.choices[0].message.content
            elif self.llm_client is not None:
                html = await self.llm_client.chat(
                    messages=[
                        {"role": "system", "content": "You are a frontend engineer. Return plain HTML."},
                        {"role": "user", "content": html_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                )
            else:
                raise Exception("LLM client not initialized")

            # 清理可能的markdown标记
            html = html.replace("```html", "").replace("```", "").strip()
            return html

        except Exception as e:
            print(f"HTML generation error: {e}")
            # 返回基础HTML模板
            return self._get_default_html(spec, theme)

    async def _generate_css(self, spec: Dict[str, Any], theme: str) -> str:
        """生成CSS内容"""

        color_scheme = spec.get("color_scheme", {"primary": "#3498db", "secondary": "#2ecc71"})
        fonts = spec.get("fonts", ["Arial", "sans-serif"])

        css_prompt = f"""生成一个完整的CSS样式表。

项目规格:
{json.dumps(spec, ensure_ascii=False, indent=2)}

主题: {theme}
配色方案: {json.dumps(color_scheme, ensure_ascii=False)}
字体: {", ".join(fonts)}

要求:
1. 使用CSS变量定义配色
2. 响应式设计（媒体查询）
3. 流畅的动画和过渡效果
4. 现代化的视觉风格
5. 支持深色/浅色主题切换

只返回CSS代码，不要markdown标记:
"""

        try:
            if self.llm_provider == "ollama":
                response = ollama.chat(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的CSS工程师，擅长现代化响应式设计。"},
                        {"role": "user", "content": css_prompt}
                    ],
                    options={"temperature": 0.2, "num_predict": 2048}
                )
                css = response['message']['content']
            elif self.client is not None:
                response = await self.client.chat.completions.create(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的CSS工程师，擅长现代化响应式设计。"},
                        {"role": "user", "content": css_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                )
                css = response.choices[0].message.content
            elif self.llm_client is not None:
                css = await self.llm_client.chat(
                    messages=[
                        {"role": "system", "content": "You are a CSS engineer. Return plain CSS."},
                        {"role": "user", "content": css_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                )
            else:
                raise Exception("LLM client not initialized")

            css = css.replace("```css", "").replace("```", "").strip()
            return css

        except Exception as e:
            print(f"CSS generation error: {e}")
            return self._get_default_css(spec, theme)

    async def _generate_js(self, spec: Dict[str, Any]) -> str:
        """生成JavaScript内容"""

        features = spec.get("features", [])

        js_prompt = f"""生成JavaScript交互代码。

项目规格:
{json.dumps(spec, ensure_ascii=False, indent=2)}

功能特性: {", ".join(features)}

要求:
1. 现代ES6+语法
2. 实现必要的交互功能
3. 平滑滚动
4. 响应式导航菜单
5. 深色模式切换（如果需要）
6. 代码简洁易读

只返回JavaScript代码，不要markdown标记:
"""

        try:
            if self.llm_provider == "ollama":
                response = ollama.chat(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的JavaScript工程师，擅长编写简洁高效的前端代码。"},
                        {"role": "user", "content": js_prompt}
                    ],
                    options={"temperature": 0.2, "num_predict": 2048}
                )
                js = response['message']['content']
            elif self.client is not None:
                response = await self.client.chat.completions.create(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的JavaScript工程师，擅长编写简洁高效的前端代码。"},
                        {"role": "user", "content": js_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                )
                js = response.choices[0].message.content
            elif self.llm_client is not None:
                js = await self.llm_client.chat(
                    messages=[
                        {"role": "system", "content": "You are a JavaScript engineer. Return plain JavaScript."},
                        {"role": "user", "content": js_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                )
            else:
                raise Exception("LLM client not initialized")

            js = js.replace("```javascript", "").replace("```js", "").replace("```", "").strip()
            return js

        except Exception as e:
            print(f"JS generation error: {e}")
            return self._get_default_js()

    def _get_default_html(self, spec: Dict[str, Any], theme: str) -> str:
        """获取默认HTML模板"""
        title = spec.get("title", "我的网站")
        description = spec.get("description", "使用AI生成的网站")

        return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="{description}">
    <title>{title}</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body class="{theme}-theme">
    <header>
        <nav>
            <h1>{title}</h1>
        </nav>
    </header>

    <main>
        <section id="hero">
            <h2>欢迎</h2>
            <p>{description}</p>
        </section>
    </main>

    <footer>
        <p>&copy; 2024 {title}. AI生成.</p>
    </footer>

    <script src="script.js"></script>
</body>
</html>"""

    def _get_default_css(self, spec: Dict[str, Any], theme: str) -> str:
        """获取默认CSS"""
        color_scheme = spec.get("color_scheme", {"primary": "#3498db", "secondary": "#2ecc71"})

        return f"""/* 基础样式 */
:root {{
    --primary-color: {color_scheme.get('primary', '#3498db')};
    --secondary-color: {color_scheme.get('secondary', '#2ecc71')};
    --text-color: #333;
    --bg-color: #fff;
}}

.dark-theme {{
    --text-color: #f0f0f0;
    --bg-color: #1a1a1a;
}}

* {{
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}}

body {{
    font-family: Arial, sans-serif;
    line-height: 1.6;
    color: var(--text-color);
    background-color: var(--bg-color);
}}

header {{
    background-color: var(--primary-color);
    color: white;
    padding: 1rem;
}}

main {{
    max-width: 1200px;
    margin: 2rem auto;
    padding: 0 1rem;
}}

footer {{
    background-color: #333;
    color: white;
    text-align: center;
    padding: 1rem;
    margin-top: 2rem;
}}

#hero {{
    text-align: center;
    padding: 3rem 0;
}}

#hero h2 {{
    font-size: 2.5rem;
    margin-bottom: 1rem;
}}

@media (max-width: 768px) {{
    #hero h2 {{
        font-size: 2rem;
    }}
}}"""

    def _get_default_js(self) -> str:
        """获取默认JavaScript"""
        return """// 页面加载完成
document.addEventListener('DOMContentLoaded', () => {
    console.log('页面加载完成');

    // 平滑滚动
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });
});"""

    # ========================================
    # 流式生成方法
    # ========================================

    async def generate_stream(
        self,
        prompt: str,
        context: Optional[Dict[str, Any]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        流式生成Web项目文件

        Args:
            prompt: 用户需求描述
            context: 意图识别结果

        Yields:
            流式生成的进度和内容
        """
        if not self._ready:
            yield {"type": "error", "error": "Web engine not ready"}
            return

        try:
            # 防御性编程：确保context是字典
            if isinstance(context, list):
                context = context[0] if len(context) > 0 else {}

            entities = context.get("entities", {}) if context else {}
            template_type = entities.get("template", "basic")
            theme = entities.get("theme", "light")

            # 快速路径：预定义模板
            if has_template(template_type):
                yield {
                    "type": "progress",
                    "stage": "template",
                    "message": "使用预定义模板"
                }

                template_files = get_template(template_type)
                yield {
                    "type": "complete",
                    "files": [
                        {
                            "path": "index.html",
                            "content": template_files["index.html"],
                            "language": "html"
                        },
                        {
                            "path": "styles.css",
                            "content": template_files["styles.css"],
                            "language": "css"
                        },
                        {
                            "path": "script.js",
                            "content": template_files["script.js"],
                            "language": "javascript"
                        }
                    ],
                    "metadata": {
                        "template": template_type,
                        "theme": theme,
                        "source": "predefined_template"
                    }
                }
                return

            # 慢速路径：LLM生成
            yield {
                "type": "progress",
                "stage": "spec",
                "message": "生成项目规格..."
            }

            # 1. 生成规格（流式）
            spec = None
            async for chunk in self._generate_spec_stream(prompt, entities):
                if chunk.get("type") == "complete":
                    spec = chunk.get("spec")
                    yield {
                        "type": "progress",
                        "stage": "spec",
                        "message": "规格生成完成",
                        "spec": spec
                    }
                elif chunk.get("type") == "content":
                    yield chunk

            if not spec:
                raise Exception("Failed to generate spec")

            # 2. 生成HTML（流式）
            yield {
                "type": "progress",
                "stage": "html",
                "message": "生成HTML..."
            }

            html_content = ""
            async for chunk in self._generate_html_stream(spec, theme):
                if chunk.get("type") == "content":
                    html_content += chunk.get("content", "")
                    yield chunk
                elif chunk.get("type") == "complete":
                    html_content = chunk.get("content", "")

            # 3. 生成CSS（流式）
            yield {
                "type": "progress",
                "stage": "css",
                "message": "生成CSS..."
            }

            css_content = ""
            async for chunk in self._generate_css_stream(spec, theme):
                if chunk.get("type") == "content":
                    css_content += chunk.get("content", "")
                    yield chunk
                elif chunk.get("type") == "complete":
                    css_content = chunk.get("content", "")

            # 4. 生成JavaScript（流式）
            yield {
                "type": "progress",
                "stage": "js",
                "message": "生成JavaScript..."
            }

            js_content = ""
            async for chunk in self._generate_js_stream(spec):
                if chunk.get("type") == "content":
                    js_content += chunk.get("content", "")
                    yield chunk
                elif chunk.get("type") == "complete":
                    js_content = chunk.get("content", "")

            # 5. 返回最终结果
            yield {
                "type": "complete",
                "files": [
                    {
                        "path": "index.html",
                        "content": html_content,
                        "language": "html"
                    },
                    {
                        "path": "styles.css",
                        "content": css_content,
                        "language": "css"
                    },
                    {
                        "path": "script.js",
                        "content": js_content,
                        "language": "javascript"
                    }
                ],
                "metadata": {
                    "template": template_type,
                    "theme": theme,
                    "spec": spec,
                    "source": "llm_generated"
                }
            }

        except Exception as e:
            yield {
                "type": "error",
                "error": str(e)
            }

    async def _generate_spec_stream(
        self,
        prompt: str,
        entities: Dict[str, Any]
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式生成项目规格"""

        spec_prompt = f"""根据用户需求，生成Web项目规格说明。

用户需求: {prompt}
提取的实体: {json.dumps(entities, ensure_ascii=False)}

请生成包含以下信息的JSON规格说明:
{{
    "title": "项目标题",
    "description": "项目描述",
    "sections": ["首页", "关于", "联系"],
    "features": ["响应式设计", "深色模式"],
    "color_scheme": {{"primary": "#3498db", "secondary": "#2ecc71"}},
    "fonts": ["Arial", "sans-serif"],
    "layout": "single-page"
}}

只返回JSON，不要其他文字:
"""

        try:
            full_content = ""

            # 根据提供商选择流式方法
            if self.llm_provider == "ollama":
                async for chunk in stream_ollama_chat(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是Web项目规格专家，总是返回有效的JSON。"},
                        {"role": "user", "content": spec_prompt}
                    ],
                    options={"temperature": 0.3}
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "spec"}

            elif self.client is not None:
                async for chunk in stream_openai_chat(
                    client=self.client,
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是Web项目规格专家，总是返回有效的JSON。"},
                        {"role": "user", "content": spec_prompt}
                    ],
                    temperature=0.3
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "spec"}

            elif self.llm_client is not None:
                async for chunk in stream_custom_llm_chat(
                    llm_client=self.llm_client,
                    messages=[
                        {"role": "system", "content": "You are a web spec assistant. Return valid JSON only."},
                        {"role": "user", "content": spec_prompt}
                    ],
                    temperature=0.3,
                    max_tokens=1024
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "spec"}

            # 解析JSON
            try:
                spec = json.loads(full_content)
            except json.JSONDecodeError:
                # 如果JSON解析失败，使用默认规格
                spec = {
                    "title": "我的网站",
                    "description": "使用AI生成的网站",
                    "sections": ["首页"],
                    "features": ["响应式设计"],
                    "color_scheme": {"primary": "#3498db", "secondary": "#2ecc71"},
                    "fonts": ["Arial", "sans-serif"],
                    "layout": "single-page"
                }

            yield {"type": "complete", "spec": spec}

        except Exception as e:
            yield {"type": "error", "error": str(e)}

    async def _generate_html_stream(
        self,
        spec: Dict[str, Any],
        theme: str
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式生成HTML"""

        html_prompt = f"""生成一个完整的HTML5网页。

项目规格:
{json.dumps(spec, ensure_ascii=False, indent=2)}

主题: {theme}

要求:
1. 使用语义化HTML5标签
2. 包含必要的meta标签
3. 引用styles.css和script.js
4. 响应式设计
5. 代码整洁规范

只返回HTML代码，不要markdown标记:
"""

        try:
            full_content = ""

            if self.llm_provider == "ollama":
                async for chunk in stream_ollama_chat(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的前端开发工程师，擅长编写简洁优雅的HTML代码。"},
                        {"role": "user", "content": html_prompt}
                    ],
                    options={"temperature": 0.2, "num_predict": 2048}
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "html"}

            elif self.client is not None:
                async for chunk in stream_openai_chat(
                    client=self.client,
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的前端开发工程师，擅长编写简洁优雅的HTML代码。"},
                        {"role": "user", "content": html_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "html"}

            elif self.llm_client is not None:
                async for chunk in stream_custom_llm_chat(
                    llm_client=self.llm_client,
                    messages=[
                        {"role": "system", "content": "You are a frontend engineer. Return plain HTML."},
                        {"role": "user", "content": html_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "html"}

            # 清理markdown标记
            full_content = full_content.replace("```html", "").replace("```", "").strip()
            yield {"type": "complete", "content": full_content}

        except Exception as e:
            # 返回默认HTML
            default_html = self._get_default_html(spec, theme)
            yield {"type": "complete", "content": default_html}

    async def _generate_css_stream(
        self,
        spec: Dict[str, Any],
        theme: str
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式生成CSS"""

        color_scheme = spec.get("color_scheme", {"primary": "#3498db", "secondary": "#2ecc71"})
        fonts = spec.get("fonts", ["Arial", "sans-serif"])

        css_prompt = f"""生成一个完整的CSS样式表。

项目规格:
{json.dumps(spec, ensure_ascii=False, indent=2)}

主题: {theme}
配色方案: {json.dumps(color_scheme, ensure_ascii=False)}
字体: {", ".join(fonts)}

要求:
1. 使用CSS变量定义配色
2. 响应式设计（媒体查询）
3. 流畅的动画和过渡效果
4. 现代化的视觉风格
5. 支持深色/浅色主题切换

只返回CSS代码，不要markdown标记:
"""

        try:
            full_content = ""

            if self.llm_provider == "ollama":
                async for chunk in stream_ollama_chat(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的CSS工程师，擅长现代化响应式设计。"},
                        {"role": "user", "content": css_prompt}
                    ],
                    options={"temperature": 0.2, "num_predict": 2048}
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "css"}

            elif self.client is not None:
                async for chunk in stream_openai_chat(
                    client=self.client,
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的CSS工程师，擅长现代化响应式设计。"},
                        {"role": "user", "content": css_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "css"}

            elif self.llm_client is not None:
                async for chunk in stream_custom_llm_chat(
                    llm_client=self.llm_client,
                    messages=[
                        {"role": "system", "content": "You are a CSS engineer. Return plain CSS."},
                        {"role": "user", "content": css_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "css"}

            full_content = full_content.replace("```css", "").replace("```", "").strip()
            yield {"type": "complete", "content": full_content}

        except Exception as e:
            default_css = self._get_default_css(spec, theme)
            yield {"type": "complete", "content": default_css}

    async def _generate_js_stream(
        self,
        spec: Dict[str, Any]
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式生成JavaScript"""

        features = spec.get("features", [])

        js_prompt = f"""生成JavaScript交互代码。

项目规格:
{json.dumps(spec, ensure_ascii=False, indent=2)}

功能特性: {", ".join(features)}

要求:
1. 现代ES6+语法
2. 实现必要的交互功能
3. 平滑滚动
4. 响应式导航菜单
5. 深色模式切换（如果需要）
6. 代码简洁易读

只返回JavaScript代码，不要markdown标记:
"""

        try:
            full_content = ""

            if self.llm_provider == "ollama":
                async for chunk in stream_ollama_chat(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的JavaScript工程师，擅长编写简洁高效的前端代码。"},
                        {"role": "user", "content": js_prompt}
                    ],
                    options={"temperature": 0.2, "num_predict": 2048}
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "js"}

            elif self.client is not None:
                async for chunk in stream_openai_chat(
                    client=self.client,
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": "你是专业的JavaScript工程师，擅长编写简洁高效的前端代码。"},
                        {"role": "user", "content": js_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "js"}

            elif self.llm_client is not None:
                async for chunk in stream_custom_llm_chat(
                    llm_client=self.llm_client,
                    messages=[
                        {"role": "system", "content": "You are a JavaScript engineer. Return plain JavaScript."},
                        {"role": "user", "content": js_prompt}
                    ],
                    temperature=0.2,
                    max_tokens=2048
                ):
                    if chunk.get("type") == "content":
                        content = chunk.get("content", "")
                        full_content += content
                        yield {"type": "content", "content": content, "stage": "js"}

            full_content = full_content.replace("```javascript", "").replace("```js", "").replace("```", "").strip()
            yield {"type": "complete", "content": full_content}

        except Exception as e:
            default_js = self._get_default_js()
            yield {"type": "complete", "content": default_js}
