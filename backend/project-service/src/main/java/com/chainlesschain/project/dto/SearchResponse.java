package com.chainlesschain.project.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 搜索响应DTO
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SearchResponse {

    /**
     * 搜索结果列表
     */
    private List<SearchResult> results;

    /**
     * 总结果数
     */
    private Long total;

    /**
     * 当前页码
     */
    private Integer page;

    /**
     * 每页大小
     */
    private Integer pageSize;

    /**
     * 总页数
     */
    private Integer totalPages;

    /**
     * 搜索耗时（毫秒）
     */
    private Long duration;

    /**
     * 搜索建议
     */
    private List<String> suggestions;

    /**
     * 搜索结果项
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SearchResult {
        /**
         * 结果ID
         */
        private String id;

        /**
         * 结果类型
         */
        private String type;

        /**
         * 标题
         */
        private String title;

        /**
         * 内容摘要
         */
        private String snippet;

        /**
         * 高亮内容
         */
        private String highlight;

        /**
         * 相关性得分
         */
        private Double score;

        /**
         * 创建时间
         */
        private String createdAt;

        /**
         * 作者
         */
        private String author;

        /**
         * 额外数据
         */
        private Object metadata;
    }
}
