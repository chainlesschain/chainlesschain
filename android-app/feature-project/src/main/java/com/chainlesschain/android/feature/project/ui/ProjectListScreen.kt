package com.chainlesschain.android.feature.project.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SearchBar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.project.R
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.project.model.ProjectFilter
import com.chainlesschain.android.feature.project.model.ProjectListState
import com.chainlesschain.android.feature.project.model.ProjectSortBy
import com.chainlesschain.android.feature.project.model.ProjectWithStats
import com.chainlesschain.android.feature.project.model.SortDirection
import com.chainlesschain.android.feature.project.viewmodel.ProjectUiEvent
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectListScreen(
    viewModel: ProjectViewModel = hiltViewModel(),
    onNavigateToProject: (String) -> Unit,
    onNavigateToCreateProject: () -> Unit
) {
    val listState by viewModel.projectListState.collectAsState()
    val filter by viewModel.filter.collectAsState()
    val sortBy by viewModel.sortBy.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val projectCount by viewModel.projectCount.collectAsState()

    val snackbarHostState = remember { SnackbarHostState() }
    var searchQuery by remember { mutableStateOf("") }
    var isSearchActive by remember { mutableStateOf(false) }
    var showFilterMenu by remember { mutableStateOf(false) }
    var showSortMenu by remember { mutableStateOf(false) }

    // 处理 UI 事件
    LaunchedEffect(Unit) {
        viewModel.uiEvents.collect { event ->
            when (event) {
                is ProjectUiEvent.ShowMessage -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is ProjectUiEvent.ShowError -> {
                    snackbarHostState.showSnackbar(event.error)
                }
                is ProjectUiEvent.NavigateToProject -> {
                    onNavigateToProject(event.projectId)
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.project_management)) },
                actions = {
                    IconButton(onClick = { isSearchActive = !isSearchActive }) {
                        Icon(Icons.Default.Search, contentDescription = stringResource(R.string.search))
                    }
                    IconButton(onClick = { showFilterMenu = true }) {
                        Icon(Icons.Default.FilterList, contentDescription = stringResource(R.string.filter))
                    }
                    IconButton(onClick = { showSortMenu = true }) {
                        Icon(Icons.Default.Sort, contentDescription = stringResource(R.string.sort))
                    }

                    // 筛选菜单
                    DropdownMenu(
                        expanded = showFilterMenu,
                        onDismissRequest = { showFilterMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.all_projects)) },
                            onClick = {
                                viewModel.clearFilter()
                                showFilterMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.favorite_projects)) },
                            leadingIcon = { Icon(Icons.Default.Star, null) },
                            onClick = {
                                viewModel.setFilter(ProjectFilter(isFavorite = true))
                                showFilterMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.archived_projects)) },
                            leadingIcon = { Icon(Icons.Default.Archive, null) },
                            onClick = {
                                viewModel.setFilter(ProjectFilter(isArchived = true))
                                showFilterMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.in_progress)) },
                            onClick = {
                                viewModel.setFilter(ProjectFilter(status = ProjectStatus.ACTIVE))
                                showFilterMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.completed)) },
                            onClick = {
                                viewModel.setFilter(ProjectFilter(status = ProjectStatus.COMPLETED))
                                showFilterMenu = false
                            }
                        )
                    }

                    // 排序菜单
                    DropdownMenu(
                        expanded = showSortMenu,
                        onDismissRequest = { showSortMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.recently_updated)) },
                            onClick = {
                                viewModel.setSorting(ProjectSortBy.UPDATED_AT)
                                showSortMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.created_time)) },
                            onClick = {
                                viewModel.setSorting(ProjectSortBy.CREATED_AT)
                                showSortMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.name)) },
                            onClick = {
                                viewModel.setSorting(ProjectSortBy.NAME, SortDirection.ASC)
                                showSortMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.access_count)) },
                            onClick = {
                                viewModel.setSorting(ProjectSortBy.ACCESS_COUNT)
                                showSortMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.file_count_sort)) },
                            onClick = {
                                viewModel.setSorting(ProjectSortBy.FILE_COUNT)
                                showSortMenu = false
                            }
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onNavigateToCreateProject) {
                Icon(Icons.Default.Add, contentDescription = stringResource(R.string.create_project_button))
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // 搜索栏
            AnimatedVisibility(
                visible = isSearchActive,
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                SearchBar(
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    onSearch = { viewModel.search(it) },
                    active = false,
                    onActiveChange = {},
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    placeholder = { Text(stringResource(R.string.search_projects)) },
                    leadingIcon = { Icon(Icons.Default.Search, null) },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(onClick = {
                                searchQuery = ""
                                viewModel.search("")
                            }) {
                                Icon(Icons.Default.Clear, null)
                            }
                        }
                    }
                ) {}
            }

            // 项目类型过滤
            LazyRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(horizontal = 16.dp)
            ) {
                items(ProjectType.ALL_TYPES) { type ->
                    FilterChip(
                        selected = filter.type == type,
                        onClick = {
                            if (filter.type == type) {
                                viewModel.setFilter(filter.copy(type = null))
                            } else {
                                viewModel.setFilter(filter.copy(type = type))
                            }
                        },
                        label = { Text(getTypeDisplayName(type)) }
                    )
                }
            }

            // 项目列表
            when (val state = listState) {
                is ProjectListState.Loading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                is ProjectListState.Empty -> {
                    EmptyProjectsView(
                        filter = filter,
                        onCreateProject = onNavigateToCreateProject
                    )
                }
                is ProjectListState.Error -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = state.message,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
                is ProjectListState.Success -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(
                            items = state.projects,
                            key = { it.project.id }
                        ) { projectWithStats ->
                            ProjectCard(
                                projectWithStats = projectWithStats,
                                onClick = { onNavigateToProject(projectWithStats.project.id) },
                                onFavoriteClick = { viewModel.toggleFavorite(projectWithStats.project.id) },
                                onArchiveClick = { viewModel.toggleArchive(projectWithStats.project.id) },
                                onDeleteClick = { viewModel.deleteProject(projectWithStats.project.id) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectCard(
    projectWithStats: ProjectWithStats,
    onClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    onArchiveClick: () -> Unit,
    onDeleteClick: () -> Unit
) {
    val project = projectWithStats.project
    var showMenu by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f)
                ) {
                    // 项目图标
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(getProjectTypeColor(project.type).copy(alpha = 0.1f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Folder,
                            contentDescription = null,
                            tint = getProjectTypeColor(project.type),
                            modifier = Modifier.size(24.dp)
                        )
                    }

                    Spacer(modifier = Modifier.width(12.dp))

                    Column {
                        Text(
                            text = project.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )

                        project.description?.takeIf { it.isNotBlank() }?.let { desc ->
                            Text(
                                text = desc,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }

                Row {
                    IconButton(onClick = onFavoriteClick) {
                        Icon(
                            imageVector = if (project.isFavorite) Icons.Filled.Star else Icons.Filled.StarBorder,
                            contentDescription = stringResource(R.string.favorite),
                            tint = if (project.isFavorite) Color(0xFFFFC107) else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    Box {
                        IconButton(onClick = { showMenu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.more))
                        }

                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text(stringResource(if (project.isArchived) R.string.unarchive_action else R.string.archive_action)) },
                                onClick = {
                                    onArchiveClick()
                                    showMenu = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.delete)) },
                                onClick = {
                                    onDeleteClick()
                                    showMenu = false
                                }
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // 项目信息
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // 状态和类型
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip(
                        onClick = {},
                        label = { Text(project.getStatusDisplayName(), style = MaterialTheme.typography.labelSmall) }
                    )
                    AssistChip(
                        onClick = {},
                        label = { Text(project.getTypeDisplayName(), style = MaterialTheme.typography.labelSmall) }
                    )
                }

                // 文件数和大小
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.Description,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "${project.fileCount}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    Text(
                        text = project.getReadableSize(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 更新时间
            Text(
                text = stringResource(R.string.updated_at_format, formatDate(project.updatedAt)),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
    }
}

@Composable
private fun EmptyProjectsView(
    filter: ProjectFilter,
    onCreateProject: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.Folder,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = when {
                filter.searchQuery != null -> stringResource(R.string.no_matching_projects)
                filter.isFavorite == true -> stringResource(R.string.no_favorite_projects)
                filter.isArchived == true -> stringResource(R.string.no_archived_projects)
                filter.status != null -> stringResource(R.string.no_status_projects, getStatusDisplayName(filter.status))
                filter.type != null -> stringResource(R.string.no_type_projects, getTypeDisplayName(filter.type))
                else -> stringResource(R.string.no_projects)
            },
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = stringResource(R.string.create_first_project),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
        )
    }
}

private fun getProjectTypeColor(type: String): Color {
    return when (type) {
        ProjectType.DOCUMENT -> Color(0xFF2196F3)
        ProjectType.WEB -> Color(0xFFFF9800)
        ProjectType.APP -> Color(0xFF4CAF50)
        ProjectType.DATA -> Color(0xFF9C27B0)
        ProjectType.DESIGN -> Color(0xFFE91E63)
        ProjectType.RESEARCH -> Color(0xFF00BCD4)
        else -> Color(0xFF607D8B)
    }
}

@Composable
private fun getTypeDisplayName(type: String): String {
    return when (type) {
        ProjectType.DOCUMENT -> stringResource(R.string.type_document)
        ProjectType.WEB -> stringResource(R.string.type_web)
        ProjectType.APP -> stringResource(R.string.type_app)
        ProjectType.DATA -> stringResource(R.string.type_data)
        ProjectType.DESIGN -> stringResource(R.string.type_design)
        ProjectType.RESEARCH -> stringResource(R.string.type_research)
        ProjectType.OTHER -> stringResource(R.string.type_other)
        else -> stringResource(R.string.type_unknown)
    }
}

@Composable
private fun getStatusDisplayName(status: String): String {
    return when (status) {
        ProjectStatus.ACTIVE -> stringResource(R.string.project_status_active)
        ProjectStatus.PAUSED -> stringResource(R.string.project_status_paused)
        ProjectStatus.COMPLETED -> stringResource(R.string.project_status_completed)
        ProjectStatus.ARCHIVED -> stringResource(R.string.project_status_archived)
        else -> stringResource(R.string.project_status_unknown)
    }
}

private fun formatDate(timestamp: Long): String {
    val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
    return sdf.format(Date(timestamp))
}
