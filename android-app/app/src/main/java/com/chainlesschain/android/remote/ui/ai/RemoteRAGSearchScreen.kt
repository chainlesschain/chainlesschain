package com.chainlesschain.android.remote.ui.ai

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.SearchResult
import com.chainlesschain.android.remote.p2p.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteRAGSearchScreen(
    viewModel: RemoteRAGSearchViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val searchResults by viewModel.searchResults.collectAsState()
    val searchHistory by viewModel.searchHistory.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()

    var searchQuery by remember { mutableStateOf("") }
    var showSettings by remember { mutableStateOf(false) }
    var selectedResult by remember { mutableStateOf<SearchResult?>(null) }

    @OptIn(FlowPreview::class)
    LaunchedEffect(Unit) {
        snapshotFlow { searchQuery }
            .debounce(300)
            .distinctUntilChanged()
            .filter { it.isNotBlank() }
            .collectLatest { query ->
                viewModel.search(query, uiState.topK)
            }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Remote RAG Search") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                    if (searchResults.isNotEmpty()) {
                        IconButton(onClick = { viewModel.clearResults() }) {
                            Icon(Icons.Default.DeleteSweep, contentDescription = "Clear")
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(modifier = Modifier.fillMaxSize().padding(paddingValues)) {
            SearchBar(
                query = searchQuery,
                onQueryChange = { searchQuery = it },
                onSearch = { viewModel.search(searchQuery, uiState.topK) },
                enabled = connectionState == ConnectionState.CONNECTED && !uiState.isSearching,
                modifier = Modifier.padding(16.dp)
            )

            Box(modifier = Modifier.weight(1f)) {
                when {
                    connectionState != ConnectionState.CONNECTED -> {
                        EmptyState(Icons.Default.CloudOff, "Not connected to PC", "Connect first in Remote Control")
                    }
                    uiState.isSearching -> {
                        LoadingState()
                    }
                    searchResults.isEmpty() && uiState.currentQuery == null -> {
                        if (searchHistory.isEmpty()) {
                            EmptyState(Icons.Default.Search, "Search knowledge base", "Query notes/docs on your PC")
                        } else {
                            SearchHistorySection(
                                history = searchHistory,
                                onHistoryClick = {
                                    searchQuery = it
                                    viewModel.search(it, uiState.topK)
                                }
                            )
                        }
                    }
                    searchResults.isEmpty() -> {
                        EmptyState(Icons.Default.SearchOff, "No results", "Try a different query")
                    }
                    else -> {
                        SearchResultsList(
                            results = searchResults,
                            totalResults = uiState.totalResults,
                            query = uiState.currentQuery.orEmpty(),
                            onResultClick = { selectedResult = it },
                            hasMore = uiState.hasMore,
                            isLoadingMore = uiState.isSearching,
                            onLoadMore = { viewModel.loadMore() }
                        )
                    }
                }

                uiState.error?.let { error ->
                    Snackbar(
                        modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                        action = {
                            Row {
                                TextButton(onClick = { viewModel.retryCurrentQuery() }) { Text("Retry") }
                                TextButton(onClick = { viewModel.clearError() }) { Text("Close") }
                            }
                        }
                    ) { Text(error) }
                }
            }
        }
    }

    selectedResult?.let { result ->
        ResultDetailDialog(result = result, onDismiss = { selectedResult = null })
    }

    if (showSettings) {
        SearchSettingsDialog(
            topK = uiState.topK,
            onTopKChange = { viewModel.setTopK(it) },
            onDismiss = { showSettings = false }
        )
    }
}

@Composable
fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text("Search knowledge base...") },
        leadingIcon = { Icon(Icons.Default.Search, null) },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Clear, contentDescription = "Clear")
                }
            }
        },
        singleLine = true,
        enabled = enabled,
        shape = RoundedCornerShape(28.dp)
    )
}

@Composable
fun SearchResultsList(
    results: List<SearchResult>,
    totalResults: Int,
    query: String,
    onResultClick: (SearchResult) -> Unit,
    hasMore: Boolean,
    isLoadingMore: Boolean,
    onLoadMore: () -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text("$totalResults results for \"$query\"", style = MaterialTheme.typography.bodyMedium)
        }

        items(results, key = { it.noteId }) { result ->
            SearchResultCard(result = result, onClick = { onResultClick(result) })
        }

        if (hasMore) {
            item {
                Button(onClick = onLoadMore, modifier = Modifier.fillMaxWidth(), enabled = !isLoadingMore) {
                    if (isLoadingMore) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Loading...")
                    } else {
                        Text("Load More")
                    }
                }
            }
        }
    }
}

@Composable
fun SearchResultCard(result: SearchResult, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = result.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.width(8.dp))
                SimilarityScoreChip(score = result.score)
            }

            Text(result.content, maxLines = 3, overflow = TextOverflow.Ellipsis)

            result.metadata?.let { metadata ->
                if (metadata.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        metadata.entries.take(3).forEach { (key, value) ->
                            AssistChip(onClick = {}, label = { Text("$key: $value") })
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SimilarityScoreChip(score: Float) {
    val percentage = (score * 100).toInt()
    val color = when {
        score >= 0.8f -> MaterialTheme.colorScheme.tertiary
        score >= 0.6f -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.outline
    }
    Surface(shape = RoundedCornerShape(12.dp), color = color.copy(alpha = 0.15f)) {
        Text("$percentage%", modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp), color = color, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SearchHistorySection(history: List<String>, onHistoryClick: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Recent Searches", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        history.forEach { query ->
            Card(modifier = Modifier.fillMaxWidth().clickable { onHistoryClick(query) }) {
                Row(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Default.History, null)
                    Text(query, modifier = Modifier.weight(1f))
                    Icon(Icons.Default.ArrowForward, null)
                }
            }
        }
    }
}

@Composable
fun LoadingState() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CircularProgressIndicator()
            Text("Searching...")
        }
    }
}

@Composable
fun EmptyState(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, subtitle: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, modifier = Modifier.size(64.dp))
            Text(title)
            Text(subtitle, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun ResultDetailDialog(result: SearchResult, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(result.title) },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Similarity", fontWeight = FontWeight.Bold)
                        SimilarityScoreChip(result.score)
                    }
                }
                item { Text(result.content) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } }
    )
}

@Composable
fun SearchSettingsDialog(topK: Int, onTopKChange: (Int) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Search Settings") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Top K")
                    Text(topK.toString(), fontWeight = FontWeight.Bold)
                }
                Slider(value = topK.toFloat(), onValueChange = { onTopKChange(it.toInt()) }, valueRange = 1f..20f, steps = 18)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } }
    )
}
