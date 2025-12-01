package com.chainlesschain.model;

import androidx.room.Entity;
import androidx.room.PrimaryKey;
import androidx.room.TypeConverters;

import com.chainlesschain.database.Converters;

import java.util.Date;
import java.util.List;

/**
 * Knowledge Item Entity
 * 知识库项目实体类
 */
@Entity(tableName = "knowledge_items")
@TypeConverters(Converters.class)
public class KnowledgeItem {
    @PrimaryKey(autoGenerate = true)
    private long id;

    private String title;
    private String content;
    private String type; // note, document, link, image
    private List<String> tags;
    private Date createdAt;
    private Date updatedAt;
    private String deviceId;
    private String encryptedContent;
    private String syncStatus; // synced, pending, conflict, local

    public KnowledgeItem() {
        this.createdAt = new Date();
        this.updatedAt = new Date();
        this.syncStatus = "local";
        this.type = "note";
    }

    // Getters and Setters
    public long getId() {
        return id;
    }

    public void setId(long id) {
        this.id = id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public Date getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Date createdAt) {
        this.createdAt = createdAt;
    }

    public Date getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Date updatedAt) {
        this.updatedAt = updatedAt;
    }

    public String getDeviceId() {
        return deviceId;
    }

    public void setDeviceId(String deviceId) {
        this.deviceId = deviceId;
    }

    public String getEncryptedContent() {
        return encryptedContent;
    }

    public void setEncryptedContent(String encryptedContent) {
        this.encryptedContent = encryptedContent;
    }

    public String getSyncStatus() {
        return syncStatus;
    }

    public void setSyncStatus(String syncStatus) {
        this.syncStatus = syncStatus;
    }

    public String getTypeIcon() {
        switch (type) {
            case "document":
                return "📄";
            case "link":
                return "🔗";
            case "image":
                return "🖼️";
            case "note":
            default:
                return "📝";
        }
    }

    public String getSyncIcon() {
        switch (syncStatus) {
            case "synced":
                return "✅";
            case "pending":
                return "⏳";
            case "conflict":
                return "⚠️";
            case "local":
            default:
                return "📱";
        }
    }
}
