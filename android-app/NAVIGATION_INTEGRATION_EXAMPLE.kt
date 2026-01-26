/**
 * 导航集成示例
 *
 * 此文件展示如何将新的LLM配置界面集成到应用的导航系统中
 *
 * 使用方法：
 * 1. 在主NavHost中添加路由定义
 * 2. 在ProfileScreen中连接导航回调
 * 3. （可选）在主界面添加快速测试入口
 */

package com.chainlesschain.android.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.chainlesschain.android.presentation.screens.*
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider

/**
 * 主导航配置（示例）
 */
@Composable
fun MainNavigation(
    navController: NavHostController,
    startDestination: String = "home"
) {
    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        // 现有路由...
        composable("home") {
            // HomeScreen...
        }

        composable("profile") {
            ProfileScreen(
                onLogout = {
                    navController.navigate("login") {
                        popUpTo("home") { inclusive = true }
                    }
                },
                // 【新增】连接AI配置导航
                onNavigateToLLMSettings = {
                    navController.navigate("llm_settings")
                },
                viewModel = hiltViewModel()
            )
        }

        // ========== 新增路由 ==========

        /**
         * LLM设置界面路由
         */
        composable("llm_settings") {
            LLMSettingsScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        /**
         * LLM测试对话界面路由（可选）
         *
         * 支持传递提供商参数，例如：
         * navController.navigate("llm_test/DOUBAO")
         */
        composable("llm_test/{provider}") { backStackEntry ->
            val providerName = backStackEntry.arguments?.getString("provider") ?: "DOUBAO"
            val provider = try {
                LLMProvider.valueOf(providerName)
            } catch (e: Exception) {
                LLMProvider.DOUBAO
            }

            LLMTestChatScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                provider = provider
            )
        }

        // 或者使用默认提供商的简化路由
        composable("llm_test") {
            LLMTestChatScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                provider = LLMProvider.DOUBAO  // 默认使用火山引擎
            )
        }
    }
}

/**
 * 使用示例1：从ProfileScreen导航到LLM设置
 */
@Composable
fun ProfileScreenExample(navController: NavHostController) {
    ProfileScreen(
        onLogout = { /* ... */ },
        onNavigateToLLMSettings = {
            navController.navigate("llm_settings")
        },
        viewModel = hiltViewModel()
    )
}

/**
 * 使用示例2：从AI对话界面快速跳转到设置
 */
@Composable
fun ChatScreenExample(navController: NavHostController) {
    // 在ChatScreen的TopAppBar添加设置按钮
    IconButton(
        onClick = {
            navController.navigate("llm_settings")
        }
    ) {
        Icon(Icons.Default.Settings, "AI配置")
    }
}

/**
 * 使用示例3：从主界面添加测试入口（可选）
 */
@Composable
fun HomeScreenExample(navController: NavHostController) {
    // 添加一个"测试AI"的快捷入口
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                navController.navigate("llm_test/DOUBAO")  // 测试火山引擎
            }
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(Icons.Default.Science, "测试")
            Column {
                Text("测试AI对话", style = MaterialTheme.typography.titleMedium)
                Text("快速测试LLM连接和性能", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/**
 * 使用示例4：从设置页面跳转到测试
 */
@Composable
fun LLMSettingsScreenExample(navController: NavHostController) {
    // 在LLMSettingsScreen保存成功后，提供测试按钮
    Button(
        onClick = {
            // 使用当前配置的提供商进行测试
            val provider = /* 从ViewModel获取当前提供商 */ "DOUBAO"
            navController.navigate("llm_test/$provider")
        }
    ) {
        Text("测试对话")
    }
}

/**
 * 底部导航栏集成示例（如果使用BottomNavigation）
 */
@Composable
fun BottomNavigationExample(navController: NavHostController) {
    BottomNavigation {
        // 现有导航项...
        BottomNavigationItem(
            icon = { Icon(Icons.Default.Home, "首页") },
            label = { Text("首页") },
            selected = false,
            onClick = { navController.navigate("home") }
        )

        // 可选：添加AI测试快捷入口
        BottomNavigationItem(
            icon = { Icon(Icons.Default.Science, "AI测试") },
            label = { Text("AI测试") },
            selected = false,
            onClick = { navController.navigate("llm_test") }
        )

        BottomNavigationItem(
            icon = { Icon(Icons.Default.Person, "我的") },
            label = { Text("我的") },
            selected = false,
            onClick = { navController.navigate("profile") }
        )
    }
}

/**
 * 深度链接配置示例（可选）
 *
 * 支持外部链接打开特定LLM配置
 * 例如：chainlesschain://llm_settings?provider=DOUBAO
 */
@Composable
fun DeepLinkExample() {
    NavHost(
        navController = navController,
        startDestination = "home"
    ) {
        composable(
            route = "llm_settings?provider={provider}",
            deepLinks = listOf(
                navDeepLink {
                    uriPattern = "chainlesschain://llm_settings?provider={provider}"
                }
            )
        ) { backStackEntry ->
            val provider = backStackEntry.arguments?.getString("provider")
            // 自动选择指定的提供商
            LLMSettingsScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
    }
}

/**
 * 集成检查清单：
 *
 * [ ] 1. 在MainNavigation中添加"llm_settings"路由
 * [ ] 2. 在ProfileScreen中连接onNavigateToLLMSettings回调
 * [ ] 3. （可选）添加"llm_test"路由用于快速测试
 * [ ] 4. （可选）在主界面添加测试快捷入口
 * [ ] 5. 测试导航流程：Profile → LLM Settings → 返回
 * [ ] 6. 测试导航流程：LLM Settings → LLM Test → 返回
 */

/**
 * 完整导航流程示例：
 *
 * 用户路径1（配置）：
 * Home → Profile → AI配置 → 选择Doubao → 输入API Key → 测试连接 → 保存 → 返回
 *
 * 用户路径2（测试）：
 * Home → Profile → AI配置 → 配置完成 → 测试对话 → 发送消息 → 观察响应 → 返回
 *
 * 用户路径3（快速测试）：
 * Home → AI测试 → 发送消息 → 提示未配置 → 跳转AI配置 → 配置 → 返回测试 → 成功对话
 */
