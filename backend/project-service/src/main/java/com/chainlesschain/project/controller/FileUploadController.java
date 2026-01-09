package com.chainlesschain.project.controller;

import com.chainlesschain.project.dto.FileUploadResponse;
import com.chainlesschain.project.service.FileUploadService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;

/**
 * 文件上传控制器
 * 处理文件上传、下载和管理
 */
@RestController
@RequestMapping("/api/files")
@Tag(name = "文件管理", description = "文件上传、下载和管理相关接口")
public class FileUploadController {

    @Autowired
    private FileUploadService fileUploadService;

    /**
     * 上传单个文件
     */
    @PostMapping("/upload")
    @Operation(summary = "上传文件", description = "上传单个文件")
    public ResponseEntity<?> uploadFile(
            @RequestParam("file") MultipartFile file,
            Authentication authentication) {
        try {
            String userId = authentication.getName();
            FileUploadResponse response = fileUploadService.uploadFile(file, userId);
            return ResponseEntity.ok(response);
        } catch (IOException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "文件上传失败: " + e.getMessage()));
        }
    }

    /**
     * 批量上传文件
     */
    @PostMapping("/upload/batch")
    @Operation(summary = "批量上传文件", description = "一次上传多个文件")
    public ResponseEntity<?> uploadFiles(
            @RequestParam("files") MultipartFile[] files,
            Authentication authentication) {
        try {
            String userId = authentication.getName();
            List<FileUploadResponse> responses = fileUploadService.uploadFiles(files, userId);
            return ResponseEntity.ok(Map.of(
                "success", true,
                "files", responses
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "批量上传失败: " + e.getMessage()));
        }
    }

    /**
     * 下载文件
     */
    @GetMapping("/{userId}/{fileName}")
    @Operation(summary = "下载文件", description = "根据文件名下载文件")
    public ResponseEntity<Resource> downloadFile(
            @PathVariable String userId,
            @PathVariable String fileName) {
        try {
            File file = fileUploadService.getFile(userId, fileName);
            if (file == null) {
                return ResponseEntity.notFound().build();
            }

            Resource resource = new FileSystemResource(file);
            String contentType = Files.probeContentType(file.toPath());
            if (contentType == null) {
                contentType = "application/octet-stream";
            }

            return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(contentType))
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + fileName + "\"")
                .body(resource);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    /**
     * 删除文件
     */
    @DeleteMapping("/{userId}/{fileId}")
    @Operation(summary = "删除文件", description = "删除指定文件")
    public ResponseEntity<?> deleteFile(
            @PathVariable String userId,
            @PathVariable String fileId,
            Authentication authentication) {
        try {
            // 验证用户权限
            if (!authentication.getName().equals(userId)) {
                return ResponseEntity.status(403)
                    .body(Map.of("error", "无权删除此文件"));
            }

            boolean deleted = fileUploadService.deleteFile(userId, fileId);
            if (deleted) {
                return ResponseEntity.ok(Map.of("success", true, "message", "文件已删除"));
            } else {
                return ResponseEntity.notFound().build();
            }
        } catch (IOException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "删除文件失败: " + e.getMessage()));
        }
    }

    /**
     * 获取文件信息
     */
    @GetMapping("/{userId}/{fileName}/info")
    @Operation(summary = "获取文件信息", description = "获取文件的元数据信息")
    public ResponseEntity<?> getFileInfo(
            @PathVariable String userId,
            @PathVariable String fileName) {
        try {
            File file = fileUploadService.getFile(userId, fileName);
            if (file == null) {
                return ResponseEntity.notFound().build();
            }

            return ResponseEntity.ok(Map.of(
                "fileName", file.getName(),
                "fileSize", file.length(),
                "lastModified", file.lastModified(),
                "exists", file.exists()
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "获取文件信息失败: " + e.getMessage()));
        }
    }
}
