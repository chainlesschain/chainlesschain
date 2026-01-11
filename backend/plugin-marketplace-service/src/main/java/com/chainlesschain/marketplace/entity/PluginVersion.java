package com.chainlesschain.marketplace.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * Plugin Version Entity
 * 插件版本实体类
 *
 * @author ChainlessChain Team
 */
@Data
@TableName("plugin_versions")
public class PluginVersion {

    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("plugin_id")
    private Long pluginId;

    private String version;

    private String changelog;

    @TableField("file_url")
    private String fileUrl;

    @TableField("file_size")
    private Long fileSize;

    @TableField("file_hash")
    private String fileHash;

    private Integer downloads;

    private String status;  // active, deprecated, yanked

    @TableField(value = "created_at", fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableLogic
    private Boolean deleted;
}
