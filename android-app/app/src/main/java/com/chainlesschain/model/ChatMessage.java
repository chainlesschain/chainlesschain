package com.chainlesschain.model;

import androidx.room.Entity;
import androidx.room.PrimaryKey;
import androidx.room.TypeConverters;

import com.chainlesschain.database.Converters;

import java.util.Date;

/**
 * Chat Message Entity
 * AI对话消息实体类
 */
@Entity(tableName = "chat_messages")
@TypeConverters(Converters.class)
public class ChatMessage {
    @PrimaryKey(autoGenerate = true)
    private long id;

    private String role; // user, assistant, system
    private String content;
    private Date timestamp;
    private Integer tokens;
    private String sessionId;

    public ChatMessage() {
        this.timestamp = new Date();
    }

    public ChatMessage(String role, String content) {
        this.role = role;
        this.content = content;
        this.timestamp = new Date();
    }

    // Getters and Setters
    public long getId() {
        return id;
    }

    public void setId(long id) {
        this.id = id;
    }

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public Date getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(Date timestamp) {
        this.timestamp = timestamp;
    }

    public Integer getTokens() {
        return tokens;
    }

    public void setTokens(Integer tokens) {
        this.tokens = tokens;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public boolean isUser() {
        return "user".equals(role);
    }

    public boolean isAssistant() {
        return "assistant".equals(role);
    }

    public boolean isSystem() {
        return "system".equals(role);
    }
}
