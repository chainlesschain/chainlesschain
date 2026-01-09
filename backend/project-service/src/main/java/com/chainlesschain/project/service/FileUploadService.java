package com.chainlesschain.project.service;

import com.chainlesschain.project.dto.FileUploadResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * 文件上传服务
 * 处理文件上传、存储和管理
 */
@Service
public class FileUploadService {

    @Value("${file.upload.path:/data/uploads}")
    private String uploadPath;

    @Value("${file.upload.max-size:10485760}") // 默认10MB
    private Long maxFileSize;

    @Value("${file.upload.allowed-types:jpg,jpeg,png,gif,pdf,doc,docx,xls,xlsx,ppt,pptx,txt,md}")
    private String allowedTypes;

    private static final List<String> IMAGE_TYPES = Arrays.asList("jpg", "jpeg", "png", "gif", "bmp", "webp");
    private static final int THUMBNAIL_WIDTH = 200;
    private static final int THUMBNAIL_HEIGHT = 200;

    /**
     * 上传文件
     */
    public FileUploadResponse uploadFile(MultipartFile file, String userId) throws IOException {
        // 验证文件
        validateFile(file);

        // 生成文件ID和路径
        String fileId = UUID.randomUUID().toString();
        String originalFilename = file.getOriginalFilename();
        String fileExtension = getFileExtension(originalFilename);
        String fileName = fileId + "." + fileExtension;

        // 创建用户目录
        Path userDir = Paths.get(uploadPath, userId);
        Files.createDirectories(userDir);

        // 保存文件
        Path filePath = userDir.resolve(fileName);
        Files.copy(file.getInputStream(), filePath, StandardCopyOption.REPLACE_EXISTING);

        // 创建响应
        FileUploadResponse response = new FileUploadResponse();
        response.setFileId(fileId);
        response.setFileName(originalFilename);
        response.setFileSize(file.getSize());
        response.setFileType(fileExtension);
        response.setFileUrl("/api/files/" + userId + "/" + fileName);
        response.setUploadTime(LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
        response.setStatus("success");

        // 如果是图片，生成缩略图
        if (isImageFile(fileExtension)) {
            try {
                String thumbnailName = fileId + "_thumb." + fileExtension;
                Path thumbnailPath = userDir.resolve(thumbnailName);
                generateThumbnail(filePath.toFile(), thumbnailPath.toFile());
                response.setThumbnailUrl("/api/files/" + userId + "/" + thumbnailName);
            } catch (Exception e) {
                // 缩略图生成失败不影响主流程
                System.err.println("生成缩略图失败: " + e.getMessage());
            }
        }

        return response;
    }

    /**
     * 批量上传文件
     */
    public List<FileUploadResponse> uploadFiles(MultipartFile[] files, String userId) {
        return Arrays.stream(files)
            .map(file -> {
                try {
                    return uploadFile(file, userId);
                } catch (IOException e) {
                    FileUploadResponse errorResponse = new FileUploadResponse();
                    errorResponse.setFileName(file.getOriginalFilename());
                    errorResponse.setStatus("error");
                    errorResponse.setError(e.getMessage());
                    return errorResponse;
                }
            })
            .toList();
    }

    /**
     * 删除文件
     */
    public boolean deleteFile(String userId, String fileId) throws IOException {
        Path userDir = Paths.get(uploadPath, userId);

        // 查找并删除文件（包括缩略图）
        File[] files = userDir.toFile().listFiles((dir, name) -> name.startsWith(fileId));
        if (files != null) {
            for (File file : files) {
                Files.deleteIfExists(file.toPath());
            }
            return true;
        }
        return false;
    }

    /**
     * 获取文件
     */
    public File getFile(String userId, String fileName) {
        Path filePath = Paths.get(uploadPath, userId, fileName);
        File file = filePath.toFile();
        return file.exists() ? file : null;
    }

    /**
     * 验证文件
     */
    private void validateFile(MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            throw new IOException("文件不能为空");
        }

        if (file.getSize() > maxFileSize) {
            throw new IOException("文件大小超过限制: " + (maxFileSize / 1024 / 1024) + "MB");
        }

        String extension = getFileExtension(file.getOriginalFilename());
        if (!isAllowedType(extension)) {
            throw new IOException("不支持的文件类型: " + extension);
        }
    }

    /**
     * 获取文件扩展名
     */
    private String getFileExtension(String filename) {
        if (filename == null || !filename.contains(".")) {
            return "";
        }
        return filename.substring(filename.lastIndexOf(".") + 1).toLowerCase();
    }

    /**
     * 检查是否为允许的文件类型
     */
    private boolean isAllowedType(String extension) {
        return Arrays.asList(allowedTypes.split(",")).contains(extension.toLowerCase());
    }

    /**
     * 检查是否为图片文件
     */
    private boolean isImageFile(String extension) {
        return IMAGE_TYPES.contains(extension.toLowerCase());
    }

    /**
     * 生成缩略图
     */
    private void generateThumbnail(File sourceFile, File thumbnailFile) throws IOException {
        BufferedImage originalImage = ImageIO.read(sourceFile);
        if (originalImage == null) {
            throw new IOException("无法读取图片文件");
        }

        // 计算缩略图尺寸（保持宽高比）
        int originalWidth = originalImage.getWidth();
        int originalHeight = originalImage.getHeight();
        double ratio = Math.min(
            (double) THUMBNAIL_WIDTH / originalWidth,
            (double) THUMBNAIL_HEIGHT / originalHeight
        );
        int targetWidth = (int) (originalWidth * ratio);
        int targetHeight = (int) (originalHeight * ratio);

        // 创建缩略图
        BufferedImage thumbnail = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = thumbnail.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(originalImage, 0, 0, targetWidth, targetHeight, null);
        g.dispose();

        // 保存缩略图
        String format = getFileExtension(thumbnailFile.getName());
        ImageIO.write(thumbnail, format, thumbnailFile);
    }
}
