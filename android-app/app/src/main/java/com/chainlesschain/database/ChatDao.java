package com.chainlesschain.database;

import androidx.lifecycle.LiveData;
import androidx.room.Dao;
import androidx.room.Delete;
import androidx.room.Insert;
import androidx.room.Query;

import com.chainlesschain.model.ChatMessage;

import java.util.List;

/**
 * Chat Message DAO
 * AI对话消息数据访问对象
 */
@Dao
public interface ChatDao {

    @Query("SELECT * FROM chat_messages ORDER BY timestamp ASC")
    LiveData<List<ChatMessage>> getAllMessages();

    @Query("SELECT * FROM chat_messages WHERE sessionId = :sessionId ORDER BY timestamp ASC")
    LiveData<List<ChatMessage>> getMessagesBySession(String sessionId);

    @Query("SELECT * FROM chat_messages WHERE sessionId = :sessionId ORDER BY timestamp ASC")
    List<ChatMessage> getMessagesBySessionSync(String sessionId);

    @Insert
    long insert(ChatMessage message);

    @Delete
    void delete(ChatMessage message);

    @Query("DELETE FROM chat_messages")
    void deleteAll();

    @Query("DELETE FROM chat_messages WHERE sessionId = :sessionId")
    void deleteSession(String sessionId);

    @Query("SELECT COUNT(*) FROM chat_messages")
    int getMessageCount();
}
