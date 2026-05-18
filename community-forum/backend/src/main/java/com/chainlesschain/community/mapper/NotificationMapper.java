package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.entity.Notification;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 通知Mapper接口
 */
@Mapper
public interface NotificationMapper extends BaseMapper<Notification> {

    /**
     * 分页查询用户通知（关联发送者信息）
     */
    @Select("SELECT n.*, u.nickname AS sender_nickname, u.avatar AS sender_avatar " +
            "FROM notifications n " +
            "LEFT JOIN users u ON n.sender_id = u.id " +
            "WHERE n.user_id = #{userId} " +
            "ORDER BY n.created_at DESC")
    IPage<Notification> selectUserNotifications(Page<Notification> page, @Param("userId") Long userId);

    /**
     * 查询未读通知数
     */
    @Select("SELECT COUNT(*) FROM notifications WHERE user_id = #{userId} AND is_read = 0")
    int countUnread(@Param("userId") Long userId);

    /**
     * 标记全部为已读
     */
    @Update("UPDATE notifications SET is_read = 1 WHERE user_id = #{userId} AND is_read = 0")
    int markAllAsRead(@Param("userId") Long userId);

    /**
     * 删除已读通知
     */
    @Update("UPDATE notifications SET deleted = 1 WHERE user_id = #{userId} AND is_read = 1")
    int deleteReadNotifications(@Param("userId") Long userId);
}
