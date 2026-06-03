package com.chainlesschain.android.remote.ui.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
import com.chainlesschain.android.remote.commands.AgentAction
import com.chainlesschain.android.remote.p2p.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteAgentControlScreen(
    viewModel: RemoteAgentControlViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val agents by viewModel.agents.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val connectedPeer by viewModel.connectedPeer.collectAsState()
    val actionEnabled = connectionState == ConnectionState.CONNECTED && !uiState.isLoading

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.rs_agent_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refreshAllAgents(forceRemote = true) }) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.common_refresh))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(stringResource(R.string.rs_agent_connection_fmt, connectionState.toString()), style = MaterialTheme.typography.bodyMedium)
            connectedPeer?.let { peer ->
                Text(
                    text = stringResource(R.string.rs_agent_target_fmt, peer.peerId, peer.did),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (uiState.isLoading) {
                Text(
                    text = stringResource(R.string.rs_agent_refreshing),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(agents) { agent ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(agent.name, fontWeight = FontWeight.Bold)
                            Text(agent.description, style = MaterialTheme.typography.bodySmall)
                            Text(stringResource(R.string.rs_agent_status_fmt, agent.status.toString()), style = MaterialTheme.typography.bodySmall)
                            Text(stringResource(R.string.rs_agent_type_fmt, agent.type.toString()), style = MaterialTheme.typography.bodySmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = { viewModel.controlAgent(agent.id, AgentAction.START) },
                                    enabled = actionEnabled
                                ) {
                                    Text(stringResource(R.string.rs_agent_start))
                                }
                                Button(
                                    onClick = { viewModel.controlAgent(agent.id, AgentAction.STOP) },
                                    enabled = actionEnabled
                                ) {
                                    Text(stringResource(R.string.rs_agent_stop))
                                }
                                Button(
                                    onClick = { viewModel.controlAgent(agent.id, AgentAction.RESTART) },
                                    enabled = actionEnabled
                                ) {
                                    Text(stringResource(R.string.rs_agent_restart))
                                }
                            }
                        }
                    }
                }
            }

            uiState.error?.let { error ->
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}
