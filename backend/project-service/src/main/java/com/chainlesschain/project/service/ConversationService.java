package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.*;
import com.chainlesschain.project.entity.Conversation;
import com.chainlesschain.project.entity.ConversationMessage;
import com.chainlesschain.project.mapper.ConversationMapper;
import com.chainlesschain.project.mapper.ConversationMessageMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 对话服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ConversationService {

    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper messageMapper;

    /**
     * 创建对话
     */
    @Transactional
    public ConversationDTO createConversation(ConversationCreateRequest request) {
        log.info("[ConversationService] 创建对话: title={}, userId={}", request.getTitle(), request.getUserId());

        Conversation conversation = new Conversation();
        conversation.setTitle(request.getTitle());
        conversation.setProjectId(request.getProjectId());
        conversation.setUserId(request.getUserId());
        conversation.setContextMode(request.getContextMode() != null ? request.getContextMode() : "global");
        conversation.setContextData(request.getContextData());
        conversation.setMessageCount(0);
        conversation.setCreatedAt(LocalDateTime.now());
        conversation.setUpdatedAt(LocalDateTime.now());

        conversationMapper.insert(conversation);

        return convertToDTO(conversation);
    }

    /**
     * 获取对话详情
     */
    public ConversationDTO getConversation(String conversationId) {
        log.info("[ConversationService] 获取对话详情: conversationId={}", conversationId);

        Conversation conversation = conversationMapper.selectById(conversationId);
        if (conversation == null) {
            throw new RuntimeException("对话不存在");
        }

        ConversationDTO dto = convertToDTO(conversation);

        // 获取最后一条消息
        ConversationMessage lastMessage = messageMapper.selectLastMessage(conversationId);
        if (lastMessage != null) {
            dto.setLastMessage(convertMessageToDTO(lastMessage));
        }

        return dto;
    }

    /**
     * 获取用户的对话列表
     */
    public Page<ConversationDTO> listConversations(String userId, String projectId, int pageNum, int pageSize) {
        log.info("[ConversationService] 获取对话列表: userId={}, projectId={}, page={}/{}",
                 userId, projectId, pageNum, pageSize);

        Page<Conversation> page = new Page<>(pageNum, pageSize);
        QueryWrapper<Conversation> wrapper = new QueryWrapper<>();

        if (userId != null) {
            wrapper.eq("user_id", userId);
        }
        if (projectId != null) {
            wrapper.eq("project_id", projectId);
        }

        wrapper.orderByDesc("updated_at");

        Page<Conversation> conversationPage = conversationMapper.selectPage(page, wrapper);

        Page<ConversationDTO> dtoPage = new Page<>(pageNum, pageSize);
        dtoPage.setTotal(conversationPage.getTotal());
        dtoPage.setRecords(
            conversationPage.getRecords().stream()
                .map(this::convertToDTO)
                .collect(Collectors.toList())
        );

        return dtoPage;
    }

    /**
     * 更新对话
     */
    @Transactional
    public ConversationDTO updateConversation(String conversationId, String title) {
        log.info("[ConversationService] 更新对话: conversationId={}, title={}", conversationId, title);

        Conversation conversation = conversationMapper.selectById(conversationId);
        if (conversation == null) {
            throw new RuntimeException("对话不存在");
        }

        conversation.setTitle(title);
        conversation.setUpdatedAt(LocalDateTime.now());
        conversationMapper.updateById(conversation);

        return convertToDTO(conversation);
    }

    /**
     * 删除对话
     */
    @Transactional
    public void deleteConversation(String conversationId) {
        log.info("[ConversationService] 删除对话: conversationId={}", conversationId);

        // 逻辑删除对话
        conversationMapper.deleteById(conversationId);

        // 逻辑删除所有消息
        QueryWrapper<ConversationMessage> wrapper = new QueryWrapper<>();
        wrapper.eq("conversation_id", conversationId);
        messageMapper.delete(wrapper);
    }

    /**
     * 创建消息
     */
    @Transactional
    public MessageDTO createMessage(MessageCreateRequest request) {
        log.info("[ConversationService] 创建消息: conversationId={}, role={}",
                 request.getConversationId(), request.getRole());

        // 验证对话是否存在
        Conversation conversation = conversationMapper.selectById(request.getConversationId());
        if (conversation == null) {
            throw new RuntimeException("对话不存在");
        }

        // 创建消息
        ConversationMessage message = new ConversationMessage();
        message.setConversationId(request.getConversationId());
        message.setRole(request.getRole());
        message.setContent(request.getContent());
        message.setMessageType(request.getType() != null ? request.getType() : "text");
        message.setMetadata(request.getMetadata());
        message.setCreatedAt(LocalDateTime.now());

        messageMapper.insert(message);

        // 更新对话的消息数量和更新时间
        conversation.setMessageCount(conversation.getMessageCount() + 1);
        conversation.setUpdatedAt(LocalDateTime.now());
        conversationMapper.updateById(conversation);

        return convertMessageToDTO(message);
    }

    /**
     * 获取对话的消息列表
     */
    public List<MessageDTO> listMessages(String conversationId, Integer limit, Integer offset) {
        log.info("[ConversationService] 获取消息列表: conversationId={}, limit={}, offset={}",
                 conversationId, limit, offset);

        QueryWrapper<ConversationMessage> wrapper = new QueryWrapper<>();
        wrapper.eq("conversation_id", conversationId);
        wrapper.orderByAsc("created_at");

        if (limit != null && limit > 0) {
            wrapper.last("LIMIT " + limit + (offset != null ? " OFFSET " + offset : ""));
        }

        List<ConversationMessage> messages = messageMapper.selectList(wrapper);
        return messages.stream()
            .map(this::convertMessageToDTO)
            .collect(Collectors.toList());
    }

    /**
     * 删除消息
     */
    @Transactional
    public void deleteMessage(String messageId) {
        log.info("[ConversationService] 删除消息: messageId={}", messageId);

        ConversationMessage message = messageMapper.selectById(messageId);
        if (message == null) {
            throw new RuntimeException("消息不存在");
        }

        // 逻辑删除消息
        messageMapper.deleteById(messageId);

        // 更新对话的消息数量
        Conversation conversation = conversationMapper.selectById(message.getConversationId());
        if (conversation != null && conversation.getMessageCount() > 0) {
            conversation.setMessageCount(conversation.getMessageCount() - 1);
            conversation.setUpdatedAt(LocalDateTime.now());
            conversationMapper.updateById(conversation);
        }
    }

    /**
     * 转换为DTO
     */
    private ConversationDTO convertToDTO(Conversation conversation) {
        ConversationDTO dto = new ConversationDTO();
        BeanUtils.copyProperties(conversation, dto);
        return dto;
    }

    /**
     * 转换消息为DTO
     */
    private MessageDTO convertMessageToDTO(ConversationMessage message) {
        MessageDTO dto = new MessageDTO();
        BeanUtils.copyProperties(message, dto);
        dto.setType(message.getMessageType());
        return dto;
    }
}
