package com.chainlesschain.android.remote.ui.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.AgentAction
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class RemoteAgentControlViewModel @Inject constructor(
    private val aiCommands: AICommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    private val _uiState = MutableStateFlow(RemoteAgentControlUiState())
    val uiState: StateFlow<RemoteAgentControlUiState> = _uiState.asStateFlow()

    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    private val _agents = MutableStateFlow<List<AgentInfo>>(emptyList())
    val agents: StateFlow<List<AgentInfo>> = _agents.asStateFlow()

    init {
        initializeAgents()
        loadAgentsFromRemote()
        refreshAllAgents()
    }

    private fun initializeAgents() {
        _agents.value = listOf(
            AgentInfo("code-assistant", "Code Assistant", "Code writing and review", AgentStatus.STOPPED, AgentType.CODE),
            AgentInfo("research-agent", "Research Assistant", "Knowledge search and summary", AgentStatus.STOPPED, AgentType.RESEARCH),
            AgentInfo("writing-agent", "Writing Assistant", "Drafting and editing content", AgentStatus.STOPPED, AgentType.WRITING),
            AgentInfo("data-analyst", "Data Analyst", "Data analysis and visualization", AgentStatus.STOPPED, AgentType.DATA)
        )
    }

    fun controlAgent(agentId: String, action: AgentAction) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = aiCommands.controlAgent(action, agentId)
            _uiState.update { it.copy(isLoading = false) }

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null && response.success) {
                    updateAgentStatus(agentId, action, response.status)
                    Timber.d("Agent control success: $agentId - $action")
                } else {
                    _uiState.update { it.copy(error = "Agent control failed") }
                }
            } else {
                val error = result.exceptionOrNull()?.message ?: "Agent control failed"
                Timber.e(result.exceptionOrNull(), "Agent control failed")
                _uiState.update { it.copy(error = error) }
            }
        }
    }

    private fun updateAgentStatus(agentId: String, action: AgentAction, remoteStatus: String? = null) {
        _agents.update { agents ->
            agents.map { agent ->
                if (agent.id == agentId) {
                    val mapped = mapRemoteStatus(remoteStatus)
                    agent.copy(
                        status = mapped ?: when (action) {
                            AgentAction.START -> AgentStatus.RUNNING
                            AgentAction.STOP -> AgentStatus.STOPPED
                            AgentAction.RESTART -> AgentStatus.RESTARTING
                            AgentAction.STATUS -> agent.status
                        },
                        lastUpdated = System.currentTimeMillis()
                    )
                } else {
                    agent
                }
            }
        }
    }

    private fun mapRemoteStatus(status: String?): AgentStatus? {
        return when (status?.lowercase()) {
            "running", "active", "started" -> AgentStatus.RUNNING
            "stopped", "inactive" -> AgentStatus.STOPPED
            "restarting" -> AgentStatus.RESTARTING
            "error", "failed" -> AgentStatus.ERROR
            else -> null
        }
    }

    private fun mapRemoteType(type: String?): AgentType {
        return when (type?.lowercase()) {
            "code" -> AgentType.CODE
            "research" -> AgentType.RESEARCH
            "writing" -> AgentType.WRITING
            "data" -> AgentType.DATA
            else -> AgentType.CUSTOM
        }
    }

    private fun loadAgentsFromRemote() {
        viewModelScope.launch {
            val result = aiCommands.listAgents()
            val payload = result.getOrNull() ?: return@launch
            if (payload.agents.isEmpty()) return@launch
            _agents.value = payload.agents.map { remote ->
                AgentInfo(
                    id = remote.id,
                    name = remote.name,
                    description = remote.description ?: "Remote agent",
                    status = mapRemoteStatus(remote.status) ?: AgentStatus.STOPPED,
                    type = mapRemoteType(remote.type)
                )
            }
        }
    }

    fun queryAgentStatus(agentId: String) {
        controlAgent(agentId, AgentAction.STATUS)
    }

    fun refreshAllAgents() {
        viewModelScope.launch {
            _agents.value.forEach { agent ->
                queryAgentStatus(agent.id)
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

data class RemoteAgentControlUiState(
    val isLoading: Boolean = false,
    val error: String? = null
)

data class AgentInfo(
    val id: String,
    val name: String,
    val description: String,
    val status: AgentStatus,
    val type: AgentType,
    val lastUpdated: Long = System.currentTimeMillis()
)

enum class AgentStatus {
    RUNNING,
    STOPPED,
    RESTARTING,
    ERROR
}

enum class AgentType {
    CODE,
    RESEARCH,
    WRITING,
    DATA,
    CUSTOM
}
