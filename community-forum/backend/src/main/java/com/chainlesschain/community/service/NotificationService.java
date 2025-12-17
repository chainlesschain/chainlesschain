package com.chainlesschain.community.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.entity.Notification;
import com.chainlesschain.community.entity.User;
import com.chainlesschain.community.mapper.NotificationMapper;
import com.chainlesschain.community.mapper.UserMapper;
import com.chainlesschain.community.util.SecurityUtil;
import com.chainlesschain.community.vo.NotificationVO;
import com.chainlesschain.community.vo.UserVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 通知服务
 */
@Service
public class NotificationService {

    @Autowired
    private NotificationMapper notificationMapper;

    @Autowired
    private UserMapper userMapper;

    /**
     * 分页查询通知列表
     */
    public Result<PageResult<NotificationVO>> getNotifications(Integer page, Integer pageSize) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Page<Notification> pageParam = new Page<>(page, pageSize);
        notificationMapper.selectUserNotifications(pageParam, currentUserId);

        List<NotificationVO> voList = pageParam.getRecords().stream()
                .map(this::convertToVO)
                .collect(Collectors.toList());

        PageResult<NotificationVO> pageResult = PageResult.of(voList, pageParam.getTotal(), page, pageSize);

        return Result.success(pageResult);
    }

    /**
     * 获取未读通知数
     */
    public Result<Integer> getUnreadCount() {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        int count = notificationMapper.countUnread(currentUserId);

        return Result.success(count);
    }

    /**
     * 标记通知为已读
     */
    @Transactional
    public Result<Void> markAsRead(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Notification notification = notificationMapper.selectById(id);

        if (notification == null) {
            return Result.notFound();
        }

        if (!notification.getUserId().equals(currentUserId)) {
            return Result.forbidden();
        }

        notification.setIsRead(1);
        notificationMapper.updateById(notification);

        return Result.success();
    }

    /**
     * 标记全部为已读
     */
    @Transactional
    public Result<Void> markAllAsRead() {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        notificationMapper.markAllAsRead(currentUserId);

        return Result.success();
    }

    /**
     * 删除通知
     */
    @Transactional
    public Result<Void> deleteNotification(Long id) {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        Notification notification = notificationMapper.selectById(id);

        if (notification == null) {
            return Result.notFound();
        }

        if (!notification.getUserId().equals(currentUserId)) {
            return Result.forbidden();
        }

        notificationMapper.deleteById(id);

        return Result.success();
    }

    /**
     * 清空已读通知
     */
    @Transactional
    public Result<Void> clearReadNotifications() {
        Long currentUserId = SecurityUtil.getCurrentUserId();

        if (currentUserId == null) {
            return Result.unauthorized();
        }

        notificationMapper.deleteReadNotifications(currentUserId);

        return Result.success();
    }

    /**
     * 转换为NotificationVO
     */
    private NotificationVO convertToVO(Notification notification) {
        NotificationVO vo = new NotificationVO();
        BeanUtils.copyProperties(notification, vo);

        // 查询发送者信息
        if (notification.getSenderId() != null) {
            User sender = userMapper.selectById(notification.getSenderId());
            if (sender != null) {
                UserVO senderVO = new UserVO();
                BeanUtils.copyProperties(sender, senderVO);
                vo.setSender(senderVO);
            }
        }

        return vo;
    }
}
