"""
项目服务 (Spring Boot) 接口测试
端口: 9090
"""
from test_framework import APITester, validate_success_response, validate_has_data
import uuid


class ProjectServiceTester(APITester):
    def __init__(self, base_url: str = "http://localhost:9090"):
        super().__init__(base_url)
        self.test_project_id = None
        self.test_file_id = None

    def test_health(self):
        self.run_test(
            name="项目服务健康检查",
            method="GET",
            endpoint="/api/projects/health",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_create_project(self):
        project_data = {
            "name": f"测试项目_{uuid.uuid4().hex[:8]}",
            "description": "这是一个自动化测试项目",
            "projectType": "web",
            "userId": "test_user_001",
            "template": "basic"
        }

        result = self.run_test(
            name="创建项目",
            method="POST",
            endpoint="/api/projects/create",
            data=project_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r) or validate_has_data(r)
        )

        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict) and "projectId" in data:
                self.test_project_id = data["projectId"]
            elif isinstance(data, dict) and "id" in data:
                self.test_project_id = data["id"]

    def test_list_projects(self):
        self.run_test(
            name="获取项目列表",
            method="GET",
            endpoint="/api/projects/list",
            params={"pageNum": 1, "pageSize": 10},
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def run_all_tests(self):
        print("
" + "="*60)
        print("开始测试项目服务 (Spring Boot)")
        print("="*60 + "
")

        self.test_health()
        self.test_create_project()
        self.test_list_projects()


if __name__ == "__main__":
    tester = ProjectServiceTester()
    tester.run_all_tests()
    tester.generate_report()
