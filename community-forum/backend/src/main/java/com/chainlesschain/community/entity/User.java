package com.chainlesschain.community.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 用户实体
 */
@Data
@TableName("users")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String did;
    private String deviceId;
    private String deviceType;
    private String username;
    private String nickname;
    private String avatar;
    private String email;
    private String bio;
    private String role;
    private String status;
    private Integer points;
    private Integer reputation;
    private Integer postsCount;
    private Integer repliesCount;
    private Integer followersCount;
    private Integer followingCount;
    private LocalDateTime lastLoginAt;
    private String lastLoginIp;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}
