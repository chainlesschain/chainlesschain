"""
主测试运行脚本 - 支持基础和完整测试
运行所有后端接口测试并生成综合报告
"""
import argparse
import sys
from datetime import datetime
from test_project_service import ProjectServiceTester
from test_ai_service import AIServiceTester
from test_project_service_full import ProjectServiceTester as ProjectServiceTesterFull
from test_ai_service_full import AIServiceTester as AIServiceTesterFull


def main():
    parser = argparse.ArgumentParser(description='ChainlessChain后端接口测试')
    parser.add_argument('--service', choices=['all', 'project', 'ai'], default='all',
                        help='选择要测试的服务 (默认: all)')
    parser.add_argument('--mode', choices=['basic', 'full'], default='basic',
                        help='测试模式: basic=基础测试(11个), full=完整测试(60+个) (默认: basic)')
    parser.add_argument('--project-url', default='http://localhost:9090',
                        help='项目服务URL (默认: http://localhost:9090)')
    parser.add_argument('--ai-url', default='http://localhost:8001',
                        help='AI服务URL (默认: http://localhost:8001)')
    args = parser.parse_args()

    print("="*80)
    print("ChainlessChain 后端接口自动化测试")
    print(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"测试模式: {args.mode.upper()} ({'基础测试 (11个接口)' if args.mode == 'basic' else '完整测试 (60+接口)'})")
    print("="*80)

    all_results = []

    # 选择测试器类
    if args.mode == 'full':
        ProjectTesterClass = ProjectServiceTesterFull
        AITesterClass = AIServiceTesterFull
    else:
        ProjectTesterClass = ProjectServiceTester
        AITesterClass = AIServiceTester

    # 测试项目服务
    if args.service in ['all', 'project']:
        print("\n[1/2] 测试项目服务 (Spring Boot)...")
        project_tester = ProjectTesterClass(args.project_url)
        project_tester.run_all_tests()

        # 生成报告文件名
        report_prefix = f"test_report_project_{args.mode}"
        project_tester.reporter.generate_markdown_report(f"{report_prefix}.md")
        project_tester.reporter.generate_json_report(f"{report_prefix}.json")

        all_results.append(('项目服务', project_tester.reporter.get_summary()))

    # 测试AI服务
    if args.service in ['all', 'ai']:
        print("\n[2/2] 测试AI服务 (FastAPI)...")
        ai_tester = AITesterClass(args.ai_url)
        ai_tester.run_all_tests()

        # 生成报告文件名
        report_prefix = f"test_report_ai_{args.mode}"
        ai_tester.reporter.generate_markdown_report(f"{report_prefix}.md")
        ai_tester.reporter.generate_json_report(f"{report_prefix}.json")

        all_results.append(('AI服务', ai_tester.reporter.get_summary()))

    # 打印综合摘要
    print("\n" + "="*80)
    print("综合测试摘要")
    print("="*80)

    total_tests = sum(r[1]['total'] for r in all_results)
    total_passed = sum(r[1]['passed'] for r in all_results)
    total_failed = sum(r[1]['failed'] for r in all_results)
    total_errors = sum(r[1]['error'] for r in all_results)

    for service_name, summary in all_results:
        print(f"\n{service_name}:")
        print(f"  总数: {summary['total']}, 通过: {summary['passed']}, "
              f"失败: {summary['failed']}, 错误: {summary['error']}")
        print(f"  成功率: {summary['success_rate']}, 耗时: {summary['duration']:.2f}s")

    print(f"\n整体统计:")
    print(f"  总测试数: {total_tests}")
    print(f"  总通过: {total_passed}")
    print(f"  总失败: {total_failed}")
    print(f"  总错误: {total_errors}")
    if total_tests > 0:
        overall_success_rate = (total_passed / total_tests * 100)
        print(f"  整体成功率: {overall_success_rate:.2f}%")

        if overall_success_rate == 100:
            print("\n  ✅ 恭喜！所有测试通过！")
        elif overall_success_rate >= 80:
            print("\n  ⚠️  大部分测试通过，但仍有部分问题需要修复")
        else:
            print("\n  ❌ 测试通过率较低，需要重点关注")

    print("="*80)

    # 如果有失败或错误，返回非零退出码
    if total_failed > 0 or total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
