package com.chainlesschain.project.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 搜索请求DTO
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SearchRequest {

    /**
     * 搜索关键词
     */
    private String keyword;

    /**
     * 搜索类型（all, conversation, post, comment, file）
     */
    private String type = "all";

    /**
     * 用户ID（可选，用于过滤）
     */
    private String userId;

    /**
     * 项目ID（可选，用于过滤）
     */
    private String projectId;

    /**
     * 页码
     */
    private Integer page = 1;

    /**
     * 每页大小
     */
    private Integer pageSize = 20;

    /**
     * 排序字段
     */
    private String sortBy = "relevance";

    /**
     * 排序方向（asc, desc）
     */
    private String sortOrder = "desc";

    /**
     * 过滤条件
     */
    private List<String> filters;
}
