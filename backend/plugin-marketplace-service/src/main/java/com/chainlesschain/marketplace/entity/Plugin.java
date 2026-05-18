package com.chainlesschain.marketplace.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Plugin Entity
 * 插件实体类
 *
 * @author ChainlessChain Team
 */
@Data
@TableName("plugins")
public class Plugin {

    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("plugin_id")
    private String pluginId;

    private String name;

    @TableField("display_name")
    private String displayName;

    private String version;

    private String author;

    @TableField("author_did")
    private String authorDid;

    private String description;

    @TableField("long_description")
    private String longDescription;

    private String category;

    @TableField(typeHandler = com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler.class)
    private List<String> tags;

    @TableField("icon_url")
    private String iconUrl;

    private String homepage;

    private String repository;

    private String license;

    // File information
    @TableField("file_url")
    private String fileUrl;

    @TableField("file_size")
    private Long fileSize;

    @TableField("file_hash")
    private String fileHash;

    // Status
    private String status;  // pending, approved, rejected, suspended

    private Boolean verified;

    private Boolean featured;

    // Statistics
    private Integer downloads;

    private BigDecimal rating;

    @TableField("rating_count")
    private Integer ratingCount;

    // Metadata
    @TableField("min_version")
    private String minVersion;

    @TableField("max_version")
    private String maxVersion;

    @TableField(typeHandler = com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler.class)
    private List<String> permissions;

    @TableField(typeHandler = com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler.class)
    private Object dependencies;

    // Timestamps
    @TableField(value = "created_at", fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(value = "updated_at", fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableField("published_at")
    private LocalDateTime publishedAt;

    @TableLogic
    private Boolean deleted;

    // Transient fields (not in database)
    @TableField(exist = false)
    private List<PluginVersion> versions;

    @TableField(exist = false)
    private String categoryName;
}
