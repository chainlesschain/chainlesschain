package com.chainlesschain.android.core.common.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.error.AppError
import com.chainlesschain.android.core.common.error.ErrorHandler
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * ViewModel 基类
 *
 * 提供统一的状态管理、错误处理和事件分发
 */
abstract class BaseViewModel<State : UiState, Event : UiEvent>(
    initialState: State
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(initialState)
    val uiState: StateFlow<State> = _uiState.asStateFlow()

    // 错误状态
    private val _errorState = MutableSharedFlow<AppError>()
    val errorState: SharedFlow<AppError> = _errorState.asSharedFlow()

    // 加载状态
    private val _loadingState = MutableStateFlow(false)
    val loadingState: StateFlow<Boolean> = _loadingState.asStateFlow()

    // 单次事件（用于导航、Toast 等）
    private val _eventFlow = MutableSharedFlow<Event>()
    val eventFlow: SharedFlow<Event> = _eventFlow.asSharedFlow()

    // 异常处理器
    protected val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        Timber.e(throwable, "Coroutine exception")
        handleError(throwable)
    }

    /**
     * 更新 UI 状态
     */
    protected fun updateState(update: State.() -> State) {
        _uiState.value = _uiState.value.update()
    }

    /**
     * 设置 UI 状态
     */
    protected fun setState(state: State) {
        _uiState.value = state
    }

    /**
     * 获取当前状态
     */
    protected val currentState: State
        get() = _uiState.value

    /**
     * 发送事件
     */
    protected fun sendEvent(event: Event) {
        viewModelScope.launch {
            _eventFlow.emit(event)
        }
    }

    /**
     * 设置加载状态
     */
    protected fun setLoading(isLoading: Boolean) {
        _loadingState.value = isLoading
    }

    /**
     * 处理错误
     */
    protected fun handleError(throwable: Throwable) {
        val error = ErrorHandler.handleError(throwable)
        Timber.e(throwable, "Error: ${error.message}")

        viewModelScope.launch {
            _errorState.emit(error)
        }
    }

    /**
     * 发送错误
     */
    protected fun sendError(error: AppError) {
        viewModelScope.launch {
            _errorState.emit(error)
        }
    }

    /**
     * 执行带加载状态的操作
     */
    protected fun launchWithLoading(
        block: suspend () -> Unit
    ): Job {
        return viewModelScope.launch(exceptionHandler) {
            setLoading(true)
            try {
                block()
            } finally {
                setLoading(false)
            }
        }
    }

    /**
     * 执行带错误处理的操作
     */
    protected fun launchWithError(
        block: suspend () -> Unit
    ): Job {
        return viewModelScope.launch(exceptionHandler) {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                handleError(e)
            }
        }
    }

    /**
     * 执行带加载状态和错误处理的操作
     */
    protected fun launchSafely(
        block: suspend () -> Unit
    ): Job {
        return viewModelScope.launch(exceptionHandler) {
            setLoading(true)
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                handleError(e)
            } finally {
                setLoading(false)
            }
        }
    }
}

/**
 * UI 状态标记接口
 *
 * 所有 UiState 都应该实现此接口
 */
interface UiState

/**
 * UI 事件标记接口
 *
 * 所有 UiEvent 都应该实现此接口（用于单次事件）
 */
interface UiEvent

/**
 * 标准 UI 状态实现
 *
 * 适用于大多数列表/详情页面
 */
sealed class DataState<out T> : UiState {
    /**
     * 初始状态
     */
    object Initial : DataState<Nothing>()

    /**
     * 加载中
     */
    object Loading : DataState<Nothing>()

    /**
     * 成功
     */
    data class Success<T>(val data: T) : DataState<T>()

    /**
     * 错误
     */
    data class Error(val error: AppError) : DataState<Nothing>()

    /**
     * 空数据
     */
    object Empty : DataState<Nothing>()
}

/**
 * 扩展函数：判断是否正在加载
 */
fun DataState<*>.isLoading(): Boolean = this is DataState.Loading

/**
 * 扩展函数：判断是否成功
 */
fun DataState<*>.isSuccess(): Boolean = this is DataState.Success

/**
 * 扩展函数：判断是否错误
 */
fun DataState<*>.isError(): Boolean = this is DataState.Error

/**
 * 扩展函数：判断是否为空
 */
fun DataState<*>.isEmpty(): Boolean = this is DataState.Empty

/**
 * 扩展函数：获取数据
 */
fun <T> DataState<T>.getDataOrNull(): T? {
    return if (this is DataState.Success) data else null
}

/**
 * 扩展函数：获取错误
 */
fun DataState<*>.getErrorOrNull(): AppError? {
    return if (this is DataState.Error) error else null
}

/**
 * 使用示例：
 *
 * 1. 定义 UiState
 * ```kotlin
 * data class KnowledgeListUiState(
 *     val items: List<KnowledgeItem> = emptyList(),
 *     val isLoading: Boolean = false,
 *     val error: AppError? = null,
 *     val selectedItem: KnowledgeItem? = null
 * ) : UiState
 * ```
 *
 * 2. 定义 UiEvent
 * ```kotlin
 * sealed class KnowledgeListEvent : UiEvent {
 *     data class NavigateToDetail(val id: String) : KnowledgeListEvent()
 *     data class ShowToast(val message: String) : KnowledgeListEvent()
 * }
 * ```
 *
 * 3. 实现 ViewModel
 * ```kotlin
 * class KnowledgeListViewModel(
 *     private val repository: KnowledgeRepository
 * ) : BaseViewModel<KnowledgeListUiState, KnowledgeListEvent>(
 *     initialState = KnowledgeListUiState()
 * ) {
 *
 *     init {
 *         loadItems()
 *     }
 *
 *     fun loadItems() = launchSafely {
 *         repository.getAll()
 *             .collect { result ->
 *                 result.onSuccess { items ->
 *                     updateState { copy(items = items) }
 *                 }.onFailure { error ->
 *                     handleError(error)
 *                 }
 *             }
 *     }
 *
 *     fun onItemClick(id: String) {
 *         sendEvent(KnowledgeListEvent.NavigateToDetail(id))
 *     }
 *
 *     fun deleteItem(id: String) = launchSafely {
 *         repository.delete(id)
 *             .onSuccess {
 *                 sendEvent(KnowledgeListEvent.ShowToast("删除成功"))
 *                 loadItems()
 *             }
 *     }
 * }
 * ```
 *
 * 4. 在 Composable 中使用
 * ```kotlin
 * @Composable
 * fun KnowledgeListScreen(
 *     viewModel: KnowledgeListViewModel = hiltViewModel()
 * ) {
 *     val uiState by viewModel.uiState.collectAsState()
 *     val isLoading by viewModel.loadingState.collectAsState()
 *
 *     // 收集单次事件
 *     LaunchedEffect(Unit) {
 *         viewModel.eventFlow.collect { event ->
 *             when (event) {
 *                 is KnowledgeListEvent.NavigateToDetail -> {
 *                     navController.navigate("detail/${event.id}")
 *                 }
 *                 is KnowledgeListEvent.ShowToast -> {
 *                     // 显示 Toast
 *                 }
 *             }
 *         }
 *     }
 *
 *     // 收集错误
 *     LaunchedEffect(Unit) {
 *         viewModel.errorState.collect { error ->
 *             // 显示错误对话框或 Snackbar
 *         }
 *     }
 *
 *     StateContainer(
 *         isLoading = isLoading,
 *         isEmpty = uiState.items.isEmpty()
 *     ) {
 *         LazyColumn {
 *             items(uiState.items) { item ->
 *                 ItemCard(
 *                     item = item,
 *                     onClick = { viewModel.onItemClick(item.id) }
 *                 )
 *             }
 *         }
 *     }
 * }
 * ```
 */
