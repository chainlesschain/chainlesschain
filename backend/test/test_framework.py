"""
测试框架和工具函数
提供HTTP请求、结果验证、报告生成等功能
"""
import requests
import json
import time
from typing import Dict, Any, List, Optional
from datetime import datetime
from dataclasses import dataclass, asdict
from enum import Enum


class TestStatus(Enum):
    """测试状态枚举"""
    PASSED = "PASSED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    ERROR = "ERROR"


@dataclass
class TestResult:
    """测试结果数据类"""
    name: str
    status: TestStatus
    duration: float
    endpoint: str
    method: str
    request_data: Optional[Dict] = None
    response_data: Optional[Dict] = None
    error_message: Optional[str] = None
    expected: Optional[Any] = None
    actual: Optional[Any] = None


class TestReporter:
    """测试报告生成器"""

    def __init__(self):
        self.results: List[TestResult] = []
        self.start_time = datetime.now()

    def add_result(self, result: TestResult):
        """添加测试结果"""
        self.results.append(result)

    def get_summary(self) -> Dict[str, Any]:
        """获取测试摘要"""
        total = len(self.results)
        passed = sum(1 for r in self.results if r.status == TestStatus.PASSED)
        failed = sum(1 for r in self.results if r.status == TestStatus.FAILED)
        error = sum(1 for r in self.results if r.status == TestStatus.ERROR)
        skipped = sum(1 for r in self.results if r.status == TestStatus.SKIPPED)

        return {
            "total": total,
            "passed": passed,
            "failed": failed,
            "error": error,
            "skipped": skipped,
            "success_rate": f"{(passed / total * 100) if total > 0 else 0:.2f}%",
            "duration": (datetime.now() - self.start_time).total_seconds()
        }

    def generate_markdown_report(self, filename: str = "test_report.md"):
        """生成Markdown格式的测试报告"""
        summary = self.get_summary()

        report = f"""# 后端接口测试报告

## 测试摘要

- **测试时间**: {self.start_time.strftime('%Y-%m-%d %H:%M:%S')}
- **测试时长**: {summary['duration']:.2f}秒
- **总测试数**: {summary['total']}
- **通过**: {summary['passed']} ✅
- **失败**: {summary['failed']} ❌
- **错误**: {summary['error']} ⚠️
- **跳过**: {summary['skipped']} ⏭️
- **成功率**: {summary['success_rate']}

## 详细结果

"""

        # 按状态分组
        for status in TestStatus:
            filtered = [r for r in self.results if r.status == status]
            if not filtered:
                continue

            status_icon = {
                TestStatus.PASSED: "✅",
                TestStatus.FAILED: "❌",
                TestStatus.ERROR: "⚠️",
                TestStatus.SKIPPED: "⏭️"
            }

            report += f"\n### {status_icon[status]} {status.value} ({len(filtered)})\n\n"

            for result in filtered:
                report += f"#### {result.name}\n\n"
                report += f"- **接口**: `{result.method} {result.endpoint}`\n"
                report += f"- **耗时**: {result.duration:.3f}秒\n"

                if result.error_message:
                    report += f"- **错误信息**: {result.error_message}\n"

                if result.request_data:
                    report += f"\n**请求数据**:\n```json\n{json.dumps(result.request_data, indent=2, ensure_ascii=False)}\n```\n"

                if result.response_data:
                    report += f"\n**响应数据**:\n```json\n{json.dumps(result.response_data, indent=2, ensure_ascii=False)}\n```\n"

                if result.expected is not None and result.actual is not None:
                    report += f"\n- **期望**: {result.expected}\n"
                    report += f"- **实际**: {result.actual}\n"

                report += "\n---\n\n"

        # 写入文件
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(report)

        return filename

    def generate_json_report(self, filename: str = "test_report.json"):
        """生成JSON格式的测试报告"""
        summary = self.get_summary()

        report = {
            "summary": summary,
            "start_time": self.start_time.isoformat(),
            "results": [
                {
                    **asdict(r),
                    "status": r.status.value
                }
                for r in self.results
            ]
        }

        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

        return filename


class APITester:
    """API测试器基类"""

    def __init__(self, base_url: str, timeout: int = 600):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.session = requests.Session()
        self.reporter = TestReporter()

    def test_request(
        self,
        name: str,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None,
        headers: Optional[Dict] = None,
        expected_status: int = 200,
        validate_func: Optional[callable] = None
    ) -> TestResult:
        """
        执行单个API测试

        Args:
            name: 测试名称
            method: HTTP方法 (GET, POST, PUT, DELETE)
            endpoint: API端点
            data: 请求体数据
            params: 查询参数
            headers: 请求头
            expected_status: 期望的HTTP状态码
            validate_func: 自定义验证函数

        Returns:
            TestResult对象
        """
        url = f"{self.base_url}{endpoint}"
        start_time = time.time()

        try:
            # 发送请求
            response = self.session.request(
                method=method.upper(),
                url=url,
                json=data if method.upper() in ['POST', 'PUT', 'PATCH'] else None,
                params=params,
                headers=headers,
                timeout=self.timeout
            )

            duration = time.time() - start_time

            # 解析响应
            try:
                response_data = response.json()
            except:
                response_data = {"raw": response.text}

            # 验证状态码
            if response.status_code != expected_status:
                return TestResult(
                    name=name,
                    status=TestStatus.FAILED,
                    duration=duration,
                    endpoint=endpoint,
                    method=method,
                    request_data=data,
                    response_data=response_data,
                    error_message=f"状态码不匹配",
                    expected=expected_status,
                    actual=response.status_code
                )

            # 自定义验证
            if validate_func:
                try:
                    validate_func(response_data)
                except AssertionError as e:
                    return TestResult(
                        name=name,
                        status=TestStatus.FAILED,
                        duration=duration,
                        endpoint=endpoint,
                        method=method,
                        request_data=data,
                        response_data=response_data,
                        error_message=str(e)
                    )

            # 测试通过
            return TestResult(
                name=name,
                status=TestStatus.PASSED,
                duration=duration,
                endpoint=endpoint,
                method=method,
                request_data=data,
                response_data=response_data
            )

        except requests.exceptions.Timeout:
            return TestResult(
                name=name,
                status=TestStatus.ERROR,
                duration=time.time() - start_time,
                endpoint=endpoint,
                method=method,
                request_data=data,
                error_message=f"请求超时 (>{self.timeout}s)"
            )
        except requests.exceptions.ConnectionError:
            return TestResult(
                name=name,
                status=TestStatus.ERROR,
                duration=time.time() - start_time,
                endpoint=endpoint,
                method=method,
                request_data=data,
                error_message="无法连接到服务器"
            )
        except Exception as e:
            return TestResult(
                name=name,
                status=TestStatus.ERROR,
                duration=time.time() - start_time,
                endpoint=endpoint,
                method=method,
                request_data=data,
                error_message=f"未知错误: {str(e)}"
            )

    def run_test(self, *args, **kwargs) -> TestResult:
        """运行测试并添加到报告器"""
        result = self.test_request(*args, **kwargs)
        self.reporter.add_result(result)

        # 打印实时结果
        status_icon = {
            TestStatus.PASSED: "[PASS]",
            TestStatus.FAILED: "[FAIL]",
            TestStatus.ERROR: "[ERROR]",
            TestStatus.SKIPPED: "[SKIP]"
        }
        print(f"{status_icon[result.status]} {result.name} ({result.duration:.3f}s)")
        if result.error_message:
            print(f"   Error: {result.error_message}")

        return result

    def generate_report(self, markdown: bool = True, json_report: bool = True):
        """生成测试报告"""
        reports = []

        if markdown:
            md_file = self.reporter.generate_markdown_report()
            reports.append(md_file)
            print(f"\nMarkdown报告已生成: {md_file}")

        if json_report:
            json_file = self.reporter.generate_json_report()
            reports.append(json_file)
            print(f"JSON报告已生成: {json_file}")

        # 打印摘要
        summary = self.reporter.get_summary()
        print(f"\n{'='*60}")
        print(f"Summary:")
        print(f"  Total: {summary['total']}")
        print(f"  Passed: {summary['passed']}")
        print(f"  Failed: {summary['failed']}")
        print(f"  Error: {summary['error']}")
        print(f"  Success Rate: {summary['success_rate']}")
        print(f"  Duration: {summary['duration']:.2f}s")
        print(f"{'='*60}\n")

        return reports


# 通用验证函数
def validate_success_response(response_data: Dict):
    """验证成功响应的标准格式"""
    # 支持多种响应格式
    # 格式1: {"success": true, "code": 200, "data": {...}}
    # 格式2: {"code": 200, "message": "...", "data": {...}}
    # 格式3: {"status": "healthy/running", ...}

    has_valid_field = (
        "success" in response_data or
        "status" in response_data or
        "code" in response_data
    )

    assert has_valid_field, "响应中缺少success/status/code字段"

    if "success" in response_data:
        assert response_data["success"] is True, f"success字段为False"

    if "code" in response_data:
        assert response_data["code"] in [0, 200], f"响应code不正确: {response_data['code']}"

    if "status" in response_data:
        valid_statuses = ["healthy", "running", "ok", "success"]
        assert response_data["status"] in valid_statuses, f"status不正确: {response_data['status']}"


def validate_has_data(response_data: Dict):
    """验证响应包含data字段"""
    assert "data" in response_data or "result" in response_data, "响应中缺少data/result字段"


def validate_pagination(response_data: Dict):
    """验证分页响应"""
    data = response_data.get("data", response_data)
    assert "records" in data or "list" in data or "items" in data, "分页响应中缺少记录列表"
    assert "total" in data or "size" in data, "分页响应中缺少总数信息"
