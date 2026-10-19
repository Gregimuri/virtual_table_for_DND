'use strict';

const VTTPlay = (() => {
  const SIZES = {
    tiny: 0.5,
    small: 0.75,
    medium: 1,
    large: 2,
    huge: 3,
    gargantuan: 4,
  };

  function colsOf(grid) {
    return Math.max(2, Math.min(80, Number(grid && grid.cols) || 27));
  }

  function aspectOf(aspect) {
    const value = Number(aspect);
    return value > 0.05 ? value : 9 / 16;
  }

  function cleanStat(stat) {
    const src = stat && typeof stat === 'object' ? stat : {};
    return {
      ac: String(src.ac || '').slice(0, 40),
      attack: String(src.attack || '').slice(0, 180),
      trait: String(src.trait || '').slice(0, 500),
    };
  }

  function normalizeToken(token) {
    if (!token || typeof token !== 'object') return token;
    const sizes = Object.keys(SIZES);
    const modes = ['hidden', 'gm', 'table'];
    const hp = token.hp == null || token.hp === '' ? null : Math.max(0, Math.round(Number(token.hp) || 0));
    const hpMax = token.hpMax == null || token.hpMax === '' ? null : Math.max(0, Math.round(Number(token.hpMax) || 0));
    token.hidden = !!token.hidden;
    token.locked = !!token.locked;
    token.nameMode = modes.includes(token.nameMode) ? token.nameMode : 'hidden';
    token.hp = hp;
    token.hpMax = hpMax;
    token.hpPublic = !!token.hpPublic;
    token.size = sizes.includes(token.size) ? token.size : '';
    token.parentId = token.parentId || null;
    token.stat = cleanStat(token.stat);
    token.noteId = token.noteId || null;
    return token;
  }

  function scaleForSize(size, grid) {
    const cells = SIZES[size];
    if (!cells) return null;
    return Math.max(0.03, Math.min(1.5, cells / colsOf(grid)));
  }

  function snapPoint(x, y, grid, aspect) {
    if (!grid) return { x, y };
    if (grid.type === 'hex-pointy' || grid.type === 'hex-flat') {
      return snapHex(x, y, grid, aspectOf(aspect));
    }
    const cols = colsOf(grid);
    const ox = Number(grid.offsetX) || 0;
    const oy = Number(grid.offsetY) || 0;
    const rowAspect = aspectOf(aspect);
    const gy = y * cols * rowAspect - oy;
    return {
      x: (Math.floor(x * cols - ox) + 0.5 + ox) / cols,
      y: (Math.floor(gy) + 0.5 + oy) / (cols * rowAspect),
    };
  }

  function snapHex(x, y, grid, aspect) {
    const cols = colsOf(grid);
    const pointy = grid.type === 'hex-pointy';
    const size = pointy ? (1 / cols) / Math.sqrt(3) : (1 / cols) / 2;
    const horiz = pointy ? size * Math.sqrt(3) : size * 1.5;
    const vert = pointy ? size * 1.5 : size * Math.sqrt(3);
    const ox = ((Number(grid.offsetX) || 0) % 1 + 1) % 1;
    const oy = ((Number(grid.offsetY) || 0) % 1 + 1) % 1;
    const originX = ox * horiz - horiz;
    const originY = oy * vert - vert;
    const px = x;
    const py = y * aspect;
    let best = null;
    let bestD = Infinity;
    const colsN = Math.ceil(1 / horiz) + 4;
    const rowsN = Math.ceil(aspect / vert) + 4;
    for (let row = 0; row < rowsN; row += 1) {
      for (let col = 0; col < colsN; col += 1) {
        const cx = originX + col * horiz + (pointy && row % 2 ? horiz / 2 : 0);
        const cy = originY + row * vert + (!pointy && col % 2 ? vert / 2 : 0);
        const dist = (cx - px) ** 2 + (cy - py) ** 2;
        if (dist < bestD) {
          bestD = dist;
          best = { x: cx, y: cy / aspect };
        }
      }
    }
    return best || { x, y };
  }

  function cellsBetween(x1, y1, x2, y2, grid, aspect) {
    const cols = colsOf(grid);
    const dx = (x2 - x1) * cols;
    const dy = (y2 - y1) * cols * aspectOf(aspect);
    return Math.hypot(dx, dy);
  }

  function formatNum(value) {
    const rounded = Math.round(value * 10) / 10;
    return String(rounded).replace('.', ',');
  }

  function measureText(template, grid, aspect) {
    if (!template) return '';
    const span = cellsBetween(template.x, template.y, template.x2, template.y2, grid, aspect);
    if (template.kind === 'circle') return `круг ${formatNum(span)} кл.`;
    if (template.kind === 'cone') return `конус ${formatNum(span)} кл.`;
    if (template.kind === 'square') {
      const cols = colsOf(grid);
      const width = Math.abs(template.x2 - template.x) * cols;
      const height = Math.abs(template.y2 - template.y) * cols * aspectOf(aspect);
      return `${formatNum(width)}×${formatNum(height)} кл.`;
    }
    return `${formatNum(span)} кл.`;
  }

  function paintShapes(ctx, templates, options) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;
    (templates || []).forEach((template) => {
      if (!template) return;
      if (!options.gm && !template.shown) return;
      const x1 = template.x * width;
      const y1 = template.y * height;
      const x2 = template.x2 * width;
      const y2 = template.y2 * height;
      ctx.save();
      ctx.lineWidth = Math.max(2, width / 700);
      ctx.strokeStyle = template.shown ? '#f4efe4' : '#e0c088';
      ctx.fillStyle = template.shown ? 'rgba(244, 239, 228, 0.16)' : 'rgba(224, 192, 136, 0.14)';
      ctx.setLineDash(template.shown ? [] : [10, 7]);
      ctx.beginPath();
      if (template.kind === 'line') {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (template.kind === 'circle') {
        ctx.arc(x1, y1, Math.hypot(x2 - x1, y2 - y1), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (template.kind === 'square') {
        ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.fill();
        ctx.stroke();
      } else {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const len = Math.hypot(x2 - x1, y2 - y1);
        const spread = 26.5 * Math.PI / 180;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + len * Math.cos(angle - spread), y1 + len * Math.sin(angle - spread));
        ctx.lineTo(x1 + len * Math.cos(angle + spread), y1 + len * Math.sin(angle + spread));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      const label = measureText(template, options.grid, options.aspect);
      if (label) {
        ctx.setLineDash([]);
        ctx.font = `${Math.max(16, Math.round(width / 70))}px "Segoe UI", sans-serif`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#1a120c';
        ctx.fillStyle = '#f6f0e4';
        const lx = template.kind === 'circle' || template.kind === 'cone' ? x1 : (x1 + x2) / 2;
        const ly = template.kind === 'circle' || template.kind === 'cone' ? y1 : (y1 + y2) / 2;
        ctx.strokeText(label, lx + 8, ly - 8);
        ctx.fillText(label, lx + 8, ly - 8);
      }
      ctx.restore();
    });
  }

  function syncChrome(el, token, mode) {
    let name = el.querySelector('.token-name');
    if (!name) {
      name = document.createElement('div');
      name.className = 'token-name';
      el.appendChild(name);
    }
    const showName = mode === 'table'
      ? token.nameMode === 'table'
      : token.nameMode === 'gm' || token.nameMode === 'table';
    name.hidden = !showName || !(token.name || '').trim();
    name.textContent = token.name || '';
    let hp = el.querySelector('.token-hp');
    if (!hp) {
      hp = document.createElement('div');
      hp.className = 'token-hp';
      hp.appendChild(document.createElement('span'));
      el.appendChild(hp);
    }
    const max = Number(token.hpMax);
    const value = Number(token.hp);
    const showHp = max > 0 && token.hp != null && (mode === 'gm' || token.hpPublic);
    hp.hidden = !showHp;
    if (!showHp) return;
    const pct = Math.max(0, Math.min(1, value / max));
    hp.dataset.band = pct > 0.5 ? 'ok' : pct > 0.25 ? 'mid' : 'low';
    hp.querySelector('span').style.width = `${pct * 100}%`;
  }

  function placeRing(layer, token) {
    if (!layer) return;
    layer.querySelectorAll('.turn-ring').forEach((el) => el.remove());
    if (!token) return;
    const ring = document.createElement('div');
    ring.className = 'turn-ring';
    ring.style.left = `${token.x * 100}%`;
    ring.style.top = `${token.y * 100}%`;
    ring.style.width = `${Math.max(0.03, Number(token.scale) || 0.1) * 100}%`;
    layer.appendChild(ring);
  }

  function normalizeInitiative(value) {
    const items = Array.isArray(value && value.items) ? value.items : [];
    const clean = items.filter((item) => item && item.id).slice(0, 40).map((item) => ({
      id: item.id,
      name: String(item.name || 'Ход').slice(0, 80),
      tokenId: item.tokenId || null,
      secret: !!item.secret,
    }));
    let index = Math.round(Number(value && value.index) || 0);
    if (!clean.length) index = 0;
    else index = Math.max(0, Math.min(clean.length - 1, index));
    return { items: clean, index };
  }

  function normalizeCard(card) {
    if (!card || typeof card !== 'object') return null;
    const text = String(card.text || '').slice(0, 2000);
    if (!text.trim()) return null;
    return { title: String(card.title || '').slice(0, 80), text };
  }

  return {
    SIZES,
    colsOf,
    cleanStat,
    normalizeToken,
    scaleForSize,
    snapPoint,
    measureText,
    paintShapes,
    syncChrome,
    placeRing,
    normalizeInitiative,
    normalizeCard,
  };
})();
