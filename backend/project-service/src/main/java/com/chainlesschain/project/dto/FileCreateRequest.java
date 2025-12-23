package com.chainlesschain.project.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;

/**
 * 创建文件请求DTO
 */
@Data
public class FileCreateRequest {

    @NotBlank(message = "文件路径不能为空")
    private String filePath;  // 相对路径，如 "src/main.js"

    @NotBlank(message = "文件名不能为空")
    private String fileName;  // 文件名

    @NotBlank(message = "文件类型不能为空")
    private String fileType;  // html, css, js, py, java, md, docx, pdf, etc.

    private String language;  // 编程语言（可选）

    private String content;   // 文件内容（文本）或 Base64（二进制）

    private Boolean isBase64 = false;  // 是否为Base64编码

    private String generatedBy;  // web_engine, doc_engine, data_engine, user

    private Map<String, Object> metadata;  // 额外元数据
}
