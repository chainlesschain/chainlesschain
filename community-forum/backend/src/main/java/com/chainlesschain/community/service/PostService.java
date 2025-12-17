package com.chainlesschain.community.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.PostCreateRequest;
import com.chainlesschain.community.dto.PostUpdateRequest;
import com.chainlesschain.community.entity.*;
import com.chainlesschain.community.mapper.*;
import com.chainlesschain.community.util.SecurityUtil;
import com.chainlesschain.community.vo.PostListVO;
import com.chainlesschain.community.vo.PostVO;
import com.chainlesschain.community.vo.TagVO;
import com.chainlesschain.community.vo.UserVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 帖子服务
 */
@Service
public class PostService {

    @Autowired
    private PostMapper postMapper;

    @Autowired
    private UserMapper userMapper;

    @Autowired
    private CategoryMapper categoryMapper;

    @Autowired
    private TagMapper tagMapper;

    @Autowired
    private PostTagMapper postTagMapper;

    @Autowired
    private LikeMapper likeMapper;

    @Autowired
    private FavoriteMapper favoriteMapper;

    /**
     * 分页查询帖子列表
     */
    public Result<PageResult<PostListVO>> getPosts(Integer page, Integer pageSize,
                                                    Long categoryId, String sortBy) {
        Page<Post> pageParam = new Page<>(page, pageSize);

        // 根据分类查询
        if (categoryId != null) {
            postMapper.selectPostsByCategoryId(pageParam, categoryId);
        } else {
            postMapper.selectPostsWithDetails(pageParam);
        }

        List<PostListVO> voList = pageParam.getRecords().stream().map(this::convertToListVO).collect(Collectors.toList());

        PageResult<PostListVO> pageResult = PageResult.of(voList, pageParam.getTotal(), page, pageSize);

        return Result.success(pageResult);
    }

    /**
     * 获取帖子详情
     */
    @Transactional
    public Result<PostVO> getPostById(Long id) {
        Post post = postMapper.selectById(id);

        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        // 增加浏览数
        postMapper.incrementViewsCount(id);

        // 转换为VO
        PostVO postVO = convertToVO(post);

        // 查询标签
        List<Tag> tags = tagMapper.findByPostId(id);
        postVO.setTags(tags.stream().map(this::convertTagToVO).collect(Collectors.toList()));

        // 查询当前用户是否点赞和收藏
        Long currentUserId = SecurityUtil.getCurrentUserId();
        if (currentUserId != null) {
            postVO.setLiked(likeMapper.checkUserLiked(currentUserId, "POST", id) > 0);
            postVO.setFavorited(favoriteMapper.checkUserFavorited(currentUserId, id) > 0);
        }

        return Result.success(postVO);
    }

    /**
     * 创建帖子
     */
    @Transactional
    public Result<PostVO> createPost(PostCreateRequest request) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        // 验证分类
        Category category = categoryMapper.selectById(request.getCategoryId());
        if (category == null) {
            return Result.error("分类不存在");
        }

        // 创建帖子
        Post post = new Post();
        post.setUserId(currentUserId);
        post.setTitle(request.getTitle());
        post.setContent(request.getContent());
        post.setCategoryId(request.getCategoryId());
        post.setType(request.getType() != null ? request.getType() : "DISCUSSION");
        post.setStatus("PUBLISHED");
        post.setPublishedAt(LocalDateTime.now());

        postMapper.insert(post);

        // 处理标签
        if (request.getTags() != null && !request.getTags().isEmpty()) {
            handlePostTags(post.getId(), request.getTags());
        }

        // 更新用户帖子数
        userMapper.incrementPostsCount(currentUserId, 1);

        // 更新分类帖子数
        categoryMapper.incrementPostsCount(request.getCategoryId(), 1);

        return Result.success(convertToVO(post));
    }

    /**
     * 更新帖子
     */
    @Transactional
    public Result<PostVO> updatePost(Long id, PostUpdateRequest request) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Post post = postMapper.selectById(id);

        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        // 检查权限
        if (!post.getUserId().equals(currentUserId) && !SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        // 更新字段
        if (request.getTitle() != null) {
            post.setTitle(request.getTitle());
        }
        if (request.getContent() != null) {
            post.setContent(request.getContent());
        }
        if (request.getCategoryId() != null) {
            post.setCategoryId(request.getCategoryId());
        }
        if (request.getType() != null) {
            post.setType(request.getType());
        }

        postMapper.updateById(post);

        // 更新标签
        if (request.getTags() != null) {
            postTagMapper.deleteByPostId(id);
            handlePostTags(id, request.getTags());
        }

        return Result.success(convertToVO(post));
    }

    /**
     * 删除帖子
     */
    @Transactional
    public Result<Void> deletePost(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Post post = postMapper.selectById(id);

        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        // 检查权限
        if (!post.getUserId().equals(currentUserId) && !SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        // 逻辑删除
        post.setDeleted(1);
        postMapper.updateById(post);

        // 更新用户帖子数
        userMapper.incrementPostsCount(post.getUserId(), -1);

        // 更新分类帖子数
        categoryMapper.incrementPostsCount(post.getCategoryId(), -1);

        return Result.success();
    }

    /**
     * 点赞帖子
     */
    @Transactional
    public Result<Void> likePost(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Post post = postMapper.selectById(id);
        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        // 检查是否已点赞
        if (likeMapper.checkUserLiked(currentUserId, "POST", id) > 0) {
            return Result.error("已经点赞过了");
        }

        // 添加点赞记录
        Like like = new Like();
        like.setUserId(currentUserId);
        like.setTargetType("POST");
        like.setTargetId(id);
        likeMapper.insert(like);

        // 更新帖子点赞数
        postMapper.incrementLikesCount(id, 1);

        return Result.success();
    }

    /**
     * 取消点赞
     */
    @Transactional
    public Result<Void> unlikePost(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        // 删除点赞记录
        int deleted = likeMapper.unlike(currentUserId, "POST", id);

        if (deleted > 0) {
            // 更新帖子点赞数
            postMapper.incrementLikesCount(id, -1);
        }

        return Result.success();
    }

    /**
     * 收藏帖子
     */
    @Transactional
    public Result<Void> favoritePost(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Post post = postMapper.selectById(id);
        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        // 检查是否已收藏
        if (favoriteMapper.checkUserFavorited(currentUserId, id) > 0) {
            return Result.error("已经收藏过了");
        }

        // 添加收藏记录
        Favorite favorite = new Favorite();
        favorite.setUserId(currentUserId);
        favorite.setPostId(id);
        favoriteMapper.insert(favorite);

        // 更新帖子收藏数
        postMapper.incrementFavoritesCount(id, 1);

        return Result.success();
    }

    /**
     * 取消收藏
     */
    @Transactional
    public Result<Void> unfavoritePost(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        // 删除收藏记录
        int deleted = favoriteMapper.unfavorite(currentUserId, id);

        if (deleted > 0) {
            // 更新帖子收藏数
            postMapper.incrementFavoritesCount(id, -1);
        }

        return Result.success();
    }

    /**
     * 处理帖子标签
     */
    private void handlePostTags(Long postId, List<String> tagNames) {
        for (String tagName : tagNames) {
            // 查找或创建标签
            Tag tag = tagMapper.findByName(tagName);
            if (tag == null) {
                tag = new Tag();
                tag.setName(tagName);
                tag.setSlug(tagName.toLowerCase().replace(" ", "-"));
                tagMapper.insert(tag);
            }

            // 创建关联
            PostTag postTag = new PostTag();
            postTag.setPostId(postId);
            postTag.setTagId(tag.getId());
            postTagMapper.insert(postTag);

            // 更新标签帖子数
            tagMapper.incrementPostsCount(tag.getId(), 1);
        }
    }

    /**
     * 转换为PostVO
     */
    private PostVO convertToVO(Post post) {
        PostVO vo = new PostVO();
        BeanUtils.copyProperties(post, vo);

        // 查询用户信息
        User user = userMapper.selectById(post.getUserId());
        if (user != null) {
            UserVO userVO = new UserVO();
            BeanUtils.copyProperties(user, userVO);
            vo.setUser(userVO);
        }

        // 查询分类信息
        Category category = categoryMapper.selectById(post.getCategoryId());
        if (category != null) {
            vo.setCategory(convertCategoryToVO(category));
        }

        return vo;
    }

    /**
     * 转换为PostListVO（精简版）
     */
    private PostListVO convertToListVO(Post post) {
        PostListVO vo = new PostListVO();
        BeanUtils.copyProperties(post, vo);

        // 查询并设置用户信息
        User user = userMapper.selectById(post.getUserId());
        if (user != null) {
            vo.setUserId(user.getId());
            vo.setUserNickname(user.getNickname());
            vo.setUserAvatar(user.getAvatar());
        }

        // 查询并设置分类信息
        Category category = categoryMapper.selectById(post.getCategoryId());
        if (category != null) {
            vo.setCategoryName(category.getName());
            vo.setCategorySlug(category.getSlug());
        }

        // 查询并设置标签信息
        List<Tag> tags = tagMapper.findByPostId(post.getId());
        if (tags != null && !tags.isEmpty()) {
            vo.setTagNames(tags.stream().map(Tag::getName).collect(Collectors.toList()));
        }

        return vo;
    }

    /**
     * 转换Category为VO
     */
    private com.chainlesschain.community.vo.CategoryVO convertCategoryToVO(Category category) {
        com.chainlesschain.community.vo.CategoryVO vo = new com.chainlesschain.community.vo.CategoryVO();
        BeanUtils.copyProperties(category, vo);
        return vo;
    }

    /**
     * 转换Tag为VO
     */
    private TagVO convertTagToVO(Tag tag) {
        TagVO vo = new TagVO();
        BeanUtils.copyProperties(tag, vo);
        return vo;
    }
}
