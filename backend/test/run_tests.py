"""
主测试运行脚本
运行所有后端接口测试并生成综合报告
"""
import argparse
import sys
from datetime import datetime
from test_project_service import ProjectServiceTester
from test_ai_service import AIServiceTester


def main():
    parser = argparse.ArgumentParser(description='ChainlessChain后端接口测试')
    parser.add_argument('--service', choices=['all', 'project', 'ai'], default='all',
                        help='选择要测试的服务 (默认: all)')
    parser.add_argument('--project-url', default='http://localhost:9090',
                        help='项目服务URL (默认: http://localhost:9090)')
    parser.add_argument('--ai-url', default='http://localhost:8001',
                        help='AI服务URL (默认: http://localhost:8001)')
    args = parser.parse_args()

    print("="*80)
    print("ChainlessChain 后端接口自动化测试")
    print(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)

    all_results = []

    # 测试项目服务
    if args.service in ['all', 'project']:
        print("
[1/2] 测试项目服务 (Spring Boot)...")
        project_tester = ProjectServiceTester(args.project_url)
        project_tester.run_all_tests()
        project_tester.generate_report(
            markdown=True,
            json_report=True
        )
        all_results.append(('项目服务', project_tester.reporter.get_summary()))

    # 测试AI服务
    if args.service in ['all', 'ai']:
        print("
[2/2] 测试AI服务 (FastAPI)...")
        ai_tester = AIServiceTester(args.ai_url)
        ai_tester.run_all_tests()
        ai_tester.generate_report(
            markdown=True,
            json_report=True
        )
        all_results.append(('AI服务', ai_tester.reporter.get_summary()))

    # 打印综合摘要
    print("
" + "="*80)
    print("综合测试摘要")
    print("="*80)

    total_tests = sum(r[1]['total'] for r in all_results)
    total_passed = sum(r[1]['passed'] for r in all_results)
    total_failed = sum(r[1]['failed'] for r in all_results)
    total_errors = sum(r[1]['error'] for r in all_results)

    for service_name, summary in all_results:
        print(f"
{service_name}:")
        print(f"  总数: {summary['total']}, 通过: {summary['passed']}, "
              f"失败: {summary['failed']}, 错误: {summary['error']}")
        print(f"  成功率: {summary['success_rate']}, 耗时: {summary['duration']:.2f}s")

    print(f"
整体统计:")
    print(f"  总测试数: {total_tests}")
    print(f"  总通过: {total_passed}")
    print(f"  总失败: {total_failed}")
    print(f"  总错误: {total_errors}")
    if total_tests > 0:
        print(f"  整体成功率: {(total_passed / total_tests * 100):.2f}%")

    print("="*80)

    # 如果有失败或错误，返回非零退出码
    if total_failed > 0 or total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
