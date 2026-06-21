package com.chainlesschain.project.service;

import com.chainlesschain.project.dto.ConversationCreateRequest;
import com.chainlesschain.project.dto.ConversationDTO;
import com.chainlesschain.project.dto.MessageCreateRequest;
import com.chainlesschain.project.dto.MessageDTO;
import com.chainlesschain.project.entity.Conversation;
import com.chainlesschain.project.entity.ConversationMessage;
import com.chainlesschain.project.mapper.ConversationMapper;
import com.chainlesschain.project.mapper.ConversationMessageMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link ConversationService} 测试（先前零覆盖）。
 *
 * 覆盖对话/消息 CRUD 的分支与计数维护：contextMode/messageType 默认值、不存在抛错、
 * createMessage 递增 messageCount、deleteMessage 仅在 count>0 时递减（防负数）、
 * deleteConversation 级联删消息。纯 Mockito 单元（mapper 全 mock），不需 Spring/DB。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ConversationServiceTest {

    @Mock private ConversationMapper conversationMapper;
    @Mock private ConversationMessageMapper messageMapper;

    @InjectMocks private ConversationService service;

    // ----------------------------------------------------------------- //
    // createConversation
    // ----------------------------------------------------------------- //
    @Test
    void createConversation_defaultsContextModeGlobal_andZeroCount() {
        ConversationCreateRequest r = new ConversationCreateRequest();
        r.setTitle("chat");
        r.setUserId("u1");

        ConversationDTO dto = service.createConversation(r);

        ArgumentCaptor<Conversation> cap = ArgumentCaptor.forClass(Conversation.class);
        verify(conversationMapper).insert(cap.capture());
        assertEquals("global", cap.getValue().getContextMode());
        assertEquals(0, cap.getValue().getMessageCount());
        assertEquals("chat", dto.getTitle());
    }

    @Test
    void createConversation_keepsExplicitContextMode() {
        ConversationCreateRequest r = new ConversationCreateRequest();
        r.setTitle("t");
        r.setContextMode("project");
        service.createConversation(r);
        ArgumentCaptor<Conversation> cap = ArgumentCaptor.forClass(Conversation.class);
        verify(conversationMapper).insert(cap.capture());
        assertEquals("project", cap.getValue().getContextMode());
    }

    // ----------------------------------------------------------------- //
    // getConversation
    // ----------------------------------------------------------------- //
    @Test
    void getConversation_notFound_throws() {
        when(conversationMapper.selectById("x")).thenReturn(null);
        assertThrows(RuntimeException.class, () -> service.getConversation("x"));
    }

    @Test
    void getConversation_attachesLastMessageWhenPresent() {
        Conversation c = new Conversation();
        c.setTitle("t");
        when(conversationMapper.selectById("c1")).thenReturn(c);
        ConversationMessage last = new ConversationMessage();
        last.setContent("bye");
        last.setMessageType("text");
        when(messageMapper.selectLastMessage("c1")).thenReturn(last);

        ConversationDTO dto = service.getConversation("c1");
        assertNotNull(dto.getLastMessage());
        assertEquals("bye", dto.getLastMessage().getContent());
    }

    @Test
    void getConversation_noLastMessage_leavesNull() {
        when(conversationMapper.selectById("c2")).thenReturn(new Conversation());
        when(messageMapper.selectLastMessage("c2")).thenReturn(null);
        ConversationDTO dto = service.getConversation("c2");
        assertNull(dto.getLastMessage());
    }

    // ----------------------------------------------------------------- //
    // updateConversation / deleteConversation
    // ----------------------------------------------------------------- //
    @Test
    void updateConversation_notFound_throws() {
        when(conversationMapper.selectById("x")).thenReturn(null);
        assertThrows(RuntimeException.class, () -> service.updateConversation("x", "new"));
    }

    @Test
    void updateConversation_setsTitleAndUpdates() {
        Conversation c = new Conversation();
        c.setTitle("old");
        when(conversationMapper.selectById("c3")).thenReturn(c);
        ConversationDTO dto = service.updateConversation("c3", "new title");
        verify(conversationMapper).updateById(c);
        assertEquals("new title", dto.getTitle());
    }

    @Test
    void deleteConversation_alsoDeletesMessages() {
        service.deleteConversation("c4");
        verify(conversationMapper).deleteById("c4");
        verify(messageMapper).delete(any());  // 级联删该对话所有消息
    }

    // ----------------------------------------------------------------- //
    // createMessage — 递增 messageCount
    // ----------------------------------------------------------------- //
    @Test
    void createMessage_conversationMissing_throws_noInsert() {
        MessageCreateRequest r = new MessageCreateRequest();
        r.setConversationId("gone");
        when(conversationMapper.selectById("gone")).thenReturn(null);
        assertThrows(RuntimeException.class, () -> service.createMessage(r));
        verify(messageMapper, never()).insert(any(ConversationMessage.class));
    }

    @Test
    void createMessage_defaultsTypeText_andIncrementsCount() {
        Conversation c = new Conversation();
        c.setMessageCount(5);
        when(conversationMapper.selectById("c5")).thenReturn(c);

        MessageCreateRequest r = new MessageCreateRequest();
        r.setConversationId("c5");
        r.setRole("user");
        r.setContent("hi");           // type left null
        MessageDTO dto = service.createMessage(r);

        ArgumentCaptor<ConversationMessage> mc = ArgumentCaptor.forClass(ConversationMessage.class);
        verify(messageMapper).insert(mc.capture());
        assertEquals("text", mc.getValue().getMessageType());   // 默认 text
        assertEquals("text", dto.getType());

        ArgumentCaptor<Conversation> cc = ArgumentCaptor.forClass(Conversation.class);
        verify(conversationMapper).updateById(cc.capture());
        assertEquals(6, cc.getValue().getMessageCount());        // 5 -> 6
    }

    // ----------------------------------------------------------------- //
    // deleteMessage — 计数防负数守卫
    // ----------------------------------------------------------------- //
    @Test
    void deleteMessage_notFound_throws() {
        when(messageMapper.selectById("x")).thenReturn(null);
        assertThrows(RuntimeException.class, () -> service.deleteMessage("x"));
    }

    @Test
    void deleteMessage_decrementsCountWhenPositive() {
        ConversationMessage m = new ConversationMessage();
        m.setConversationId("c6");
        when(messageMapper.selectById("m1")).thenReturn(m);
        Conversation c = new Conversation();
        c.setMessageCount(3);
        when(conversationMapper.selectById("c6")).thenReturn(c);

        service.deleteMessage("m1");

        verify(messageMapper).deleteById("m1");
        ArgumentCaptor<Conversation> cap = ArgumentCaptor.forClass(Conversation.class);
        verify(conversationMapper).updateById(cap.capture());
        assertEquals(2, cap.getValue().getMessageCount());       // 3 -> 2
    }

    @Test
    void deleteMessage_countZero_doesNotGoNegative() {
        ConversationMessage m = new ConversationMessage();
        m.setConversationId("c7");
        when(messageMapper.selectById("m2")).thenReturn(m);
        Conversation c = new Conversation();
        c.setMessageCount(0);
        when(conversationMapper.selectById("c7")).thenReturn(c);

        service.deleteMessage("m2");

        verify(messageMapper).deleteById("m2");
        // count==0 → 守卫不触发更新，绝不递减成负数
        verify(conversationMapper, never()).updateById(any(Conversation.class));
        assertEquals(0, c.getMessageCount());
    }

    @Test
    void deleteMessage_missingConversation_skipsCountUpdate() {
        ConversationMessage m = new ConversationMessage();
        m.setConversationId("orphan");
        when(messageMapper.selectById("m3")).thenReturn(m);
        when(conversationMapper.selectById("orphan")).thenReturn(null);

        service.deleteMessage("m3");

        verify(messageMapper).deleteById("m3");
        verify(conversationMapper, never()).updateById(any(Conversation.class));
    }
}
