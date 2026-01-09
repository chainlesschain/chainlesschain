package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 角色实体
 */
@Data
@TableName("roles")
public class Role {

    /**
     * 角色ID
     */
    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 角色名称（唯一）
     */
    private String name;

    /**
     * 角色代码（唯一，如：ROLE_ADMIN）
     */
    private String code;

    /**
     * 角色描述
     */
    private String description;

    /**
     * 权限列表（逗号分隔）
     */
    private String permissions;

    /**
     * 角色状态（active, inactive）
     */
    private String status;

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    /**
     * 逻辑删除标志
     */
    @TableLogic
    private Integer deleted;
}
