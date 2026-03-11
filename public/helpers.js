function copyFileContent() {
  const cells = document.querySelectorAll(".line-text");
  const text = Array.from(cells)
    .map((c) => c.textContent)
    .join("\n");
  navigator.clipboard.writeText(text).then(
    () => {
      const btn = document.getElementById("copy-btn");
      const original = btn.textContent;
      btn.textContent = "[Copied!]";
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    },
    () => {
      const btn = document.getElementById("copy-btn");
      btn.textContent = "[Failed]";
      setTimeout(() => {
        btn.textContent = "[Copy Text]";
      }, 1500);
    },
  );
}

function initImageResolution() {
  const img = document.querySelector(".media-preview");
  if (!img || img.tagName !== "IMG") return;
  function updateInfo() {
    if (img.naturalWidth) {
      const el = document.getElementById("mediaRes");
      if (el) {
        el.textContent =
          "Resolution: " + img.naturalWidth + " \u00d7 " + img.naturalHeight;
      }
    }
  }
  if (img.complete) updateInfo();
  else img.addEventListener("load", updateInfo);
}
