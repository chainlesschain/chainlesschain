package com.chainlesschain.project.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 文件上传响应DTO
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class FileUploadResponse {

    /**
     * 文件ID
     */
    private String fileId;

    /**
     * 文件名
     */
    private String fileName;

    /**
     * 文件大小（字节）
     */
    private Long fileSize;

    /**
     * 文件类型
     */
    private String fileType;

    /**
     * 文件URL
     */
    private String fileUrl;

    /**
     * 缩略图URL（如果是图片）
     */
    private String thumbnailUrl;

    /**
     * 上传时间
     */
    private String uploadTime;

    /**
     * 上传状态
     */
    private String status;

    /**
     * 错误信息（如果有）
     */
    private String error;
}
