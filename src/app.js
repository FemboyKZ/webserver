import express from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import nunjucks from "nunjucks";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import crypto from "crypto";
import config from "./config.js";
import {
  readDirectory,
  formatFileSize,
  formatFileDate,
  getArchiveType,
  sanitizeEntryName,
  listArchiveContents,
  buildArchiveTree,
  extractFileFromArchive,
  computeFileHash,
} from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEXT_EXTENSIONS = new Set([
  "bat",
  "cfg",
  "cmd",
  "conf",
  "css",
  "csv",
  "dockerfile",
  "env",
  "gitignore",
  "html",
  "ini",
  "js",
  "json",
  "jsonc",
  "jsx",
  "log",
  "makefile",
  "md",
  "php",
  "ps1",
  "py",
  "rst",
  "sh",
  "shtml",
  "sp",
  "tex",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "webp",
  "svg",
  "ico",
  "avif",
]);

const VIDEO_EXTENSIONS = new Map([
  ["mp4", "mp4"],
  ["webm", "webm"],
  ["ogv", "ogg"],
  ["mov", "mp4"],
  ["mkv", "x-matroska"],
  ["avi", "x-msvideo"],
]);

const AUDIO_EXTENSIONS = new Map([
  ["mp3", "mpeg"],
  ["ogg", "ogg"],
  ["wav", "wav"],
  ["flac", "flac"],
  ["aac", "aac"],
  ["m4a", "mp4"],
  ["wma", "x-ms-wma"],
  ["opus", "opus"],
]);

const BOT_UA =
  /bot|crawl|spider|preview|embed|slack|discord|telegram|whatsapp|facebook|twitter|og-image/i;

const app = express();

// Trust reverse proxy (Apache) for correct protocol/host in redirects
app.set("trust proxy", 1);

// Nunjucks setup
const env = nunjucks.configure(path.join(__dirname, "..", "views"), {
  autoescape: true,
  express: app,
});

env.addGlobal("discordInvite", config.discordInvite);
env.addGlobal("repoUrl", config.repoUrl);
env.addGlobal("siteUrl", config.siteUrl);

// Build static asset version map for cache-busting
const publicDir = path.join(__dirname, "..", "public");
const assetVersions = new Map();

async function buildAssetVersions(dir, prefix = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await buildAssetVersions(path.join(dir, entry.name), rel);
    } else {
      const content = await fs.readFile(path.join(dir, entry.name));
      const hash = crypto
        .createHash("md5")
        .update(content)
        .digest("hex")
        .slice(0, 8);
      assetVersions.set(rel, hash);
    }
  }
}

await buildAssetVersions(publicDir);
env.addGlobal("assetV", (file) => assetVersions.get(file) || "");

// Security headers
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; frame-ancestors 'self'",
  );
  next();
});

// Rate limiting
const archiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});

// Gzip/brotli compression
app.use(compression());

// Serve static assets (CSS/JS) from /static/ with cache headers
app.use(
  "/static",
  express.static(path.join(__dirname, "..", "public"), { maxAge: "1d" }),
);

// Main browse route — handles all paths
app.get("/{*splat}", async (req, res) => {
  try {
    // Decode and normalize the requested path
    let reqPath;
    try {
      reqPath = decodeURIComponent(req.path);
    } catch {
      return res.status(400).render("error.njk", {
        status: "400",
        message: "Invalid URL encoding.",
      });
    }
    const dirPath = path.join(config.filesRoot, reqPath);
    const resolved = path.resolve(dirPath);

    // Path traversal protection (pre-symlink check)
    if (!resolved.startsWith(config.filesRoot)) {
      return res.status(403).render("error.njk", {
        status: "403",
        message: "You don't have permission to access this path.",
      });
    }

    // Resolve symlinks and check the real path exists
    let realPath;
    try {
      realPath = await fs.realpath(resolved);
    } catch {
      return res.status(404).render("error.njk", {
        status: "404",
        message: "The file or directory you're looking for doesn't exist.",
      });
    }

    // Check if path is a file — preview or serve
    try {
      const stat = await fs.stat(realPath);
      if (stat.isFile()) {
        // Raw download via ?raw=1 or non-browser clients (wget, curl, game engines, etc.)
        // Skip when ?file= is present (archive entry requests handled below)
        // Check for explicit text/html in Accept header instead of req.accepts()
        // because req.accepts("html") returns true for */* which game clients send
        const acceptHeader = req.get("Accept") || "";
        const wantsHtml = acceptHeader.includes("text/html");
        if ((req.query.raw === "1" || !wantsHtml) && !req.query.file) {
          return res.sendFile(realPath);
        }

        const ext = path.extname(realPath).replace(/^\./, "").toLowerCase();
        const baseName = path.basename(realPath);
        const nameNoExt = baseName.replace(/\.[^.]+$/, "").toLowerCase();
        const parentPath = req.path.replace(/\/[^/]*$/, "/") || "/";

        // Minimal embed page via ?embed=1 or bot/crawler user agents
        const ua = req.get("user-agent") || "";
        if (req.query.embed === "1" || BOT_UA.test(ua)) {
          // Normalize path to prevent open redirect via // protocol-relative URLs
          const safePath = "/" + req.path.replace(/^\/+/, "");
          const embedCtx = {
            fileName: baseName,
            sizeFormatted: formatFileSize(stat.size),
            currentPath: safePath,
            ext: ext || "unknown",
          };

          if (VIDEO_EXTENSIONS.has(ext)) {
            embedCtx.mediaType = "video";
            embedCtx.mimeSubtype = VIDEO_EXTENSIONS.get(ext);
          } else if (AUDIO_EXTENSIONS.has(ext)) {
            embedCtx.mediaType = "audio";
            embedCtx.mimeSubtype = AUDIO_EXTENSIONS.get(ext);
          } else if (IMAGE_EXTENSIONS.has(ext)) {
            embedCtx.mediaType = "image";
          }

          return res.render("embed.njk", embedCtx);
        }

        const { sha256, md5 } = await computeFileHash(realPath);

        if (TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(nameNoExt)) {
          // Skip text preview for files exceeding size limit
          if (stat.size > config.maxTextPreviewSize) {
            return res.render("file-unknown.njk", {
              title: `FKZ File Index - ${config.mirrorTag} - ${baseName}`,
              fileName: baseName,
              sizeFormatted: formatFileSize(stat.size),
              date: formatFileDate(stat.mtimeMs),
              currentPath: req.path,
              parentPath,
              ext: ext || "unknown",
              sha256,
              md5,
            });
          }

          const raw = await fs.readFile(realPath);
          const content = raw.toString("utf-8");

          // Detect line ending type
          const hasCRLF = content.includes("\r\n");
          const hasCR = !hasCRLF && content.includes("\r");
          const lineEnding = hasCRLF ? "CRLF" : hasCR ? "CR" : "LF";

          // Detect encoding (check for UTF-8 BOM or assume UTF-8)
          const hasBOM = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
          const encoding = hasBOM ? "UTF-8 (BOM)" : "UTF-8";

          const lines = content.split(/\r\n|\r|\n/);
          const lineCount = lines.length;
          const charCount = content.length;

          return res.render("file.njk", {
            title: `FKZ File Index - ${config.mirrorTag} - ${baseName}`,
            fileName: baseName,
            lines,
            content,
            sizeFormatted: formatFileSize(stat.size),
            date: formatFileDate(stat.mtimeMs),
            currentPath: req.path,
            parentPath,
            encoding,
            lineEnding,
            lineCount,
            charCount,
            minFilesForNav: config.minFilesForNav,
            sha256,
            md5,
          });
        }

        const mediaCtx = {
          title: `FKZ File Index - ${config.mirrorTag} - ${baseName}`,
          fileName: baseName,
          sizeFormatted: formatFileSize(stat.size),
          date: formatFileDate(stat.mtimeMs),
          currentPath: req.path,
          sha256,
          md5,
          parentPath,
        };

        if (IMAGE_EXTENSIONS.has(ext)) {
          return res.render("file-image.njk", { ...mediaCtx, ext });
        }

        if (VIDEO_EXTENSIONS.has(ext)) {
          return res.render("file-video.njk", {
            ...mediaCtx,
            ext,
            mimeSubtype: VIDEO_EXTENSIONS.get(ext),
          });
        }

        if (AUDIO_EXTENSIONS.has(ext)) {
          return res.render("file-audio.njk", {
            ...mediaCtx,
            ext,
            mimeSubtype: AUDIO_EXTENSIONS.get(ext),
          });
        }

        const archiveType = getArchiveType(baseName);
        if (archiveType) {
          // Apply rate limiting to archive operations
          await new Promise((resolve, reject) => {
            archiveLimiter(req, res, (err) => (err ? reject(err) : resolve()));
          });
          if (res.headersSent) return;

          // View a specific file inside the archive
          const fileParam = req.query.file;
          if (fileParam) {
            try {
              const data = await extractFileFromArchive(realPath, fileParam);
              const entryName = sanitizeEntryName(fileParam);
              const entryExt = path
                .extname(entryName)
                .replace(/^\./, "")
                .toLowerCase();
              const entryBase = path.basename(entryName);

              // Raw download
              if (req.query.raw === "1") {
                const mime = {
                  jpg: "image/jpeg",
                  jpeg: "image/jpeg",
                  png: "image/png",
                  gif: "image/gif",
                  bmp: "image/bmp",
                  webp: "image/webp",
                  svg: "image/svg+xml",
                  ico: "image/x-icon",
                  avif: "image/avif",
                };
                res.set(
                  "Content-Type",
                  mime[entryExt] || "application/octet-stream",
                );
                res.set(
                  "Content-Disposition",
                  `attachment; filename*=UTF-8''${encodeURIComponent(entryBase)}`,
                );
                return res.send(data);
              }

              // Find entry metadata
              const entries = await listArchiveContents(realPath);
              const entryMeta = entries.find((e) => e.name === entryName) || {};

              const viewCtx = {
                title: `FKZ File Index - ${config.mirrorTag} - ${baseName} - ${entryBase}`,
                entryName,
                archiveName: baseName,
                archivePath: req.path,
                currentPath: req.path,
                ext: entryExt || "unknown",
                sizeFormatted: formatFileSize(entryMeta.size || data.length),
                date: entryMeta.date || "",
              };

              // Text preview
              if (
                TEXT_EXTENSIONS.has(entryExt) ||
                TEXT_EXTENSIONS.has(
                  entryBase.replace(/\.[^.]+$/, "").toLowerCase(),
                )
              ) {
                const content = data.toString("utf-8");
                const hasCRLF = content.includes("\r\n");
                const hasCR = !hasCRLF && content.includes("\r");
                const lines = content.split(/\r\n|\r|\n/);
                return res.render("file-archive-view.njk", {
                  ...viewCtx,
                  viewType: "text",
                  content,
                  lines,
                  lineCount: lines.length,
                  charCount: content.length,
                  encoding: "UTF-8",
                  lineEnding: hasCRLF ? "CRLF" : hasCR ? "CR" : "LF",
                });
              }

              // Image preview
              if (IMAGE_EXTENSIONS.has(entryExt)) {
                return res.render("file-archive-view.njk", {
                  ...viewCtx,
                  viewType: "image",
                });
              }

              // Unknown file type
              return res.render("file-archive-view.njk", {
                ...viewCtx,
                viewType: "unknown",
              });
            } catch {
              return res.status(404).render("error.njk", {
                status: "404",
                message:
                  "The requested file could not be found in the archive.",
              });
            }
          }

          // List archive contents
          try {
            const entries = await listArchiveContents(realPath);
            const {
              dirs,
              files: archiveFiles,
              totalSize: totalUncompressed,
            } = buildArchiveTree(entries);
            return res.render("file-archive.njk", {
              ...mediaCtx,
              archiveType,
              dirs,
              files: archiveFiles,
              fileCount: archiveFiles.length,
              dirCount: dirs.length,
              totalSizeFormatted: formatFileSize(totalUncompressed),
            });
          } catch {
            return res.render("file-archive.njk", {
              ...mediaCtx,
              archiveType,
              dirs: [],
              files: [],
              fileCount: 0,
              dirCount: 0,
              totalSizeFormatted: "0  B",
              error: "Could not read archive contents.",
            });
          }
        }

        return res.render("file-unknown.njk", {
          ...mediaCtx,
          ext: ext || "unknown",
        });
      }
    } catch {
      return res.status(404).render("error.njk", {
        status: "404",
        message: "The file or directory you're looking for doesn't exist.",
      });
    }

    // Redirect to trailing slash for directories
    if (!req.path.endsWith("/")) {
      return res.redirect(301, req.path + "/");
    }

    // Check for exclude marker
    const markerExists = await fs
      .access(path.join(realPath, config.excludeMarker))
      .then(
        () => true,
        () => false,
      );
    if (markerExists) {
      return res.status(403).render("error.njk", {
        status: "403",
        message: "You don't have permission to access this directory.",
      });
    }

    const { folders, files, filetypes } = await readDirectory(realPath);

    // Filetype filter via query param
    const filetype = req.query.type?.toLowerCase() || null;
    const displayFiles = filetype
      ? files.filter((f) => f.ext === filetype)
      : files;

    const totalSize = displayFiles.reduce((sum, f) => sum + f.size, 0);

    // Relative path for display (use logical path, not symlink target)
    const relativePath = path
      .relative(config.filesRoot, resolved)
      .replace(/\\/g, "/");
    const isRoot = relativePath === "";
    const dirName = isRoot ? "/" : `/${path.basename(resolved)}/`;

    // Mirror link
    const mirrorLink = isRoot
      ? config.mirrorUrl + "/"
      : `${config.mirrorUrl}/${relativePath}/`;

    const title =
      `FKZ File Index - ${config.mirrorTag} - ${dirName}` +
      (filetype ? ` - .${filetype.toUpperCase()}` : "");

    res.render("index.njk", {
      title,
      folders,
      files: displayFiles,
      filetypes,
      activeFiletype: filetype,
      totalSize: formatFileSize(totalSize),
      totalCount: displayFiles.length,
      folderCount: folders.length,
      isRoot,
      currentPath: req.path,
      mirrorName: config.mirrorName,
      mirrorLink,
      minFilesForNav: config.minFilesForNav,
      minFoldersForNav: config.minFoldersForNav,
    });
  } catch (err) {
    console.error(`Error serving ${req.path}:`, err);
    res.status(500).render("error.njk", {
      status: "500",
      message: "Internal server error",
    });
  }
});

const server = app.listen(config.port, () => {
  console.log(
    `FKZ File Index (${config.mirrorTag}) listening on http://localhost:${config.port}`,
  );
  console.log(`Serving files from: ${config.filesRoot}`);
});

function shutdown() {
  console.log("Shutting down gracefully...");
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
