'use strict';

const VTTPaint = (() => {
  function contain(boxW, boxH, imgW, imgH) {
    if (!boxW || !boxH || !imgW || !imgH) return { w: 0, h: 0 };
    const scale = Math.min(boxW / imgW, boxH / imgH);
    return {
      w: Math.max(1, Math.round(imgW * scale)),
      h: Math.max(1, Math.round(imgH * scale)),
    };
  }

  function canvasSize(width, height, maxEdge) {
    const edge = Math.max(width, height);
    const scale = edge > maxEdge ? maxEdge / edge : 1;
    return {
      w: Math.max(1, Math.round(width * scale)),
      h: Math.max(1, Math.round(height * scale)),
    };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image'));
      image.src = url;
    });
  }

  function drawSegment(ctx, x0, y0, x1, y1, size, color, erase) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const sizePx = Math.max(0.75, size * width);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = sizePx;
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color || '#000000';
      ctx.fillStyle = color || '#000000';
    }
    if (x0 == null) {
      ctx.beginPath();
      ctx.arc(x1 * width, y1 * height, sizePx / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x0 * width, y0 * height);
      ctx.lineTo(x1 * width, y1 * height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function paintStroke(ctx, stroke) {
    const points = stroke.points || [];
    if (!points.length) return;
    if (points.length === 1) {
      drawSegment(ctx, null, null, points[0][0], points[0][1], stroke.size, stroke.color, stroke.erase);
      return;
    }
    for (let i = 1; i < points.length; i += 1) {
      drawSegment(
        ctx,
        points[i - 1][0],
        points[i - 1][1],
        points[i][0],
        points[i][1],
        stroke.size,
        stroke.color,
        stroke.erase
      );
    }
  }

  function replayDraw(ctx, strokes) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    (strokes || []).forEach((stroke) => paintStroke(ctx, stroke));
  }

  function replayFog(ctx, ops) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    (ops || []).forEach((op) => {
      if (op.op === 'fill') {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
        return;
      }
      if (op.op === 'stroke') {
        paintStroke(ctx, {
          points: op.points,
          size: op.size,
          color: '#000000',
          erase: !!op.erase,
        });
      }
    });
  }

  function keyLight(imageData, threshold) {
    const data = imageData.data;
    const limit = Number(threshold);
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (!alpha) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luminance < limit || saturation > 0.28) continue;
      const fade = Math.min(1, (luminance - limit) / Math.max(1, 255 - limit));
      data[i + 3] = Math.round(alpha * (1 - fade * fade));
    }
  }

  function drawGrid(ctx, grid) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    if (!grid || !grid.enabled || !width || !height) {
      ctx.restore();
      return;
    }
    const cols = Math.max(2, Math.min(80, Number(grid.cols) || 20));
    const offsetX = ((Number(grid.offsetX) || 0) % 1 + 1) % 1;
    const offsetY = ((Number(grid.offsetY) || 0) % 1 + 1) % 1;
    ctx.globalAlpha = Math.max(0.08, Math.min(1, Number(grid.opacity) || 0.5));
    ctx.strokeStyle = grid.color || '#e0c088';
    ctx.lineWidth = Math.max(1, width / 900);
    if (grid.type === 'hex-pointy' || grid.type === 'hex-flat') {
      drawHexGrid(ctx, width, height, cols, offsetX, offsetY, grid.type === 'hex-pointy');
    } else {
      drawSquareGrid(ctx, width, height, cols, offsetX, offsetY, Number(grid.major) || 0);
    }
    ctx.restore();
  }

  function drawSquareGrid(ctx, width, height, cols, offsetX, offsetY, major) {
    const cell = width / cols;
    const startX = offsetX * cell;
    const startY = offsetY * cell;
    const thin = ctx.lineWidth;
    for (let i = -1; i < cols + 2; i += 1) {
      const x = startX + i * cell;
      if (x < -1 || x > width + 1) continue;
      ctx.lineWidth = major && i % major === 0 ? thin * 2.4 : thin;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    const rows = Math.ceil(height / cell) + 2;
    for (let i = -1; i < rows; i += 1) {
      const y = startY + i * cell;
      if (y < -1 || y > height + 1) continue;
      ctx.lineWidth = major && i % major === 0 ? thin * 2.4 : thin;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  function drawHexGrid(ctx, width, height, cols, offsetX, offsetY, pointy) {
    const size = pointy ? (width / cols) / Math.sqrt(3) : (width / cols) / 2;
    const horiz = pointy ? size * Math.sqrt(3) : size * 1.5;
    const vert = pointy ? size * 1.5 : size * Math.sqrt(3);
    const originX = offsetX * horiz - horiz;
    const originY = offsetY * vert - vert;
    const colsN = Math.ceil(width / horiz) + 4;
    const rowsN = Math.ceil(height / vert) + 4;
    for (let row = 0; row < rowsN; row += 1) {
      for (let col = 0; col < colsN; col += 1) {
        const cx = originX + col * horiz + (pointy && row % 2 ? horiz / 2 : 0);
        const cy = originY + row * vert + (!pointy && col % 2 ? vert / 2 : 0);
        if (cx < -size * 2 || cy < -size * 2 || cx > width + size * 2 || cy > height + size * 2) continue;
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const angle = (Math.PI / 3) * i + (pointy ? Math.PI / 6 : 0);
          const x = cx + size * Math.cos(angle);
          const y = cy + size * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  function parseHex(color) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
    if (!match) return null;
    const value = parseInt(match[1], 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function keyColor(imageData, color, tolerance) {
    const rgb = parseHex(color);
    if (!rgb) return;
    const tol = Math.max(0, Math.min(160, Number(tolerance) || 0));
    const data = imageData.data;
    const hard = tol * 0.72;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (!alpha) continue;
      const dist = Math.hypot(data[i] - rgb.r, data[i + 1] - rgb.g, data[i + 2] - rgb.b);
      if (dist > tol) continue;
      if (dist <= hard) {
        data[i + 3] = 0;
        continue;
      }
      const fade = (dist - hard) / Math.max(1, tol - hard);
      data[i + 3] = Math.round(alpha * fade);
    }
  }

  async function cutBlob(blob, cut) {
    if (!blob || !cut || !cut.color) return blob;
    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, image.naturalWidth);
      canvas.height = Math.max(1, image.naturalHeight);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      keyColor(imageData, cut.color, cut.tolerance);
      ctx.putImageData(imageData, 0, 0);
      const next = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return next || blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function applyTokenStyle(el, token) {
    el.style.left = `${token.x * 100}%`;
    el.style.top = `${token.y * 100}%`;
    el.style.width = `${token.scale * 100}%`;
    el.style.zIndex = String(token.z || 1);
    el.style.transform = `translate(-50%, -50%) rotate(${token.rotation || 0}deg)`;
  }

  function roundPoint(value) {
    return Math.round(value * 100000) / 100000;
  }

  return {
    contain,
    canvasSize,
    loadImage,
    drawSegment,
    replayDraw,
    replayFog,
    keyLight,
    keyColor,
    cutBlob,
    drawGrid,
    applyTokenStyle,
    roundPoint,
  };
})();
