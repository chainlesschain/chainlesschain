package com.chainlesschain.android.core.common

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * 统一的Result类型，用于封装操作结果
 */
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Error(val exception: Throwable, val message: String? = null) : Result<Nothing>()
    data object Loading : Result<Nothing>()

    val isSuccess: Boolean
        get() = this is Success

    val isError: Boolean
        get() = this is Error

    val isLoading: Boolean
        get() = this is Loading

    fun getOrNull(): T? = when (this) {
        is Success -> data
        else -> null
    }

    fun exceptionOrNull(): Throwable? = when (this) {
        is Error -> exception
        else -> null
    }

    companion object {
        fun <T> success(data: T): Result<T> = Success(data)
        fun error(exception: Throwable, message: String? = null): Result<Nothing> =
            Error(exception, message)
        fun loading(): Result<Nothing> = Loading
    }
}

/**
 * 将Result<T>映射为Result<R>
 */
inline fun <T, R> Result<T>.map(transform: (T) -> R): Result<R> {
    return when (this) {
        is Result.Success -> Result.Success(transform(data))
        is Result.Error -> Result.Error(exception, message)
        is Result.Loading -> Result.Loading
    }
}

/**
 * 在成功时执行操作
 */
inline fun <T> Result<T>.onSuccess(action: (T) -> Unit): Result<T> {
    if (this is Result.Success) {
        action(data)
    }
    return this
}

/**
 * 在失败时执行操作
 */
inline fun <T> Result<T>.onError(action: (Throwable) -> Unit): Result<T> {
    if (this is Result.Error) {
        action(exception)
    }
    return this
}

/**
 * Fold result into a single value
 */
inline fun <T, R> Result<T>.fold(
    onSuccess: (T) -> R,
    onFailure: (Throwable) -> R
): R {
    return when (this) {
        is Result.Success -> onSuccess(data)
        is Result.Error -> onFailure(exception)
        is Result.Loading -> throw IllegalStateException("Cannot fold Loading state")
    }
}

/**
 * Get data or throw exception
 */
val <T> Result<T>.data: T
    get() = when (this) {
        is Result.Success -> data
        is Result.Error -> throw exception
        is Result.Loading -> throw IllegalStateException("Cannot get data from Loading state")
    }

/**
 * Convert Flow<T> to Flow<Result<T>> with error handling
 */
fun <T> Flow<T>.asResult(): Flow<Result<T>> = flow {
    try {
        collect { value ->
            emit(Result.Success(value))
        }
    } catch (e: Exception) {
        emit(Result.Error(e))
    }
}
