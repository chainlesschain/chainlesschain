package com.chainlesschain.android.call.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.dao.call.CallHistoryDao
import com.chainlesschain.android.core.database.entity.call.CallHistoryEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * FAMILY-67 通话记录 ViewModel：从 [CallHistoryDao] 读 `call_history`。
 * 传 peerDid 则只看该好友；空则全部。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class CallHistoryViewModel @Inject constructor(
    private val dao: CallHistoryDao,
) : ViewModel() {

    private val _peerDid = MutableStateFlow<String?>(null)

    val records: StateFlow<List<CallHistoryEntity>> = _peerDid
        .flatMapLatest { did ->
            if (did.isNullOrBlank()) dao.getAll() else dao.getByPeerDid(did)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun load(peerDid: String?) {
        _peerDid.value = peerDid
    }

    fun delete(id: String) {
        viewModelScope.launch { runCatching { dao.deleteById(id) } }
    }
}
