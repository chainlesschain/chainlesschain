package com.chainlesschain.community.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 关注实体
 */
@Data
@TableName("follows")
public class Follow {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long followerId;    // 关注者ID
    private Long followingId;   // 被关注者ID

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    // 非数据库字段
    @TableField(exist = false)
    private User follower;

    @TableField(exist = false)
    private User following;
}
