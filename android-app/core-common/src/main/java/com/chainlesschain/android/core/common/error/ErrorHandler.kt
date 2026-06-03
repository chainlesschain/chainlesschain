package com.chainlesschain.android.core.common.error

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import timber.log.Timber

/**
 * 统一错误处理机制
 *
 * 提供标准化的错误处理、日志记录和用户友好的错误消息
 */

/**
 * 应用错误类型
 */
sealed class AppError(
    open val message: String,
    open val cause: Throwable? = null
) {
    /**
     * 网络错误
     */
    data class NetworkError(
        override val message: String = "网络连接失败，请检查网络设置",
        override val cause: Throwable? = null,
        val statusCode: Int? = null
    ) : AppError(message, cause)

    /**
     * 数据库错误
     */
    data class DatabaseError(
        override val message: String = "数据库操作失败",
        override val cause: Throwable? = null
    ) : AppError(message, cause)

    /**
     * 认证错误
     */
    data class AuthError(
        override val message: String = "认证失败，请重新登录",
        override val cause: Throwable? = null,
        val errorCode: String? = null
    ) : AppError(message, cause)

    /**
     * 验证错误
     */
    data class ValidationError(
        override val message: String,
        override val cause: Throwable? = null,
        val field: String? = null
    ) : AppError(message, cause)

    /**
     * 业务逻辑错误
     */
    data class BusinessError(
        override val message: String,
        override val cause: Throwable? = null,
        val errorCode: String? = null
    ) : AppError(message, cause)

    /**
     * 未知错误
     */
    data class UnknownError(
        override val message: String = "发生未知错误，请稍后重试",
        override val cause: Throwable? = null
    ) : AppError(message, cause)

    /**
     * 文件错误
     */
    data class FileError(
        override val message: String = "文件操作失败",
        override val cause: Throwable? = null
    ) : AppError(message, cause)

    /**
     * 权限错误
     */
    data class PermissionError(
        override val message: String = "权限不足，请授予必要权限",
        override val cause: Throwable? = null,
        val permission: String? = null
    ) : AppError(message, cause)
}

/**
 * 错误处理器
 */
object ErrorHandler {

    /**
     * 将异常转换为 AppError
     */
    fun handleError(throwable: Throwable): AppError {
        Timber.e(throwable, "Error occurred")

        return when (throwable) {
            is java.net.UnknownHostException,
            is java.net.SocketTimeoutException,
            is java.io.IOException -> {
                AppError.NetworkError(
                    message = "网络连接失败，请检查网络设置",
                    cause = throwable
                )
            }

            is android.database.sqlite.SQLiteException -> {
                AppError.DatabaseError(
                    message = "数据库操作失败",
                    cause = throwable
                )
            }

            is SecurityException -> {
                AppError.PermissionError(
                    message = "权限不足，请授予必要权限",
                    cause = throwable
                )
            }

            is IllegalArgumentException,
            is IllegalStateException -> {
                AppError.ValidationError(
                    message = throwable.message ?: "参数验证失败",
                    cause = throwable
                )
            }

            else -> {
                AppError.UnknownError(
                    message = throwable.message ?: "发生未知错误，请稍后重试",
                    cause = throwable
                )
            }
        }
    }

    /**
     * 根据错误类型返回用户友好的消息
     */
    fun getUserMessage(error: AppError): String {
        return when (error) {
            is AppError.NetworkError -> {
                if (error.statusCode != null) {
                    when (error.statusCode) {
                        401, 403 -> "认证失败，请重新登录"
                        404 -> "请求的资源不存在"
                        500 -> "服务器错误，请稍后重试"
                        else -> error.message
                    }
                } else {
                    error.message
                }
            }
            is AppError.AuthError -> "认证失败，请重新登录"
            is AppError.ValidationError -> error.message
            is AppError.PermissionError -> "权限不足，请授予必要权限"
            else -> error.message
        }
    }

    /**
     * 判断错误是否需要用户操作
     */
    fun requiresUserAction(error: AppError): Boolean {
        return when (error) {
            is AppError.AuthError -> true
            is AppError.PermissionError -> true
            is AppError.ValidationError -> true
            else -> false
        }
    }

    /**
     * 判断错误是否可以重试
     */
    fun isRetryable(error: AppError): Boolean {
        return when (error) {
            is AppError.NetworkError -> true
            is AppError.DatabaseError -> false
            is AppError.AuthError -> false
            is AppError.ValidationError -> false
            is AppError.BusinessError -> false
            is AppError.UnknownError -> true
            is AppError.FileError -> true
            is AppError.PermissionError -> false
        }
    }
}

/**
 * Flow 扩展函数：统一错误处理
 */
fun <T> Flow<T>.handleErrors(
    onError: (AppError) -> Unit = {}
): Flow<Result<T>> = this
    .map { Result.success(it) }
    .catch { throwable ->
        val error = ErrorHandler.handleError(throwable)
        onError(error)
        emit(Result.failure(throwable))
    }

/**
 * Flow 扩展函数：将结果转换为 Result<T>
 */
fun <T> Flow<T>.asResult(): Flow<Result<T>> = this
    .map<T, Result<T>> { Result.success(it) }
    .onStart { emit(Result.success(null) as Result<T>) }
    .catch { throwable ->
        val error = ErrorHandler.handleError(throwable)
        Timber.e(throwable, "Flow error: ${error.message}")
        emit(Result.failure(throwable))
    }

/**
 * 扩展函数：从 Result 中提取错误
 */
fun <T> Result<T>.getErrorOrNull(): AppError? {
    return exceptionOrNull()?.let { ErrorHandler.handleError(it) }
}

/**
 * 扩展函数：执行带错误处理的操作
 */
suspend fun <T> runCatchingWithError(
    block: suspend () -> T
): Result<T> {
    return try {
        Result.success(block())
    } catch (e: Exception) {
        val error = ErrorHandler.handleError(e)
        Timber.e(e, "Operation failed: ${error.message}")
        Result.failure(e)
    }
}

/**
 * 使用示例：
 *
 * 1. ViewModel 中使用
 * ```kotlin
 * viewModelScope.launch {
 *     repository.getData()
 *         .handleErrors { error ->
 *             _errorState.value = ErrorHandler.getUserMessage(error)
 *         }
 *         .collect { result ->
 *             result.onSuccess { data ->
 *                 _uiState.value = UiState.Success(data)
 *             }
 *         }
 * }
 * ```
 *
 * 2. Repository 中使用
 * ```kotlin
 * fun getData(): Flow<Result<Data>> = flow {
 *     val data = api.fetchData()
 *     emit(data)
 * }.asResult()
 * ```
 *
 * 3. 单次操作使用
 * ```kotlin
 * val result = runCatchingWithError {
 *     database.insert(item)
 * }
 * result.onFailure { error ->
 *     Timber.e(error, "Insert failed")
 * }
 * ```
 */
