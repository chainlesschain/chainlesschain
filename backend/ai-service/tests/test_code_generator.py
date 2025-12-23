"""
代码生成器测试
"""
import pytest
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.code.code_generator import CodeGenerator
from src.code.code_reviewer import CodeReviewer
from src.code.code_refactorer import CodeRefactorer


class TestCodeGenerator:
    """CodeGenerator测试类"""

    @pytest.fixture
    def code_generator(self):
        """CodeGenerator实例"""
        return CodeGenerator()

    @pytest.mark.asyncio
    async def test_generate_simple_function(self, code_generator):
        """测试生成简单函数"""
        result = await code_generator.generate(
            description="创建一个计算两个数之和的函数",
            language="python",
            style="modern",
            include_tests=False,
            include_comments=True
        )

        assert result is not None
        assert "code" in result
        # 应该包含def关键字（Python函数定义）
        assert "def" in result["code"].lower() or "function" in result.get("description", "").lower()

    @pytest.mark.asyncio
    async def test_generate_with_tests(self, code_generator):
        """测试生成带测试的代码"""
        result = await code_generator.generate(
            description="创建一个判断数字是否为质数的函数",
            language="python",
            include_tests=True
        )

        assert result is not None
        assert "code" in result
        # 如果支持测试生成，应该有tests字段或在code中包含测试
        assert "tests" in result or "test" in result["code"].lower()

    @pytest.mark.asyncio
    async def test_generate_with_context(self, code_generator):
        """测试带上下文的代码生成"""
        context = """
        已有代码:
        class Calculator:
            def add(self, a, b):
                return a + b
        """

        result = await code_generator.generate(
            description="为Calculator类添加subtract方法",
            language="python",
            context=context
        )

        assert result is not None
        assert "code" in result


class TestCodeReviewer:
    """CodeReviewer测试类"""

    @pytest.fixture
    def code_reviewer(self):
        """CodeReviewer实例"""
        return CodeReviewer()

    @pytest.mark.asyncio
    async def test_review_python_code(self, code_reviewer):
        """测试审查Python代码"""
        code = """
def calculate(x, y):
    result = x / y
    return result
"""

        result = await code_reviewer.review(code, "python")

        assert result is not None
        assert "issues" in result or "suggestions" in result or "score" in result

    @pytest.mark.asyncio
    async def test_review_with_focus_areas(self, code_reviewer):
        """测试指定关注领域的审查"""
        code = """
def process_data(data):
    for item in data:
        print(item)
"""

        result = await code_reviewer.review(
            code,
            "python",
            focus_areas=["performance", "security"]
        )

        assert result is not None
        # 应该包含审查结果
        assert any(key in result for key in ["issues", "suggestions", "recommendations", "score"])

    @pytest.mark.asyncio
    async def test_review_javascript_code(self, code_reviewer):
        """测试审查JavaScript代码"""
        code = """
function processArray(arr) {
    let result = [];
    for (var i = 0; i < arr.length; i++) {
        result.push(arr[i] * 2);
    }
    return result;
}
"""

        result = await code_reviewer.review(code, "javascript")

        assert result is not None
        # 应该建议使用const/let而不是var，使用map而不是循环


class TestCodeRefactorer:
    """CodeRefactorer测试类"""

    @pytest.fixture
    def code_refactorer(self):
        """CodeRefactorer实例"""
        return CodeRefactorer()

    @pytest.mark.asyncio
    async def test_refactor_extract_method(self, code_refactorer):
        """测试重构：提取方法"""
        code = """
def process_user_data():
    # 验证用户
    if user.name == "" or user.age < 0:
        return False

    # 保存到数据库
    db.save(user)
    return True
"""

        result = await code_refactorer.refactor(
            code,
            "python",
            refactor_type="extract_method"
        )

        assert result is not None
        assert "refactored_code" in result

    @pytest.mark.asyncio
    async def test_refactor_general(self, code_refactorer):
        """测试通用重构"""
        code = """
def calc(a, b, c):
    x = a + b
    y = x * c
    z = y / 2
    return z
"""

        result = await code_refactorer.refactor(code, "python")

        assert result is not None
        assert "refactored_code" in result

    @pytest.mark.asyncio
    async def test_explain_code(self, code_refactorer):
        """测试代码解释"""
        code = """
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
"""

        result = await code_refactorer.explain(code, "python")

        assert result is not None
        assert isinstance(result, str)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_fix_bug(self, code_refactorer):
        """测试修复Bug"""
        code = """
def divide_numbers(a, b):
    return a / b  # 可能除零错误
"""

        result = await code_refactorer.fix_bug(
            code,
            "python",
            bug_description="可能发生除零错误"
        )

        assert result is not None
        assert "fixed_code" in result
        # 修复后的代码应该包含错误处理
        fixed = result["fixed_code"]
        assert "if" in fixed.lower() or "try" in fixed.lower() or "except" in fixed.lower()

    @pytest.mark.asyncio
    async def test_optimize_code(self, code_refactorer):
        """测试性能优化"""
        code = """
def find_duplicates(arr):
    result = []
    for i in range(len(arr)):
        for j in range(i+1, len(arr)):
            if arr[i] == arr[j]:
                result.append(arr[i])
    return result
"""

        result = await code_refactorer.optimize(code, "python")

        assert result is not None
        assert "optimized_code" in result

    @pytest.mark.asyncio
    async def test_refactor_with_target(self, code_refactorer):
        """测试带目标的重构"""
        code = """
class UserManager:
    def __init__(self):
        self.users = []

    def add_user(self, user):
        self.users.append(user)
"""

        result = await code_refactorer.refactor(
            code,
            "python",
            refactor_type="rename_variable",
            target="users"
        )

        assert result is not None
        assert "refactored_code" in result


class TestCodeGeneratorEdgeCases:
    """代码生成器边缘情况测试"""

    @pytest.fixture
    def code_generator(self):
        return CodeGenerator()

    @pytest.mark.asyncio
    async def test_generate_empty_description(self, code_generator):
        """测试空描述"""
        try:
            result = await code_generator.generate(
                description="",
                language="python"
            )
            # 应该处理空描述或返回错误
            assert result is not None
        except Exception as e:
            # 允许抛出异常
            assert isinstance(e, (ValueError, RuntimeError))

    @pytest.mark.asyncio
    async def test_generate_unsupported_language(self, code_generator):
        """测试不支持的语言"""
        result = await code_generator.generate(
            description="创建一个函数",
            language="unknown_language"
        )

        # 应该优雅处理或返回错误信息
        assert result is not None

    @pytest.mark.asyncio
    async def test_generate_complex_requirement(self, code_generator):
        """测试复杂需求"""
        description = """
        创建一个完整的用户认证系统，包括:
        1. 用户注册
        2. 用户登录
        3. 密码加密
        4. JWT令牌生成
        5. 中间件验证
        """

        result = await code_generator.generate(
            description=description,
            language="python",
            style="modern",
            include_tests=True,
            include_comments=True
        )

        assert result is not None
        assert "code" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
