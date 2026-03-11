function populateMediaInfo(mediaEl) {
  const container = mediaEl.closest(".player");
  const infoContainer = container?.parentElement;

  // Duration
  const durationEl = document.getElementById("mediaDuration");
  if (durationEl && mediaEl.duration && isFinite(mediaEl.duration)) {
    const d = mediaEl.duration;
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor(d % 60);
    const pad = (n) => String(n).padStart(2, "0");
    const formatted = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    durationEl.textContent = "Duration: " + formatted;
  }

  // Video-specific: resolution + framerate
  if (mediaEl.tagName === "VIDEO") {
    const resEl = document.getElementById("mediaRes");
    if (resEl && mediaEl.videoWidth) {
      resEl.textContent =
        "Resolution: " + mediaEl.videoWidth + " \u00d7 " + mediaEl.videoHeight;
    }

    // Detect framerate via requestVideoFrameCallback
    const fpsEl = document.getElementById("mediaFps");
    if (fpsEl && "requestVideoFrameCallback" in mediaEl) {
      let firstTime = null;
      let frameCount = 0;
      const TARGET_FRAMES = 10;

      function onFrame(now, metadata) {
        if (firstTime === null) {
          firstTime = metadata.mediaTime;
        }
        frameCount++;
        if (frameCount >= TARGET_FRAMES) {
          const elapsed = metadata.mediaTime - firstTime;
          if (elapsed > 0) {
            const fps = Math.round((frameCount - 1) / elapsed);
            fpsEl.textContent = "Framerate: " + fps + " fps";
          }
          // Pause and reset if we started playback just for detection
          if (mediaEl._fpsDetectionAutoPlayed) {
            mediaEl.pause();
            mediaEl.currentTime = 0;
            delete mediaEl._fpsDetectionAutoPlayed;
          }
        } else {
          mediaEl.requestVideoFrameCallback(onFrame);
        }
      }

      // Start detecting once the user plays, or do a silent probe
      if (!mediaEl.paused) {
        mediaEl.requestVideoFrameCallback(onFrame);
      } else {
        mediaEl.addEventListener(
          "play",
          () => {
            if (!fpsEl.textContent) {
              mediaEl.requestVideoFrameCallback(onFrame);
            }
          },
          { once: true },
        );
      }
    }
  }

  // Audio-specific: channels + sample rate via AudioContext
  if (mediaEl.tagName === "AUDIO") {
    const channelsEl = document.getElementById("mediaChannels");
    const sampleRateEl = document.getElementById("mediaSampleRate");
    if (channelsEl || sampleRateEl) {
      try {
        const audioCtx = new (window.AudioContext ||
          window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(mediaEl);
        source.connect(audioCtx.destination);
        if (channelsEl) {
          const ch = source.channelCount;
          const label =
            ch === 1 ? "Mono" : ch === 2 ? "Stereo" : ch + " channels";
          channelsEl.textContent = "Channels: " + label;
        }
        if (sampleRateEl) {
          sampleRateEl.textContent =
            "Sample Rate: " + audioCtx.sampleRate + " Hz";
        }
      } catch {
        // AudioContext not available or already connected
      }
    }
  }
}

function initPlayer(mediaEl) {
  const container = mediaEl.closest(".player");
  const playBtn = container.querySelector(".player-play");
  const muteBtn = container.querySelector(".player-mute");
  const volumeBar = container.querySelector(".player-volume");
  const progress = container.querySelector(".player-progress");
  const progressFill = container.querySelector(".player-progress-fill");
  const progressBuffer = container.querySelector(".player-progress-buffer");
  const timeCurrent = container.querySelector(".player-time-current");
  const timeDuration = container.querySelector(".player-time-duration");
  const fullscreenBtn = container.querySelector(".player-fullscreen");

  function formatTime(s) {
    if (isNaN(s)) return "0:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  function setIcon(btn, name) {
    btn.innerHTML = '<i data-lucide="' + name + '"></i>';
    if (window.lucide) lucide.createIcons({ nodes: [btn] });
  }

  playBtn.addEventListener("click", () => {
    if (mediaEl.paused) {
      mediaEl.play();
    } else {
      mediaEl.pause();
    }
  });

  mediaEl.addEventListener("play", () => {
    setIcon(playBtn, "pause");
  });
  mediaEl.addEventListener("pause", () => {
    setIcon(playBtn, "play");
  });

  mediaEl.addEventListener("loadedmetadata", () => {
    timeDuration.textContent = formatTime(mediaEl.duration);
    if (volumeBar) volumeBar.value = mediaEl.volume;
    populateMediaInfo(mediaEl);
  });

  mediaEl.addEventListener("timeupdate", () => {
    if (mediaEl.duration) {
      const pct = (mediaEl.currentTime / mediaEl.duration) * 100;
      progressFill.style.width = pct + "%";
      timeCurrent.textContent = formatTime(mediaEl.currentTime);
    }
  });

  mediaEl.addEventListener("progress", () => {
    if (mediaEl.buffered.length > 0 && mediaEl.duration) {
      const buffEnd = mediaEl.buffered.end(mediaEl.buffered.length - 1);
      const pct = (buffEnd / mediaEl.duration) * 100;
      progressBuffer.style.width = pct + "%";
    }
  });

  progress.addEventListener("click", (e) => {
    const rect = progress.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    mediaEl.currentTime = pct * mediaEl.duration;
  });

  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      mediaEl.muted = !mediaEl.muted;
      setIcon(muteBtn, mediaEl.muted ? "volume-x" : "volume-2");
    });
  }

  if (volumeBar) {
    volumeBar.addEventListener("input", () => {
      mediaEl.volume = volumeBar.value;
      mediaEl.muted = false;
      if (muteBtn) setIcon(muteBtn, "volume-2");
    });
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
    });
  }

  // Click video to play/pause
  if (mediaEl.tagName === "VIDEO") {
    mediaEl.addEventListener("click", () => {
      if (mediaEl.paused) {
        mediaEl.play();
      } else {
        mediaEl.pause();
      }
    });
  }

  mediaEl.addEventListener("ended", () => {
    playBtn.textContent = "\u25B6";
  });

  // Fullscreen auto-hide controls
  let hideTimeout = null;
  const HIDE_DELAY = 2000;

  function showControls() {
    container.classList.remove("controls-hidden");
    container.style.cursor = "";
    clearTimeout(hideTimeout);
    if (document.fullscreenElement === container && !mediaEl.paused) {
      hideTimeout = setTimeout(hideControls, HIDE_DELAY);
    }
  }

  function hideControls() {
    if (document.fullscreenElement === container) {
      container.classList.add("controls-hidden");
      container.style.cursor = "none";
    }
  }

  container.addEventListener("mousemove", showControls);
  container.addEventListener("mouseleave", () => {
    if (document.fullscreenElement === container && !mediaEl.paused) {
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(hideControls, 500);
    }
  });

  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement === container) {
      showControls();
    } else {
      clearTimeout(hideTimeout);
      container.classList.remove("controls-hidden");
      container.style.cursor = "";
    }
  });

  mediaEl.addEventListener("pause", () => {
    clearTimeout(hideTimeout);
    showControls();
  });

  mediaEl.addEventListener("play", () => {
    if (document.fullscreenElement === container) {
      hideTimeout = setTimeout(hideControls, HIDE_DELAY);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".player").forEach((p) => {
    const media = p.querySelector("video, audio");
    if (media) initPlayer(media);
  });
});
