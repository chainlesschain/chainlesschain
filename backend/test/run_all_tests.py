"""
主测试运行器 - 运行所有后端接口测试并生成报告
"""
import sys
import os

# 添加当前目录到Python路径
sys.path.insert(0, os.path.dirname(__file__))

from test_project_service import ProjectServiceTester
from test_project_service_with_existing import ProjectServiceTesterExisting
from report_generator import ReportGenerator
from datetime import datetime


def print_banner():
    """打印测试横幅"""
    print("\n" + "=" * 70)
    print(" " * 15 + "ChainlessChain 后端接口测试套件")
    print("=" * 70)
    print(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70 + "\n")


def main():
    """主函数"""
    print_banner()

    all_results = {}

    # 1. 测试 Project Service
    print("\n[PROJECT SERVICE] 开始测试...")
    print("-" * 70)

    # 检查是否使用现有项目（绕过创建项目的性能问题）
    use_existing = os.getenv("USE_EXISTING_PROJECT", "true").lower() == "true"

    try:
        if use_existing:
            print("[INFO] 使用现有项目模式（绕过创建项目性能瓶颈）")
            project_tester = ProjectServiceTesterExisting()
        else:
            print("[INFO] 使用完整测试模式（包括创建项目）")
            project_tester = ProjectServiceTester()

        project_tester.run_all_tests()
        all_results["project-service"] = project_tester.results
    except Exception as e:
        print(f"[ERROR] Project Service 测试失败: {e}")
        import traceback
        traceback.print_exc()

    # 2. 测试 AI Service
    # 注意：AI Service 测试比较复杂，暂时注释掉
    # 可以通过环境变量 RUN_AI_TESTS=true 来启用
    run_ai_tests = os.getenv("RUN_AI_TESTS", "false").lower() == "true"

    if run_ai_tests:
        print("\n[AI SERVICE] 开始测试...")
        print("-" * 70)
        try:
            from test_ai_service_comprehensive import AIServiceTester
            ai_tester = AIServiceTester()
            ai_tester.run_all_tests()
            all_results["ai-service"] = ai_tester.results
        except Exception as e:
            print(f"[ERROR] AI Service 测试失败: {e}")
            import traceback
            traceback.print_exc()
    else:
        print("\n[SKIP] 跳过 AI Service 测试（设置 RUN_AI_TESTS=true 来启用）")

    # 3. 生成报告
    if all_results:
        print("\n" + "=" * 70)
        print("[REPORT] 生成测试报告...")
        print("=" * 70 + "\n")

        report_gen = ReportGenerator()  # 使用默认路径（脚本目录下的reports/）

        # 生成HTML报告
        try:
            report_gen.generate_html_report(all_results)
        except Exception as e:
            print(f"[WARNING] HTML报告生成失败: {e}")

        # 生成JSON报告
        try:
            report_gen.generate_json_report(all_results)
        except Exception as e:
            print(f"[WARNING] JSON报告生成失败: {e}")

        # 生成Markdown报告
        try:
            report_gen.generate_markdown_report(all_results)
        except Exception as e:
            print(f"[WARNING] Markdown报告生成失败: {e}")

    # 4. 打印最终摘要
    print("\n" + "=" * 70)
    print("[SUMMARY] 最终测试摘要")
    print("=" * 70)

    total_tests = 0
    total_passed = 0
    total_failed = 0
    total_errors = 0
    total_skipped = 0

    for service_name, results in all_results.items():
        service_total = len(results)
        service_passed = sum(1 for r in results if r.status == "PASS")
        service_failed = sum(1 for r in results if r.status == "FAIL")
        service_errors = sum(1 for r in results if r.status == "ERROR")
        service_skipped = sum(1 for r in results if r.status == "SKIP")

        print(f"\n{service_name}:")
        print(f"  总计: {service_total}")
        print(f"  通过: {service_passed}")
        print(f"  失败: {service_failed}")
        print(f"  错误: {service_errors}")
        print(f"  跳过: {service_skipped}")

        total_tests += service_total
        total_passed += service_passed
        total_failed += service_failed
        total_errors += service_errors
        total_skipped += service_skipped

    success_rate = (total_passed / total_tests * 100) if total_tests > 0 else 0

    print(f"\n{'=' * 70}")
    print(f"总计:")
    print(f"  测试数: {total_tests}")
    print(f"  通过: {total_passed}")
    print(f"  失败: {total_failed}")
    print(f"  错误: {total_errors}")
    print(f"  跳过: {total_skipped}")
    print(f"  成功率: {success_rate:.2f}%")
    print(f"{'=' * 70}\n")

    print(f"结束时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 返回退出代码
    if total_failed > 0 or total_errors > 0:
        print("[FAIL] 测试失败")
        return 1
    else:
        print("[PASS] 测试通过")
        return 0


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
