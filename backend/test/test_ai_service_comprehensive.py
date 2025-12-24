"""
AI服务 (FastAPI) 全面接口测试
覆盖所有API端点
端口: 8001
"""
from test_framework import APITester, validate_success_response, validate_has_data
import uuid
import os


class AIServiceComprehensiveTester(APITester):
    def __init__(self, base_url: str = "http://localhost:8001"):
        super().__init__(base_url)
        self.test_project_id = None
        self.test_repo_path = "C:/code/chainlesschain"

    # ========================================
    # Basic Health Tests
    # ========================================
    def test_root(self):
        """测试根路径"""
        self.run_test(
            name="[Root] AI服务根路径",
            method="GET",
            endpoint="/",
            expected_status=200
        )

    def test_health(self):
        """测试健康检查"""
        self.run_test(
            name="[Health] AI服务健康检查",
            method="GET",
            endpoint="/health",
            expected_status=200
        )

    # ========================================
    # Intent Classification Tests
    # ========================================
    def test_intent_classify_create_project(self):
        """测试意图识别 - 创建项目"""
        request_data = {
            "text": "我想创建一个待办事项网页应用",
            "context": []
        }

        self.run_test(
            name="[Intent] 意图识别 - 创建项目",
            method="POST",
            endpoint="/api/intent/classify",
            data=request_data,
            expected_status=200
        )

    def test_intent_classify_generate_code(self):
        """测试意图识别 - 生成代码"""
        request_data = {
            "text": "帮我写一个Python函数计算斐波那契数列",
            "context": []
        }

        self.run_test(
            name="[Intent] 意图识别 - 生成代码",
            method="POST",
            endpoint="/api/intent/classify",
            data=request_data,
            expected_status=200
        )

    # ========================================
    # Project Creation Tests
    # ========================================
    def test_create_project_web(self):
        """测试创建Web项目"""
        request_data = {
            "user_prompt": "创建一个简单的HTML页面，显示Hello World",
            "project_type": "web"
        }

        result = self.run_test(
            name="[Project] 创建Web项目",
            method="POST",
            endpoint="/api/projects/create",
            data=request_data,
            expected_status=200
        )

        # 提取项目ID
        if result.response_data and "result" in result.response_data:
            res = result.response_data["result"]
            if isinstance(res, dict) and "project_id" in res:
                self.test_project_id = res["project_id"]

    def test_create_project_data(self):
        """测试创建数据分析项目"""
        request_data = {
            "user_prompt": "创建一个数据分析项目，分析销售数据",
            "project_type": "data"
        }

        self.run_test(
            name="[Project] 创建数据分析项目",
            method="POST",
            endpoint="/api/projects/create",
            data=request_data,
            expected_status=200
        )

    def test_create_project_document(self):
        """测试创建文档项目"""
        request_data = {
            "user_prompt": "帮我写一份技术文档",
            "project_type": "document"
        }

        self.run_test(
            name="[Project] 创建文档项目",
            method="POST",
            endpoint="/api/projects/create",
            data=request_data,
            expected_status=200
        )

    # ========================================
    # Task Execution Tests
    # ========================================
    def test_execute_task(self):
        """测试执行任务"""
        if not self.test_project_id:
            self.test_project_id = f"test_project_{uuid.uuid4().hex[:8]}"

        request_data = {
            "project_id": self.test_project_id,
            "user_prompt": "在项目中添加一个新功能：用户登录",
            "context": []
        }

        self.run_test(
            name="[Task] 执行任务 - 添加功能",
            method="POST",
            endpoint="/api/tasks/execute",
            data=request_data,
            expected_status=200
        )

    # ========================================
    # RAG (Retrieval Augmented Generation) Tests
    # ========================================
    def test_rag_query_simple(self):
        """测试RAG查询 - 简单查询"""
        self.run_test(
            name="[RAG] 简单知识查询",
            method="POST",
            endpoint="/api/rag/query",
            params={"query": "什么是机器学习"},
            expected_status=200
        )

    def test_rag_query_technical(self):
        """测试RAG查询 - 技术查询"""
        self.run_test(
            name="[RAG] 技术知识查询",
            method="POST",
            endpoint="/api/rag/query",
            params={"query": "如何使用React Hooks"},
            expected_status=200
        )

    def test_rag_query_enhanced(self):
        """测试增强RAG查询"""
        request_data = {
            "query": "ChainlessChain的架构设计",
            "top_k": 5,
            "score_threshold": 0.7
        }

        self.run_test(
            name="[RAG] 增强知识查询",
            method="POST",
            endpoint="/api/rag/query/enhanced",
            data=request_data,
            expected_status=200
        )

    def test_rag_index_project(self):
        """测试索引项目"""
        if not self.test_project_id:
            self.test_project_id = f"test_project_{uuid.uuid4().hex[:8]}"

        request_data = {
            "project_id": self.test_project_id,
            "project_path": self.test_repo_path,
            "file_patterns": ["*.py", "*.js", "*.md"]
        }

        self.run_test(
            name="[RAG] 索引项目文件",
            method="POST",
            endpoint="/api/rag/index/project",
            data=request_data,
            expected_status=200
        )

    def test_rag_index_stats(self):
        """测试获取索引统计"""
        self.run_test(
            name="[RAG] 获取索引统计",
            method="GET",
            endpoint="/api/rag/index/stats",
            expected_status=200
        )

    def test_rag_update_file(self):
        """测试更新文件索引"""
        request_data = {
            "project_id": self.test_project_id or "test_project",
            "file_path": "/test/sample.py",
            "content": "# Sample Python file\nprint('Hello World')"
        }

        self.run_test(
            name="[RAG] 更新文件索引",
            method="POST",
            endpoint="/api/rag/index/update-file",
            data=request_data,
            expected_status=200
        )

    # ========================================
    # Git Operations Tests
    # ========================================
    def test_git_status(self):
        """测试Git状态查询"""
        self.run_test(
            name="[Git] 查询Git状态",
            method="GET",
            endpoint="/api/git/status",
            params={"repo_path": self.test_repo_path},
            expected_status=200
        )

    def test_git_log(self):
        """测试Git日志查询"""
        self.run_test(
            name="[Git] 查询Git日志",
            method="GET",
            endpoint="/api/git/log",
            params={"repo_path": self.test_repo_path, "max_count": 10},
            expected_status=200
        )

    def test_git_diff(self):
        """测试Git差异查询"""
        self.run_test(
            name="[Git] 查询Git差异",
            method="GET",
            endpoint="/api/git/diff",
            params={"repo_path": self.test_repo_path},
            expected_status=200
        )

    def test_git_branches(self):
        """测试Git分支列表"""
        self.run_test(
            name="[Git] 获取分支列表",
            method="GET",
            endpoint="/api/git/branches",
            params={"repo_path": self.test_repo_path},
            expected_status=200
        )

    def test_git_generate_commit_message(self):
        """测试生成提交信息"""
        request_data = {
            "repo_path": self.test_repo_path,
            "diff": "diff --git a/test.py b/test.py\n+print('new line')"
        }

        self.run_test(
            name="[Git] 生成提交信息",
            method="POST",
            endpoint="/api/git/generate-commit-message",
            data=request_data,
            expected_status=200
        )

    def test_git_init(self):
        """测试Git初始化"""
        test_repo = f"C:/temp/test_repo_{uuid.uuid4().hex[:8]}"

        request_data = {
            "repo_path": test_repo
        }

        self.run_test(
            name="[Git] 初始化仓库",
            method="POST",
            endpoint="/api/git/init",
            data=request_data,
            expected_status=200
        )

    # ========================================
    # Code Generation Tests
    # ========================================
    def test_code_generate_python(self):
        """测试Python代码生成"""
        request_data = {
            "description": "创建一个Python函数，计算斐波那契数列",
            "language": "python",
            "style": "modern",
            "include_tests": False,
            "include_comments": True
        }

        self.run_test(
            name="[Code] 生成Python代码",
            method="POST",
            endpoint="/api/code/generate",
            data=request_data,
            expected_status=200
        )

    def test_code_generate_javascript(self):
        """测试JavaScript代码生成"""
        request_data = {
            "description": "创建一个JavaScript函数，实现防抖功能",
            "language": "javascript",
            "style": "modern",
            "include_tests": True,
            "include_comments": True
        }

        self.run_test(
            name="[Code] 生成JavaScript代码",
            method="POST",
            endpoint="/api/code/generate",
            data=request_data,
            expected_status=200
        )

    def test_code_explain(self):
        """测试代码解释"""
        request_data = {
            "code": """
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
""",
            "language": "python"
        }

        self.run_test(
            name="[Code] 解释代码",
            method="POST",
            endpoint="/api/code/explain",
            data=request_data,
            expected_status=200
        )

    def test_code_review(self):
        """测试代码审查"""
        request_data = {
            "code": """
function calculateTotal(items) {
    var total = 0;
    for (var i = 0; i < items.length; i++) {
        total += items[i].price * items[i].quantity;
    }
    return total;
}
""",
            "language": "javascript",
            "focus_areas": ["performance", "best_practices", "security"]
        }

        self.run_test(
            name="[Code] 审查代码",
            method="POST",
            endpoint="/api/code/review",
            data=request_data,
            expected_status=200
        )

    def test_code_refactor(self):
        """测试代码重构"""
        request_data = {
            "code": """
def calc(a, b, op):
    if op == '+':
        return a + b
    elif op == '-':
        return a - b
    elif op == '*':
        return a * b
    elif op == '/':
        return a / b
""",
            "language": "python",
            "refactor_goals": ["improve_readability", "add_error_handling"]
        }

        self.run_test(
            name="[Code] 重构代码",
            method="POST",
            endpoint="/api/code/refactor",
            data=request_data,
            expected_status=200
        )

    def test_code_fix_bug(self):
        """测试修复bug"""
        request_data = {
            "code": """
def divide(a, b):
    return a / b
""",
            "bug_description": "没有处理除零错误",
            "language": "python"
        }

        self.run_test(
            name="[Code] 修复Bug",
            method="POST",
            endpoint="/api/code/fix-bug",
            data=request_data,
            expected_status=200
        )

    def test_code_generate_tests(self):
        """测试生成测试代码"""
        request_data = {
            "code": """
def add(a, b):
    return a + b

def subtract(a, b):
    return a - b
""",
            "language": "python",
            "test_framework": "pytest"
        }

        self.run_test(
            name="[Code] 生成测试代码",
            method="POST",
            endpoint="/api/code/generate-tests",
            data=request_data,
            expected_status=200
        )

    def test_code_optimize(self):
        """测试代码优化"""
        request_data = {
            "code": """
def find_duplicates(arr):
    duplicates = []
    for i in range(len(arr)):
        for j in range(i+1, len(arr)):
            if arr[i] == arr[j] and arr[i] not in duplicates:
                duplicates.append(arr[i])
    return duplicates
""",
            "language": "python",
            "optimization_focus": "performance"
        }

        self.run_test(
            name="[Code] 优化代码",
            method="POST",
            endpoint="/api/code/optimize",
            data=request_data,
            expected_status=200
        )

    # ========================================
    # Git Advanced Operations (Write operations)
    # ========================================
    def test_git_create_branch(self):
        """测试创建Git分支"""
        request_data = {
            "repo_path": self.test_repo_path,
            "branch_name": f"test-branch-{uuid.uuid4().hex[:8]}"
        }

        self.run_test(
            name="[Git] 创建分支",
            method="POST",
            endpoint="/api/git/branch/create",
            data=request_data,
            expected_status=200
        )

    def test_git_checkout_branch(self):
        """测试切换Git分支"""
        request_data = {
            "repo_path": self.test_repo_path,
            "branch_name": "main"
        }

        self.run_test(
            name="[Git] 切换分支",
            method="POST",
            endpoint="/api/git/branch/checkout",
            data=request_data,
            expected_status=200
        )

    # ========================================
    # Cleanup Tests
    # ========================================
    def test_rag_delete_project_index(self):
        """测试删除项目索引"""
        if not self.test_project_id:
            print("  跳过：没有可用的项目ID")
            return

        self.run_test(
            name="[RAG] 删除项目索引",
            method="DELETE",
            endpoint=f"/api/rag/index/project/{self.test_project_id}",
            expected_status=200
        )

    # ========================================
    # Run All Tests
    # ========================================
    def run_all_tests(self):
        """运行所有测试（按功能分组）"""
        print("\n" + "="*80)
        print("开始全面测试AI服务 (FastAPI) - 所有API端点")
        print("="*80 + "\n")

        # 1. Basic Health
        print("\n--- 基础健康检查 ---")
        self.test_root()
        self.test_health()

        # 2. Intent Classification
        print("\n--- 意图识别 ---")
        self.test_intent_classify_create_project()
        self.test_intent_classify_generate_code()

        # 3. Project Creation
        print("\n--- 项目创建 ---")
        self.test_create_project_web()
        self.test_create_project_data()
        self.test_create_project_document()

        # 4. Task Execution
        print("\n--- 任务执行 ---")
        self.test_execute_task()

        # 5. RAG Operations
        print("\n--- RAG知识检索 ---")
        self.test_rag_query_simple()
        self.test_rag_query_technical()
        self.test_rag_query_enhanced()
        self.test_rag_index_project()
        self.test_rag_index_stats()
        self.test_rag_update_file()

        # 6. Git Operations
        print("\n--- Git操作 ---")
        self.test_git_status()
        self.test_git_log()
        self.test_git_diff()
        self.test_git_branches()
        self.test_git_generate_commit_message()
        self.test_git_init()
        self.test_git_create_branch()
        self.test_git_checkout_branch()

        # 7. Code Operations
        print("\n--- 代码生成与分析 ---")
        self.test_code_generate_python()
        self.test_code_generate_javascript()
        self.test_code_explain()
        self.test_code_review()
        self.test_code_refactor()
        self.test_code_fix_bug()
        self.test_code_generate_tests()
        self.test_code_optimize()

        # 8. Cleanup
        print("\n--- 清理资源 ---")
        self.test_rag_delete_project_index()


if __name__ == "__main__":
    tester = AIServiceComprehensiveTester()
    tester.run_all_tests()
    tester.generate_report(
        markdown=True,
        json_report=True
    )
