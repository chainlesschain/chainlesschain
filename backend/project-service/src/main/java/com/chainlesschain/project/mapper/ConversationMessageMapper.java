package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.ConversationMessage;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 对话消息Mapper
 */
@Mapper
public interface ConversationMessageMapper extends BaseMapper<ConversationMessage> {

    /**
     * 根据对话ID查询消息列表
     */
    @Select("SELECT * FROM conversation_messages WHERE conversation_id = #{conversationId} AND deleted = 0 ORDER BY created_at ASC")
    List<ConversationMessage> selectByConversationId(@Param("conversationId") String conversationId);

    /**
     * 查询对话的最后一条消息
     */
    @Select("SELECT * FROM conversation_messages WHERE conversation_id = #{conversationId} AND deleted = 0 ORDER BY created_at DESC LIMIT 1")
    ConversationMessage selectLastMessage(@Param("conversationId") String conversationId);

    /**
     * 统计对话的消息数量
     */
    @Select("SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = #{conversationId} AND deleted = 0")
    int countByConversationId(@Param("conversationId") String conversationId);
}
