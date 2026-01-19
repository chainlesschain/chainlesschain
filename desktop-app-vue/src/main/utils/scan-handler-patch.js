const { ipcMain } = require("electron");

// 扫描项目文件夹并添加到数据库
ipcMain.handle("project:scan-files", async (_event, projectId) => {
  try {
    console.log(`[Main] 扫描项目文件: ${projectId}`);
    const project = this.database.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(projectId);
    if (!project) {throw new Error("项目不存在");}
    const rootPath = project.root_path || project.folder_path;
    if (!rootPath) {throw new Error("项目没有根路径");}

    const fs = require("fs").promises;
    const path = require("path");
    const crypto = require("crypto");
    const addedFiles = [];

    const scanDir = async (dir, base) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(base, fullPath);
        if (/(^|[/\\])\.|node_modules|\.git|dist|build/.test(relativePath))
          {continue;}
        if (entry.isDirectory()) {
          await scanDir(fullPath, base);
        } else if (entry.isFile()) {
          addedFiles.push({ fullPath, relativePath });
        }
      }
    };

    await scanDir(rootPath, rootPath);
    console.log(`[Main] 找到 ${addedFiles.length} 个文件`);

    let added = 0,
      skipped = 0;
    for (const { fullPath, relativePath } of addedFiles) {
      try {
        const exists = this.database.db
          .prepare(
            "SELECT id FROM project_files WHERE project_id = ? AND file_path = ?",
          )
          .get(projectId, relativePath);
        if (exists) {
          skipped++;
          continue;
        }

        const content = await fs.readFile(fullPath, "utf8");
        const stats = await fs.stat(fullPath);
        const hash = crypto
          .createHash("sha256")
          .update(content, "utf8")
          .digest("hex");
        const ext = path.extname(relativePath).substring(1);
        const fileId =
          "file_" + Date.now() + "_" + Math.random().toString(36).substring(7);
        const now = Date.now();

        this.database.db.run(
          "INSERT INTO project_files (id, project_id, file_name, file_path, file_type, content, content_hash, file_size, version, fs_path, created_at, updated_at, sync_status, synced_at, device_id, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            fileId,
            projectId,
            path.basename(relativePath),
            relativePath,
            ext || "unknown",
            content,
            hash,
            stats.size,
            1,
            fullPath,
            now,
            now,
            "pending",
            null,
            null,
            0,
          ],
        );
        added++;
      } catch (err) {
        console.error(`[Main] 文件处理失败 ${relativePath}:`, err.message);
      }
    }

    this.database.saveToFile();
    console.log(`[Main] 扫描完成: 添加${added}, 跳过${skipped}`);

    if (this.fileSyncManager) {
      await this.fileSyncManager.watchProject(projectId, rootPath);
    }

    return { success: true, addedCount: added, skippedCount: skipped };
  } catch (error) {
    console.error("[Main] 扫描失败:", error);
    throw error;
  }
});
