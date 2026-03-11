import express from "express";
import nunjucks from "nunjucks";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import config from "./config.js";
import { readDirectory, formatFileSize, formatFileDate } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "log", "cfg", "conf", "ini", "yml", "yaml",
  "toml", "json", "xml", "csv", "tsv", "env", "gitignore",
  "dockerfile", "makefile", "rst", "tex", "bat", "cmd",
]);

const app = express();

// Nunjucks setup
const env = nunjucks.configure(path.join(__dirname, "..", "views"), {
  autoescape: true,
  express: app,
});

// Serve static assets (CSS/JS) from /static/
app.use("/static", express.static(path.join(__dirname, "..", "public")));

// Main browse route — handles all paths
app.get("/{*splat}", async (req, res) => {
  try {
    // Decode and normalize the requested path
    const reqPath = decodeURIComponent(req.path);
    const dirPath = path.join(config.filesRoot, reqPath);
    const resolved = path.resolve(dirPath);

    // Path traversal protection (pre-symlink check)
    if (!resolved.startsWith(config.filesRoot)) {
      return res.status(403).send("Forbidden");
    }

    // Resolve symlinks and check the real path exists
    let realPath;
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      return res.status(404).send("Not found");
    }

    // Check if path is a file — preview or serve
    try {
      const stat = fs.statSync(realPath);
      if (stat.isFile()) {
        // Raw download via ?raw=1 or non-browser clients (wget, curl, etc.)
        const acceptsHtml = req.accepts("html");
        if (req.query.raw === "1" || !acceptsHtml) {
          return res.sendFile(realPath);
        }

        const ext = path.extname(realPath).replace(/^\./, "").toLowerCase();
        const baseName = path.basename(realPath);
        const nameNoExt = baseName.replace(/\.[^.]+$/, "").toLowerCase();

        if (TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(nameNoExt)) {
          const raw = fs.readFileSync(realPath);
          const content = raw.toString("utf-8");
          const parentPath = req.path.replace(/\/[^\/]*$/, "/") || "/";

          // Detect line ending type
          const hasCRLF = content.includes("\r\n");
          const hasCR = !hasCRLF && content.includes("\r");
          const lineEnding = hasCRLF ? "CRLF" : hasCR ? "CR" : "LF";

          // Detect encoding (check for UTF-8 BOM or assume UTF-8)
          const hasBOM = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
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
          });
        }

        const parentPath = req.path.replace(/\/[^\/]*$/, "/") || "/";
        return res.render("file-unknown.njk", {
          title: `FKZ File Index - ${config.mirrorTag} - ${baseName}`,
          fileName: baseName,
          ext: ext || "unknown",
          sizeFormatted: formatFileSize(stat.size),
          date: formatFileDate(stat.mtimeMs),
          currentPath: req.path,
          parentPath,
        });
      }
    } catch {
      return res.status(404).send("Not found");
    }

    // Redirect to trailing slash for directories
    if (!req.path.endsWith("/")) {
      return res.redirect(301, req.path + "/");
    }

    // Check for exclude marker
    if (fs.existsSync(path.join(realPath, config.excludeMarker))) {
      return res.status(403).send("Forbidden");
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
    res.status(500).send("Internal server error");
  }
});

app.listen(config.port, () => {
  console.log(
    `FKZ File Index (${config.mirrorTag}) listening on http://localhost:${config.port}`,
  );
  console.log(`Serving files from: ${config.filesRoot}`);
});
