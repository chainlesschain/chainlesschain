package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目对话实体
 */
@Data
@TableName("project_conversations")
public class ProjectConversation {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    private String projectId;

    private String role;  // user, assistant, system

    private String content;

    private String context;  // JSON array

    private String taskId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableLogic
    private Integer deleted;
}
