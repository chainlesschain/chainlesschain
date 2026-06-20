package com.chainlesschain.project.service;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

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
}
