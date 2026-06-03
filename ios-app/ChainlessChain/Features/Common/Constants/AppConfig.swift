import Foundation

/// 应用配置常量
/// 集中管理所有硬编码配置值
enum AppConfig {

    // MARK: - P2P 网络配置

    enum P2P {
        /// 最大重连尝试次数
        static let maxReconnectAttempts = 5

        /// 基础重连延迟（秒）
        static let baseReconnectDelay: TimeInterval = 2.0

        /// 消息批处理大小
        static let batchSize = 10

        /// 批处理间隔（秒）
        static let batchInterval: TimeInterval = 0.1

        /// 消息去重窗口（秒）
        static let deduplicationWindow: TimeInterval = 60

        /// 最大去重缓存数量
        static let maxDeduplicationCache = 10000

        /// 离线消息过期时间（秒）- 24小时
        static let offlineMessageExpiry: TimeInterval = 24 * 60 * 60
    }

    // MARK: - 消息投递配置

    enum Delivery {
        /// 投递超时时间（秒）
        static let timeout: TimeInterval = 30.0

        /// 最大重试次数
        static let maxRetries = 3

        /// 确认延迟移除时间（秒）
        static let ackRemovalDelay: UInt64 = 5_000_000_000  // 5秒（纳秒）
    }

    // MARK: - 性能监控配置

    enum Performance {
        /// 内存警告阈值（百分比）
        static let memoryWarningThreshold: Float = 0.8

        /// 内存临界阈值（百分比）
        static let criticalMemoryThreshold: Float = 0.9

        /// 默认监控间隔（秒）
        static let defaultMonitoringInterval: TimeInterval = 5.0

        /// 推荐分页大小
        static let defaultPageSize = 50

        /// 懒加载阈值
        static let lazyLoadingThreshold = 50
    }

    // MARK: - 通知配置

    enum Notification {
        /// 消息通知类别标识符
        static let messageCategoryId = "MESSAGE_CATEGORY"

        /// 群消息通知类别标识符
        static let groupMessageCategoryId = "GROUP_MESSAGE_CATEGORY"

        /// 默认静默时段开始（小时）
        static let defaultQuietHoursStart = 22

        /// 默认静默时段结束（小时）
        static let defaultQuietHoursEnd = 8
    }

    // MARK: - 图片处理配置

    enum Image {
        /// 存储目录
        static let storageDir = "images"

        /// 缩略图目录
        static let thumbnailDir = "images/thumbnails"

        /// 缩略图后缀
        static let thumbnailSuffix = "_thumb.jpg"

        /// JPEG 压缩质量
        static let jpegCompressionQuality: CGFloat = 0.7

        /// 缩略图压缩质量
        static let thumbnailCompressionQuality: CGFloat = 0.8

        /// Base64 图片数据 URI 前缀
        static let base64DataURIPrefix = "data:image/jpeg;base64,"

        /// P2P 图片缓存键前缀
        static let p2pCacheKeyPrefix = "p2p_image_"
    }

    // MARK: - 搜索配置

    enum Search {
        /// 关键词搜索防抖延迟（秒）
        static let keywordDebounceDelay: TimeInterval = 0.3

        /// 语义搜索防抖延迟（秒）
        static let semanticDebounceDelay: TimeInterval = 0.5

        /// 混合搜索向量权重
        static let hybridVectorWeight: Double = 0.6

        /// 混合搜索关键词权重
        static let hybridKeywordWeight: Double = 0.4
    }

    // MARK: - 数据库配置

    enum Database {
        /// 默认分页大小
        static let defaultPageSize = 50

        /// 最大查询限制
        static let maxQueryLimit = 1000

        /// 最近消息默认数量
        static let recentMessagesLimit = 100
    }

    // MARK: - 加密配置

    enum Crypto {
        /// PBKDF2 迭代次数
        static let pbkdf2Iterations = 256_000

        /// 盐长度（字节）
        static let saltLength = 32

        /// 密钥长度（字节）
        static let keyLength = 32
    }

    // MARK: - 用户界面配置

    enum UI {
        /// PIN 码最小长度
        static let minPinLength = 6

        /// PIN 码最大长度
        static let maxPinLength = 8

        /// 动画持续时间
        static let animationDuration: TimeInterval = 0.3

        /// Toast 显示时间
        static let toastDuration: TimeInterval = 2.0
    }
}
