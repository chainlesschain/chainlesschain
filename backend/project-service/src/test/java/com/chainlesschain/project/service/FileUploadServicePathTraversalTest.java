package com.chainlesschain.project.service;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * {@link FileUploadService} 路径穿越加固单元测试（getFile / deleteFile 拒绝 ../ 等）。
 */
class FileUploadServicePathTraversalTest {

    private FileUploadService service() {
        FileUploadService s = new FileUploadService();
        ReflectionTestUtils.setField(s, "uploadPath", System.getProperty("java.io.tmpdir"));
        return s;
    }

    @Test
    void getFile_rejectsTraversalFileName() {
        FileUploadService s = service();
        assertThrows(IllegalArgumentException.class, () -> s.getFile("alice", "../../../etc/passwd"));
        assertThrows(IllegalArgumentException.class, () -> s.getFile("alice", "..\\..\\secret"));
        assertThrows(IllegalArgumentException.class, () -> s.getFile("alice", "a/b"));
    }

    @Test
    void getFile_rejectsTraversalUserId() {
        FileUploadService s = service();
        assertThrows(IllegalArgumentException.class, () -> s.getFile("../../etc", "passwd"));
    }

    @Test
    void getFile_allowsPlainName_returnsNullWhenAbsent() {
        FileUploadService s = service();
        // 合法文件名、文件不存在 → 返回 null（不抛异常）
        assertNull(s.getFile("alice", "nonexistent-" + System.nanoTime() + ".txt"));
    }

    @Test
    void deleteFile_rejectsTraversal() {
        FileUploadService s = service();
        assertThrows(IllegalArgumentException.class, () -> s.deleteFile("alice", "../evil"));
        assertThrows(IllegalArgumentException.class, () -> s.deleteFile("../../etc", "x"));
    }

    @Test
    void uploadFile_rejectsTraversalUserId() {
        FileUploadService s = service();
        MockMultipartFile file = new MockMultipartFile("file", "photo.png", "image/png", new byte[] {1, 2, 3});
        // userId 含 .. / 路径分隔符 → 写入前即拒（与 getFile/deleteFile 对称，杜绝穿越写入）
        assertThrows(IllegalArgumentException.class, () -> s.uploadFile(file, "../../etc"));
        assertThrows(IllegalArgumentException.class, () -> s.uploadFile(file, "a/b"));
        assertThrows(IllegalArgumentException.class, () -> s.uploadFile(file, "a\\b"));
    }

    @Test
    void uploadFiles_rejectsTraversalUserId() {
        FileUploadService s = service();
        MockMultipartFile file = new MockMultipartFile("file", "photo.png", "image/png", new byte[] {1, 2, 3});
        // 批量上传同样拦截非法 userId（透传 uploadFile 的守卫，硬失败而非逐文件软失败）
        assertThrows(
            IllegalArgumentException.class,
            () -> s.uploadFiles(new MultipartFile[] {file}, "../../etc"));
    }
}
