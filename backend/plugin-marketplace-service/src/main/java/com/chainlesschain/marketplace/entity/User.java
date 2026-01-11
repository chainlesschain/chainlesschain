package com.chainlesschain.marketplace.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * User Entity
 * 用户实体类
 *
 * @author ChainlessChain Team
 */
@Data
@TableName("users")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String did;

    private String username;

    private String email;

    @TableField("password_hash")
    private String passwordHash;

    @TableField("display_name")
    private String displayName;

    @TableField("avatar_url")
    private String avatarUrl;

    private String bio;

    private String website;

    private String role;  // developer, admin, moderator

    private Boolean verified;

    @TableField(value = "created_at", fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(value = "updated_at", fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableField("last_login_at")
    private LocalDateTime lastLoginAt;

    @TableLogic
    private Boolean deleted;
}
