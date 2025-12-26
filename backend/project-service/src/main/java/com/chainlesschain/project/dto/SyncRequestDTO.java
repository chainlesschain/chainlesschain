package com.chainlesschain.project.dto;

import lombok.Data;
import java.util.List;
import java.util.Map;

/**
 * 同步请求 DTO
 * 用于客户端批量上传数据时的请求体
 */
@Data
public class SyncRequestDTO {

    /**
     * 表名
     */
    private String tableName;

    /**
     * 设备ID
     */
    private String deviceId;

    /**
     * 请求ID（用于幂等性保护）
     * 客户端生成的唯一UUID，用于防止重复请求
     */
    private String requestId;

    /**
     * 最后同步时间戳（毫秒）
     */
    private Long lastSyncedAt;

    /**
     * 待上传的记录列表
     * 每个记录是一个Map，key为字段名，value为字段值
     */
    private List<Map<String, Object>> records;

    /**
     * 是否强制覆盖（默认false，遇到冲突时会返回冲突信息）
     */
    private Boolean forceOverwrite = false;
}
