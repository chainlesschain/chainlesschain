package com.chainlesschain.android.core.common.repository

import kotlinx.coroutines.flow.Flow

/**
 * Repository 接口抽象
 *
 * 定义标准的 Repository 操作和最佳实践
 */

/**
 * 基础 Repository 接口
 *
 * 所有 Repository 都应该实现此接口或其子接口
 *
 * @param T 实体类型
 * @param ID 主键类型
 */
interface BaseRepository<T, ID> {

    /**
     * 根据 ID 获取单个实体
     *
     * @param id 实体 ID
     * @return Flow<Result<T>> 实体流
     */
    fun getById(id: ID): Flow<Result<T>>

    /**
     * 获取所有实体
     *
     * @return Flow<Result<List<T>>> 实体列表流
     */
    fun getAll(): Flow<Result<List<T>>>

    /**
     * 插入实体
     *
     * @param entity 要插入的实体
     * @return Result<ID> 插入后的 ID
     */
    suspend fun insert(entity: T): Result<ID>

    /**
     * 更新实体
     *
     * @param entity 要更新的实体
     * @return Result<Unit> 更新结果
     */
    suspend fun update(entity: T): Result<Unit>

    /**
     * 删除实体
     *
     * @param id 要删除的实体 ID
     * @return Result<Unit> 删除结果
     */
    suspend fun delete(id: ID): Result<Unit>
}

/**
 * 可搜索的 Repository 接口
 *
 * 提供搜索功能的 Repository 应该实现此接口
 */
interface SearchableRepository<T> {

    /**
     * 搜索实体
     *
     * @param query 搜索关键词
     * @return Flow<Result<List<T>>> 搜索结果流
     */
    fun search(query: String): Flow<Result<List<T>>>
}

/**
 * 可分页的 Repository 接口
 *
 * 提供分页功能的 Repository 应该实现此接口
 */
interface PageableRepository<T> {

    /**
     * 获取分页数据
     *
     * @param page 页码（从 0 开始）
     * @param pageSize 每页数量
     * @return Flow<Result<List<T>>> 分页数据流
     */
    fun getPage(page: Int, pageSize: Int): Flow<Result<List<T>>>
}

/**
 * 可缓存的 Repository 接口
 *
 * 提供缓存功能的 Repository 应该实现此接口
 */
interface CacheableRepository {

    /**
     * 清除缓存
     */
    suspend fun clearCache()

    /**
     * 刷新缓存
     */
    suspend fun refreshCache()
}

/**
 * 可同步的 Repository 接口
 *
 * 提供远程同步功能的 Repository 应该实现此接口
 */
interface SyncableRepository {

    /**
     * 同步数据
     *
     * @param forceRefresh 是否强制刷新
     * @return Result<Unit> 同步结果
     */
    suspend fun sync(forceRefresh: Boolean = false): Result<Unit>

    /**
     * 获取上次同步时间
     *
     * @return 上次同步时间戳（毫秒）
     */
    suspend fun getLastSyncTime(): Long?
}

/**
 * Repository 实现的最佳实践
 *
 * 1. 使用 Flow 返回数据流（响应式）
 * 2. 使用 Result 封装结果（统一错误处理）
 * 3. 分离本地数据源和远程数据源
 * 4. 优先使用本地缓存（Single Source of Truth）
 * 5. 后台自动同步远程数据
 *
 * 示例实现：
 * ```kotlin
 * class KnowledgeRepository(
 *     private val localDataSource: KnowledgeDao,
 *     private val remoteDataSource: KnowledgeApi,
 *     private val dispatcher: CoroutineDispatcher = Dispatchers.IO
 * ) : BaseRepository<KnowledgeItem, String>,
 *     SearchableRepository<KnowledgeItem>,
 *     SyncableRepository {
 *
 *     override fun getById(id: String): Flow<Result<KnowledgeItem>> = flow {
 *         // 1. 先从本地获取
 *         val localItem = localDataSource.getById(id)
 *         emit(localItem)
 *
 *         // 2. 后台同步远程数据
 *         try {
 *             val remoteItem = remoteDataSource.getById(id)
 *             localDataSource.insert(remoteItem)
 *             emit(remoteItem)
 *         } catch (e: Exception) {
 *             // 远程获取失败，使用本地数据
 *             Timber.w(e, "Failed to fetch remote data")
 *         }
 *     }.flowOn(dispatcher)
 *         .asResult()
 *
 *     override fun getAll(): Flow<Result<List<KnowledgeItem>>> =
 *         localDataSource.getAll()
 *             .map { Result.success(it) }
 *             .flowOn(dispatcher)
 *
 *     override suspend fun insert(entity: KnowledgeItem): Result<String> =
 *         runCatchingWithError {
 *             withContext(dispatcher) {
 *                 val id = localDataSource.insert(entity)
 *                 // 后台同步到远程
 *                 launch {
 *                     remoteDataSource.create(entity)
 *                 }
 *                 id
 *             }
 *         }
 *
 *     override fun search(query: String): Flow<Result<List<KnowledgeItem>>> =
 *         localDataSource.search(query)
 *             .map { Result.success(it) }
 *             .flowOn(dispatcher)
 *
 *     override suspend fun sync(forceRefresh: Boolean): Result<Unit> =
 *         runCatchingWithError {
 *             withContext(dispatcher) {
 *                 val remoteItems = remoteDataSource.getAll()
 *                 localDataSource.insertAll(remoteItems)
 *             }
 *         }
 *
 *     override suspend fun getLastSyncTime(): Long? {
 *         // 从 SharedPreferences 或数据库读取
 *         return null
 *     }
 * }
 * ```
 */

/**
 * Repository 协调器
 *
 * 协调多个 Repository 的操作
 */
abstract class RepositoryCoordinator {

    /**
     * 执行事务操作
     *
     * @param block 事务代码块
     * @return Result<T> 事务结果
     */
    protected suspend fun <T> transaction(
        block: suspend () -> T
    ): Result<T> = runCatching {
        block()
    }

    /**
     * 批量操作
     *
     * @param operations 操作列表
     * @return Result<List<R>> 操作结果列表
     */
    protected suspend fun <T, R> batchOperation(
        items: List<T>,
        operation: suspend (T) -> R
    ): Result<List<R>> = runCatching {
        items.map { operation(it) }
    }
}
