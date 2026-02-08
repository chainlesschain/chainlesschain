package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.chainlesschain.project.dto.SearchRequest;
import com.chainlesschain.project.dto.SearchResponse;
import com.chainlesschain.project.dto.SearchResponse.SearchResult;
import com.chainlesschain.project.entity.Conversation;
import com.chainlesschain.project.entity.ConversationMessage;
import com.chainlesschain.project.entity.KnowledgeItem;
import com.chainlesschain.project.entity.ProjectComment;
import com.chainlesschain.project.entity.ProjectFile;
import com.chainlesschain.project.mapper.ConversationMapper;
import com.chainlesschain.project.mapper.ConversationMessageMapper;
import com.chainlesschain.project.mapper.KnowledgeItemMapper;
import com.chainlesschain.project.mapper.ProjectCommentMapper;
import com.chainlesschain.project.mapper.ProjectFileMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 搜索服务
 * 提供全文搜索功能
 */
@Service
@RequiredArgsConstructor
public class SearchService {

    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper conversationMessageMapper;
    private final KnowledgeItemMapper knowledgeItemMapper;
    private final ProjectCommentMapper projectCommentMapper;
    private final ProjectFileMapper projectFileMapper;

    @Autowired(required = false)
    private RedisTemplate<String, Object> redisTemplate;

    private static final String SEARCH_CACHE_PREFIX = "search:";
    private static final long CACHE_EXPIRATION = 300; // 5分钟
    private static final int MAX_SNIPPET_LENGTH = 200;
    private static final int MAX_RESULTS_PER_TYPE = 50;

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
        String keyword = request.getKeyword();

        // 搜索对话
        if ("all".equals(request.getType()) || "conversation".equals(request.getType())) {
            results.addAll(searchConversations(keyword, request));
        }

        // 搜索知识库条目（帖子/笔记/文档）
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
     * 搜索对话（标题匹配 + 消息内容匹配）
     */
    private List<SearchResult> searchConversations(String keyword, SearchRequest request) {
        List<SearchResult> results = new ArrayList<>();

        // 1. 按对话标题搜索
        LambdaQueryWrapper<Conversation> convWrapper = new LambdaQueryWrapper<>();
        convWrapper.like(Conversation::getTitle, keyword)
                .eq(StringUtils.hasText(request.getUserId()), Conversation::getUserId, request.getUserId())
                .eq(StringUtils.hasText(request.getProjectId()), Conversation::getProjectId, request.getProjectId())
                .orderByDesc(Conversation::getUpdatedAt)
                .last("LIMIT " + MAX_RESULTS_PER_TYPE);

        List<Conversation> conversations = conversationMapper.selectList(convWrapper);
        for (Conversation conv : conversations) {
            SearchResult result = new SearchResult();
            result.setId(conv.getId());
            result.setType("conversation");
            result.setTitle(conv.getTitle());
            result.setSnippet(conv.getTitle());
            result.setHighlight(highlightKeyword(conv.getTitle(), keyword));
            result.setScore(0.9);
            result.setCreatedAt(formatDateTime(conv.getCreatedAt()));
            result.setAuthor(conv.getUserId());
            results.add(result);
        }

        // 2. 按消息内容搜索（补充标题搜索未命中的对话）
        LambdaQueryWrapper<ConversationMessage> msgWrapper = new LambdaQueryWrapper<>();
        msgWrapper.like(ConversationMessage::getContent, keyword)
                .orderByDesc(ConversationMessage::getCreatedAt)
                .last("LIMIT " + MAX_RESULTS_PER_TYPE);

        List<ConversationMessage> messages = conversationMessageMapper.selectList(msgWrapper);
        for (ConversationMessage msg : messages) {
            // 跳过已通过标题匹配到的对话
            String convId = msg.getConversationId();
            if (results.stream().anyMatch(r -> r.getId().equals(convId))) {
                continue;
            }

            SearchResult result = new SearchResult();
            result.setId(convId);
            result.setType("conversation");
            result.setTitle("对话消息");
            result.setSnippet(truncate(msg.getContent(), MAX_SNIPPET_LENGTH));
            result.setHighlight(highlightKeyword(truncate(msg.getContent(), MAX_SNIPPET_LENGTH), keyword));
            result.setScore(0.75);
            result.setCreatedAt(formatDateTime(msg.getCreatedAt()));
            result.setAuthor(msg.getRole());
            results.add(result);
        }

        return results;
    }

    /**
     * 搜索知识库条目（笔记/文档/网页剪辑）
     */
    private List<SearchResult> searchPosts(String keyword, SearchRequest request) {
        List<SearchResult> results = new ArrayList<>();

        LambdaQueryWrapper<KnowledgeItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.and(w -> w.like(KnowledgeItem::getTitle, keyword)
                        .or()
                        .like(KnowledgeItem::getContent, keyword))
                .eq(StringUtils.hasText(request.getUserId()), KnowledgeItem::getUserId, request.getUserId())
                .orderByDesc(KnowledgeItem::getUpdatedAt)
                .last("LIMIT " + MAX_RESULTS_PER_TYPE);

        List<KnowledgeItem> items = knowledgeItemMapper.selectList(wrapper);
        for (KnowledgeItem item : items) {
            SearchResult result = new SearchResult();
            result.setId(item.getId());
            result.setType("post");
            result.setTitle(item.getTitle());
            String snippet = StringUtils.hasText(item.getContent())
                    ? truncate(item.getContent(), MAX_SNIPPET_LENGTH)
                    : item.getTitle();
            result.setSnippet(snippet);
            result.setHighlight(highlightKeyword(snippet, keyword));
            // 标题匹配权重更高
            boolean titleMatch = item.getTitle() != null && item.getTitle().toLowerCase().contains(keyword.toLowerCase());
            result.setScore(titleMatch ? 0.88 : 0.72);
            result.setCreatedAt(formatDateTime(item.getCreatedAt()));
            result.setAuthor(item.getUserId());
            results.add(result);
        }

        return results;
    }

    /**
     * 搜索项目评论
     */
    private List<SearchResult> searchComments(String keyword, SearchRequest request) {
        List<SearchResult> results = new ArrayList<>();

        LambdaQueryWrapper<ProjectComment> wrapper = new LambdaQueryWrapper<>();
        wrapper.like(ProjectComment::getContent, keyword)
                .eq(StringUtils.hasText(request.getProjectId()), ProjectComment::getProjectId, request.getProjectId())
                .eq(StringUtils.hasText(request.getUserId()), ProjectComment::getUserId, request.getUserId())
                .orderByDesc(ProjectComment::getCreatedAt)
                .last("LIMIT " + MAX_RESULTS_PER_TYPE);

        List<ProjectComment> comments = projectCommentMapper.selectList(wrapper);
        for (ProjectComment comment : comments) {
            SearchResult result = new SearchResult();
            result.setId(comment.getId());
            result.setType("comment");
            result.setTitle(StringUtils.hasText(comment.getFilePath())
                    ? "评论 @ " + comment.getFilePath()
                    : "项目评论");
            String snippet = truncate(comment.getContent(), MAX_SNIPPET_LENGTH);
            result.setSnippet(snippet);
            result.setHighlight(highlightKeyword(snippet, keyword));
            result.setScore(0.70);
            result.setCreatedAt(formatDateTime(comment.getCreatedAt()));
            result.setAuthor(comment.getAuthorDid() != null ? comment.getAuthorDid() : comment.getUserId());
            results.add(result);
        }

        return results;
    }

    /**
     * 搜索项目文件（文件名 + 文件路径 + 内容）
     */
    private List<SearchResult> searchFiles(String keyword, SearchRequest request) {
        List<SearchResult> results = new ArrayList<>();

        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.and(w -> w.like(ProjectFile::getFileName, keyword)
                        .or()
                        .like(ProjectFile::getFilePath, keyword)
                        .or()
                        .like(ProjectFile::getContent, keyword))
                .eq(StringUtils.hasText(request.getProjectId()), ProjectFile::getProjectId, request.getProjectId())
                .orderByDesc(ProjectFile::getUpdatedAt)
                .last("LIMIT " + MAX_RESULTS_PER_TYPE);

        List<ProjectFile> files = projectFileMapper.selectList(wrapper);
        for (ProjectFile file : files) {
            SearchResult result = new SearchResult();
            result.setId(file.getId());
            result.setType("file");
            result.setTitle(file.getFileName());
            String snippet = file.getFilePath();
            if (StringUtils.hasText(file.getContent()) && file.getContent().toLowerCase().contains(keyword.toLowerCase())) {
                snippet = truncate(file.getContent(), MAX_SNIPPET_LENGTH);
            }
            result.setSnippet(snippet);
            result.setHighlight(highlightKeyword(snippet, keyword));
            // 文件名精确匹配权重高
            boolean nameMatch = file.getFileName() != null && file.getFileName().toLowerCase().contains(keyword.toLowerCase());
            result.setScore(nameMatch ? 0.85 : 0.65);
            result.setCreatedAt(formatDateTime(file.getCreatedAt()));
            result.setAuthor(file.getGeneratedBy());
            results.add(result);
        }

        return results;
    }

    /**
     * 生成搜索建议（基于相关对话标题和知识库标题）
     */
    private List<String> generateSuggestions(String keyword) {
        List<String> suggestions = new ArrayList<>();
        if (!StringUtils.hasText(keyword) || keyword.length() < 2) {
            return suggestions;
        }

        // 从对话标题中提取相关建议
        LambdaQueryWrapper<Conversation> convWrapper = new LambdaQueryWrapper<>();
        convWrapper.like(Conversation::getTitle, keyword)
                .orderByDesc(Conversation::getUpdatedAt)
                .last("LIMIT 3");
        List<Conversation> relatedConvs = conversationMapper.selectList(convWrapper);
        suggestions.addAll(relatedConvs.stream()
                .map(Conversation::getTitle)
                .filter(StringUtils::hasText)
                .collect(Collectors.toList()));

        // 从知识库标题中提取相关建议
        if (suggestions.size() < 5) {
            LambdaQueryWrapper<KnowledgeItem> kiWrapper = new LambdaQueryWrapper<>();
            kiWrapper.like(KnowledgeItem::getTitle, keyword)
                    .orderByDesc(KnowledgeItem::getUpdatedAt)
                    .last("LIMIT " + (5 - suggestions.size()));
            List<KnowledgeItem> relatedItems = knowledgeItemMapper.selectList(kiWrapper);
            suggestions.addAll(relatedItems.stream()
                    .map(KnowledgeItem::getTitle)
                    .filter(StringUtils::hasText)
                    .collect(Collectors.toList()));
        }

        return suggestions.stream().distinct().limit(5).collect(Collectors.toList());
    }

    /**
     * 获取搜索建议（供Controller调用）
     */
    public List<String> getSuggestions(String keyword) {
        return generateSuggestions(keyword);
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

    /**
     * 高亮关键词
     */
    private String highlightKeyword(String text, String keyword) {
        if (!StringUtils.hasText(text) || !StringUtils.hasText(keyword)) {
            return text;
        }
        return text.replaceAll("(?i)" + java.util.regex.Pattern.quote(keyword), "<em>$0</em>");
    }

    /**
     * 截断文本
     */
    private String truncate(String text, int maxLength) {
        if (text == null) {
            return "";
        }
        if (text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + "...";
    }

    /**
     * 格式化日期时间
     */
    private String formatDateTime(java.time.LocalDateTime dateTime) {
        if (dateTime == null) {
            return null;
        }
        return dateTime.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
    }
}
