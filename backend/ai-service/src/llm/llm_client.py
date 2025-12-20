"""
Universal LLM Client - 统一LLM客户端
支持多种云LLM服务商：Ollama, OpenAI, DashScope, ZhipuAI等
"""
import os
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod


class BaseLLMClient(ABC):
    """LLM客户端基类"""

    @abstractmethod
    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        """
        对话接口

        Args:
            messages: 消息列表 [{"role": "user", "content": "..."}]
            temperature: 温度参数
            max_tokens: 最大token数

        Returns:
            LLM响应文本
        """
        pass


class OllamaClient(BaseLLMClient):
    """Ollama本地LLM客户端"""

    def __init__(self, model: str = "qwen2:7b", host: str = "http://localhost:11434"):
        import ollama
        self.model = model
        self.host = host
        self.client = ollama

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = self.client.chat(
                model=self.model,
                messages=messages,
                options={
                    "temperature": temperature,
                    "num_predict": max_tokens
                }
            )
            return response['message']['content']
        except Exception as e:
            raise Exception(f"Ollama调用失败: {e}")


class OpenAIClient(BaseLLMClient):
    """OpenAI API客户端（兼容所有OpenAI格式的API）"""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-3.5-turbo",
        base_url: str = "https://api.openai.com/v1"
    ):
        from openai import AsyncOpenAI
        self.model = model
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"OpenAI API调用失败: {e}")


class DashScopeClient(BaseLLMClient):
    """阿里云通义千问客户端"""

    def __init__(self, api_key: str, model: str = "qwen-turbo"):
        try:
            import dashscope
            dashscope.api_key = api_key
            self.dashscope = dashscope
            self.model = model
        except ImportError:
            raise Exception("请先安装: pip install dashscope")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            from dashscope import Generation

            response = Generation.call(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                result_format='message'
            )

            if response.status_code == 200:
                return response.output.choices[0].message.content
            else:
                raise Exception(f"DashScope错误: {response.message}")

        except Exception as e:
            raise Exception(f"DashScope调用失败: {e}")


class ZhipuAIClient(BaseLLMClient):
    """智谱AI客户端"""

    def __init__(self, api_key: str, model: str = "glm-4"):
        try:
            from zhipuai import ZhipuAI
            self.client = ZhipuAI(api_key=api_key)
            self.model = model
        except ImportError:
            raise Exception("请先安装: pip install zhipuai")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"智谱AI调用失败: {e}")


class VolcEngineClient(BaseLLMClient):
    """火山引擎（豆包）客户端"""

    def __init__(self, api_key: str, model: str = "doubao-pro-4k"):
        try:
            from volcengine.maas import MaasService, MaasException
            self.model = model
            self.maas = MaasService('maas-api.ml-platform-cn-beijing.volces.com', 'cn-beijing')
            self.maas.set_ak(api_key.split(':')[0] if ':' in api_key else api_key)
            self.maas.set_sk(api_key.split(':')[1] if ':' in api_key else '')
        except ImportError:
            raise Exception("请先安装: pip install volcengine-python-sdk")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            req = {
                "model": {
                    "name": self.model
                },
                "messages": messages,
                "parameters": {
                    "temperature": temperature,
                    "max_tokens": max_tokens
                }
            }

            response = self.maas.chat(req)
            return response['choice']['message']['content']
        except Exception as e:
            raise Exception(f"火山引擎调用失败: {e}")


class QianfanClient(BaseLLMClient):
    """百度千帆客户端"""

    def __init__(self, api_key: str, model: str = "ERNIE-Bot-turbo"):
        try:
            import qianfan
            # api_key格式: "access_key:secret_key"
            if ':' in api_key:
                ak, sk = api_key.split(':', 1)
                self.client = qianfan.ChatCompletion(ak=ak, sk=sk)
            else:
                self.client = qianfan.ChatCompletion(ak=api_key)
            self.model = model
        except ImportError:
            raise Exception("请先安装: pip install qianfan")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = self.client.do(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_output_tokens=max_tokens
            )
            return response['result']
        except Exception as e:
            raise Exception(f"百度千帆调用失败: {e}")


class HunyuanClient(BaseLLMClient):
    """腾讯混元客户端（使用OpenAI兼容接口）"""

    def __init__(self, api_key: str, model: str = "hunyuan-lite"):
        from openai import AsyncOpenAI
        self.model = model
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.hunyuan.cloud.tencent.com/v1"
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"腾讯混元调用失败: {e}")


class SparkClient(BaseLLMClient):
    """讯飞星火客户端（使用OpenAI兼容接口）"""

    def __init__(self, api_key: str, model: str = "spark-lite"):
        from openai import AsyncOpenAI
        # api_key格式: "app_id:api_key:api_secret"
        self.model = model
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://spark-api-open.xf-yun.com/v1"
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"讯飞星火调用失败: {e}")


class MiniMaxClient(BaseLLMClient):
    """MiniMax客户端"""

    def __init__(self, api_key: str, model: str = "abab5.5-chat"):
        from openai import AsyncOpenAI
        self.model = model
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.minimax.chat/v1"
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"MiniMax调用失败: {e}")


class DeepSeekClient(BaseLLMClient):
    """DeepSeek客户端"""

    def __init__(self, api_key: str, model: str = "deepseek-chat"):
        from openai import AsyncOpenAI
        self.model = model
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com/v1"
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"DeepSeek调用失败: {e}")


class LLMClientFactory:
    """LLM客户端工厂"""

    @staticmethod
    def create_client(
        provider: str,
        model: str,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None
    ) -> BaseLLMClient:
        """
        创建LLM客户端

        Args:
            provider: 提供商 (ollama, openai, dashscope, zhipu, volcengine, qianfan,
                              hunyuan, spark, minimax, deepseek)
            model: 模型名称
            api_key: API密钥
            base_url: API基础URL

        Returns:
            LLM客户端实例
        """
        provider = provider.lower()

        if provider == "ollama":
            host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
            return OllamaClient(model=model, host=host)

        elif provider == "openai":
            if not api_key:
                raise ValueError("OpenAI需要API Key")
            base_url = base_url or "https://api.openai.com/v1"
            return OpenAIClient(api_key=api_key, model=model, base_url=base_url)

        elif provider == "dashscope":
            if not api_key:
                raise ValueError("DashScope需要API Key")
            return DashScopeClient(api_key=api_key, model=model)

        elif provider == "zhipu":
            if not api_key:
                raise ValueError("智谱AI需要API Key")
            return ZhipuAIClient(api_key=api_key, model=model)

        elif provider == "volcengine" or provider == "doubao":
            if not api_key:
                raise ValueError("火山引擎需要API Key (格式: ak:sk)")
            return VolcEngineClient(api_key=api_key, model=model)

        elif provider == "qianfan" or provider == "baidu":
            if not api_key:
                raise ValueError("百度千帆需要API Key (格式: ak:sk)")
            return QianfanClient(api_key=api_key, model=model)

        elif provider == "hunyuan" or provider == "tencent":
            if not api_key:
                raise ValueError("腾讯混元需要API Key")
            return HunyuanClient(api_key=api_key, model=model)

        elif provider == "spark" or provider == "xfyun":
            if not api_key:
                raise ValueError("讯飞星火需要API Key")
            return SparkClient(api_key=api_key, model=model)

        elif provider == "minimax":
            if not api_key:
                raise ValueError("MiniMax需要API Key")
            return MiniMaxClient(api_key=api_key, model=model)

        elif provider == "deepseek":
            if not api_key:
                raise ValueError("DeepSeek需要API Key")
            return DeepSeekClient(api_key=api_key, model=model)

        else:
            raise ValueError(f"不支持的LLM提供商: {provider}")


# 便捷函数
def get_llm_client() -> BaseLLMClient:
    """
    根据环境变量自动创建LLM客户端

    环境变量:
        LLM_PROVIDER: 提供商 (ollama, openai, dashscope, zhipu, volcengine, qianfan,
                               hunyuan, spark, minimax, deepseek)
        LLM_MODEL: 模型名称
        OPENAI_API_KEY: OpenAI API密钥
        OPENAI_BASE_URL: OpenAI API基础URL
        DASHSCOPE_API_KEY: 阿里云DashScope API密钥
        ZHIPU_API_KEY: 智谱AI API密钥
        VOLCENGINE_API_KEY: 火山引擎API密钥 (格式: ak:sk)
        QIANFAN_API_KEY: 百度千帆API密钥 (格式: ak:sk)
        HUNYUAN_API_KEY: 腾讯混元API密钥
        SPARK_API_KEY: 讯飞星火API密钥
        MINIMAX_API_KEY: MiniMax API密钥
        DEEPSEEK_API_KEY: DeepSeek API密钥
    """
    provider = os.getenv("LLM_PROVIDER", "ollama")
    model = os.getenv("LLM_MODEL", "qwen2:7b")

    api_key = None
    base_url = None

    # 根据provider获取对应的API Key
    provider_lower = provider.lower()

    if provider_lower == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    elif provider_lower == "dashscope":
        api_key = os.getenv("DASHSCOPE_API_KEY")
    elif provider_lower == "zhipu":
        api_key = os.getenv("ZHIPU_API_KEY")
    elif provider_lower in ["volcengine", "doubao"]:
        api_key = os.getenv("VOLCENGINE_API_KEY")
    elif provider_lower in ["qianfan", "baidu"]:
        api_key = os.getenv("QIANFAN_API_KEY")
    elif provider_lower in ["hunyuan", "tencent"]:
        api_key = os.getenv("HUNYUAN_API_KEY")
    elif provider_lower in ["spark", "xfyun"]:
        api_key = os.getenv("SPARK_API_KEY")
    elif provider_lower == "minimax":
        api_key = os.getenv("MINIMAX_API_KEY")
    elif provider_lower == "deepseek":
        api_key = os.getenv("DEEPSEEK_API_KEY")

    return LLMClientFactory.create_client(
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url
    )
