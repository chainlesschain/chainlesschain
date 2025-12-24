package com.chainlesschain.project.service;

import com.chainlesschain.project.dto.ConflictResolutionDTO;
import com.chainlesschain.project.dto.SyncRequestDTO;
import com.chainlesschain.project.dto.SyncResponseDTO;

import java.util.Map;

/**
 * 数据同步服务接口
 */
public interface SyncService {

    /**
     * 批量上传数据
     *
     * @param request 同步请求
     * @return 上传结果统计
     */
    Map<String, Object> uploadBatch(SyncRequestDTO request);

    /**
     * 增量下载数据
     *
     * @param tableName    表名
     * @param lastSyncedAt 最后同步时间戳（毫秒）
     * @param deviceId     设备ID
     * @return 增量数据
     */
    SyncResponseDTO downloadIncremental(String tableName, Long lastSyncedAt, String deviceId);

    /**
     * 获取同步状态
     *
     * @param deviceId 设备ID
     * @return 同步状态信息
     */
    Map<String, Object> getSyncStatus(String deviceId);

    /**
     * 解决冲突
     *
     * @param resolution 冲突解决方案
     */
    void resolveConflict(ConflictResolutionDTO resolution);
}
