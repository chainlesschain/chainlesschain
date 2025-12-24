"""
AI服务 (FastAPI) 接口测试
端口: 8001
"""
from test_framework import APITester, validate_success_response, validate_has_data
import uuid


class AIServiceTester(APITester):
    def __init__(self, base_url: str = "http://localhost:8001"):
        super().__init__(base_url)
        self.test_project_id = None

    def test_health(self):
        self.run_test(
            name="AI服务健康检查",
            method="GET",
            endpoint="/health",
            expected_status=200
        )

    def test_root(self):
        self.run_test(
            name="AI服务根路径",
            method="GET",
            endpoint="/",
            expected_status=200
        )

    def test_intent_classify(self):
        request_data = {
            "text": "创建一个待办事项网页应用",
            "context": []
        }

        self.run_test(
            name="意图识别",
            method="POST",
            endpoint="/api/intent/classify",
            data=request_data,
            expected_status=200
        )

    def test_create_project(self):
        request_data = {
            "user_prompt": "创建一个简单的HTML页面，显示Hello World",
            "project_type": "web"
        }

        result = self.run_test(
            name="AI创建项目",
            method="POST",
            endpoint="/api/projects/create",
            data=request_data,
            expected_status=200
        )

        if result.response_data and "result" in result.response_data:
            res = result.response_data["result"]
            if isinstance(res, dict) and "project_id" in res:
                self.test_project_id = res["project_id"]

    def test_rag_query(self):
        self.run_test(
            name="RAG知识检索",
            method="POST",
            endpoint="/api/rag/query",
            params={"query": "什么是机器学习"},
            expected_status=200
        )

    def test_git_status(self):
        self.run_test(
            name="Git状态查询",
            method="GET",
            endpoint="/api/git/status",
            params={"repo_path": "C:/code/chainlesschain"},
            expected_status=200
        )

    def test_code_generate(self):
        request_data = {
            "description": "创建一个Python函数，计算斐波那契数列",
            "language": "python",
            "style": "modern",
            "include_tests": False,
            "include_comments": True
        }

        self.run_test(
            name="代码生成",
            method="POST",
            endpoint="/api/code/generate",
            data=request_data,
            expected_status=200
        )

    def test_code_explain(self):
        request_data = {
            "code": "def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)",
            "language": "python"
        }

        self.run_test(
            name="代码解释",
            method="POST",
            endpoint="/api/code/explain",
            data=request_data,
            expected_status=200
        )

    def run_all_tests(self):
        print("
" + "="*60)
        print("开始测试AI服务 (FastAPI)")
        print("="*60 + "
")

        self.test_root()
        self.test_health()
        self.test_intent_classify()
        self.test_create_project()
        self.test_rag_query()
        self.test_git_status()
        self.test_code_generate()
        self.test_code_explain()


if __name__ == "__main__":
    tester = AIServiceTester()
    tester.run_all_tests()
    tester.generate_report()
