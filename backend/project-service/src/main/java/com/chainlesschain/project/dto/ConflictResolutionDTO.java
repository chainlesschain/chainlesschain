package com.chainlesschain.project.dto;

import lombok.Data;
import java.util.Map;

/**
 * 冲突解决 DTO
 * 用于客户端解决冲突后提交解决方案
 */
@Data
public class ConflictResolutionDTO {

    /**
     * 冲突ID
     */
    private String conflictId;

    /**
     * 表名
     */
    private String tableName;

    /**
     * 记录ID
     */
    private String recordId;

    /**
     * 解决策略
     * - "local": 使用本地版本
     * - "remote": 使用远程版本
     * - "manual": 使用手动合并的版本
     */
    private String resolution;

    /**
     * 设备ID
     */
    private String deviceId;

    /**
     * 如果是manual策略，这里是手动合并后的数据
     */
    private Map<String, Object> mergedData;
}
