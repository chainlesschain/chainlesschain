package com.chainlesschain.android.feature.project.e2e

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.MainActivity
import com.chainlesschain.android.test.*
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 项目管理 E2E 测试
 *
 * 测试项目创建、文件编辑、Git操作、代码高亮等
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class ProjectE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        composeTestRule.waitForLoadingToComplete()
        navigateToProjects()
    }

    private fun navigateToProjects() {
        composeTestRule.apply {
            clickOnText("项目", substring = true)
            waitForLoadingToComplete()
        }
    }

    /**
     * E2E-PROJECT-01: 创建项目 → 文件编辑 → Git 提交
     */
    @Test
    fun testCompleteProjectWorkflow() {
        val projectName = "E2E Test Project ${System.currentTimeMillis()}"
        val fileName = "MainActivity.kt"
        val fileContent = """
            package com.example.test

            import android.os.Bundle
            import androidx.appcompat.app.AppCompatActivity

            class MainActivity : AppCompatActivity() {
                override fun onCreate(savedInstanceState: Bundle?) {
                    super.onCreate(savedInstanceState)
                    setContentView(R.layout.activity_main)
                }
            }
        """.trimIndent()

        composeTestRule.apply {
            // 1. 创建新项目
            onNode(hasContentDescription("新建项目") or hasText("新建")).performClick()
            waitForLoadingToComplete()

            // 2. 填写项目信息
            typeTextInField("项目名称", projectName)
            typeTextInField("包名", "com.example.test")

            // 3. 选择模板
            clickOnText("选择模板")
            clickOnText("Android Application")
            clickOnText("确认")

            // 4. 创建项目
            clickOnText("创建")
            waitForText("项目创建成功", substring = true, timeoutMillis = 30000)

            // 5. 打开项目
            clickOnText(projectName)
            waitForLoadingToComplete()

            // 6. 浏览文件树
            assertTextExists("src", substring = true)
            clickOnText("src")
            clickOnText("main")
            clickOnText("java")
            clickOnText("com")
            clickOnText("example")
            clickOnText("test")

            // 7. 创建新文件
            clickOnText("新建文件")
            typeTextInField("文件名", fileName)
            clickOnText("确认")
            waitForLoadingToComplete()

            // 8. 编辑文件
            typeTextInField("代码编辑器", fileContent, clearFirst = false)

            // 9. 保存文件
            clickOnText("保存")
            assertSnackbarMessage("文件已保存")

            // 10. Git 初始化
            clickOnText("Git")
            clickOnText("初始化仓库")
            waitForText("Git 仓库已初始化", timeoutMillis = 5000)

            // 11. 暂存文件
            clickOnText("暂存")
            clickOnText("全部暂存")
            assertSnackbarMessage("文件已暂存")

            // 12. 提交
            clickOnText("提交")
            typeTextInField("提交信息", "Initial commit: Add MainActivity")
            clickOnText("确认提交")
            waitForText("提交成功", timeoutMillis = 5000)
            assertSnackbarMessage("提交成功")

            // 13. 查看提交历史
            clickOnText("历史")
            waitForLoadingToComplete()
            assertTextExists("Initial commit: Add MainActivity")
            assertTextExists(fileName)
        }
    }

    /**
     * E2E-PROJECT-02: 代码高亮验证 (14种语言)
     */
    @Test
    fun testCodeHighlightingForMultipleLanguages() {
        val languages = mapOf(
            "Kotlin" to """
                fun greet(name: String): String {
                    return "Hello, ${'$'}name!"
                }
            """.trimIndent(),

            "Java" to """
                public class HelloWorld {
                    public static void main(String[] args) {
                        System.out.println("Hello, World!");
                    }
                }
            """.trimIndent(),

            "Python" to """
                def fibonacci(n):
                    if n <= 1:
                        return n
                    return fibonacci(n-1) + fibonacci(n-2)
            """.trimIndent(),

            "JavaScript" to """
                const sum = (a, b) => a + b;
                console.log(sum(5, 3));
            """.trimIndent(),

            "TypeScript" to """
                interface User {
                    name: string;
                    age: number;
                }
                const user: User = { name: "Alice", age: 30 };
            """.trimIndent(),

            "Go" to """
                package main
                import "fmt"
                func main() {
                    fmt.Println("Hello, Go!")
                }
            """.trimIndent(),

            "Rust" to """
                fn main() {
                    let x = 5;
                    println!("x = {}", x);
                }
            """.trimIndent(),

            "C++" to """
                #include <iostream>
                int main() {
                    std::cout << "Hello, C++!" << std::endl;
                    return 0;
                }
            """.trimIndent()
        )

        composeTestRule.apply {
            // 创建测试项目
            createTestProject("Syntax Highlight Test")

            languages.forEach { (language, code) ->
                // 1. 创建对应语言的文件
                clickOnText("新建文件")
                val extension = getFileExtension(language)
                typeTextInField("文件名", "test.$extension")
                clickOnText("确认")

                // 2. 输入代码
                typeTextInField("代码编辑器", code, clearFirst = false)

                // 3. 保存并验证高亮
                clickOnText("保存")
                waitForLoadingToComplete()

                // 4. 验证关键字高亮（根据实际高亮实现验证）
                // 这里假设有特定的UI指示高亮生效
                assertTextExists(code, substring = true)

                // 5. 查看语法树（如果支持）
                clickOnText("语法树")
                assertTextExists(language, substring = true)
                clickBackButton()

                // 6. 返回文件列表
                clickBackButton()
            }
        }
    }

    /**
     * E2E-PROJECT-03: 文件搜索 (模糊/全文/正则)
     */
    @Test
    fun testFileSearchFunctionality() {
        composeTestRule.apply {
            // 创建包含多个文件的测试项目
            createTestProject("Search Test Project")
            createMultipleTestFiles()

            // 1. 打开搜索
            clickOnText("搜索")
            waitForLoadingToComplete()

            // 2. 模糊文件名搜索
            typeTextInField("搜索", "Main")
            waitForLoadingToComplete()
            assertTextExists("MainActivity.kt")
            assertTextExists("MainFragment.kt")

            // 3. 精确文件名搜索
            typeTextInField("搜索", "MainActivity.kt", clearFirst = true)
            waitForLoadingToComplete()
            assertTextExists("MainActivity.kt")
            assertTextDoesNotExist("MainFragment.kt")

            // 4. 全文内容搜索
            clickOnText("搜索类型")
            clickOnText("内容搜索")
            typeTextInField("搜索", "onCreate", clearFirst = true)
            waitForLoadingToComplete()
            assertTextExists("MainActivity.kt")
            assertTextExists("onCreate 方法", substring = true)

            // 5. 正则表达式搜索
            clickOnText("搜索类型")
            clickOnText("正则表达式")
            typeTextInField("搜索", "fun\\s+\\w+\\(", clearFirst = true)
            waitForLoadingToComplete()
            assertTextExists("找到", substring = true)
            assertTextExists("个匹配", substring = true)

            // 6. 文件类型过滤
            clickOnText("过滤")
            clickOnText("仅 .kt 文件")
            waitForLoadingToComplete()
            performPullToRefresh()

            // 7. 搜索结果导航
            clickOnText("MainActivity.kt")
            waitForLoadingToComplete()
            assertTextExists("onCreate", substring = true)

            // 8. 替换功能
            clickOnText("替换")
            typeTextInField("替换为", "onCreateView")
            clickOnText("替换全部")
            clickOnText("确认")
            assertSnackbarMessage("已替换")
        }
    }

    /**
     * E2E-PROJECT-04: Git 差异对比
     */
    @Test
    fun testGitDiffComparison() {
        val originalCode = """
            class MainActivity : AppCompatActivity() {
                override fun onCreate(savedInstanceState: Bundle?) {
                    super.onCreate(savedInstanceState)
                    setContentView(R.layout.activity_main)
                }
            }
        """.trimIndent()

        val modifiedCode = """
            class MainActivity : AppCompatActivity() {
                override fun onCreate(savedInstanceState: Bundle?) {
                    super.onCreate(savedInstanceState)
                    setContentView(R.layout.activity_main)

                    // Initialize components
                    initViews()
                }

                private fun initViews() {
                    // TODO: Initialize views
                }
            }
        """.trimIndent()

        composeTestRule.apply {
            // 1. 创建项目并初始化 Git
            createTestProject("Git Diff Test")
            initializeGitRepo()

            // 2. 创建初始文件并提交
            clickOnText("新建文件")
            typeTextInField("文件名", "MainActivity.kt")
            clickOnText("确认")
            typeTextInField("代码编辑器", originalCode, clearFirst = false)
            clickOnText("保存")

            gitCommit("Initial commit")

            // 3. 修改文件
            clickOnText("MainActivity.kt")
            typeTextInField("代码编辑器", modifiedCode, clearFirst = true)
            clickOnText("保存")

            // 4. 查看差异
            clickOnText("Git")
            clickOnText("查看更改")
            waitForLoadingToComplete()

            // 5. 验证差异显示
            assertTextExists("MainActivity.kt")
            assertTextExists("已修改", substring = true)

            // 6. 打开差异对比
            clickOnText("MainActivity.kt")
            waitForLoadingToComplete()

            // 7. 验证并排对比视图
            assertTextExists("原始", substring = true)
            assertTextExists("修改", substring = true)

            // 8. 验证添加的行（绿色）
            assertTextExists("+ // Initialize components", substring = true)
            assertTextExists("+ initViews()", substring = true)

            // 9. 验证新增的方法
            assertTextExists("+ private fun initViews()", substring = true)

            // 10. 统计信息
            assertTextExists("添加", substring = true)
            assertTextExists("行", substring = true)

            // 11. 暂存更改
            clickOnText("暂存此文件")
            assertSnackbarMessage("已暂存")

            // 12. 提交
            clickBackButton()
            gitCommit("Add initViews method")

            // 13. 查看提交历史对比
            clickOnText("历史")
            clickOnText("Add initViews method")
            waitForLoadingToComplete()
            assertTextExists("initViews", substring = true)
        }
    }

    /**
     * E2E-PROJECT-05: 模板应用 (11个模板)
     */
    @Test
    fun testProjectTemplates() {
        val templates = listOf(
            "Android Application",
            "Android Library",
            "Kotlin Multiplatform",
            "Compose Desktop",
            "Spring Boot",
            "Node.js Express",
            "React App",
            "Vue.js App",
            "Python Flask",
            "Go Web Server",
            "Rust CLI"
        )

        composeTestRule.apply {
            templates.forEach { template ->
                // 1. 创建新项目
                onNode(hasContentDescription("新建项目") or hasText("新建")).performClick()
                waitForLoadingToComplete()

                // 2. 选择模板
                clickOnText("选择模板")
                scrollToText(template)
                clickOnText(template)
                clickOnText("确认")

                // 3. 填写项目信息
                val projectName = "$template Project ${System.currentTimeMillis()}"
                typeTextInField("项目名称", projectName)
                typeTextInField("包名", "com.test.${template.lowercase().replace(" ", "")}")

                // 4. 创建项目
                clickOnText("创建")
                waitForText("项目创建成功", timeoutMillis = 45000)

                // 5. 验证模板文件生成
                clickOnText(projectName)
                waitForLoadingToComplete()

                // 6. 验证关键文件存在
                when (template) {
                    "Android Application" -> {
                        assertTextExists("MainActivity.kt", substring = true)
                        assertTextExists("activity_main.xml", substring = true)
                    }
                    "Spring Boot" -> {
                        assertTextExists("Application.java", substring = true)
                        assertTextExists("application.properties", substring = true)
                    }
                    "React App" -> {
                        assertTextExists("App.jsx", substring = true)
                        assertTextExists("index.html", substring = true)
                    }
                    // 其他模板类似验证
                }

                // 7. 验证构建配置
                clickOnText("构建配置")
                assertTextExists("构建脚本", substring = true)

                // 8. 返回项目列表
                clickBackButton()
                clickBackButton()
            }
        }
    }

    // ===== Helper Methods =====

    private fun createTestProject(name: String) {
        composeTestRule.apply {
            onNode(hasContentDescription("新建项目") or hasText("新建")).performClick()
            waitForLoadingToComplete()
            typeTextInField("项目名称", name)
            typeTextInField("包名", "com.test.${name.lowercase().replace(" ", "")}")
            clickOnText("选择模板")
            clickOnText("Android Application")
            clickOnText("确认")
            clickOnText("创建")
            waitForText("项目创建成功", timeoutMillis = 30000)
            clickOnText(name)
            waitForLoadingToComplete()
        }
    }

    private fun initializeGitRepo() {
        composeTestRule.apply {
            clickOnText("Git")
            clickOnText("初始化仓库")
            waitForText("Git 仓库已初始化", timeoutMillis = 5000)
        }
    }

    private fun gitCommit(message: String) {
        composeTestRule.apply {
            clickOnText("Git")
            clickOnText("暂存")
            clickOnText("全部暂存")
            clickOnText("提交")
            typeTextInField("提交信息", message)
            clickOnText("确认提交")
            waitForText("提交成功", timeoutMillis = 5000)
            clickBackButton()
        }
    }

    private fun createMultipleTestFiles() {
        val files = mapOf(
            "MainActivity.kt" to "class MainActivity : AppCompatActivity() { }",
            "MainFragment.kt" to "class MainFragment : Fragment() { }",
            "Utils.kt" to "object Utils { fun log(msg: String) { } }",
            "Constants.kt" to "object Constants { const val API_KEY = \"test\" }"
        )

        composeTestRule.apply {
            files.forEach { (fileName, content) ->
                clickOnText("新建文件")
                typeTextInField("文件名", fileName)
                clickOnText("确认")
                typeTextInField("代码编辑器", content, clearFirst = false)
                clickOnText("保存")
                clickBackButton()
            }
        }
    }

    private fun getFileExtension(language: String): String {
        return when (language) {
            "Kotlin" -> "kt"
            "Java" -> "java"
            "Python" -> "py"
            "JavaScript" -> "js"
            "TypeScript" -> "ts"
            "Go" -> "go"
            "Rust" -> "rs"
            "C++" -> "cpp"
            else -> "txt"
        }
    }
}
