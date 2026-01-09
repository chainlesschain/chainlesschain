package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.Conversation;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 对话Mapper
 */
@Mapper
public interface ConversationMapper extends BaseMapper<Conversation> {

    /**
     * 根据用户ID查询对话列表
     */
    @Select("SELECT * FROM conversations WHERE user_id = #{userId} AND deleted = 0 ORDER BY updated_at DESC")
    List<Conversation> selectByUserId(@Param("userId") String userId);

    /**
     * 根据项目ID查询对话列表
     */
    @Select("SELECT * FROM conversations WHERE project_id = #{projectId} AND deleted = 0 ORDER BY updated_at DESC")
    List<Conversation> selectByProjectId(@Param("projectId") String projectId);

    /**
     * 更新消息数量
     */
    @Select("UPDATE conversations SET message_count = message_count + #{increment}, updated_at = NOW() WHERE id = #{conversationId}")
    int updateMessageCount(@Param("conversationId") String conversationId, @Param("increment") int increment);
}
