package com.chainlesschain.android.core.p2p.filetransfer.model

import kotlinx.serialization.Serializable

/**
 * 文件传输状态
 *
 * File transfer status enum representing all possible states of a transfer
 */
@Serializable
enum class FileTransferStatus {
    /** 等待中 - Transfer created but not yet started */
    PENDING,

    /** 请求中 - Outgoing: waiting for peer to accept; Incoming: received request */
    REQUESTING,

    /** 传输中 - Actively transferring chunks */
    TRANSFERRING,

    /** 已暂停 - Transfer paused by user */
    PAUSED,

    /** 已完成 - Transfer completed successfully */
    COMPLETED,

    /** 失败 - Transfer failed due to error */
    FAILED,

    /** 已取消 - Transfer cancelled by user */
    CANCELLED,

    /** 已拒绝 - Transfer rejected by peer */
    REJECTED;

    /**
     * Check if transfer is in a terminal state
     */
    fun isTerminal(): Boolean = this in listOf(COMPLETED, FAILED, CANCELLED, REJECTED)

    /**
     * Check if transfer can be resumed
     */
    fun canResume(): Boolean = this == PAUSED

    /**
     * Check if transfer can be paused
     */
    fun canPause(): Boolean = this == TRANSFERRING

    /**
     * Check if transfer can be cancelled
     */
    fun canCancel(): Boolean = this in listOf(PENDING, REQUESTING, TRANSFERRING, PAUSED)

    /**
     * Check if transfer can be retried
     */
    fun canRetry(): Boolean = this in listOf(FAILED, CANCELLED)
}
