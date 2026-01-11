package com.chainlesschain.marketplace.dto;

import lombok.Data;
import jakarta.validation.constraints.*;

/**
 * Plugin Query DTO
 * 插件查询参数
 */
@Data
public class PluginQueryDTO {

    private String category;

    private String search;

    private String sort = "popular";  // popular, recent, rating, downloads

    private Integer page = 1;

    @Min(1)
    @Max(100)
    private Integer pageSize = 20;

    private Boolean verified;

    private String status;
}
