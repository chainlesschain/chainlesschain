package com.chainlesschain.android.feature.localterminal

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * 2026-05-24 — `LocalFilesystemBootstrapper.extractTarToDir` 的 JVM 单测，
 * 覆盖修复后的 GNU tar 扩展支持（typeFlag 'L'/'K'）+ file/dir collision 防御。
 *
 * 起因：cc-cli.tgz 含 @aws-sdk 系等深嵌套包，npm pack 路径 >100 字符触发
 * GNU `././@LongLink` 长名 entry。原 parser 没识别 'L' typeFlag，把 @LongLink
 * 当 regular file 写到磁盘 + 下一 entry 用截断 header name → 文件名错位（
 * `bom-handling.js` → `bom-hand`）→ 整个 cc bundle 残缺 → `require('./bom-handling')`
 * 失败 → cc 子进程 exit 1 → 数据浏览 / 审计 / 提问空 0 结果。
 *
 * 测试构造合成 tar bytestream（无外部 tar 依赖），逐 case 验证：
 *  1. 短名 regular file 直写
 *  2. 目录 entry (typeflag '5') mkdirs
 *  3. GNU 'L' long-name → 下一 file 用长路径写
 *  4. 同名 file+dir collision → file 跳过不抛 EISDIR
 *  5. End-of-archive (双 512 零块) 正常终止
 */
class TarExtractorTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    private lateinit var bootstrapper: LocalFilesystemBootstrapper
    private lateinit var destDir: File

    @Before
    fun setUp() {
        val context = mockk<Context>(relaxed = true)
        bootstrapper = LocalFilesystemBootstrapper(context)
        destDir = tempFolder.newFolder("extract")
    }

    @Test
    fun `short-name regular file extracts content correctly`() {
        val tar = TarBuilder()
            .addFile("hello.txt", "world".toByteArray())
            .endArchive()
            .build()

        bootstrapper.extractTarToDir(ByteArrayInputStream(tar), destDir)

        val out = File(destDir, "hello.txt")
        assertTrue("hello.txt should exist", out.isFile)
        assertEquals("world", out.readText())
    }

    @Test
    fun `directory entry creates directory`() {
        val tar = TarBuilder()
            .addDir("subdir/")
            .addFile("subdir/inner.txt", "x".toByteArray())
            .endArchive()
            .build()

        bootstrapper.extractTarToDir(ByteArrayInputStream(tar), destDir)

        assertTrue("subdir should be a directory", File(destDir, "subdir").isDirectory)
        assertEquals("x", File(destDir, "subdir/inner.txt").readText())
    }

    @Test
    fun `GNU L long-name overrides next entry name`() {
        // 路径 >100 字符 — 模拟 @aws-sdk 深嵌套
        val longPath = "node_modules/" +
            "very/deeply/nested/package/with/many/segments/that/exceed/" +
            "the/standard/ustar/limit/of/one/hundred/chars/bom-handling.js"
        assertTrue("test sanity: path must be >100 chars", longPath.length > 100)

        val tar = TarBuilder()
            .addLongName(longPath)
            // 紧随其后的 regular file，header.name 是截断版本（实际 GNU tar 写
            // 前 100 chars），parser 应忽略并用 pendingLongName。
            .addFile(longPath.substring(0, 100), "real-content".toByteArray())
            .endArchive()
            .build()

        bootstrapper.extractTarToDir(ByteArrayInputStream(tar), destDir)

        val out = File(destDir, longPath)
        assertTrue("file at full long path should exist: $longPath", out.isFile)
        assertEquals("real-content", out.readText())
        // 必须 NOT 写出 @LongLink 文件（旧 bug 的特征）
        assertFalse("@LongLink must not be written as a regular file",
            File(destDir, "@LongLink").exists())
        assertFalse("./@LongLink must not be written as a regular file",
            File(destDir, "././@LongLink").exists())
    }

    @Test
    fun `package prefix is stripped from full name including via long-name`() {
        // npm pack 的 entry 都以 package/ 前缀；extractTarToDir 应剥掉
        val longPath = "package/node_modules/@aws-sdk/middleware-host-header/" +
            "abc/def/ghi/jkl/mno/pqr/stu/vwx/yz1/234/567/long-pkg-path/file.js"
        assertTrue("test sanity: path must be >100 chars, got ${longPath.length}", longPath.length > 100)

        val tar = TarBuilder()
            .addLongName(longPath)
            .addFile(longPath.substring(0, 100), "stripped".toByteArray())
            .endArchive()
            .build()

        bootstrapper.extractTarToDir(ByteArrayInputStream(tar), destDir)

        val expected = File(destDir, longPath.removePrefix("package/"))
        assertTrue("stripped path should be extracted: ${expected.path}", expected.isFile)
        assertEquals("stripped", expected.readText())
    }

    @Test
    fun `file colliding with existing directory is skipped without throwing`() {
        // npm pack 偶发 quirk：同一路径上既有目录 entry 又有 0 字节文件 entry。
        // 直接 outputStream() 会抛 EISDIR；新逻辑应跳过。
        val tar = TarBuilder()
            .addDir("collide/")
            .addFile("collide/inner.txt", "ok".toByteArray())
            // 文件 entry 路径恰好等于已存在的目录
            .addFile("collide", "should-be-skipped".toByteArray())
            .endArchive()
            .build()

        // 不应抛
        bootstrapper.extractTarToDir(ByteArrayInputStream(tar), destDir)

        assertTrue(File(destDir, "collide").isDirectory)
        assertEquals("ok", File(destDir, "collide/inner.txt").readText())
    }

    @Test
    fun `multiple long-name entries each apply to immediately following entry`() {
        val longA = "a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/" +
            "0123456789/0123456789/0123456789/AAAAAAAAAA/file-a.txt"
        val longB = "a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/" +
            "0123456789/0123456789/0123456789/BBBBBBBBBB/file-b.txt"
        assertTrue(
            "test sanity: paths must be >100 chars, got A=${longA.length} B=${longB.length}",
            longA.length > 100 && longB.length > 100,
        )

        val tar = TarBuilder()
            .addLongName(longA).addFile(longA.substring(0, 100), "A".toByteArray())
            .addLongName(longB).addFile(longB.substring(0, 100), "B".toByteArray())
            .endArchive()
            .build()

        bootstrapper.extractTarToDir(ByteArrayInputStream(tar), destDir)

        assertEquals("A", File(destDir, longA).readText())
        assertEquals("B", File(destDir, longB).readText())
    }
}

/**
 * 最小化 USTAR tar 字节流构造器 —— 不依赖 commons-compress；只支持 test
 * 必需的 typeflag '0' (file) / '5' (dir) / 'L' (GNU long-name)。
 */
private class TarBuilder {
    private val out = ByteArrayOutputStream()

    fun addFile(name: String, data: ByteArray): TarBuilder {
        writeHeader(name, data.size.toLong(), '0', linkName = "")
        out.write(data)
        writeZeroPadTo512(data.size)
        return this
    }

    fun addDir(name: String): TarBuilder {
        require(name.endsWith("/")) { "directory entry name should end with /" }
        writeHeader(name, 0L, '5', linkName = "")
        return this
    }

    /**
     * 模拟 GNU tar 'L' typeflag：name 字段固定 `././@LongLink`，data 是下一
     * entry 真实的全路径（NULL-terminated 习惯但解析器对 NULL 不应敏感）。
     */
    fun addLongName(fullPath: String): TarBuilder {
        val bytes = fullPath.toByteArray(Charsets.UTF_8) + 0  // GNU tar 写 NULL 结尾
        writeHeader("././@LongLink", bytes.size.toLong(), 'L', linkName = "")
        out.write(bytes)
        writeZeroPadTo512(bytes.size)
        return this
    }

    /** End-of-archive: two consecutive 512-byte zero blocks. */
    fun endArchive(): TarBuilder {
        out.write(ByteArray(1024))
        return this
    }

    fun build(): ByteArray = out.toByteArray()

    private fun writeHeader(name: String, size: Long, typeflag: Char, linkName: String) {
        val header = ByteArray(512)
        val nameBytes = name.toByteArray(Charsets.UTF_8)
        require(nameBytes.size <= 100) {
            "tar name field max 100 chars; got ${nameBytes.size} for $name"
        }
        nameBytes.copyInto(header, 0)
        // mode = 0644 octal padded
        writeOctal(header, 100, 8, 420L) // 0644
        writeOctal(header, 108, 8, 0L)   // uid
        writeOctal(header, 116, 8, 0L)   // gid
        writeOctal(header, 124, 12, size)
        writeOctal(header, 136, 12, 0L)  // mtime
        // chksum: 先填 spaces 再算
        for (i in 148..155) header[i] = ' '.code.toByte()
        header[156] = typeflag.code.toByte()
        if (linkName.isNotEmpty()) linkName.toByteArray().copyInto(header, 157)
        // magic = "ustar " + version " \0"
        "ustar  ".toByteArray().copyInto(header, 257) // GNU 风格 (磁带 archive)
        val checksum = header.map { it.toInt() and 0xff }.sum()
        val cs = "%06o".format(checksum).toByteArray()
        cs.copyInto(header, 148)
        header[154] = 0
        header[155] = ' '.code.toByte()
        out.write(header)
    }

    private fun writeOctal(buf: ByteArray, off: Int, len: Int, value: Long) {
        // tar octal field: <len-1> 个 octal digit + NULL
        val str = value.toString(8).padStart(len - 1, '0').take(len - 1)
        str.toByteArray().copyInto(buf, off)
        buf[off + len - 1] = 0
    }

    private fun writeZeroPadTo512(dataLen: Int) {
        val padding = (512 - (dataLen % 512)) % 512
        if (padding > 0) out.write(ByteArray(padding))
    }
}
