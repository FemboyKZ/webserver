const express = require("express");
const nunjucks = require("nunjucks");
const path = require("path");
const fs = require("fs");
const config = require("./config");
const { readDirectory, formatFileSize } = require("./utils");

const app = express();

// Nunjucks setup
const env = nunjucks.configure(path.join(__dirname, "..", "views"), {
  autoescape: true,
  express: app,
});

// Serve static assets (CSS/JS) from /static/
app.use("/static", express.static(path.join(__dirname, "..", "public")));

// Main browse route — handles all paths
app.get("/*", async (req, res) => {
  try {
    // Decode and normalize the requested path
    const reqPath = decodeURIComponent(req.path);
    const dirPath = path.join(config.filesRoot, reqPath);
    const resolved = path.resolve(dirPath);

    // Path traversal protection
    if (!resolved.startsWith(config.filesRoot)) {
      return res.status(403).send("Forbidden");
    }

    // Check if path is a file — serve it directly
    try {
      const stat = fs.statSync(resolved);
      if (stat.isFile()) {
        return res.sendFile(resolved);
      }
    } catch {
      return res.status(404).send("Not found");
    }

    // Redirect to trailing slash for directories
    if (!req.path.endsWith("/")) {
      return res.redirect(301, req.path + "/");
    }

    // Check for exclude marker
    if (fs.existsSync(path.join(resolved, config.excludeMarker))) {
      return res.status(403).send("Forbidden");
    }

    const { folders, files, filetypes } = await readDirectory(resolved);

    // Filetype filter via query param
    const filetype = req.query.type?.toLowerCase() || null;
    const displayFiles = filetype
      ? files.filter((f) => f.ext === filetype)
      : files;

    const totalSize = displayFiles.reduce((sum, f) => sum + f.size, 0);

    // Relative path for display
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
