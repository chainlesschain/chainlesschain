"""
测试报告生成器
"""
import json
import os
from datetime import datetime
from typing import List, Dict, Any
from test_utils import TestResult


class ReportGenerator:
    """测试报告生成器"""

    def __init__(self, output_dir: str = None):
        if output_dir is None:
            # 使用脚本所在目录的 reports 子目录
            script_dir = os.path.dirname(os.path.abspath(__file__))
            output_dir = os.path.join(script_dir, "reports")
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

    def generate_html_report(self, all_results: Dict[str, List[TestResult]], filename: str = None):
        """生成HTML格式报告"""
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"test_report_{timestamp}.html"

        filepath = os.path.join(self.output_dir, filename)

        # 统计数据
        total_tests = 0
        total_passed = 0
        total_failed = 0
        total_errors = 0
        total_skipped = 0

        for service_name, results in all_results.items():
            total_tests += len(results)
            total_passed += sum(1 for r in results if r.status == "PASS")
            total_failed += sum(1 for r in results if r.status == "FAIL")
            total_errors += sum(1 for r in results if r.status == "ERROR")
            total_skipped += sum(1 for r in results if r.status == "SKIP")

        success_rate = (total_passed / total_tests * 100) if total_tests > 0 else 0

        # 生成HTML
        html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ChainlessChain 后端接口测试报告</title>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #333;
            border-bottom: 3px solid #4CAF50;
            padding-bottom: 10px;
        }}
        .summary {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }}
        .summary-card {{
            padding: 20px;
            border-radius: 6px;
            text-align: center;
        }}
        .summary-card h3 {{
            margin: 0;
            font-size: 2em;
        }}
        .summary-card p {{
            margin: 5px 0 0 0;
            color: #666;
        }}
        .card-total {{ background-color: #e3f2fd; }}
        .card-pass {{ background-color: #c8e6c9; }}
        .card-fail {{ background-color: #ffcdd2; }}
        .card-error {{ background-color: #ffe0b2; }}
        .card-skip {{ background-color: #f0f0f0; }}
        .service-section {{
            margin: 30px 0;
        }}
        .service-header {{
            background-color: #2196F3;
            color: white;
            padding: 15px;
            border-radius: 6px 6px 0 0;
            font-size: 1.2em;
            font-weight: bold;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
        }}
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }}
        th {{
            background-color: #f5f5f5;
            font-weight: 600;
        }}
        .status-PASS {{ color: #4CAF50; font-weight: bold; }}
        .status-FAIL {{ color: #f44336; font-weight: bold; }}
        .status-ERROR {{ color: #ff9800; font-weight: bold; }}
        .status-SKIP {{ color: #9e9e9e; font-weight: bold; }}
        .error-message {{
            color: #d32f2f;
            font-size: 0.9em;
            margin-top: 5px;
        }}
        .timestamp {{
            color: #666;
            font-size: 0.9em;
        }}
        .footer {{
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            text-align: center;
            color: #666;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>🧪 ChainlessChain 后端接口测试报告</h1>
        <p class="timestamp">生成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}</p>

        <div class="summary">
            <div class="summary-card card-total">
                <h3>{total_tests}</h3>
                <p>总测试数</p>
            </div>
            <div class="summary-card card-pass">
                <h3>{total_passed}</h3>
                <p>通过</p>
            </div>
            <div class="summary-card card-fail">
                <h3>{total_failed}</h3>
                <p>失败</p>
            </div>
            <div class="summary-card card-error">
                <h3>{total_errors}</h3>
                <p>错误</p>
            </div>
            <div class="summary-card card-skip">
                <h3>{total_skipped}</h3>
                <p>跳过</p>
            </div>
        </div>

        <div style="margin: 20px 0; padding: 15px; background-color: {'#c8e6c9' if success_rate >= 80 else '#ffcdd2'}; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0;">成功率: {success_rate:.2f}%</h2>
        </div>
"""

        # 为每个服务生成详细表格
        for service_name, results in all_results.items():
            service_passed = sum(1 for r in results if r.status == "PASS")
            service_total = len(results)
            service_rate = (service_passed / service_total * 100) if service_total > 0 else 0

            html_content += f"""
        <div class="service-section">
            <div class="service-header">
                {service_name} ({service_passed}/{service_total} 通过 - {service_rate:.1f}%)
            </div>
            <table>
                <thead>
                    <tr>
                        <th>测试名称</th>
                        <th>方法</th>
                        <th>端点</th>
                        <th>状态</th>
                        <th>状态码</th>
                        <th>响应时间</th>
                    </tr>
                </thead>
                <tbody>
"""

            for result in results:
                response_time = f"{result.response_time:.3f}s" if result.response_time else "-"
                status_code = result.status_code or "-"

                error_html = ""
                if result.error_message:
                    error_html = f'<div class="error-message">错误: {result.error_message}</div>'

                html_content += f"""
                    <tr>
                        <td>{result.name}{error_html}</td>
                        <td>{result.method}</td>
                        <td><code>{result.endpoint}</code></td>
                        <td class="status-{result.status}">{result.status}</td>
                        <td>{status_code}</td>
                        <td>{response_time}</td>
                    </tr>
"""

            html_content += """
                </tbody>
            </table>
        </div>
"""

        html_content += """
        <div class="footer">
            <p>ChainlessChain 后端接口自动化测试 | 生成于 backend/test/</p>
        </div>
    </div>
</body>
</html>
"""

        # 写入文件
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html_content)

        print(f"\n[OK] HTML报告已生成: {filepath}")
        return filepath

    def generate_json_report(self, all_results: Dict[str, List[TestResult]], filename: str = None):
        """生成JSON格式报告"""
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"test_report_{timestamp}.json"

        filepath = os.path.join(self.output_dir, filename)

        # 转换为JSON格式
        report_data = {
            "timestamp": datetime.now().isoformat(),
            "summary": {
                "total": 0,
                "passed": 0,
                "failed": 0,
                "errors": 0,
                "skipped": 0
            },
            "services": {}
        }

        for service_name, results in all_results.items():
            service_data = {
                "total": len(results),
                "passed": sum(1 for r in results if r.status == "PASS"),
                "failed": sum(1 for r in results if r.status == "FAIL"),
                "errors": sum(1 for r in results if r.status == "ERROR"),
                "skipped": sum(1 for r in results if r.status == "SKIP"),
                "tests": [r.to_dict() for r in results]
            }

            report_data["services"][service_name] = service_data

            # 更新总计
            report_data["summary"]["total"] += service_data["total"]
            report_data["summary"]["passed"] += service_data["passed"]
            report_data["summary"]["failed"] += service_data["failed"]
            report_data["summary"]["errors"] += service_data["errors"]
            report_data["summary"]["skipped"] += service_data["skipped"]

        # 写入文件
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(report_data, f, ensure_ascii=False, indent=2)

        print(f"[OK] JSON报告已生成: {filepath}")
        return filepath

    def generate_markdown_report(self, all_results: Dict[str, List[TestResult]], filename: str = None):
        """生成Markdown格式报告"""
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"test_report_{timestamp}.md"

        filepath = os.path.join(self.output_dir, filename)

        # 统计数据
        total_tests = 0
        total_passed = 0
        total_failed = 0
        total_errors = 0
        total_skipped = 0

        for service_name, results in all_results.items():
            total_tests += len(results)
            total_passed += sum(1 for r in results if r.status == "PASS")
            total_failed += sum(1 for r in results if r.status == "FAIL")
            total_errors += sum(1 for r in results if r.status == "ERROR")
            total_skipped += sum(1 for r in results if r.status == "SKIP")

        success_rate = (total_passed / total_tests * 100) if total_tests > 0 else 0

        # 生成Markdown
        md_content = f"""# ChainlessChain 后端接口测试报告

**生成时间**: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

## 📊 测试摘要

| 指标 | 数量 |
|------|------|
| 总测试数 | {total_tests} |
| [PASS] 通过 | {total_passed} |
| [FAIL] 失败 | {total_failed} |
| [ERROR] 错误 | {total_errors} |
| [SKIP] 跳过 | {total_skipped} |
| **成功率** | **{success_rate:.2f}%** |

"""

        # 为每个服务生成详细表格
        for service_name, results in all_results.items():
            service_passed = sum(1 for r in results if r.status == "PASS")
            service_total = len(results)
            service_rate = (service_passed / service_total * 100) if service_total > 0 else 0

            md_content += f"""
## 🔧 {service_name}

**通过率**: {service_rate:.1f}% ({service_passed}/{service_total})

| 测试名称 | 方法 | 端点 | 状态 | 响应时间 |
|---------|------|------|------|---------|
"""

            for result in results:
                status_icon = {
                    "PASS": "[+]",
                    "FAIL": "[-]",
                    "ERROR": "[!]",
                    "SKIP": "[~]"
                }.get(result.status, "[?]")

                response_time = f"{result.response_time:.3f}s" if result.response_time else "-"

                md_content += f"| {result.name} | {result.method} | `{result.endpoint}` | {status_icon} {result.status} | {response_time} |\n"

                if result.error_message:
                    md_content += f"|  | | **错误**: {result.error_message} | | |\n"

        md_content += f"""
---

*生成于 backend/test/ | ChainlessChain 后端接口自动化测试*
"""

        # 写入文件
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(md_content)

        print(f"[OK] Markdown报告已生成: {filepath}")
        return filepath
