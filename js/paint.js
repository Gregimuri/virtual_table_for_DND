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
    applyTokenStyle,
    roundPoint,
  };
})();
