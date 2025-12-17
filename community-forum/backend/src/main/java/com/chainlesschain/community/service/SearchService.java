package com.chainlesschain.community.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.entity.Post;
import com.chainlesschain.community.entity.User;
import com.chainlesschain.community.mapper.PostMapper;
import com.chainlesschain.community.mapper.UserMapper;
import com.chainlesschain.community.vo.PostListVO;
import com.chainlesschain.community.vo.UserVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 搜索服务
 */
@Service
public class SearchService {

    @Autowired
    private PostMapper postMapper;

    @Autowired
    private UserMapper userMapper;

    /**
     * 全局搜索
     */
    public Result<Map<String, Object>> globalSearch(String keyword, Integer page, Integer pageSize) {
        if (keyword == null || keyword.trim().isEmpty()) {
            return Result.error("搜索关键词不能为空");
        }

        Map<String, Object> resultMap = new HashMap<>();

        // 搜索帖子（最多5条）
        List<Post> posts = searchPostsInternal(keyword, 1, 5);
        resultMap.put("posts", posts.stream().map(this::convertPostToListVO).collect(Collectors.toList()));

        // 搜索用户（最多5条）
        List<User> users = searchUsersInternal(keyword, 1, 5);
        resultMap.put("users", users.stream().map(this::convertUserToVO).collect(Collectors.toList()));

        return Result.success(resultMap);
    }

    /**
     * 搜索帖子
     */
    public Result<PageResult<PostListVO>> searchPosts(String keyword, Long categoryId, Integer page, Integer pageSize) {
        if (keyword == null || keyword.trim().isEmpty()) {
            return Result.error("搜索关键词不能为空");
        }

        QueryWrapper<Post> wrapper = new QueryWrapper<>();
        wrapper.eq("deleted", 0)
                .eq("status", "PUBLISHED")
                .and(w -> w.like("title", keyword).or().like("content", keyword));

        if (categoryId != null) {
            wrapper.eq("category_id", categoryId);
        }

        wrapper.orderByDesc("created_at");

        Page<Post> pageParam = new Page<>(page, pageSize);
        postMapper.selectPage(pageParam, wrapper);

        List<PostListVO> voList = pageParam.getRecords().stream()
                .map(this::convertPostToListVO)
                .collect(Collectors.toList());

        PageResult<PostListVO> pageResult = PageResult.of(voList, pageParam.getTotal(), page, pageSize);

        return Result.success(pageResult);
    }

    /**
     * 搜索用户
     */
    public Result<PageResult<UserVO>> searchUsers(String keyword, Integer page, Integer pageSize) {
        if (keyword == null || keyword.trim().isEmpty()) {
            return Result.error("搜索关键词不能为空");
        }

        QueryWrapper<User> wrapper = new QueryWrapper<>();
        wrapper.eq("deleted", 0)
                .and(w -> w.like("nickname", keyword).or().like("username", keyword))
                .orderByDesc("created_at");

        Page<User> pageParam = new Page<>(page, pageSize);
        userMapper.selectPage(pageParam, wrapper);

        List<UserVO> voList = pageParam.getRecords().stream()
                .map(this::convertUserToVO)
                .collect(Collectors.toList());

        PageResult<UserVO> pageResult = PageResult.of(voList, pageParam.getTotal(), page, pageSize);

        return Result.success(pageResult);
    }

    /**
     * 获取热门搜索
     */
    public Result<List<String>> getHotSearches() {
        // TODO: 实现热门搜索逻辑（可以基于Redis统计）
        List<String> hotSearches = List.of(
                "ChainlessChain",
                "区块链",
                "AI",
                "去中心化",
                "U盾"
        );

        return Result.success(hotSearches);
    }

    /**
     * 获取搜索建议
     */
    public Result<List<String>> getSearchSuggestions(String keyword) {
        if (keyword == null || keyword.trim().isEmpty()) {
            return Result.success(List.of());
        }

        // 搜索帖子标题（最多10条）
        QueryWrapper<Post> wrapper = new QueryWrapper<>();
        wrapper.select("DISTINCT title")
                .eq("deleted", 0)
                .eq("status", "PUBLISHED")
                .like("title", keyword)
                .last("LIMIT 10");

        List<Post> posts = postMapper.selectList(wrapper);
        List<String> suggestions = posts.stream()
                .map(Post::getTitle)
                .collect(Collectors.toList());

        return Result.success(suggestions);
    }

    /**
     * 内部方法：搜索帖子
     */
    private List<Post> searchPostsInternal(String keyword, Integer page, Integer pageSize) {
        QueryWrapper<Post> wrapper = new QueryWrapper<>();
        wrapper.eq("deleted", 0)
                .eq("status", "PUBLISHED")
                .and(w -> w.like("title", keyword).or().like("content", keyword))
                .orderByDesc("created_at")
                .last("LIMIT " + pageSize);

        return postMapper.selectList(wrapper);
    }

    /**
     * 内部方法：搜索用户
     */
    private List<User> searchUsersInternal(String keyword, Integer page, Integer pageSize) {
        QueryWrapper<User> wrapper = new QueryWrapper<>();
        wrapper.eq("deleted", 0)
                .and(w -> w.like("nickname", keyword).or().like("username", keyword))
                .orderByDesc("created_at")
                .last("LIMIT " + pageSize);

        return userMapper.selectList(wrapper);
    }

    /**
     * 转换Post为PostListVO
     */
    private PostListVO convertPostToListVO(Post post) {
        PostListVO vo = new PostListVO();
        BeanUtils.copyProperties(post, vo);
        return vo;
    }

    /**
     * 转换User为UserVO
     */
    private UserVO convertUserToVO(User user) {
        UserVO vo = new UserVO();
        BeanUtils.copyProperties(user, vo);
        return vo;
    }
}
