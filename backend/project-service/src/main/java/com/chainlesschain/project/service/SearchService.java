package com.chainlesschain.project.service;

import com.chainlesschain.project.dto.SearchRequest;
import com.chainlesschain.project.dto.SearchResponse;
import com.chainlesschain.project.dto.SearchResponse.SearchResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 搜索服务
 * 提供全文搜索功能
 */
@Service
public class SearchService {

    @Autowired(required = false)
    private RedisTemplate<String, Object> redisTemplate;

    private static final String SEARCH_CACHE_PREFIX = "search:";
    private static final long CACHE_EXPIRATION = 300; // 5分钟

    /**
     * 执行搜索
     */
    public SearchResponse search(SearchRequest request) {
        long startTime = System.currentTimeMillis();

        // 尝试从缓存获取
        String cacheKey = generateCacheKey(request);
        SearchResponse cachedResult = getCachedResult(cacheKey);
        if (cachedResult != null) {
            return cachedResult;
        }

        // 执行搜索
        List<SearchResult> results = performSearch(request);

        // 计算分页
        int total = results.size();
        int start = (request.getPage() - 1) * request.getPageSize();
        int end = Math.min(start + request.getPageSize(), total);
        List<SearchResult> pagedResults = results.subList(start, end);

        // 构建响应
        SearchResponse response = new SearchResponse();
        response.setResults(pagedResults);
        response.setTotal((long) total);
        response.setPage(request.getPage());
        response.setPageSize(request.getPageSize());
        response.setTotalPages((int) Math.ceil((double) total / request.getPageSize()));
        response.setDuration(System.currentTimeMillis() - startTime);
        response.setSuggestions(generateSuggestions(request.getKeyword()));

        // 缓存结果
        cacheResult(cacheKey, response);

        return response;
    }

    /**
     * 执行实际搜索
     */
    private List<SearchResult> performSearch(SearchRequest request) {
        List<SearchResult> results = new ArrayList<>();
        String keyword = request.getKeyword().toLowerCase();

        // TODO: 实际应用中应该查询数据库
        // 这里提供模拟数据作为示例

        // 搜索对话
        if ("all".equals(request.getType()) || "conversation".equals(request.getType())) {
            results.addAll(searchConversations(keyword, request));
        }

        // 搜索帖子
        if ("all".equals(request.getType()) || "post".equals(request.getType())) {
            results.addAll(searchPosts(keyword, request));
        }

        // 搜索评论
        if ("all".equals(request.getType()) || "comment".equals(request.getType())) {
            results.addAll(searchComments(keyword, request));
        }

        // 搜索文件
        if ("all".equals(request.getType()) || "file".equals(request.getType())) {
            results.addAll(searchFiles(keyword, request));
        }

        // 按相关性排序
        results.sort((a, b) -> Double.compare(b.getScore(), a.getScore()));

        return results;
    }

    /**
     * 搜索对话
     */
    private List<SearchResult> searchConversations(String keyword, SearchRequest request) {
        List<SearchResult> results = new ArrayList<>();

        // TODO: 实际查询数据库
        // 模拟数据
        if (keyword.contains("测试") || keyword.contains("对话")) {
            SearchResult result = new SearchResult();
            result.setId("conv-1");
            result.setType("conversation");
            result.setTitle("测试对话");
            result.setSnippet("这是一个包含关键词的对话内容...");
            result.setHighlight("这是一个包含<em>" + keyword + "</em>的对话内容...");
            result.setScore(0.95);
            result.setCreatedAt(LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
            result.setAuthor("user123");
            results.add(result);
        }

        return results;
    }

    /**
     * 搜索帖子
     */
    private List<SearchResult> searchPosts(String keyword, SearchRequest request) {
        List<SearchResult> results = new ArrayList<>();

        // TODO: 实际查询数据库
        // 模拟数据
        if (keyword.contains("技术") || keyword.contains("分享")) {
            SearchResult result = new SearchResult();
            result.setId("post-1");
            result.setType("post");
            result.setTitle("技术分享：如何使用全文搜索");
            result.setSnippet("本文介绍了全文搜索的实现方法...");
            result.setHighlight("本文介绍了<em>" + keyword + "</em>的实现方法...");
            result.setScore(0.88);
            result.setCreatedAt(LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
            result.setAuthor("admin");
            results.add(result);
        }

        return results;
    }

    /**
     * 搜索评论
     */
    private List<SearchResult> searchComments(String keyword, SearchRequest request) {
        List<SearchResult> results = new ArrayList<>();

        // TODO: 实际查询数据库
        return results;
    }

    /**
     * 搜索文件
     */
    private List<SearchResult> searchFiles(String keyword, SearchRequest request) {
        List<SearchResult> results = new ArrayList<>();

        // TODO: 实际查询数据库
        return results;
    }

    /**
     * 生成搜索建议
     */
    private List<String> generateSuggestions(String keyword) {
        List<String> suggestions = new ArrayList<>();

        // TODO: 基于历史搜索和热门搜索生成建议
        // 模拟数据
        if (keyword.length() >= 2) {
            suggestions.add(keyword + " 教程");
            suggestions.add(keyword + " 示例");
            suggestions.add(keyword + " 最佳实践");
        }

        return suggestions;
    }

    /**
     * 生成缓存键
     */
    private String generateCacheKey(SearchRequest request) {
        return SEARCH_CACHE_PREFIX +
            request.getKeyword() + ":" +
            request.getType() + ":" +
            request.getPage() + ":" +
            request.getPageSize();
    }

    /**
     * 从缓存获取结果
     */
    private SearchResponse getCachedResult(String cacheKey) {
        if (redisTemplate == null) {
            return null;
        }

        try {
            return (SearchResponse) redisTemplate.opsForValue().get(cacheKey);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 缓存搜索结果
     */
    private void cacheResult(String cacheKey, SearchResponse response) {
        if (redisTemplate == null) {
            return;
        }

        try {
            redisTemplate.opsForValue().set(cacheKey, response, CACHE_EXPIRATION, TimeUnit.SECONDS);
        } catch (Exception e) {
            // 缓存失败不影响主流程
        }
    }

    /**
     * 清除搜索缓存
     */
    public void clearSearchCache() {
        if (redisTemplate == null) {
            return;
        }

        try {
            redisTemplate.keys(SEARCH_CACHE_PREFIX + "*")
                .forEach(key -> redisTemplate.delete(key));
        } catch (Exception e) {
            // 忽略错误
        }
    }
}
