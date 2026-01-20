package com.chainlesschain.android.feature.project.navigation

import androidx.compose.runtime.LaunchedEffect
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.navigation
import com.chainlesschain.android.feature.project.ui.CreateProjectScreen
import com.chainlesschain.android.feature.project.ui.ProjectDetailScreen
import com.chainlesschain.android.feature.project.ui.ProjectListScreen
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel

/**
 * 项目导航路由
 */
object ProjectRoute {
    const val ROOT = "project"
    const val LIST = "project/list"
    const val DETAIL = "project/detail/{projectId}"
    const val CREATE = "project/create"
    const val FILE = "project/{projectId}/file/{fileId}"

    fun detailRoute(projectId: String) = "project/detail/$projectId"
    fun fileRoute(projectId: String, fileId: String) = "project/$projectId/file/$fileId"
}

/**
 * 导航到项目列表
 */
fun NavController.navigateToProjectList(navOptions: NavOptions? = null) {
    navigate(ProjectRoute.LIST, navOptions)
}

/**
 * 导航到项目详情
 */
fun NavController.navigateToProjectDetail(projectId: String, navOptions: NavOptions? = null) {
    navigate(ProjectRoute.detailRoute(projectId), navOptions)
}

/**
 * 导航到创建项目
 */
fun NavController.navigateToCreateProject(navOptions: NavOptions? = null) {
    navigate(ProjectRoute.CREATE, navOptions)
}

/**
 * 导航到项目文件
 */
fun NavController.navigateToProjectFile(projectId: String, fileId: String, navOptions: NavOptions? = null) {
    navigate(ProjectRoute.fileRoute(projectId, fileId), navOptions)
}

/**
 * 项目导航图
 */
fun NavGraphBuilder.projectNavGraph(
    navController: NavController,
    userId: String
) {
    navigation(
        startDestination = ProjectRoute.LIST,
        route = ProjectRoute.ROOT
    ) {
        // 项目列表
        composable(route = ProjectRoute.LIST) { backStackEntry ->
            val viewModel: ProjectViewModel = hiltViewModel()

            LaunchedEffect(userId) {
                viewModel.setCurrentUser(userId)
            }

            ProjectListScreen(
                viewModel = viewModel,
                onNavigateToProject = { projectId ->
                    navController.navigateToProjectDetail(projectId)
                },
                onNavigateToCreateProject = {
                    navController.navigateToCreateProject()
                }
            )
        }

        // 项目详情
        composable(
            route = ProjectRoute.DETAIL,
            arguments = listOf(
                navArgument("projectId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable

            ProjectDetailScreen(
                projectId = projectId,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToFile = { pid, fid ->
                    navController.navigateToProjectFile(pid, fid)
                }
            )
        }

        // 创建项目
        composable(route = ProjectRoute.CREATE) { backStackEntry ->
            val parentEntry = navController.getBackStackEntry(ProjectRoute.LIST)
            val viewModel: ProjectViewModel = hiltViewModel(parentEntry)

            LaunchedEffect(userId) {
                viewModel.setCurrentUser(userId)
            }

            CreateProjectScreen(
                viewModel = viewModel,
                onNavigateBack = { navController.popBackStack() },
                onProjectCreated = { projectId ->
                    navController.navigateToProjectDetail(projectId) {
                        popUpTo(ProjectRoute.LIST)
                    }
                }
            )
        }

        // 文件编辑（可以后续扩展）
        composable(
            route = ProjectRoute.FILE,
            arguments = listOf(
                navArgument("projectId") { type = NavType.StringType },
                navArgument("fileId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            val fileId = backStackEntry.arguments?.getString("fileId") ?: return@composable

            // TODO: FileEditorScreen
            // 暂时返回详情页
            LaunchedEffect(Unit) {
                navController.popBackStack()
            }
        }
    }
}
