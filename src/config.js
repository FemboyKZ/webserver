import path from "path";

const MIRRORS = {
  na: {
    mirrorName: "EU site",
    mirrorTag: "NA",
    mirrorUrl: "https://files.femboy.kz",
  },
  eu: {
    mirrorName: "NA Site",
    mirrorTag: "EU",
    mirrorUrl: "https://files-na.femboy.kz",
  },
};

const site = process.argv[2]?.toLowerCase();
if (!site || !MIRRORS[site]) {
  console.error("Usage: node src/app.js <eu|na> [files_root]");
  console.error(
    "Valid options: 'eu' for European mirror, 'na' for North American mirror",
  );
  process.exit(1);
}

const FILES_ROOT = path.resolve(process.argv[3] || ".");
const PORT = parseInt(process.env.PORT, 10) || 3000;

const DISCORD_INVITE = "https://discord.gg/fkz";
const REPO_URL = "https://github.com/FemboyKZ/webserver";

export default {
  ...MIRRORS[site],
  filesRoot: FILES_ROOT,
  port: PORT,
  discordInvite: DISCORD_INVITE,
  repoUrl: REPO_URL,
  excludeMarker: "EXCLUDE_FOLDER",
  ignoredFiletypes: new Set([
    "html",
    "php",
    "py",
    "sh",
    "js",
    "css",
    "htaccess",
    "tmp",
    "stignore",
  ]),
  minFilesForNav: 20,
  minFoldersForNav: 30,
};
