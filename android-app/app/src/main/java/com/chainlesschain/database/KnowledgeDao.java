package com.chainlesschain.database;

import androidx.lifecycle.LiveData;
import androidx.room.Dao;
import androidx.room.Delete;
import androidx.room.Insert;
import androidx.room.Query;
import androidx.room.Update;

import com.chainlesschain.model.KnowledgeItem;

import java.util.List;

/**
 * Knowledge Item DAO
 * 知识库数据访问对象
 */
@Dao
public interface KnowledgeDao {

    @Query("SELECT * FROM knowledge_items ORDER BY updatedAt DESC")
    LiveData<List<KnowledgeItem>> getAllItems();

    @Query("SELECT * FROM knowledge_items ORDER BY updatedAt DESC")
    List<KnowledgeItem> getAllItemsSync();

    @Query("SELECT * FROM knowledge_items WHERE id = :id")
    LiveData<KnowledgeItem> getItemById(long id);

    @Query("SELECT * FROM knowledge_items WHERE id = :id")
    KnowledgeItem getItemByIdSync(long id);

    @Query("SELECT * FROM knowledge_items WHERE " +
           "title LIKE '%' || :query || '%' OR " +
           "content LIKE '%' || :query || '%' " +
           "ORDER BY updatedAt DESC")
    LiveData<List<KnowledgeItem>> searchItems(String query);

    @Query("SELECT * FROM knowledge_items WHERE syncStatus = :status")
    List<KnowledgeItem> getItemsByStatus(String status);

    @Query("SELECT COUNT(*) FROM knowledge_items WHERE syncStatus = 'pending'")
    LiveData<Integer> getPendingCount();

    @Insert
    long insert(KnowledgeItem item);

    @Update
    void update(KnowledgeItem item);

    @Delete
    void delete(KnowledgeItem item);

    @Query("DELETE FROM knowledge_items")
    void deleteAll();

    @Query("UPDATE knowledge_items SET syncStatus = :status WHERE id = :id")
    void updateSyncStatus(long id, String status);
}
