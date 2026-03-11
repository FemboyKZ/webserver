import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import sevenZip from "7zip-min";
import * as tar from "tar";
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

function getArchiveType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tar.gz")) return "tar.gz";
  if (lower.endsWith(".tar.bz2")) return "tar.bz2";
  if (lower.endsWith(".tar.xz")) return "tar.xz";
  const ext = path.extname(lower).slice(1);
  if (["zip", "7z", "tar", "tgz", "tbz2"].includes(ext)) return ext;
  return null;
}

function sanitizeEntryName(name) {
  return name
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part !== ".." && part !== ".")
    .join("/");
}

const TAR_TYPES = new Set([
  "tar",
  "tar.gz",
  "tar.bz2",
  "tar.xz",
  "tgz",
  "tbz2",
]);

async function listArchiveContents(filePath) {
  const archiveType = getArchiveType(path.basename(filePath));

  if (archiveType === "zip") {
    const zip = new AdmZip(filePath);
    return zip
      .getEntries()
      .map((entry) => {
        const name = sanitizeEntryName(entry.entryName);
        return {
          name,
          size: entry.header.size,
          compressedSize: entry.header.compressedSize,
          isDirectory: entry.isDirectory,
          date: formatFileDate(entry.header.time),
        };
      })
      .filter((e) => e.name);
  }

  // Use node-tar for .tar, .tar.gz, .tar.bz2, .tar.xz, .tgz, .tbz2
  if (TAR_TYPES.has(archiveType)) {
    const entries = [];
    await tar.t({
      file: filePath,
      onReadEntry(entry) {
        const name = sanitizeEntryName(entry.path);
        if (name) {
          entries.push({
            name,
            size: entry.size || 0,
            compressedSize: 0,
            isDirectory: entry.type === "Directory",
            date: entry.mtime ? formatFileDate(entry.mtime.getTime()) : "",
          });
        }
      },
    });
    return entries;
  }

  // Use 7zip-min for .7z
  return new Promise((resolve, reject) => {
    sevenZip.list(filePath, (err, result) => {
      if (err) return reject(err);
      resolve(
        result
          .map((entry) => {
            const name = sanitizeEntryName(entry.name);
            return {
              name,
              size: parseInt(entry.size) || 0,
              compressedSize: parseInt(entry.compressed) || 0,
              isDirectory: entry.attr?.startsWith("D") || name.endsWith("/"),
              date:
                entry.dateTime ||
                (entry.date ? `${entry.date} ${entry.time || ""}`.trim() : ""),
            };
          })
          .filter((e) => e.name),
      );
    });
  });
}

function buildArchiveTree(entries) {
  const dirSet = new Set();
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory) {
      dirSet.add(entry.name.replace(/\/$/, ""));
    } else {
      // Infer parent directories from file paths
      const parts = entry.name.split("/");
      for (let i = 1; i < parts.length; i++) {
        dirSet.add(parts.slice(0, i).join("/"));
      }
      files.push({
        ...entry,
        sizeFormatted: formatFileSize(entry.size),
      });
    }
  }

  const dirs = [...dirSet]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((p) => ({ path: p, name: p }));
  files.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return { dirs, files, totalSize };
}

async function extractFileFromArchive(archivePath, entryPath) {
  const archiveType = getArchiveType(path.basename(archivePath));
  const sanitized = sanitizeEntryName(entryPath);
  if (!sanitized) throw new Error("Invalid entry path");

  if (archiveType === "zip") {
    const zip = new AdmZip(archivePath);
    const entry = zip.getEntry(sanitized) || zip.getEntry(sanitized + "/");
    if (!entry || entry.isDirectory)
      throw new Error("File not found in archive");
    return entry.getData();
  }

  if (TAR_TYPES.has(archiveType)) {
    const chunks = [];
    let found = false;
    await tar.t({
      file: archivePath,
      onReadEntry(entry) {
        const name = sanitizeEntryName(entry.path);
        if (name === sanitized && entry.type !== "Directory") {
          found = true;
          entry.on("data", (chunk) => chunks.push(chunk));
        }
      },
    });
    if (!found) throw new Error("File not found in archive");
    return Buffer.concat(chunks);
  }

  // 7z: extract to temp dir, read file, clean up
  const os = await import("os");
  const crypto = await import("crypto");
  const tmpDir = path.join(
    os.default.tmpdir(),
    "fkz-" + crypto.default.randomBytes(8).toString("hex"),
  );
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await new Promise((resolve, reject) => {
      sevenZip.unpack(archivePath, tmpDir, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    const filePath = path.join(tmpDir, ...sanitized.split("/"));
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(tmpDir)) throw new Error("Invalid entry path");
    return await fs.readFile(resolved);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export {
  formatFileSize,
  formatFileDate,
  readDirectory,
  getArchiveType,
  sanitizeEntryName,
  listArchiveContents,
  buildArchiveTree,
  extractFileFromArchive,
};
