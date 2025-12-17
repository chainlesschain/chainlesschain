package com.chainlesschain.community.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.ReplyCreateRequest;
import com.chainlesschain.community.entity.*;
import com.chainlesschain.community.mapper.*;
import com.chainlesschain.community.util.SecurityUtil;
import com.chainlesschain.community.vo.ReplyVO;
import com.chainlesschain.community.vo.UserVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 回复服务
 */
@Service
public class ReplyService {

    @Autowired
    private ReplyMapper replyMapper;

    @Autowired
    private PostMapper postMapper;

    @Autowired
    private UserMapper userMapper;

    @Autowired
    private LikeMapper likeMapper;

    @Autowired
    private NotificationMapper notificationMapper;

    /**
     * 分页查询帖子的回复列表
     */
    public Result<PageResult<ReplyVO>> getRepliesByPostId(Long postId, Integer page, Integer pageSize) {
        // 验证帖子是否存在
        Post post = postMapper.selectById(postId);
        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        Page<Reply> pageParam = new Page<>(page, pageSize);
        replyMapper.selectRepliesByPostId(pageParam, postId);

        List<ReplyVO> voList = pageParam.getRecords().stream().map(reply -> {
            ReplyVO vo = convertToVO(reply);
            // 查询子回复
            List<Reply> children = replyMapper.selectChildReplies(reply.getId());
            vo.setChildren(children.stream().map(this::convertToVO).collect(Collectors.toList()));
            return vo;
        }).collect(Collectors.toList());

        PageResult<ReplyVO> pageResult = PageResult.of(voList, pageParam.getTotal(), page, pageSize);

        return Result.success(pageResult);
    }

    /**
     * 创建回复
     */
    @Transactional
    public Result<ReplyVO> createReply(ReplyCreateRequest request) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        // 验证帖子是否存在
        Post post = postMapper.selectById(request.getPostId());
        if (post == null || post.getDeleted() == 1) {
            return Result.error("帖子不存在");
        }

        // 如果有父回复，验证父回复是否存在
        if (request.getParentId() != null) {
            Reply parentReply = replyMapper.selectById(request.getParentId());
            if (parentReply == null || parentReply.getDeleted() == 1) {
                return Result.error("父回复不存在");
            }
        }

        // 创建回复
        Reply reply = new Reply();
        reply.setPostId(request.getPostId());
        reply.setUserId(currentUserId);
        reply.setParentId(request.getParentId());
        reply.setReplyToUserId(request.getReplyToUserId());
        reply.setContent(request.getContent());
        reply.setIsAuthor(post.getUserId().equals(currentUserId) ? 1 : 0);

        replyMapper.insert(reply);

        // 更新帖子回复数和最后回复信息
        postMapper.incrementRepliesCount(request.getPostId(), 1);
        postMapper.updateLastReply(request.getPostId(), currentUserId);

        // 更新用户回复数
        userMapper.incrementRepliesCount(currentUserId, 1);

        // 创建通知（通知帖子作者）
        if (!post.getUserId().equals(currentUserId)) {
            createReplyNotification(post, reply, currentUserId);
        }

        return Result.success(convertToVO(reply));
    }

    /**
     * 删除回复
     */
    @Transactional
    public Result<Void> deleteReply(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Reply reply = replyMapper.selectById(id);

        if (reply == null || reply.getDeleted() == 1) {
            return Result.notFound();
        }

        // 检查权限
        if (!reply.getUserId().equals(currentUserId) && !SecurityUtil.isAdmin()) {
            return Result.forbidden();
        }

        // 逻辑删除
        reply.setDeleted(1);
        replyMapper.updateById(reply);

        // 更新帖子回复数
        postMapper.incrementRepliesCount(reply.getPostId(), -1);

        // 更新用户回复数
        userMapper.incrementRepliesCount(reply.getUserId(), -1);

        return Result.success();
    }

    /**
     * 点赞回复
     */
    @Transactional
    public Result<Void> likeReply(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Reply reply = replyMapper.selectById(id);
        if (reply == null || reply.getDeleted() == 1) {
            return Result.notFound();
        }

        // 检查是否已点赞
        if (likeMapper.checkUserLiked(currentUserId, "REPLY", id) > 0) {
            return Result.error("已经点赞过了");
        }

        // 添加点赞记录
        Like like = new Like();
        like.setUserId(currentUserId);
        like.setTargetType("REPLY");
        like.setTargetId(id);
        likeMapper.insert(like);

        // 更新回复点赞数
        replyMapper.incrementLikesCount(id, 1);

        return Result.success();
    }

    /**
     * 取消点赞
     */
    @Transactional
    public Result<Void> unlikeReply(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        // 删除点赞记录
        int deleted = likeMapper.unlike(currentUserId, "REPLY", id);

        if (deleted > 0) {
            // 更新回复点赞数
            replyMapper.incrementLikesCount(id, -1);
        }

        return Result.success();
    }

    /**
     * 设置最佳答案
     */
    @Transactional
    public Result<Void> setBestAnswer(Long postId, Long replyId) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        // 验证帖子
        Post post = postMapper.selectById(postId);
        if (post == null || post.getDeleted() == 1) {
            return Result.notFound();
        }

        // 只有帖子作者可以设置最佳答案
        if (!post.getUserId().equals(currentUserId)) {
            return Result.forbidden();
        }

        // 验证回复
        Reply reply = replyMapper.selectById(replyId);
        if (reply == null || reply.getDeleted() == 1 || !reply.getPostId().equals(postId)) {
            return Result.error("回复不存在");
        }

        // 取消之前的最佳答案
        replyMapper.unsetBestAnswer(postId);

        // 设置新的最佳答案
        replyMapper.setBestAnswer(replyId);

        // 更新帖子的最佳答案ID
        postMapper.setBestReply(postId, replyId);

        return Result.success();
    }

    /**
     * 创建回复通知
     */
    private void createReplyNotification(Post post, Reply reply, Long senderId) {
        Notification notification = new Notification();
        notification.setUserId(post.getUserId());
        notification.setSenderId(senderId);
        notification.setType("REPLY");
        notification.setTitle("收到新回复");
        notification.setContent("您的帖子《" + post.getTitle() + "》收到了新回复");
        notification.setLink("/posts/" + post.getId());
        notification.setIsRead(0);

        notificationMapper.insert(notification);
    }

    /**
     * 转换为ReplyVO
     */
    private ReplyVO convertToVO(Reply reply) {
        ReplyVO vo = new ReplyVO();
        BeanUtils.copyProperties(reply, vo);

        // 查询用户信息
        User user = userMapper.selectById(reply.getUserId());
        if (user != null) {
            UserVO userVO = new UserVO();
            BeanUtils.copyProperties(user, userVO);
            vo.setUser(userVO);
        }

        // 查询被回复者信息
        if (reply.getReplyToUserId() != null) {
            User replyToUser = userMapper.selectById(reply.getReplyToUserId());
            if (replyToUser != null) {
                UserVO replyToUserVO = new UserVO();
                BeanUtils.copyProperties(replyToUser, replyToUserVO);
                vo.setReplyToUser(replyToUserVO);
            }
        }

        // 查询当前用户是否点赞
        Long currentUserId = SecurityUtil.getCurrentUserId();
        if (currentUserId != null) {
            vo.setLiked(likeMapper.checkUserLiked(currentUserId, "REPLY", reply.getId()) > 0);
        }

        return vo;
    }
}
