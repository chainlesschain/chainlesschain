package com.chainlesschain.marketplace.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * Plugin Report Entity
 * 插件举报实体类
 *
 * @author ChainlessChain Team
 */
@Data
@TableName("plugin_reports")
public class PluginReport {

    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("plugin_id")
    private Long pluginId;

    @TableField("reporter_did")
    private String reporterDid;

    private String reason;  // malware, copyright, inappropriate, broken, other

    private String description;

    private String status;  // pending, investigating, resolved, dismissed

    private String resolution;

    @TableField(value = "created_at", fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField("resolved_at")
    private LocalDateTime resolvedAt;

    @TableField("admin_response")
    private String adminResponse;

    @TableField("reviewed_at")
    private LocalDateTime reviewedAt;

    @TableLogic
    private Boolean deleted;

    // Transient fields
    @TableField(exist = false)
    private String pluginName;

    @TableField(exist = false)
    private String reporterUsername;
}
