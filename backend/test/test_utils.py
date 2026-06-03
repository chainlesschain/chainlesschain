"""
通用测试工具类
"""
import time
import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
import requests
from colorama import init, Fore, Style

# 初始化 colorama
init(autoreset=True)

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class TestResult:
    """测试结果类"""

    def __init__(self, name: str, endpoint: str, method: str):
        self.name = name
        self.endpoint = endpoint
        self.method = method
        self.status = "PENDING"  # PENDING, PASS, FAIL, SKIP, ERROR
        self.status_code = None
        self.response_time = None
        self.error_message = None
        self.details = {}
        self.timestamp = datetime.now()

    def mark_pass(self, status_code: int, response_time: float, details: Dict = None):
        """标记测试通过"""
        self.status = "PASS"
        self.status_code = status_code
        self.response_time = response_time
        self.details = details or {}

    def mark_fail(self, status_code: int, error_message: str, details: Dict = None):
        """标记测试失败"""
        self.status = "FAIL"
        self.status_code = status_code
        self.error_message = error_message
        self.details = details or {}

    def mark_error(self, error_message: str):
        """标记测试错误"""
        self.status = "ERROR"
        self.error_message = error_message

    def mark_skip(self, reason: str):
        """标记测试跳过"""
        self.status = "SKIP"
        self.error_message = reason

    def to_dict(self) -> Dict:
        """转换为字典"""
        return {
            "name": self.name,
            "endpoint": self.endpoint,
            "method": self.method,
            "status": self.status,
            "status_code": self.status_code,
            "response_time": self.response_time,
            "error_message": self.error_message,
            "details": self.details,
            "timestamp": self.timestamp.isoformat()
        }

    def print_result(self):
        """打印测试结果"""
        status_colors = {
            "PASS": Fore.GREEN,
            "FAIL": Fore.RED,
            "ERROR": Fore.RED,
            "SKIP": Fore.YELLOW,
            "PENDING": Fore.CYAN
        }

        color = status_colors.get(self.status, Fore.WHITE)
        status_symbol = {
            "PASS": "[PASS]",
            "FAIL": "[FAIL]",
            "ERROR": "[ERROR]",
            "SKIP": "[SKIP]",
            "PENDING": "[PENDING]"
        }.get(self.status, "[?]")

        print(f"{color}{status_symbol} [{self.method}] {self.endpoint} - {self.name}{Style.RESET_ALL}")

        if self.response_time:
            print(f"  响应时间: {self.response_time:.3f}s")

        if self.status_code:
            print(f"  状态码: {self.status_code}")

        if self.error_message:
            print(f"  {Fore.RED}错误: {self.error_message}{Style.RESET_ALL}")


class APITester:
    """API测试器基类"""

    def __init__(self, base_url: str, service_name: str):
        self.base_url = base_url.rstrip('/')
        self.service_name = service_name
        self.session = requests.Session()
        self.results: List[TestResult] = []
        self.default_headers = {
            "Content-Type": "application/json"
        }

    def set_header(self, key: str, value: str):
        """设置默认请求头"""
        self.default_headers[key] = value

    def request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None,
        headers: Optional[Dict] = None,
        timeout: int = 30
    ) -> requests.Response:
        """发送HTTP请求"""
        url = f"{self.base_url}{endpoint}"
        request_headers = {**self.default_headers, **(headers or {})}

        logger.info(f"[{method}] {url}")
        if data:
            logger.debug(f"Request data: {json.dumps(data, ensure_ascii=False, indent=2)}")

        start_time = time.time()

        try:
            response = self.session.request(
                method=method,
                url=url,
                json=data,
                params=params,
                headers=request_headers,
                timeout=timeout
            )

            response_time = time.time() - start_time

            logger.info(f"Status: {response.status_code}, Time: {response_time:.3f}s")

            return response

        except Exception as e:
            logger.error(f"Request failed: {str(e)}")
            raise

    def test_endpoint(
        self,
        test_name: str,
        method: str,
        endpoint: str,
        expected_status: int = 200,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None,
        headers: Optional[Dict] = None,
        timeout: int = 30,
        validate_response: Optional[callable] = None
    ) -> TestResult:
        """
        测试单个接口端点

        Args:
            test_name: 测试名称
            method: HTTP方法
            endpoint: 接口端点
            expected_status: 期望的HTTP状态码
            data: 请求数据
            params: URL参数
            headers: 请求头
            timeout: 超时时间
            validate_response: 响应验证函数

        Returns:
            TestResult: 测试结果
        """
        result = TestResult(test_name, endpoint, method)

        try:
            start_time = time.time()
            response = self.request(method, endpoint, data, params, headers, timeout)
            response_time = time.time() - start_time

            # 检查状态码
            if response.status_code != expected_status:
                result.mark_fail(
                    response.status_code,
                    f"Expected status {expected_status}, got {response.status_code}",
                    {"response_body": response.text[:500]}
                )
            else:
                # 解析响应
                try:
                    response_data = response.json()
                except:
                    response_data = {"raw": response.text[:500]}

                # 自定义验证
                if validate_response:
                    validation_error = validate_response(response_data)
                    if validation_error:
                        result.mark_fail(
                            response.status_code,
                            validation_error,
                            {"response": response_data}
                        )
                    else:
                        result.mark_pass(response.status_code, response_time, response_data)
                else:
                    result.mark_pass(response.status_code, response_time, response_data)

        except requests.exceptions.Timeout:
            result.mark_error(f"请求超时（{timeout}s）")
        except requests.exceptions.ConnectionError:
            result.mark_error(f"无法连接到服务器 {self.base_url}")
        except Exception as e:
            result.mark_error(f"未知错误: {str(e)}")

        self.results.append(result)
        result.print_result()

        return result

    def get_summary(self) -> Dict[str, Any]:
        """获取测试摘要"""
        total = len(self.results)
        passed = sum(1 for r in self.results if r.status == "PASS")
        failed = sum(1 for r in self.results if r.status == "FAIL")
        errors = sum(1 for r in self.results if r.status == "ERROR")
        skipped = sum(1 for r in self.results if r.status == "SKIP")

        avg_response_time = 0
        if passed > 0:
            response_times = [r.response_time for r in self.results if r.response_time]
            avg_response_time = sum(response_times) / len(response_times) if response_times else 0

        return {
            "service": self.service_name,
            "total": total,
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "skipped": skipped,
            "success_rate": f"{(passed / total * 100):.2f}%" if total > 0 else "0%",
            "avg_response_time": f"{avg_response_time:.3f}s"
        }

    def print_summary(self):
        """打印测试摘要"""
        summary = self.get_summary()

        print("\n" + "=" * 60)
        print(f"{Fore.CYAN}测试摘要 - {summary['service']}{Style.RESET_ALL}")
        print("=" * 60)
        print(f"总测试数: {summary['total']}")
        print(f"{Fore.GREEN}通过: {summary['passed']}{Style.RESET_ALL}")
        print(f"{Fore.RED}失败: {summary['failed']}{Style.RESET_ALL}")
        print(f"{Fore.RED}错误: {summary['errors']}{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}跳过: {summary['skipped']}{Style.RESET_ALL}")
        print(f"成功率: {summary['success_rate']}")
        print(f"平均响应时间: {summary['avg_response_time']}")
        print("=" * 60 + "\n")


def validate_json_structure(data: Dict, required_fields: List[str]) -> Optional[str]:
    """
    验证JSON结构是否包含必需字段

    Args:
        data: 响应数据
        required_fields: 必需字段列表

    Returns:
        错误消息（如果有）或None
    """
    for field in required_fields:
        if '.' in field:
            # 支持嵌套字段，如 "data.id"
            parts = field.split('.')
            current = data
            for part in parts:
                if not isinstance(current, dict) or part not in current:
                    return f"缺少必需字段: {field}"
                current = current[part]
        else:
            if field not in data:
                return f"缺少必需字段: {field}"

    return None


def validate_api_response(data: Dict, check_success: bool = True) -> Optional[str]:
    """
    验证标准API响应格式

    Args:
        data: 响应数据
        check_success: 是否检查success字段

    Returns:
        错误消息（如果有）或None
    """
    if check_success:
        if "success" in data and not data["success"]:
            return f"API返回失败: {data.get('message', 'Unknown error')}"

    return None
