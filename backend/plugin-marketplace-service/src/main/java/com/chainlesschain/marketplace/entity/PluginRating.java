package com.chainlesschain.marketplace.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * Plugin Rating Entity
 * 插件评分实体类
 *
 * @author ChainlessChain Team
 */
@Data
@TableName("plugin_ratings")
public class PluginRating {

    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("plugin_id")
    private Long pluginId;

    @TableField("user_did")
    private String userDid;

    private Integer rating;

    private String comment;

    @TableField("helpful_count")
    private Integer helpfulCount;

    @TableField(value = "created_at", fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(value = "updated_at", fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Boolean deleted;

    // Transient fields
    @TableField(exist = false)
    private String username;

    @TableField(exist = false)
    private String avatarUrl;
}
