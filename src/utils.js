import fs from "fs/promises";
import path from "path";
import config from "./config.js";

function getFileExt(filename) {
  const ext = path.extname(filename);
  if (ext === "" && filename.startsWith(".")) {
    return filename.slice(1).toLowerCase();
  }
  return ext.replace(/^\./, "").toLowerCase();
}

function formatFileSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes}  B`;
}

function formatFileDate(mtime) {
  const d = new Date(mtime);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

async function readDirectory(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  const folders = [];
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    // Resolve symlinks to determine actual type
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(fullPath);
        isDir = stat.isDirectory();
        isFile = stat.isFile();
      } catch {
        continue; // broken symlink
      }
    }

    if (isDir) {
      try {
        await fs.access(path.join(fullPath, config.excludeMarker));
        // Marker exists — skip this folder
      } catch {
        folders.push({ name: entry.name });
      }
    } else if (isFile) {
      const ext = getFileExt(entry.name);
      if (config.ignoredFiletypes.has(ext)) continue;

      try {
        const stat = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          ext,
          size: stat.size,
          sizeFormatted: formatFileSize(stat.size),
          date: formatFileDate(stat.mtimeMs),
        });
      } catch {
        // skip files we can't stat
      }
    }
  }

  folders.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  files.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  const filetypes = [
    ...new Set(files.map((f) => f.ext).filter(Boolean)),
  ].sort();

  return { folders, files, filetypes };
}

export { getFileExt, formatFileSize, formatFileDate, readDirectory };
