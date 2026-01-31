package com.chainlesschain.android.remote.ui.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.AgentAction
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 远程 Agent 控制 ViewModel
 *
 * 功能：
 * - 管理 PC 端 AI Agent
 * - 启动/停止/重启 Agent
 * - 查询 Agent 状态
 */
@HiltViewModel
class RemoteAgentControlViewModel @Inject constructor(
    private val aiCommands: AICommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(RemoteAgentControlUiState())
    val uiState: StateFlow<RemoteAgentControlUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // Agent 列表（模拟数据，实际应从 PC 端获取）
    private val _agents = MutableStateFlow<List<AgentInfo>>(emptyList())
    val agents: StateFlow<List<AgentInfo>> = _agents.asStateFlow()

    init {
        // 初始化 Agent 列表（模拟数据）
        initializeAgents()
    }

    /**
     * 初始化 Agent 列表（模拟数据）
     */
    private fun initializeAgents() {
        _agents.value = listOf(
            AgentInfo(
                id = "code-assistant",
                name = "代码助手",
                description = "协助编写和审查代码",
                status = AgentStatus.STOPPED,
                type = AgentType.CODE
            ),
            AgentInfo(
                id = "research-agent",
                name = "研究助手",
                description = "搜索和整理研究资料",
                status = AgentStatus.STOPPED,
                type = AgentType.RESEARCH
            ),
            AgentInfo(
                id = "writing-agent",
                name = "写作助手",
                description = "协助创作和编辑文档",
                status = AgentStatus.STOPPED,
                type = AgentType.WRITING
            ),
            AgentInfo(
                id = "data-analyst",
                name = "数据分析师",
                description = "分析和可视化数据",
                status = AgentStatus.STOPPED,
                type = AgentType.DATA
            )
        )
    }

    /**
     * 控制 Agent（启动/停止/重启）
     */
    fun controlAgent(agentId: String, action: AgentAction) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            // 调用 PC 端 API
            val result = aiCommands.controlAgent(action, agentId)

            _uiState.update { it.copy(isLoading = false) }

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null && response.success) {
                    // 更新本地 Agent 状态
                    updateAgentStatus(agentId, action)
                    Timber.d("Agent 控制成功: $agentId - $action")
                } else {
                    val error = "Agent 控制失败"
                    _uiState.update { it.copy(error = error) }
                }
            } else {
                val error = result.exceptionOrNull()?.message ?: "Agent 控制失败"
                Timber.e(result.exceptionOrNull(), "Agent 控制失败")
                _uiState.update { it.copy(error = error) }
            }
        }
    }

    /**
     * 更新 Agent 状态
     */
    private fun updateAgentStatus(agentId: String, action: AgentAction) {
        _agents.update { agents ->
            agents.map { agent ->
                if (agent.id == agentId) {
                    agent.copy(
                        status = when (action) {
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

    /**
     * 查询 Agent 状态
     */
    fun queryAgentStatus(agentId: String) {
        controlAgent(agentId, AgentAction.STATUS)
    }

    /**
     * 刷新所有 Agent 状态
     */
    fun refreshAllAgents() {
        viewModelScope.launch {
            _agents.value.forEach { agent ->
                queryAgentStatus(agent.id)
            }
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

/**
 * UI 状态
 */
data class RemoteAgentControlUiState(
    val isLoading: Boolean = false,
    val error: String? = null
)

/**
 * Agent 信息
 */
data class AgentInfo(
    val id: String,
    val name: String,
    val description: String,
    val status: AgentStatus,
    val type: AgentType,
    val lastUpdated: Long = System.currentTimeMillis()
)

/**
 * Agent 状态
 */
enum class AgentStatus {
    RUNNING,
    STOPPED,
    RESTARTING,
    ERROR
}

/**
 * Agent 类型
 */
enum class AgentType {
    CODE,
    RESEARCH,
    WRITING,
    DATA,
    CUSTOM
}
