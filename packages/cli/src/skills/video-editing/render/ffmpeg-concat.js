/**
 * ffmpeg-concat.js — concat demuxer 拼接多个片段
 */

import { promises as fs } from "fs";
import path from "path";
import { spawnMediaProcess } from "../media-process.js";

export async function concatClips(clipPaths, workDir) {
  if (clipPaths.length === 0) throw new Error("No clips to concatenate");

  if (clipPaths.length === 1) return clipPaths[0];

  const listPath = path.join(workDir, "concat_list.txt");
  const lines = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`);
  await fs.writeFile(listPath, lines.join("\n"));

  const outPath = path.join(workDir, "concat_output.mp4");

  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outPath,
    ];
    const proc = spawnMediaProcess(
      "ffmpeg",
      args,
      { stdio: ["ignore", "pipe", "pipe"] },
      "video-editing:concat",
    );
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(`ffmpeg concat exit ${code}: ${stderr.slice(-300)}`),
        );
      resolve(outPath);
    });
    proc.on("error", reject);
  });
}
