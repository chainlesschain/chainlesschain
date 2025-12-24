"""
测试配置
"""
import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 服务端点配置
PROJECT_SERVICE_BASE_URL = os.getenv("PROJECT_SERVICE_URL", "http://localhost:9090")
AI_SERVICE_BASE_URL = os.getenv("AI_SERVICE_URL", "http://localhost:8001")

# 测试超时配置（秒）
DEFAULT_TIMEOUT = 30
STREAM_TIMEOUT = 60
LONG_RUNNING_TIMEOUT = 120

# 测试数据配置
TEST_USER_DID = "did:test:user123"
TEST_PROJECT_NAME = "测试项目"
TEST_FILE_CONTENT = "# 测试文件\n\n这是一个测试文件。"

# 日志配置
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FILE = "backend/test/reports/test.log"

# 报告配置
REPORT_DIR = "backend/test/reports"
REPORT_FORMAT = "html"  # html, json, markdown

# 是否跳过需要真实LLM的测试
SKIP_LLM_TESTS = os.getenv("SKIP_LLM_TESTS", "false").lower() == "true"

# 是否跳过需要数据库的测试
SKIP_DB_TESTS = os.getenv("SKIP_DB_TESTS", "false").lower() == "true"

# 测试模式
TEST_MODE = os.getenv("TEST_MODE", "full")  # full, smoke, integration
