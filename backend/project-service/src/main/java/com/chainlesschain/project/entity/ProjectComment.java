package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目评论实体
 */
@Data
@TableName("project_comments")
public class ProjectComment {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    private String projectId;

    private String filePath;

    private Integer lineNumber;

    private String authorDid;

    private String content;

    private String parentCommentId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}
