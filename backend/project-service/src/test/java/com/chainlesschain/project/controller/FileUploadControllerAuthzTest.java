package com.chainlesschain.project.controller;

import com.chainlesschain.project.service.FileUploadService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Authorization (IDOR) tests for {@link FileUploadController}'s per-user file
 * endpoints. download/info take a {@code {userId}} path variable; a caller must
 * only be able to read/inspect their OWN files. Previously download/getFileInfo
 * had no caller==userId check (only deleteFile did), so any authenticated user
 * could read another user's files by passing their userId.
 */
@ExtendWith(MockitoExtension.class)
class FileUploadControllerAuthzTest {

    @Mock
    private FileUploadService fileUploadService;
    @Mock
    private Authentication authentication;
    @InjectMocks
    private FileUploadController controller;

    @Test
    void downloadFile_otherUsersFile_isForbidden_andServiceNotCalled() {
        when(authentication.getName()).thenReturn("alice");
        var resp = controller.downloadFile("bob", "secret.txt", authentication);
        assertEquals(403, resp.getStatusCode().value());
        verify(fileUploadService, never()).getFile("bob", "secret.txt");
    }

    @Test
    void downloadFile_nullAuth_isForbidden() {
        var resp = controller.downloadFile("bob", "secret.txt", null);
        assertEquals(403, resp.getStatusCode().value());
        verify(fileUploadService, never()).getFile(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void downloadFile_ownFile_passesGuard_andCallsService() throws Exception {
        when(authentication.getName()).thenReturn("alice");
        when(fileUploadService.getFile("alice", "mine.txt")).thenReturn(null); // → 404, but guard passed
        var resp = controller.downloadFile("alice", "mine.txt", authentication);
        assertEquals(404, resp.getStatusCode().value());
        verify(fileUploadService).getFile("alice", "mine.txt");
    }

    @Test
    void getFileInfo_otherUsersFile_isForbidden_andServiceNotCalled() {
        when(authentication.getName()).thenReturn("alice");
        var resp = controller.getFileInfo("bob", "secret.txt", authentication);
        assertEquals(403, resp.getStatusCode().value());
        verify(fileUploadService, never()).getFile("bob", "secret.txt");
    }

    @Test
    void getFileInfo_ownFile_passesGuard_andCallsService() throws Exception {
        when(authentication.getName()).thenReturn("alice");
        lenient().when(fileUploadService.getFile("alice", "mine.txt")).thenReturn(null);
        var resp = controller.getFileInfo("alice", "mine.txt", authentication);
        assertEquals(404, resp.getStatusCode().value());
        verify(fileUploadService).getFile("alice", "mine.txt");
    }
}
