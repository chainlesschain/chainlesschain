package com.chainlesschain.community.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.MessageSendRequest;
import com.chainlesschain.community.entity.Message;
import com.chainlesschain.community.entity.User;
import com.chainlesschain.community.mapper.MessageMapper;
import com.chainlesschain.community.mapper.UserMapper;
import com.chainlesschain.community.util.SecurityUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 私信服务
 */
@Service
public class MessageService {

    @Autowired
    private MessageMapper messageMapper;

    @Autowired
    private UserMapper userMapper;

    /**
     * 获取与指定用户的会话消息
     */
    public Result<PageResult<Message>> getConversationMessages(Long userId, Integer page, Integer pageSize) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        // 验证对方用户是否存在
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeleted() == 1) {
            return Result.notFound();
        }

        Page<Message> pageParam = new Page<>(page, pageSize);
        messageMapper.selectConversationMessages(pageParam, currentUserId, userId);

        PageResult<Message> pageResult = PageResult.of(
                pageParam.getRecords(),
                pageParam.getTotal(),
                page,
                pageSize
        );

        return Result.success(pageResult);
    }

    /**
     * 发送私信
     */
    @Transactional
    public Result<Message> sendMessage(MessageSendRequest request) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        if (currentUserId.equals(request.getReceiverId())) {
            return Result.error("不能给自己发私信");
        }

        // 验证接收者是否存在
        User receiver = userMapper.selectById(request.getReceiverId());
        if (receiver == null || receiver.getDeleted() == 1) {
            return Result.error("接收者不存在");
        }

        // 创建消息
        Message message = new Message();
        message.setSenderId(currentUserId);
        message.setReceiverId(request.getReceiverId());
        message.setContent(request.getContent());
        message.setIsRead(0);

        messageMapper.insert(message);

        return Result.success(message);
    }

    /**
     * 获取未读消息数
     */
    public Result<Integer> getUnreadCount() {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        int count = messageMapper.countUnread(currentUserId);

        return Result.success(count);
    }

    /**
     * 标记会话为已读
     */
    @Transactional
    public Result<Void> markConversationAsRead(Long userId) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        messageMapper.markConversationAsRead(currentUserId, userId);

        return Result.success();
    }

    /**
     * 删除消息
     */
    @Transactional
    public Result<Void> deleteMessage(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Message message = messageMapper.selectById(id);

        if (message == null || message.getDeleted() == 1) {
            return Result.notFound();
        }

        // 只有发送者或接收者可以删除
        if (!message.getSenderId().equals(currentUserId) && !message.getReceiverId().equals(currentUserId)) {
            return Result.forbidden();
        }

        // 逻辑删除
        message.setDeleted(1);
        messageMapper.updateById(message);

        return Result.success();
    }
}
