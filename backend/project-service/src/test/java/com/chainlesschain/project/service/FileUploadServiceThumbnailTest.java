package com.chainlesschain.project.service;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.util.zip.CRC32;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link FileUploadService} 缩略图防解压炸弹：超大像素图（按图头尺寸判定）必须在
 * {@code ImageIO.read} 全量解码前被拒绝，避免 OutOfMemoryError 拖垮上传请求。
 */
class FileUploadServiceThumbnailTest {

    /** 反射调用私有 assertImageWithinPixelBudget(File)。 */
    private void invokeGuard(File f) throws Throwable {
        FileUploadService s = new FileUploadService();
        Method m = FileUploadService.class.getDeclaredMethod(
                "assertImageWithinPixelBudget", File.class);
        m.setAccessible(true);
        try {
            m.invoke(s, f);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }

    @Test
    void guard_rejectsOversizedImageByHeaderDimensions() throws Throwable {
        // 仅图头声明 100000x100000（=10^10 像素 ≫ 50MP 上限），无任何像素数据 ——
        // 测试自身绝不分配位图，读尺寸即拒。
        File png = File.createTempFile("bomb-", ".png");
        png.deleteOnExit();
        Files.write(png.toPath(), pngHeaderOnly(100_000, 100_000));

        IOException ex = (IOException) assertThrows(IOException.class, () -> {
            try {
                invokeGuard(png);
            } catch (Throwable t) {
                if (t instanceof IOException io) throw io;
                throw new RuntimeException(t);
            }
        });
        assertTrue(ex.getMessage().contains("尺寸过大"));
    }

    @Test
    void guard_allowsNormalSizedImage() throws Throwable {
        // 真实的小图（10x10）写盘后读尺寸 → 在预算内，不抛异常。
        File png = File.createTempFile("ok-", ".png");
        png.deleteOnExit();
        BufferedImage img = new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB);
        ImageIO.write(img, "png", png);

        assertDoesNotThrow(() -> {
            try {
                invokeGuard(png);
            } catch (Throwable t) {
                throw new RuntimeException(t);
            }
        });
    }

    @Test
    void pixelBudgetConstantIsSane() {
        Object v = ReflectionTestUtils.getField(
                FileUploadService.class, "MAX_THUMBNAIL_SOURCE_PIXELS");
        assertTrue(v instanceof Long && (Long) v > 0);
    }

    /** 构造仅含 PNG 签名 + IHDR（含正确 CRC）的字节，足够 ImageReader 读出宽高。 */
    private static byte[] pngHeaderOnly(int width, int height) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        // PNG 签名
        out.write(new byte[] {
                (byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A});
        // IHDR data: width(4) height(4) bitDepth(8) colorType(2=RGB) comp(0) filter(0) interlace(0)
        byte[] data = new byte[13];
        writeInt(data, 0, width);
        writeInt(data, 4, height);
        data[8] = 8;   // bit depth
        data[9] = 2;   // color type RGB
        data[10] = 0;  // compression
        data[11] = 0;  // filter
        data[12] = 0;  // interlace
        // length
        byte[] len = new byte[4];
        writeInt(len, 0, data.length);
        out.write(len);
        // type + data
        byte[] type = {'I', 'H', 'D', 'R'};
        out.write(type);
        out.write(data);
        // CRC over type+data
        CRC32 crc = new CRC32();
        crc.update(type);
        crc.update(data);
        byte[] crcBytes = new byte[4];
        writeInt(crcBytes, 0, (int) crc.getValue());
        out.write(crcBytes);
        return out.toByteArray();
    }

    private static void writeInt(byte[] buf, int off, int value) {
        buf[off] = (byte) ((value >>> 24) & 0xFF);
        buf[off + 1] = (byte) ((value >>> 16) & 0xFF);
        buf[off + 2] = (byte) ((value >>> 8) & 0xFF);
        buf[off + 3] = (byte) (value & 0xFF);
    }
}
