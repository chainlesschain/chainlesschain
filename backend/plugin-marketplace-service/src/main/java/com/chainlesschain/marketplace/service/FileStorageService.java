package com.chainlesschain.marketplace.service;

import io.minio.*;
import io.minio.errors.*;
import io.minio.http.Method;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.TimeUnit;

/**
 * File Storage Service using MinIO
 * MinIO 文件存储服务
 *
 * @author ChainlessChain Team
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FileStorageService {

    private final MinioClient minioClient;

    @Value("${minio.bucket}")
    private String bucketName;

    /**
     * Initialize bucket if not exists
     */
    public void initBucket() {
        try {
            boolean exists = minioClient.bucketExists(
                    BucketExistsArgs.builder()
                            .bucket(bucketName)
                            .build()
            );

            if (!exists) {
                minioClient.makeBucket(
                        MakeBucketArgs.builder()
                                .bucket(bucketName)
                                .build()
                );
                log.info("Created bucket: {}", bucketName);
            }
        } catch (Exception e) {
            log.error("Failed to initialize bucket: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to initialize storage bucket", e);
        }
    }

    /**
     * Upload file to MinIO
     *
     * @param file     File to upload
     * @param objectName Object name in MinIO
     * @return File URL
     */
    public String uploadFile(MultipartFile file, String objectName) {
        try {
            // Ensure bucket exists
            initBucket();

            // Upload file
            minioClient.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucketName)
                            .object(objectName)
                            .stream(file.getInputStream(), file.getSize(), -1)
                            .contentType(file.getContentType())
                            .build()
            );

            log.info("Uploaded file: {} to bucket: {}", objectName, bucketName);

            // Return file URL
            return getFileUrl(objectName);

        } catch (Exception e) {
            log.error("Failed to upload file: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to upload file", e);
        }
    }

    /**
     * Upload file with input stream
     *
     * @param inputStream Input stream
     * @param objectName  Object name
     * @param contentType Content type
     * @param size        File size
     * @return File URL
     */
    public String uploadFile(InputStream inputStream, String objectName, String contentType, long size) {
        try {
            initBucket();

            minioClient.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucketName)
                            .object(objectName)
                            .stream(inputStream, size, -1)
                            .contentType(contentType)
                            .build()
            );

            log.info("Uploaded file: {} to bucket: {}", objectName, bucketName);
            return getFileUrl(objectName);

        } catch (Exception e) {
            log.error("Failed to upload file: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to upload file", e);
        }
    }

    /**
     * Download file from MinIO
     *
     * @param objectName Object name
     * @return Input stream
     */
    public InputStream downloadFile(String objectName) {
        try {
            return minioClient.getObject(
                    GetObjectArgs.builder()
                            .bucket(bucketName)
                            .object(objectName)
                            .build()
            );
        } catch (Exception e) {
            log.error("Failed to download file: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to download file", e);
        }
    }

    /**
     * Delete file from MinIO
     *
     * @param objectName Object name
     */
    public void deleteFile(String objectName) {
        try {
            minioClient.removeObject(
                    RemoveObjectArgs.builder()
                            .bucket(bucketName)
                            .object(objectName)
                            .build()
            );
            log.info("Deleted file: {} from bucket: {}", objectName, bucketName);
        } catch (Exception e) {
            log.error("Failed to delete file: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to delete file", e);
        }
    }

    /**
     * Check if file exists
     *
     * @param objectName Object name
     * @return True if exists
     */
    public boolean fileExists(String objectName) {
        try {
            minioClient.statObject(
                    StatObjectArgs.builder()
                            .bucket(bucketName)
                            .object(objectName)
                            .build()
            );
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Get file URL
     *
     * @param objectName Object name
     * @return File URL
     */
    public String getFileUrl(String objectName) {
        return String.format("%s/%s/%s",
                minioClient.getBaseUrl(), bucketName, objectName);
    }

    /**
     * Get presigned download URL (valid for 7 days)
     *
     * @param objectName Object name
     * @return Presigned URL
     */
    public String getPresignedDownloadUrl(String objectName) {
        try {
            return minioClient.getPresignedObjectUrl(
                    GetPresignedObjectUrlArgs.builder()
                            .method(Method.GET)
                            .bucket(bucketName)
                            .object(objectName)
                            .expiry(7, TimeUnit.DAYS)
                            .build()
            );
        } catch (Exception e) {
            log.error("Failed to generate presigned URL: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to generate download URL", e);
        }
    }

    /**
     * Get presigned upload URL (valid for 1 hour)
     *
     * @param objectName Object name
     * @return Presigned URL
     */
    public String getPresignedUploadUrl(String objectName) {
        try {
            return minioClient.getPresignedObjectUrl(
                    GetPresignedObjectUrlArgs.builder()
                            .method(Method.PUT)
                            .bucket(bucketName)
                            .object(objectName)
                            .expiry(1, TimeUnit.HOURS)
                            .build()
            );
        } catch (Exception e) {
            log.error("Failed to generate presigned upload URL: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to generate upload URL", e);
        }
    }

    /**
     * Calculate file hash (SHA-256)
     *
     * @param file File
     * @return Hash string
     */
    public String calculateFileHash(MultipartFile file) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(file.getBytes());
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (Exception e) {
            log.error("Failed to calculate file hash: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to calculate file hash", e);
        }
    }

    /**
     * Get file size
     *
     * @param objectName Object name
     * @return File size in bytes
     */
    public long getFileSize(String objectName) {
        try {
            StatObjectResponse stat = minioClient.statObject(
                    StatObjectArgs.builder()
                            .bucket(bucketName)
                            .object(objectName)
                            .build()
            );
            return stat.size();
        } catch (Exception e) {
            log.error("Failed to get file size: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to get file size", e);
        }
    }

    /**
     * Copy file
     *
     * @param sourceObjectName Source object name
     * @param destObjectName   Destination object name
     */
    public void copyFile(String sourceObjectName, String destObjectName) {
        try {
            minioClient.copyObject(
                    CopyObjectArgs.builder()
                            .bucket(bucketName)
                            .object(destObjectName)
                            .source(
                                    CopySource.builder()
                                            .bucket(bucketName)
                                            .object(sourceObjectName)
                                            .build()
                            )
                            .build()
            );
            log.info("Copied file from {} to {}", sourceObjectName, destObjectName);
        } catch (Exception e) {
            log.error("Failed to copy file: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to copy file", e);
        }
    }
}
