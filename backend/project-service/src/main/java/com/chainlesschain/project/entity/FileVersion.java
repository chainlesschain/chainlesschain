package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 文件版本历史实体
 * 用于存储项目文件的版本快照
 */
@Data
@TableName("file_versions")
public class FileVersion {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 关联的文件ID
     */
    private String fileId;

    /**
     * 关联的项目ID
     */
    private String projectId;

    /**
     * 版本号
     */
    private Integer version;

    /**
     * 文件内容快照
     */
    private String content;

    /**
     * 内容哈希（用于快速比较）
     */
    private String contentHash;

    /**
     * 文件大小（字节）
     */
    private Long fileSize;

    /**
     * Git提交哈希（如果有）
     */
    private String commitHash;

    /**
     * 版本创建者
     * user: 用户手动保存
     * auto: 自动保存
     * ai: AI生成
     */
    private String createdBy;

    /**
     * 版本备注/提交信息
     */
    private String message;

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    /**
     * 设备ID（用于同步）
     */
    private String deviceId;
}
