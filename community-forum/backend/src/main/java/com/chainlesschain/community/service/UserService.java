package com.chainlesschain.community.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.UserUpdateRequest;
import com.chainlesschain.community.entity.Favorite;
import com.chainlesschain.community.entity.Follow;
import com.chainlesschain.community.entity.Post;
import com.chainlesschain.community.entity.Reply;
import com.chainlesschain.community.entity.User;
import com.chainlesschain.community.mapper.*;
import com.chainlesschain.community.util.SecurityUtil;
import com.chainlesschain.community.vo.PostListVO;
import com.chainlesschain.community.vo.UserVO;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 用户服务
 */
@Service
public class UserService {

    @Autowired
    private UserMapper userMapper;

    @Autowired
    private PostMapper postMapper;

    @Autowired
    private ReplyMapper replyMapper;

    @Autowired
    private FollowMapper followMapper;

    @Autowired
    private FavoriteMapper favoriteMapper;

    @Autowired
    private NotificationMapper notificationMapper;

    /**
     * 获取用户信息
     */
    public Result<UserVO> getUserById(Long id) {
        User user = userMapper.selectById(id);

        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        UserVO userVO = convertToVO(user);

        // 查询当前用户是否关注此用户
        Long currentUserId = SecurityUtil.getCurrentUserId();
        if (currentUserId != null && !currentUserId.equals(id)) {
            userVO.setIsFollowing(followMapper.checkFollowing(currentUserId, id) > 0);
        }

        return Result.success(userVO);
    }

    /**
     * 更新用户信息
     */
    @Transactional
    public Result<UserVO> updateUserProfile(UserUpdateRequest request) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        User user = userMapper.selectById(currentUserId);

        if (user == null) {
            return Result.error("用户不存在");
        }

        // 更新字段
        if (request.getNickname() != null) {
            user.setNickname(request.getNickname());
        }
        if (request.getAvatar() != null) {
            user.setAvatar(request.getAvatar());
        }
        if (request.getBio() != null) {
            user.setBio(request.getBio());
        }

        userMapper.updateById(user);

        return Result.success(convertToVO(user));
    }

    /**
     * 获取用户的帖子列表
     */
    public Result<PageResult<PostListVO>> getUserPosts(Long userId, Integer page, Integer pageSize) {
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        Page<Post> pageParam = new Page<>(page, pageSize);
        postMapper.selectPostsByUserId(pageParam, userId);

        List<PostListVO> voList = pageParam.getRecords().stream()
                .map(this::convertPostToListVO)
                .collect(Collectors.toList());

        PageResult<PostListVO> pageResult = PageResult.of(voList, pageParam.getTotal(), page, pageSize);

        return Result.success(pageResult);
    }

    /**
     * 获取用户的回复列表
     */
    public Result<PageResult<Reply>> getUserReplies(Long userId, Integer page, Integer pageSize) {
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        Page<Reply> pageParam = new Page<>(page, pageSize);
        replyMapper.selectRepliesByUserId(pageParam, userId);

        PageResult<Reply> pageResult = PageResult.of(
                pageParam.getRecords(),
                pageParam.getTotal(),
                page,
                pageSize
        );

        return Result.success(pageResult);
    }

    /**
     * 关注用户
     */
    @Transactional
    public Result<Void> followUser(Long userId) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        if (currentUserId.equals(userId)) {
            return Result.error("不能关注自己");
        }

        User user = userMapper.selectById(userId);
        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        // 检查是否已关注
        if (followMapper.checkFollowing(currentUserId, userId) > 0) {
            return Result.error("已经关注过了");
        }

        // 创建关注记录
        Follow follow = new Follow();
        follow.setFollowerId(currentUserId);
        follow.setFollowingId(userId);
        followMapper.insert(follow);

        // 更新关注数和粉丝数
        userMapper.incrementFollowingCount(currentUserId, 1);
        userMapper.incrementFollowersCount(userId, 1);

        // 创建通知
        createFollowNotification(userId, currentUserId);

        return Result.success();
    }

    /**
     * 取消关注
     */
    @Transactional
    public Result<Void> unfollowUser(Long userId) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        // 删除关注记录
        int deleted = followMapper.unfollow(currentUserId, userId);

        if (deleted > 0) {
            // 更新关注数和粉丝数
            userMapper.incrementFollowingCount(currentUserId, -1);
            userMapper.incrementFollowersCount(userId, -1);
        }

        return Result.success();
    }

    /**
     * 获取关注列表
     */
    public Result<PageResult<UserVO>> getFollowing(Long userId, Integer page, Integer pageSize) {
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        Page<User> pageParam = new Page<>(page, pageSize);
        followMapper.selectFollowing(pageParam, userId);

        List<UserVO> voList = pageParam.getRecords().stream()
                .map(this::convertToVO)
                .collect(Collectors.toList());

        PageResult<UserVO> pageResult = PageResult.of(voList, pageParam.getTotal(), page, pageSize);

        return Result.success(pageResult);
    }

    /**
     * 获取粉丝列表
     */
    public Result<PageResult<UserVO>> getFollowers(Long userId, Integer page, Integer pageSize) {
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        Page<User> pageParam = new Page<>(page, pageSize);
        followMapper.selectFollowers(pageParam, userId);

        List<UserVO> voList = pageParam.getRecords().stream()
                .map(this::convertToVO)
                .collect(Collectors.toList());

        PageResult<UserVO> pageResult = PageResult.of(voList, pageParam.getTotal(), page, pageSize);

        return Result.success(pageResult);
    }

    /**
     * 获取收藏列表
     */
    public Result<PageResult<Favorite>> getFavorites(Integer page, Integer pageSize) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Page<Favorite> pageParam = new Page<>(page, pageSize);
        favoriteMapper.selectUserFavorites(pageParam, currentUserId);

        PageResult<Favorite> pageResult = PageResult.of(
                pageParam.getRecords(),
                pageParam.getTotal(),
                page,
                pageSize
        );

        return Result.success(pageResult);
    }

    /**
     * 搜索用户
     */
    public Result<List<UserVO>> searchUsers(String keyword) {
        if (keyword == null || keyword.trim().isEmpty()) {
            return Result.success(List.of());
        }

        QueryWrapper<User> wrapper = new QueryWrapper<>();
        wrapper.eq("deleted", 0)
                .and(w -> w.like("nickname", keyword).or().like("username", keyword))
                .orderByDesc("created_at")
                .last("LIMIT 20");

        List<User> users = userMapper.selectList(wrapper);
        List<UserVO> voList = users.stream()
                .map(this::convertToVO)
                .collect(Collectors.toList());

        return Result.success(voList);
    }

    /**
     * 创建关注通知
     */
    private void createFollowNotification(Long userId, Long followerId) {
        User follower = userMapper.selectById(followerId);

        com.chainlesschain.community.entity.Notification notification = new com.chainlesschain.community.entity.Notification();
        notification.setUserId(userId);
        notification.setSenderId(followerId);
        notification.setType("FOLLOW");
        notification.setTitle("新增粉丝");
        notification.setContent(follower.getNickname() + " 关注了你");
        notification.setLink("/users/" + followerId);
        notification.setIsRead(0);

        notificationMapper.insert(notification);
    }

    /**
     * 转换为UserVO
     */
    private UserVO convertToVO(User user) {
        UserVO vo = new UserVO();
        BeanUtils.copyProperties(user, vo);
        return vo;
    }

    /**
     * 转换Post为PostListVO
     */
    private PostListVO convertPostToListVO(Post post) {
        PostListVO vo = new PostListVO();
        BeanUtils.copyProperties(post, vo);
        return vo;
    }
}
