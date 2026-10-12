'use strict';

(function (root) {
  const MAP_BYTES = 40 * 1024 * 1024;

  function fileKind(file) {
    const type = String(file && file.type || '').toLowerCase();
    const name = String(file && file.name || '').toLowerCase();
    if (type.startsWith('video/') || /\.(mp4|webm|ogg|ogv|mov|m4v)$/.test(name)) return 'video';
    if (type.startsWith('image/') || /\.(png|apng|jpe?g|gif|webp|bmp|svg|avif)$/.test(name)) return 'image';
    return '';
  }

  function mapIsVideo(map) {
    if (!map) return false;
    if (map.kind === 'video') return true;
    return String(map.blob && map.blob.type || '').toLowerCase().startsWith('video/');
  }

  function mediaSize(el) {
    if (!el || el.hidden) return null;
    if (el.tagName === 'VIDEO') return el.videoWidth ? { w: el.videoWidth, h: el.videoHeight } : null;
    return el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null;
  }

  function stopVideo(video) {
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
  }

  function applyPlayback(video, scene) {
    if (!video || video.hidden || !video.getAttribute('src')) return;
    video.muted = !(scene && scene.mapSound);
    if (scene && scene.mapPaused) video.pause();
    else video.play().catch(() => {});
  }

  function bindPoster(video, url) {
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.autoplay = false;
    video.loop = false;
    video.onloadeddata = () => {
      if (video.duration > 0.2 && video.currentTime < 0.05) {
        try { video.currentTime = Math.min(0.1, video.duration / 2); } catch (error) { /* кадр ещё не готов */ }
      }
      video.pause();
    };
    video.src = url;
  }

  root.VTTMedia = {
    MAP_BYTES,
    fileKind,
    mapIsVideo,
    mediaSize,
    stopVideo,
    applyPlayback,
    bindPoster,
  };
})(window);
