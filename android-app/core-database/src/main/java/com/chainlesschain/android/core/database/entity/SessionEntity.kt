package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * Session Entity for AI conversation session management
 *
 * Sessions group related conversations and provide:
 * - Automatic context compression
 * - Session summaries for quick overview
 * - Tag-based organization
 * - Search and filter capabilities
 * - Export/import functionality
 */
@Entity(
    tableName = "sessions",
    foreignKeys = [
        ForeignKey(
            entity = ProjectEntity::class,
            parentColumns = ["id"],
            childColumns = ["projectId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["projectId"]),
        Index(value = ["createdAt"]),
        Index(value = ["updatedAt"]),
        Index(value = ["isArchived"]),
        Index(value = ["isPinned"])
    ]
)
data class SessionEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    /** Associated project ID (null for global sessions) */
    val projectId: String?,

    /** Session title/name */
    val title: String,

    /** Auto-generated session summary */
    val summary: String? = null,

    /** Tags for organization (JSON array) */
    val tags: String? = null,

    /** Total message count in this session */
    val messageCount: Int = 0,

    /** Total token count (estimated) */
    val totalTokens: Int = 0,

    /** Compressed token count after auto-compression */
    val compressedTokens: Int = 0,

    /** Token savings percentage */
    val tokenSavingsPercent: Float = 0f,

    /** Whether session has been auto-compressed */
    val isCompressed: Boolean = false,

    /** Compression level (0-3, higher = more aggressive) */
    val compressionLevel: Int = 0,

    /** Session context mode: PROJECT, FILE, GLOBAL */
    val contextMode: String = "PROJECT",

    /** Primary LLM model used in session */
    val primaryModel: String? = null,

    /** Whether session is pinned (sticky) */
    val isPinned: Boolean = false,

    /** Whether session is archived */
    val isArchived: Boolean = false,

    /** Whether session is starred/favorited */
    val isStarred: Boolean = false,

    /** Session color label (hex string) */
    val colorLabel: String? = null,

    /** Last accessed timestamp */
    val lastAccessedAt: Long = System.currentTimeMillis(),

    /** Creation timestamp */
    val createdAt: Long = System.currentTimeMillis(),

    /** Last update timestamp */
    val updatedAt: Long = System.currentTimeMillis(),

    /** Metadata JSON for additional properties */
    val metadata: String? = null
)

/**
 * Session message link entity
 * Links messages to sessions for multi-session support
 */
@Entity(
    tableName = "session_messages",
    primaryKeys = ["sessionId", "messageId"],
    foreignKeys = [
        ForeignKey(
            entity = SessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = ProjectChatMessageEntity::class,
            parentColumns = ["id"],
            childColumns = ["messageId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["sessionId"]),
        Index(value = ["messageId"]),
        Index(value = ["orderIndex"])
    ]
)
data class SessionMessageEntity(
    val sessionId: String,
    val messageId: String,

    /** Order of message within session */
    val orderIndex: Int,

    /** Whether this message is included in compressed context */
    val isInCompressedContext: Boolean = true,

    /** Priority score for compression decisions */
    val priorityScore: Int = 50,

    /** Whether message was auto-summarized */
    val isSummarized: Boolean = false,

    /** Original message ID if this is a summarized version */
    val originalMessageId: String? = null
)

/**
 * Session snapshot for versioning/restore
 */
@Entity(
    tableName = "session_snapshots",
    foreignKeys = [
        ForeignKey(
            entity = SessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["sessionId"]),
        Index(value = ["createdAt"])
    ]
)
data class SessionSnapshotEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    val sessionId: String,

    /** Snapshot name/label */
    val name: String,

    /** Full session data JSON */
    val data: String,

    /** Message count at snapshot time */
    val messageCount: Int,

    /** Token count at snapshot time */
    val tokenCount: Int,

    /** Creation timestamp */
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * Session tag for organization
 */
@Entity(
    tableName = "session_tags",
    primaryKeys = ["sessionId", "tag"],
    foreignKeys = [
        ForeignKey(
            entity = SessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["tag"]),
        Index(value = ["sessionId"])
    ]
)
data class SessionTagEntity(
    val sessionId: String,
    val tag: String,
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * Session statistics constants
 */
object SessionStats {
    const val DEFAULT_COMPRESSION_THRESHOLD = 50  // messages before auto-compress
    const val MAX_CONTEXT_TOKENS = 4000
    const val TARGET_COMPRESSED_TOKENS = 2000
    const val SUMMARY_INTERVAL = 20  // messages between auto-summaries
}

/**
 * Session filter options
 */
data class SessionFilter(
    val projectId: String? = null,
    val tags: List<String>? = null,
    val isArchived: Boolean? = null,
    val isPinned: Boolean? = null,
    val isStarred: Boolean? = null,
    val searchQuery: String? = null,
    val dateRange: Pair<Long, Long>? = null
)

/**
 * Session sort options
 */
enum class SessionSortBy {
    CREATED_AT,
    UPDATED_AT,
    LAST_ACCESSED_AT,
    MESSAGE_COUNT,
    TITLE
}
