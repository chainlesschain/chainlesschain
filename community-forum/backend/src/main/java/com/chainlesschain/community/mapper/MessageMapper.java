package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.community.entity.Message;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 私信Mapper接口
 */
@Mapper
public interface MessageMapper extends BaseMapper<Message> {

    /**
     * 查询会话消息列表
     */
    @Select("SELECT m.*, " +
            "s.nickname AS sender_nickname, s.avatar AS sender_avatar, " +
            "r.nickname AS receiver_nickname, r.avatar AS receiver_avatar " +
            "FROM messages m " +
            "LEFT JOIN users s ON m.sender_id = s.id " +
            "LEFT JOIN users r ON m.receiver_id = r.id " +
            "WHERE m.deleted = 0 " +
            "AND ((m.sender_id = #{userId1} AND m.receiver_id = #{userId2}) " +
            "OR (m.sender_id = #{userId2} AND m.receiver_id = #{userId1})) " +
            "ORDER BY m.created_at ASC")
    IPage<Message> selectConversationMessages(Page<Message> page,
                                              @Param("userId1") Long userId1,
                                              @Param("userId2") Long userId2);

    /**
     * 查询未读消息数
     */
    @Select("SELECT COUNT(*) FROM messages WHERE receiver_id = #{userId} AND is_read = 0 AND deleted = 0")
    int countUnread(@Param("userId") Long userId);

    /**
     * 标记会话消息为已读
     */
    @Update("UPDATE messages SET is_read = 1 " +
            "WHERE receiver_id = #{receiverId} AND sender_id = #{senderId} AND is_read = 0")
    int markConversationAsRead(@Param("receiverId") Long receiverId, @Param("senderId") Long senderId);
}
