package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 知识库命令 API
 *
 * 提供类型安全的知识库管理相关命令
 */
@Singleton
class KnowledgeCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 搜索知识库
     *
     * @param query 搜索关键词
     * @param topK 返回结果数量
     * @param filters 过滤条件
     */
    suspend fun search(
        query: String,
        topK: Int = 10,
        filters: Map<String, Any>? = null
    ): Result<KnowledgeSearchResponse> {
        val params = mutableMapOf<String, Any>(
            "query" to query,
            "topK" to topK
        )
        filters?.let { params["filters"] = it }

        return client.invoke("knowledge.search", params)
    }

    /**
     * 获取笔记列表
     *
     * @param limit 返回数量限制
     * @param offset 分页偏移量
     * @param folderId 文件夹 ID 过滤
     * @param tags 标签过滤
     */
    suspend fun getNotes(
        limit: Int = 20,
        offset: Int = 0,
        folderId: String? = null,
        tags: List<String>? = null
    ): Result<NotesListResponse> {
        val params = mutableMapOf<String, Any>(
            "limit" to limit,
            "offset" to offset
        )
        folderId?.let { params["folderId"] = it }
        tags?.let { params["tags"] = it }

        return client.invoke("knowledge.getNotes", params)
    }

    /**
     * 获取笔记详情
     *
     * @param noteId 笔记 ID
     */
    suspend fun getNote(noteId: String): Result<NoteDetailResponse> {
        val params = mapOf("noteId" to noteId)
        return client.invoke("knowledge.getNote", params)
    }

    /**
     * 创建笔记
     *
     * @param title 笔记标题
     * @param content 笔记内容（Markdown 格式）
     * @param folderId 文件夹 ID
     * @param tags 标签列表
     */
    suspend fun createNote(
        title: String,
        content: String,
        folderId: String? = null,
        tags: List<String>? = null
    ): Result<CreateNoteResponse> {
        val params = mutableMapOf<String, Any>(
            "title" to title,
            "content" to content
        )
        folderId?.let { params["folderId"] = it }
        tags?.let { params["tags"] = it }

        return client.invoke("knowledge.createNote", params)
    }

    /**
     * 更新笔记
     *
     * @param noteId 笔记 ID
     * @param title 新标题（可选）
     * @param content 新内容（可选）
     * @param tags 新标签（可选）
     */
    suspend fun updateNote(
        noteId: String,
        title: String? = null,
        content: String? = null,
        tags: List<String>? = null
    ): Result<UpdateNoteResponse> {
        val params = mutableMapOf<String, Any>("noteId" to noteId)
        title?.let { params["title"] = it }
        content?.let { params["content"] = it }
        tags?.let { params["tags"] = it }

        return client.invoke("knowledge.updateNote", params)
    }

    /**
     * 删除笔记
     *
     * @param noteId 笔记 ID
     * @param permanent 是否永久删除（否则移到回收站）
     */
    suspend fun deleteNote(
        noteId: String,
        permanent: Boolean = false
    ): Result<DeleteNoteResponse> {
        val params = mapOf(
            "noteId" to noteId,
            "permanent" to permanent
        )
        return client.invoke("knowledge.deleteNote", params)
    }

    /**
     * 获取文件夹列表
     */
    suspend fun getFolders(): Result<FoldersResponse> {
        return client.invoke("knowledge.getFolders", emptyMap())
    }

    /**
     * 创建文件夹
     *
     * @param name 文件夹名称
     * @param parentId 父文件夹 ID
     */
    suspend fun createFolder(
        name: String,
        parentId: String? = null
    ): Result<CreateFolderResponse> {
        val params = mutableMapOf<String, Any>("name" to name)
        parentId?.let { params["parentId"] = it }

        return client.invoke("knowledge.createFolder", params)
    }

    /**
     * 获取标签列表
     */
    suspend fun getTags(): Result<TagsResponse> {
        return client.invoke("knowledge.getTags", emptyMap())
    }

    /**
     * 获取知识库统计
     */
    suspend fun getStats(): Result<KnowledgeStatsResponse> {
        return client.invoke("knowledge.getStats", emptyMap())
    }

    // ==================== 高级搜索 ====================

    /**
     * 高级搜索
     *
     * @param query 搜索关键词
     * @param searchIn 搜索范围 (title, content, tags, all)
     * @param dateFrom 开始日期
     * @param dateTo 结束日期
     * @param sortBy 排序字段 (relevance, date, title)
     * @param sortOrder 排序方向 (asc, desc)
     * @param limit 结果数量
     */
    suspend fun advancedSearch(
        query: String,
        searchIn: String = "all",
        dateFrom: Long? = null,
        dateTo: Long? = null,
        sortBy: String = "relevance",
        sortOrder: String = "desc",
        limit: Int = 20
    ): Result<KnowledgeSearchResponse> {
        val params = mutableMapOf<String, Any>(
            "query" to query,
            "searchIn" to searchIn,
            "sortBy" to sortBy,
            "sortOrder" to sortOrder,
            "limit" to limit
        )
        dateFrom?.let { params["dateFrom"] = it }
        dateTo?.let { params["dateTo"] = it }
        return client.invoke("knowledge.advancedSearch", params)
    }

    /**
     * 语义搜索（向量搜索）
     *
     * @param query 查询文本
     * @param topK 返回数量
     * @param threshold 相似度阈值
     */
    suspend fun semanticSearch(
        query: String,
        topK: Int = 10,
        threshold: Float = 0.5f
    ): Result<KnowledgeSearchResponse> {
        return client.invoke("knowledge.semanticSearch", mapOf(
            "query" to query,
            "topK" to topK,
            "threshold" to threshold
        ))
    }

    // ==================== 笔记版本管理 ====================

    /**
     * 获取笔记版本历史
     *
     * @param noteId 笔记 ID
     * @param limit 版本数量
     */
    suspend fun getNoteHistory(
        noteId: String,
        limit: Int = 20
    ): Result<NoteHistoryResponse> {
        return client.invoke("knowledge.getNoteHistory", mapOf(
            "noteId" to noteId,
            "limit" to limit
        ))
    }

    /**
     * 获取特定版本
     *
     * @param noteId 笔记 ID
     * @param versionId 版本 ID
     */
    suspend fun getNoteVersion(
        noteId: String,
        versionId: String
    ): Result<NoteVersionResponse> {
        return client.invoke("knowledge.getNoteVersion", mapOf(
            "noteId" to noteId,
            "versionId" to versionId
        ))
    }

    /**
     * 恢复到特定版本
     *
     * @param noteId 笔记 ID
     * @param versionId 版本 ID
     */
    suspend fun restoreNoteVersion(
        noteId: String,
        versionId: String
    ): Result<RestoreVersionResponse> {
        return client.invoke("knowledge.restoreNoteVersion", mapOf(
            "noteId" to noteId,
            "versionId" to versionId
        ))
    }

    /**
     * 比较两个版本
     *
     * @param noteId 笔记 ID
     * @param versionId1 版本 1
     * @param versionId2 版本 2
     */
    suspend fun compareVersions(
        noteId: String,
        versionId1: String,
        versionId2: String
    ): Result<VersionDiffResponse> {
        return client.invoke("knowledge.compareVersions", mapOf(
            "noteId" to noteId,
            "versionId1" to versionId1,
            "versionId2" to versionId2
        ))
    }

    // ==================== 笔记链接 ====================

    /**
     * 创建笔记链接
     *
     * @param sourceNoteId 源笔记 ID
     * @param targetNoteId 目标笔记 ID
     * @param linkType 链接类型 (reference, related, parent, child)
     */
    suspend fun linkNotes(
        sourceNoteId: String,
        targetNoteId: String,
        linkType: String = "reference"
    ): Result<LinkNotesResponse> {
        return client.invoke("knowledge.linkNotes", mapOf(
            "sourceNoteId" to sourceNoteId,
            "targetNoteId" to targetNoteId,
            "linkType" to linkType
        ))
    }

    /**
     * 删除笔记链接
     *
     * @param sourceNoteId 源笔记 ID
     * @param targetNoteId 目标笔记 ID
     */
    suspend fun unlinkNotes(
        sourceNoteId: String,
        targetNoteId: String
    ): Result<UnlinkNotesResponse> {
        return client.invoke("knowledge.unlinkNotes", mapOf(
            "sourceNoteId" to sourceNoteId,
            "targetNoteId" to targetNoteId
        ))
    }

    /**
     * 获取笔记链接（出链）
     *
     * @param noteId 笔记 ID
     */
    suspend fun getOutgoingLinks(noteId: String): Result<NoteLinksResponse> {
        return client.invoke("knowledge.getOutgoingLinks", mapOf("noteId" to noteId))
    }

    /**
     * 获取反向链接（入链）
     *
     * @param noteId 笔记 ID
     */
    suspend fun getBacklinks(noteId: String): Result<NoteLinksResponse> {
        return client.invoke("knowledge.getBacklinks", mapOf("noteId" to noteId))
    }

    /**
     * 获取知识图谱
     *
     * @param centerNoteId 中心笔记 ID（可选）
     * @param depth 深度
     */
    suspend fun getKnowledgeGraph(
        centerNoteId: String? = null,
        depth: Int = 2
    ): Result<KnowledgeGraphResponse> {
        val params = mutableMapOf<String, Any>("depth" to depth)
        centerNoteId?.let { params["centerNoteId"] = it }
        return client.invoke("knowledge.getKnowledgeGraph", params)
    }

    // ==================== 导出/导入 ====================

    /**
     * 导出笔记
     *
     * @param noteId 笔记 ID
     * @param format 格式 (markdown, html, pdf, docx)
     * @param includeAttachments 是否包含附件
     */
    suspend fun exportNote(
        noteId: String,
        format: String = "markdown",
        includeAttachments: Boolean = true
    ): Result<ExportNoteResponse> {
        return client.invoke("knowledge.exportNote", mapOf(
            "noteId" to noteId,
            "format" to format,
            "includeAttachments" to includeAttachments
        ))
    }

    /**
     * 批量导出笔记
     *
     * @param noteIds 笔记 ID 列表
     * @param format 格式
     * @param asArchive 是否打包为压缩包
     */
    suspend fun exportNotes(
        noteIds: List<String>,
        format: String = "markdown",
        asArchive: Boolean = true
    ): Result<ExportNotesResponse> {
        return client.invoke("knowledge.exportNotes", mapOf(
            "noteIds" to noteIds,
            "format" to format,
            "asArchive" to asArchive
        ))
    }

    /**
     * 导出文件夹
     *
     * @param folderId 文件夹 ID
     * @param format 格式
     * @param recursive 是否包含子文件夹
     */
    suspend fun exportFolder(
        folderId: String,
        format: String = "markdown",
        recursive: Boolean = true
    ): Result<ExportNotesResponse> {
        return client.invoke("knowledge.exportFolder", mapOf(
            "folderId" to folderId,
            "format" to format,
            "recursive" to recursive
        ))
    }

    /**
     * 导入笔记
     *
     * @param content 内容
     * @param format 格式 (markdown, html, txt)
     * @param folderId 目标文件夹
     */
    suspend fun importNote(
        content: String,
        format: String = "markdown",
        folderId: String? = null
    ): Result<ImportNoteResponse> {
        val params = mutableMapOf<String, Any>(
            "content" to content,
            "format" to format
        )
        folderId?.let { params["folderId"] = it }
        return client.invoke("knowledge.importNote", params)
    }

    /**
     * 从文件导入
     *
     * @param filePath 文件路径
     * @param folderId 目标文件夹
     */
    suspend fun importFromFile(
        filePath: String,
        folderId: String? = null
    ): Result<ImportNoteResponse> {
        val params = mutableMapOf<String, Any>("filePath" to filePath)
        folderId?.let { params["folderId"] = it }
        return client.invoke("knowledge.importFromFile", params)
    }

    // ==================== 笔记模板 ====================

    /**
     * 获取模板列表
     */
    suspend fun getTemplates(): Result<TemplatesResponse> {
        return client.invoke("knowledge.getTemplates", emptyMap())
    }

    /**
     * 获取模板详情
     *
     * @param templateId 模板 ID
     */
    suspend fun getTemplate(templateId: String): Result<TemplateDetailResponse> {
        return client.invoke("knowledge.getTemplate", mapOf("templateId" to templateId))
    }

    /**
     * 从模板创建笔记
     *
     * @param templateId 模板 ID
     * @param title 笔记标题
     * @param variables 模板变量值
     * @param folderId 目标文件夹
     */
    suspend fun createFromTemplate(
        templateId: String,
        title: String,
        variables: Map<String, String>? = null,
        folderId: String? = null
    ): Result<CreateNoteResponse> {
        val params = mutableMapOf<String, Any>(
            "templateId" to templateId,
            "title" to title
        )
        variables?.let { params["variables"] = it }
        folderId?.let { params["folderId"] = it }
        return client.invoke("knowledge.createFromTemplate", params)
    }

    /**
     * 保存为模板
     *
     * @param noteId 笔记 ID
     * @param templateName 模板名称
     * @param description 描述
     */
    suspend fun saveAsTemplate(
        noteId: String,
        templateName: String,
        description: String? = null
    ): Result<SaveTemplateResponse> {
        val params = mutableMapOf<String, Any>(
            "noteId" to noteId,
            "templateName" to templateName
        )
        description?.let { params["description"] = it }
        return client.invoke("knowledge.saveAsTemplate", params)
    }

    // ==================== 笔记状态管理 ====================

    /**
     * 置顶笔记
     *
     * @param noteId 笔记 ID
     * @param pinned 是否置顶
     */
    suspend fun pinNote(
        noteId: String,
        pinned: Boolean = true
    ): Result<NoteStateResponse> {
        return client.invoke("knowledge.pinNote", mapOf(
            "noteId" to noteId,
            "pinned" to pinned
        ))
    }

    /**
     * 收藏笔记
     *
     * @param noteId 笔记 ID
     * @param starred 是否收藏
     */
    suspend fun starNote(
        noteId: String,
        starred: Boolean = true
    ): Result<NoteStateResponse> {
        return client.invoke("knowledge.starNote", mapOf(
            "noteId" to noteId,
            "starred" to starred
        ))
    }

    /**
     * 归档笔记
     *
     * @param noteId 笔记 ID
     * @param archived 是否归档
     */
    suspend fun archiveNote(
        noteId: String,
        archived: Boolean = true
    ): Result<NoteStateResponse> {
        return client.invoke("knowledge.archiveNote", mapOf(
            "noteId" to noteId,
            "archived" to archived
        ))
    }

    /**
     * 获取置顶笔记
     */
    suspend fun getPinnedNotes(): Result<NotesListResponse> {
        return client.invoke("knowledge.getPinnedNotes", emptyMap())
    }

    /**
     * 获取收藏笔记
     */
    suspend fun getStarredNotes(): Result<NotesListResponse> {
        return client.invoke("knowledge.getStarredNotes", emptyMap())
    }

    /**
     * 获取归档笔记
     */
    suspend fun getArchivedNotes(): Result<NotesListResponse> {
        return client.invoke("knowledge.getArchivedNotes", emptyMap())
    }

    // ==================== 附件管理 ====================

    /**
     * 获取笔记附件
     *
     * @param noteId 笔记 ID
     */
    suspend fun getAttachments(noteId: String): Result<AttachmentsResponse> {
        return client.invoke("knowledge.getAttachments", mapOf("noteId" to noteId))
    }

    /**
     * 添加附件
     *
     * @param noteId 笔记 ID
     * @param fileName 文件名
     * @param fileData Base64 文件数据
     * @param mimeType MIME 类型
     */
    suspend fun addAttachment(
        noteId: String,
        fileName: String,
        fileData: String,
        mimeType: String
    ): Result<AddAttachmentResponse> {
        return client.invoke("knowledge.addAttachment", mapOf(
            "noteId" to noteId,
            "fileName" to fileName,
            "fileData" to fileData,
            "mimeType" to mimeType
        ))
    }

    /**
     * 删除附件
     *
     * @param noteId 笔记 ID
     * @param attachmentId 附件 ID
     */
    suspend fun deleteAttachment(
        noteId: String,
        attachmentId: String
    ): Result<DeleteAttachmentResponse> {
        return client.invoke("knowledge.deleteAttachment", mapOf(
            "noteId" to noteId,
            "attachmentId" to attachmentId
        ))
    }

    /**
     * 下载附件
     *
     * @param noteId 笔记 ID
     * @param attachmentId 附件 ID
     */
    suspend fun downloadAttachment(
        noteId: String,
        attachmentId: String
    ): Result<DownloadAttachmentResponse> {
        return client.invoke("knowledge.downloadAttachment", mapOf(
            "noteId" to noteId,
            "attachmentId" to attachmentId
        ))
    }

    // ==================== 文件夹管理 ====================

    /**
     * 重命名文件夹
     *
     * @param folderId 文件夹 ID
     * @param name 新名称
     */
    suspend fun renameFolder(
        folderId: String,
        name: String
    ): Result<RenameFolderResponse> {
        return client.invoke("knowledge.renameFolder", mapOf(
            "folderId" to folderId,
            "name" to name
        ))
    }

    /**
     * 移动文件夹
     *
     * @param folderId 文件夹 ID
     * @param newParentId 新父文件夹 ID
     */
    suspend fun moveFolder(
        folderId: String,
        newParentId: String?
    ): Result<MoveFolderResponse> {
        val params = mutableMapOf<String, Any>("folderId" to folderId)
        newParentId?.let { params["newParentId"] = it }
        return client.invoke("knowledge.moveFolder", params)
    }

    /**
     * 删除文件夹
     *
     * @param folderId 文件夹 ID
     * @param deleteNotes 是否删除笔记（否则移到根目录）
     */
    suspend fun deleteFolder(
        folderId: String,
        deleteNotes: Boolean = false
    ): Result<DeleteFolderResponse> {
        return client.invoke("knowledge.deleteFolder", mapOf(
            "folderId" to folderId,
            "deleteNotes" to deleteNotes
        ))
    }

    /**
     * 移动笔记到文件夹
     *
     * @param noteId 笔记 ID
     * @param folderId 目标文件夹 ID
     */
    suspend fun moveNote(
        noteId: String,
        folderId: String?
    ): Result<MoveNoteResponse> {
        val params = mutableMapOf<String, Any>("noteId" to noteId)
        folderId?.let { params["folderId"] = it }
        return client.invoke("knowledge.moveNote", params)
    }

    // ==================== 标签管理 ====================

    /**
     * 创建标签
     *
     * @param name 标签名称
     * @param color 颜色
     */
    suspend fun createTag(
        name: String,
        color: String? = null
    ): Result<CreateTagResponse> {
        val params = mutableMapOf<String, Any>("name" to name)
        color?.let { params["color"] = it }
        return client.invoke("knowledge.createTag", params)
    }

    /**
     * 重命名标签
     *
     * @param oldName 原名称
     * @param newName 新名称
     */
    suspend fun renameTag(
        oldName: String,
        newName: String
    ): Result<RenameTagResponse> {
        return client.invoke("knowledge.renameTag", mapOf(
            "oldName" to oldName,
            "newName" to newName
        ))
    }

    /**
     * 删除标签
     *
     * @param name 标签名称
     */
    suspend fun deleteTag(name: String): Result<DeleteTagResponse> {
        return client.invoke("knowledge.deleteTag", mapOf("name" to name))
    }

    /**
     * 合并标签
     *
     * @param sourceTags 源标签列表
     * @param targetTag 目标标签
     */
    suspend fun mergeTags(
        sourceTags: List<String>,
        targetTag: String
    ): Result<MergeTagsResponse> {
        return client.invoke("knowledge.mergeTags", mapOf(
            "sourceTags" to sourceTags,
            "targetTag" to targetTag
        ))
    }

    /**
     * 添加标签到笔记
     *
     * @param noteId 笔记 ID
     * @param tags 标签列表
     */
    suspend fun addTagsToNote(
        noteId: String,
        tags: List<String>
    ): Result<UpdateTagsResponse> {
        return client.invoke("knowledge.addTagsToNote", mapOf(
            "noteId" to noteId,
            "tags" to tags
        ))
    }

    /**
     * 从笔记移除标签
     *
     * @param noteId 笔记 ID
     * @param tags 标签列表
     */
    suspend fun removeTagsFromNote(
        noteId: String,
        tags: List<String>
    ): Result<UpdateTagsResponse> {
        return client.invoke("knowledge.removeTagsFromNote", mapOf(
            "noteId" to noteId,
            "tags" to tags
        ))
    }

    // ==================== 回收站 ====================

    /**
     * 获取回收站笔记
     */
    suspend fun getTrash(): Result<NotesListResponse> {
        return client.invoke("knowledge.getTrash", emptyMap())
    }

    /**
     * 恢复笔记
     *
     * @param noteId 笔记 ID
     */
    suspend fun restoreNote(noteId: String): Result<RestoreNoteResponse> {
        return client.invoke("knowledge.restoreNote", mapOf("noteId" to noteId))
    }

    /**
     * 清空回收站
     */
    suspend fun emptyTrash(): Result<EmptyTrashResponse> {
        return client.invoke("knowledge.emptyTrash", emptyMap())
    }

    // ==================== 最近访问 ====================

    /**
     * 获取最近编辑的笔记
     *
     * @param limit 数量
     */
    suspend fun getRecentlyEdited(limit: Int = 10): Result<NotesListResponse> {
        return client.invoke("knowledge.getRecentlyEdited", mapOf("limit" to limit))
    }

    /**
     * 获取最近查看的笔记
     *
     * @param limit 数量
     */
    suspend fun getRecentlyViewed(limit: Int = 10): Result<NotesListResponse> {
        return client.invoke("knowledge.getRecentlyViewed", mapOf("limit" to limit))
    }
}

// 响应数据类

@Serializable
data class KnowledgeSearchResponse(
    val success: Boolean,
    val results: List<KnowledgeSearchResult>,
    val total: Int,
    val query: String
)

@Serializable
data class KnowledgeSearchResult(
    val noteId: String,
    val title: String,
    val content: String,
    val score: Float,
    val highlights: List<String>? = null,
    val tags: List<String>? = null
)

@Serializable
data class NotesListResponse(
    val success: Boolean,
    val notes: List<NoteInfo>,
    val total: Int,
    val limit: Int,
    val offset: Int
)

@Serializable
data class NoteInfo(
    val id: String,
    val title: String,
    val preview: String? = null,
    val folderId: String? = null,
    val tags: List<String>? = null,
    val createdAt: Long,
    val updatedAt: Long
)

@Serializable
data class NoteDetailResponse(
    val success: Boolean,
    val note: NoteDetail
)

@Serializable
data class NoteDetail(
    val id: String,
    val title: String,
    val content: String,
    val folderId: String? = null,
    val tags: List<String>? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val wordCount: Int? = null
)

@Serializable
data class CreateNoteResponse(
    val success: Boolean,
    val noteId: String,
    val message: String
)

@Serializable
data class UpdateNoteResponse(
    val success: Boolean,
    val noteId: String,
    val message: String
)

@Serializable
data class DeleteNoteResponse(
    val success: Boolean,
    val noteId: String,
    val message: String
)

@Serializable
data class FoldersResponse(
    val success: Boolean,
    val folders: List<FolderInfo>,
    val total: Int
)

@Serializable
data class FolderInfo(
    val id: String,
    val name: String,
    val parentId: String? = null,
    val noteCount: Int,
    val children: List<FolderInfo>? = null
)

@Serializable
data class CreateFolderResponse(
    val success: Boolean,
    val folderId: String,
    val message: String
)

@Serializable
data class TagsResponse(
    val success: Boolean,
    val tags: List<TagInfo>,
    val total: Int
)

@Serializable
data class TagInfo(
    val name: String,
    val count: Int,
    val color: String? = null
)

@Serializable
data class KnowledgeStatsResponse(
    val success: Boolean,
    val stats: KnowledgeStats
)

@Serializable
data class KnowledgeStats(
    val totalNotes: Int,
    val totalFolders: Int,
    val totalTags: Int,
    val totalWords: Long,
    val storageUsed: Long,
    val lastUpdated: Long
)

// ==================== 版本管理响应 ====================

@Serializable
data class NoteHistoryResponse(
    val success: Boolean,
    val noteId: String,
    val versions: List<NoteVersionInfo>,
    val total: Int
)

@Serializable
data class NoteVersionInfo(
    val versionId: String,
    val createdAt: Long,
    val title: String,
    val wordCount: Int,
    val changeType: String  // "created", "edited", "restored"
)

@Serializable
data class NoteVersionResponse(
    val success: Boolean,
    val noteId: String,
    val versionId: String,
    val title: String,
    val content: String,
    val createdAt: Long
)

@Serializable
data class RestoreVersionResponse(
    val success: Boolean,
    val noteId: String,
    val restoredVersionId: String,
    val newVersionId: String,
    val message: String
)

@Serializable
data class VersionDiffResponse(
    val success: Boolean,
    val noteId: String,
    val additions: Int,
    val deletions: Int,
    val diff: String  // Unified diff format
)

// ==================== 笔记链接响应 ====================

@Serializable
data class LinkNotesResponse(
    val success: Boolean,
    val sourceNoteId: String,
    val targetNoteId: String,
    val linkType: String,
    val message: String
)

@Serializable
data class UnlinkNotesResponse(
    val success: Boolean,
    val sourceNoteId: String,
    val targetNoteId: String,
    val message: String
)

@Serializable
data class NoteLinksResponse(
    val success: Boolean,
    val noteId: String,
    val links: List<NoteLinkInfo>,
    val total: Int
)

@Serializable
data class NoteLinkInfo(
    val noteId: String,
    val title: String,
    val linkType: String,
    val createdAt: Long
)

@Serializable
data class KnowledgeGraphResponse(
    val success: Boolean,
    val nodes: List<GraphNode>,
    val edges: List<GraphEdge>,
    val totalNodes: Int,
    val totalEdges: Int
)

@Serializable
data class GraphNode(
    val id: String,
    val title: String,
    val type: String,  // "note", "folder", "tag"
    val linkCount: Int
)

@Serializable
data class GraphEdge(
    val source: String,
    val target: String,
    val type: String
)

// ==================== 导出/导入响应 ====================

@Serializable
data class ExportNoteResponse(
    val success: Boolean,
    val noteId: String,
    val format: String,
    val content: String,
    val fileName: String,
    val size: Int
)

@Serializable
data class ExportNotesResponse(
    val success: Boolean,
    val noteCount: Int,
    val format: String,
    val fileName: String,
    val data: String,  // Base64 if archive
    val size: Long
)

@Serializable
data class ImportNoteResponse(
    val success: Boolean,
    val noteId: String,
    val title: String,
    val message: String
)

// ==================== 模板响应 ====================

@Serializable
data class TemplatesResponse(
    val success: Boolean,
    val templates: List<TemplateInfo>,
    val total: Int
)

@Serializable
data class TemplateInfo(
    val id: String,
    val name: String,
    val description: String? = null,
    val variables: List<String>,
    val createdAt: Long
)

@Serializable
data class TemplateDetailResponse(
    val success: Boolean,
    val template: TemplateDetail
)

@Serializable
data class TemplateDetail(
    val id: String,
    val name: String,
    val description: String? = null,
    val content: String,
    val variables: List<String>,
    val createdAt: Long,
    val updatedAt: Long
)

@Serializable
data class SaveTemplateResponse(
    val success: Boolean,
    val templateId: String,
    val templateName: String,
    val message: String
)

// ==================== 笔记状态响应 ====================

@Serializable
data class NoteStateResponse(
    val success: Boolean,
    val noteId: String,
    val state: String,
    val value: Boolean,
    val message: String? = null
)

// ==================== 附件响应 ====================

@Serializable
data class AttachmentsResponse(
    val success: Boolean,
    val noteId: String,
    val attachments: List<AttachmentInfo>,
    val total: Int,
    val totalSize: Long
)

@Serializable
data class AttachmentInfo(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val size: Long,
    val createdAt: Long,
    val thumbnail: String? = null
)

@Serializable
data class AddAttachmentResponse(
    val success: Boolean,
    val attachmentId: String,
    val fileName: String,
    val size: Long,
    val message: String
)

@Serializable
data class DeleteAttachmentResponse(
    val success: Boolean,
    val attachmentId: String,
    val message: String
)

@Serializable
data class DownloadAttachmentResponse(
    val success: Boolean,
    val attachmentId: String,
    val fileName: String,
    val mimeType: String,
    val data: String,  // Base64
    val size: Long
)

// ==================== 文件夹管理响应 ====================

@Serializable
data class RenameFolderResponse(
    val success: Boolean,
    val folderId: String,
    val name: String,
    val message: String
)

@Serializable
data class MoveFolderResponse(
    val success: Boolean,
    val folderId: String,
    val newParentId: String? = null,
    val message: String
)

@Serializable
data class DeleteFolderResponse(
    val success: Boolean,
    val folderId: String,
    val deletedNotes: Int,
    val message: String
)

@Serializable
data class MoveNoteResponse(
    val success: Boolean,
    val noteId: String,
    val folderId: String? = null,
    val message: String
)

// ==================== 标签管理响应 ====================

@Serializable
data class CreateTagResponse(
    val success: Boolean,
    val name: String,
    val color: String? = null,
    val message: String
)

@Serializable
data class RenameTagResponse(
    val success: Boolean,
    val oldName: String,
    val newName: String,
    val affectedNotes: Int,
    val message: String
)

@Serializable
data class DeleteTagResponse(
    val success: Boolean,
    val name: String,
    val affectedNotes: Int,
    val message: String
)

@Serializable
data class MergeTagsResponse(
    val success: Boolean,
    val sourceTags: List<String>,
    val targetTag: String,
    val affectedNotes: Int,
    val message: String
)

@Serializable
data class UpdateTagsResponse(
    val success: Boolean,
    val noteId: String,
    val tags: List<String>,
    val message: String
)

// ==================== 回收站响应 ====================

@Serializable
data class RestoreNoteResponse(
    val success: Boolean,
    val noteId: String,
    val message: String
)

@Serializable
data class EmptyTrashResponse(
    val success: Boolean,
    val deletedCount: Int,
    val freedSpace: Long,
    val message: String
)
