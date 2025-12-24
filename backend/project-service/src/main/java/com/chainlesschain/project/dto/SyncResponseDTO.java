package com.chainlesschain.project.dto;

import lombok.Data;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 同步响应 DTO
 * 用于返回增量下载的数据
 */
@Data
public class SyncResponseDTO {

    /**
     * 新增的记录列表
     */
    private List<Map<String, Object>> newRecords = new ArrayList<>();

    /**
     * 更新的记录列表
     */
    private List<Map<String, Object>> updatedRecords = new ArrayList<>();

    /**
     * 已删除的记录ID列表
     */
    private List<String> deletedIds = new ArrayList<>();

    /**
     * 检测到的冲突列表
     */
    private List<ConflictInfo> conflicts = new ArrayList<>();

    /**
     * 服务器时间戳（毫秒）
     */
    private Long serverTimestamp;

    /**
     * 同步统计信息
     */
    private SyncStats stats;

    /**
     * 冲突信息
     */
    @Data
    public static class ConflictInfo {
        private String id;
        private String tableName;
        private Map<String, Object> localVersion;
        private Map<String, Object> remoteVersion;
        private Long localUpdatedAt;
        private Long remoteUpdatedAt;
    }

    /**
     * 同步统计
     */
    @Data
    public static class SyncStats {
        private Integer newCount = 0;
        private Integer updatedCount = 0;
        private Integer deletedCount = 0;
        private Integer conflictCount = 0;
        private Long executionTimeMs;
    }
}
