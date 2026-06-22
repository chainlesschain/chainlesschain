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
import com.chainlesschain.project.security.ProjectAccessGuard;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 搜索服务
 * 提供全文搜索功能。
 *
 * <p><b>授权（IDOR 修复）：</b>此前所有查询按调用方提供的 {@code userId}/{@code projectId}
 * 作<i>可选</i>过滤（甚至消息内容搜索与搜索建议完全无过滤），任意已登录用户省略这些参数
 * 即可搜出<b>其他所有用户</b>的对话/消息/知识库/评论/文件。现改为：已认证调用方一律按其
 * 身份集合（{@link ProjectAccessGuard#callerIdentities}，兼容 username/userId/did 多形态）与
 * 其可访问项目集合（{@link ProjectAccessGuard#accessibleProjectIds}）<b>强制</b>限定结果，
 * 客户端传入的 userId/projectId 仅能在该范围内进一步收窄；缓存键也按调用方区分，避免跨用户
 * 命中。dev-mode（未认证 permitAll）保持旧的可选过滤行为不变。
 */
@Service
@RequiredArgsConstructor
public class SearchService {

    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper conversationMessageMapper;
    private final KnowledgeItemMapper knowledgeItemMapper;
    private final ProjectCommentMapper projectCommentMapper;
    private final ProjectFileMapper projectFileMapper;
    private final ProjectAccessGuard accessGuard;

    @Autowired(required = false)
    private RedisTemplate<String, Object> redisTemplate;

    private static final String SEARCH_CACHE_PREFIX = "search:";
    private static final long CACHE_EXPIRATION = 300; // 5分钟
    private static final int MAX_SNIPPET_LENGTH = 200;
    private static final int MAX_RESULTS_PER_TYPE = 50;
    private static final int MAX_PAGE_SIZE = 200;

    /**
     * 调用方搜索范围。{@code enforce=false} 表示 dev-mode/未认证，保持旧的可选过滤行为。
     */
    static final class Scope {
        final boolean enforce;
        final Set<String> identities;  // 调用方身份集合 {username,userId,did}（enforce 时非空）
        final Set<String> projectIds;  // 调用方可访问项目 id 集合（可能为空 = 无可访问项目）
        final String cacheKeyPart;     // 按调用方区分缓存，防跨用户命中

        Scope(boolean enforce, Set<String> identities, Set<String> projectIds, String cacheKeyPart) {
            this.enforce = enforce;
            this.identities = identities;
            this.projectIds = projectIds;
            this.cacheKeyPart = cacheKeyPart;
        }

        boolean hasProjects() {
            return projectIds != null && !projectIds.isEmpty();
        }
    }

    Scope resolveScope(Authentication authentication) {
        if (accessGuard != null && accessGuard.isCallerAuthenticated(authentication)) {
            return new Scope(
                    true,
                    accessGuard.callerIdentities(authentication),
                    accessGuard.accessibleProjectIds(authentication),
                    "u:" + authentication.getName());
        }
        return new Scope(false, null, null, "dev");
    }

    /**
     * 执行搜索（按调用方身份强制限定范围）。
     */
    public SearchResponse search(SearchRequest request, Authentication authentication) {
        long startTime = System.currentTimeMillis();
        Scope scope = resolveScope(authentication);

        // 尝试从缓存获取（缓存键含调用方区分，避免跨用户命中他人结果）
        String cacheKey = generateCacheKey(request, scope.cacheKeyPart);
        SearchResponse cachedResult = getCachedResult(cacheKey);
        if (cachedResult != null) {
            return cachedResult;
        }

        // 执行搜索
        List<SearchResult> results = performSearch(request, scope);

        // 计算分页
        int total = results.size();
        // Clamp client-controlled paging. page/pageSize come straight from query
        // params / request body with no bean validation, so a negative pageSize
        // crashes subList (IndexOutOfBounds → HTTP 500) and pageSize=0 makes
        // totalPages = ceil(n / 0) = Infinity → (int) Integer.MAX_VALUE.
        int page = request.getPage() == null ? 1 : Math.max(1, request.getPage());
        int pageSize = request.getPageSize() == null
                ? 20
                : Math.min(Math.max(1, request.getPageSize()), MAX_PAGE_SIZE);
        int start = (page - 1) * pageSize;
        if (start < 0) start = 0;
        int end = Math.min(start + pageSize, total);
        List<SearchResult> pagedResults = start <= total
                ? new ArrayList<>(results.subList(Math.min(start, total), end))
                : new ArrayList<>();

        // 构建响应（回填归一后的 page/pageSize，使响应与实际分页一致）
        SearchResponse response = new SearchResponse();
        response.setResults(pagedResults);
        response.setTotal((long) total);
        response.setPage(page);
        response.setPageSize(pageSize);
        response.setTotalPages((int) Math.ceil((double) total / pageSize));
        response.setDuration(System.currentTimeMillis() - startTime);
        response.setSuggestions(generateSuggestions(request.getKeyword(), scope));

        // 缓存结果
        cacheResult(cacheKey, response);

        return response;
    }

    /**
     * 执行实际搜索
     */
    private List<SearchResult> performSearch(SearchRequest request, Scope scope) {
        List<SearchResult> results = new ArrayList<>();
        String keyword = request.getKeyword();

        // 搜索对话
        if ("all".equals(request.getType()) || "conversation".equals(request.getType())) {
            results.addAll(searchConversations(keyword, request, scope));
        }

        // 搜索知识库条目（帖子/笔记/文档）
        if ("all".equals(request.getType()) || "post".equals(request.getType())) {
            results.addAll(searchPosts(keyword, request, scope));
        }

        // 搜索评论
        if ("all".equals(request.getType()) || "comment".equals(request.getType())) {
            results.addAll(searchComments(keyword, request, scope));
        }

        // 搜索文件
        if ("all".equals(request.getType()) || "file".equals(request.getType())) {
            results.addAll(searchFiles(keyword, request, scope));
        }

        // 按相关性排序
        results.sort((a, b) -> Double.compare(b.getScore(), a.getScore()));

        return results;
    }

    /** 调用方可访问的全部对话 id（用于把消息内容搜索限定到这些对话）。 */
    private Set<String> callerConversationIds(Scope scope) {
        LambdaQueryWrapper<Conversation> w = new LambdaQueryWrapper<>();
        w.in(Conversation::getUserId, scope.identities);
        if (scope.hasProjects()) {
            w.or().in(Conversation::getProjectId, scope.projectIds);
        }
        return conversationMapper.selectList(w).stream()
                .map(Conversation::getId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
    }

    /**
     * 搜索对话（标题匹配 + 消息内容匹配）
     */
    private List<SearchResult> searchConversations(String keyword, SearchRequest request, Scope scope) {
        List<SearchResult> results = new ArrayList<>();

        // 1. 按对话标题搜索（强制按调用方身份限定；dev-mode 退回客户端可选过滤）
        LambdaQueryWrapper<Conversation> convWrapper = new LambdaQueryWrapper<>();
        convWrapper.like(Conversation::getTitle, keyword)
                .in(scope.enforce, Conversation::getUserId, scope.identities)
                .eq(!scope.enforce && StringUtils.hasText(request.getUserId()),
                        Conversation::getUserId, request.getUserId())
                .eq(StringUtils.hasText(request.getProjectId()),
                        Conversation::getProjectId, request.getProjectId())
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

        // 2. 按消息内容搜索（补充标题未命中的对话）。消息表无 userId，须限定到调用方可访问的
        //    对话 id，否则任意 keyword 会搜出他人对话消息（此前的 IDOR 重灾区）。
        LambdaQueryWrapper<ConversationMessage> msgWrapper = new LambdaQueryWrapper<>();
        msgWrapper.like(ConversationMessage::getContent, keyword);
        if (scope.enforce) {
            Set<String> convIds = callerConversationIds(scope);
            if (convIds.isEmpty()) {
                return results; // 调用方无任何可访问对话 → 无消息命中
            }
            msgWrapper.in(ConversationMessage::getConversationId, convIds);
        }
        msgWrapper.orderByDesc(ConversationMessage::getCreatedAt)
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
    private List<SearchResult> searchPosts(String keyword, SearchRequest request, Scope scope) {
        List<SearchResult> results = new ArrayList<>();

        LambdaQueryWrapper<KnowledgeItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.and(w -> w.like(KnowledgeItem::getTitle, keyword)
                        .or()
                        .like(KnowledgeItem::getContent, keyword))
                .in(scope.enforce, KnowledgeItem::getUserId, scope.identities)
                .eq(!scope.enforce && StringUtils.hasText(request.getUserId()),
                        KnowledgeItem::getUserId, request.getUserId())
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
     * 搜索项目评论（调用方作者发表的 或 调用方可访问项目内的评论）
     */
    private List<SearchResult> searchComments(String keyword, SearchRequest request, Scope scope) {
        List<SearchResult> results = new ArrayList<>();

        LambdaQueryWrapper<ProjectComment> wrapper = new LambdaQueryWrapper<>();
        wrapper.like(ProjectComment::getContent, keyword);
        if (scope.enforce) {
            wrapper.and(w -> {
                w.in(ProjectComment::getUserId, scope.identities);
                if (scope.hasProjects()) {
                    w.or().in(ProjectComment::getProjectId, scope.projectIds);
                }
            });
            wrapper.eq(StringUtils.hasText(request.getProjectId()),
                    ProjectComment::getProjectId, request.getProjectId());
        } else {
            wrapper.eq(StringUtils.hasText(request.getProjectId()),
                            ProjectComment::getProjectId, request.getProjectId())
                    .eq(StringUtils.hasText(request.getUserId()),
                            ProjectComment::getUserId, request.getUserId());
        }
        wrapper.orderByDesc(ProjectComment::getCreatedAt)
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
     * 搜索项目文件（文件名 + 文件路径 + 内容）。文件表无 userId，仅按 projectId 归属，故强制
     * 限定到调用方可访问的项目集合；无可访问项目则不返回任何文件。
     */
    private List<SearchResult> searchFiles(String keyword, SearchRequest request, Scope scope) {
        List<SearchResult> results = new ArrayList<>();

        if (scope.enforce && !scope.hasProjects()) {
            return results; // 调用方无可访问项目 → 无文件命中
        }

        LambdaQueryWrapper<ProjectFile> wrapper = new LambdaQueryWrapper<>();
        wrapper.and(w -> w.like(ProjectFile::getFileName, keyword)
                        .or()
                        .like(ProjectFile::getFilePath, keyword)
                        .or()
                        .like(ProjectFile::getContent, keyword))
                .in(scope.enforce, ProjectFile::getProjectId, scope.projectIds)
                .eq(StringUtils.hasText(request.getProjectId()),
                        ProjectFile::getProjectId, request.getProjectId())
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
     * 生成搜索建议（基于相关对话标题和知识库标题，按调用方身份限定）
     */
    private List<String> generateSuggestions(String keyword, Scope scope) {
        List<String> suggestions = new ArrayList<>();
        if (!StringUtils.hasText(keyword) || keyword.length() < 2) {
            return suggestions;
        }

        // 从对话标题中提取相关建议
        LambdaQueryWrapper<Conversation> convWrapper = new LambdaQueryWrapper<>();
        convWrapper.like(Conversation::getTitle, keyword)
                .in(scope.enforce, Conversation::getUserId, scope.identities)
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
                    .in(scope.enforce, KnowledgeItem::getUserId, scope.identities)
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
     * 获取搜索建议（供Controller调用，按调用方身份限定）
     */
    public List<String> getSuggestions(String keyword, Authentication authentication) {
        return generateSuggestions(keyword, resolveScope(authentication));
    }

    /**
     * 生成缓存键（含调用方区分，避免跨用户命中）
     */
    private String generateCacheKey(SearchRequest request, String scopeKeyPart) {
        return SEARCH_CACHE_PREFIX +
            scopeKeyPart + ":" +
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
