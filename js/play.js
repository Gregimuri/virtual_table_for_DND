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

  const FLOOR_COLORS = {
    stone: '#5c6b62',
    wood: '#7a5534',
    water: '#2c5c78',
    void: '#141816',
  };
  const WALL_KINDS = ['wall', 'door', 'secret', 'window', 'grate'];
  const PROP_KINDS = ['column', 'stairs', 'table', 'chest', 'pit'];

  function metrics(grid, aspect) {
    const cols = colsOf(grid);
    const ratio = aspectOf(aspect);
    return {
      cols,
      rows: Math.max(1, Math.ceil(cols * ratio - 1e-6)),
      ratio,
      ox: Number(grid && grid.offsetX) || 0,
      oy: Number(grid && grid.offsetY) || 0,
    };
  }

  function toCell(x, y, grid, aspect) {
    const m = metrics(grid, aspect);
    return { cx: x * m.cols - m.ox, cy: y * m.cols * m.ratio - m.oy };
  }

  function fromCell(cx, cy, grid, aspect) {
    const m = metrics(grid, aspect);
    return { x: (cx + m.ox) / m.cols, y: (cy + m.oy) / (m.cols * m.ratio) };
  }

  function snapCorner(x, y, grid, aspect) {
    const cell = toCell(x, y, grid, aspect);
    return fromCell(Math.round(cell.cx), Math.round(cell.cy), grid, aspect);
  }

  function lockAxis(start, end) {
    if (Math.abs(end.cx - start.cx) >= Math.abs(end.cy - start.cy)) return { cx: end.cx, cy: start.cy };
    return { cx: start.cx, cy: end.cy };
  }

  function numUnit(value) {
    return Math.max(-0.5, Math.min(1.5, Number(value) || 0));
  }

  function blocksSight(wall) {
    if (!wall) return false;
    if (wall.kind === 'window' || wall.kind === 'grate') return false;
    if (wall.kind === 'door' || wall.kind === 'secret') return !wall.open;
    return true;
  }

  function blocksMove(wall) {
    if (!wall) return false;
    if (wall.kind === 'door' || wall.kind === 'secret') return !wall.open;
    return true;
  }

  function normalizeWall(wall) {
    if (!wall || !wall.id || !WALL_KINDS.includes(wall.kind)) return null;
    return {
      id: wall.id,
      mapId: wall.mapId || null,
      roomId: wall.roomId || null,
      groupId: wall.groupId || null,
      kind: wall.kind,
      open: !!wall.open,
      x: numUnit(wall.x),
      y: numUnit(wall.y),
      x2: numUnit(wall.x2),
      y2: numUnit(wall.y2),
    };
  }

  function normalizeFloor(floor) {
    const kinds = Object.keys(FLOOR_COLORS);
    if (!floor || !floor.id || !kinds.includes(floor.kind)) return null;
    const cells = Array.isArray(floor.cells) ? floor.cells.filter((cell) => Array.isArray(cell) && cell.length >= 2).slice(0, 2500) : [];
    if (!cells.length) return null;
    return {
      id: floor.id,
      mapId: floor.mapId || null,
      roomId: floor.roomId || null,
      kind: floor.kind,
      cells: cells.map((cell) => [Math.round(Number(cell[0]) || 0), Math.round(Number(cell[1]) || 0)]),
    };
  }

  function normalizeProp(prop) {
    if (!prop || !prop.id || !PROP_KINDS.includes(prop.kind)) return null;
    return {
      id: prop.id,
      mapId: prop.mapId || null,
      kind: prop.kind,
      x: numUnit(prop.x),
      y: numUnit(prop.y),
    };
  }

  function normalizePlan(scene) {
    scene.walls = (Array.isArray(scene.walls) ? scene.walls : []).map(normalizeWall).filter(Boolean).slice(0, 500);
    scene.floors = (Array.isArray(scene.floors) ? scene.floors : []).map(normalizeFloor).filter(Boolean).slice(0, 120);
    scene.props = (Array.isArray(scene.props) ? scene.props : []).map(normalizeProp).filter(Boolean).slice(0, 240);
    return scene;
  }

  function markEdges(set, a, b) {
    const steps = Math.max(2, Math.ceil(Math.hypot(b.cx - a.cx, b.cy - a.cy) * 8));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const cx = a.cx + (b.cx - a.cx) * t;
      const cy = a.cy + (b.cy - a.cy) * t;
      if (Math.abs(cy - Math.round(cy)) < 0.16) {
        const along = cx - Math.floor(cx);
        if (along > 0.04 && along < 0.96) set.add(`h:${Math.floor(cx)}:${Math.round(cy)}`);
      }
      if (Math.abs(cx - Math.round(cx)) < 0.16) {
        const along = cy - Math.floor(cy);
        if (along > 0.04 && along < 0.96) set.add(`v:${Math.round(cx)}:${Math.floor(cy)}`);
      }
    }
  }

  function edgeSet(walls, grid, aspect, test) {
    const set = new Set();
    (walls || []).forEach((wall) => {
      if (!test(wall)) return;
      markEdges(set, toCell(wall.x, wall.y, grid, aspect), toCell(wall.x2, wall.y2, grid, aspect));
    });
    return set;
  }

  function edgeBlocked(set, i, j, dir) {
    if (dir === 'e') return set.has(`v:${i + 1}:${j}`);
    if (dir === 'w') return set.has(`v:${i}:${j}`);
    if (dir === 's') return set.has(`h:${i}:${j + 1}`);
    return set.has(`h:${i}:${j}`);
  }

  function floodRoom(x, y, walls, grid, aspect) {
    const m = metrics(grid, aspect);
    const cell = toCell(x, y, grid, aspect);
    const startI = Math.floor(cell.cx);
    const startJ = Math.floor(cell.cy);
    if (startI < 0 || startJ < 0 || startI >= m.cols || startJ >= m.rows) return { closed: false, cells: [] };
    const blocked = edgeSet(walls, grid, aspect, blocksMove);
    const seen = new Set([`${startI}:${startJ}`]);
    const queue = [[startI, startJ]];
    const cells = [];
    const dirs = [['e', 1, 0], ['w', -1, 0], ['s', 0, 1], ['n', 0, -1]];
    while (queue.length) {
      const [i, j] = queue.shift();
      if (i < 0 || j < 0 || i >= m.cols || j >= m.rows) return { closed: false, cells: [] };
      cells.push([i, j]);
      if (cells.length > 2000) return { closed: false, cells: [] };
      dirs.forEach(([dir, di, dj]) => {
        if (edgeBlocked(blocked, i, j, dir)) return;
        const key = `${i + di}:${j + dj}`;
        if (seen.has(key)) return;
        seen.add(key);
        queue.push([i + di, j + dj]);
      });
    }
    return { closed: true, cells };
  }

  function segmentHit(a, b, c, d) {
    const rx = b.cx - a.cx;
    const ry = b.cy - a.cy;
    const sx = d.cx - c.cx;
    const sy = d.cy - c.cy;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) return null;
    const qpx = c.cx - a.cx;
    const qpy = c.cy - a.cy;
    const t = (qpx * sy - qpy * sx) / den;
    const u = (qpx * ry - qpy * rx) / den;
    if (t > 0.02 && t < 0.98 && u >= 0 && u <= 1) return t;
    return null;
  }

  function clampTravel(x, y, x2, y2, walls, grid, aspect) {
    const a = toCell(x, y, grid, aspect);
    const b = toCell(x2, y2, grid, aspect);
    let best = 1;
    (walls || []).forEach((wall) => {
      if (!blocksMove(wall)) return;
      const hit = segmentHit(a, b, toCell(wall.x, wall.y, grid, aspect), toCell(wall.x2, wall.y2, grid, aspect));
      if (hit != null && hit < best) best = hit;
    });
    if (best >= 1) return { x: x2, y: y2 };
    const t = Math.max(0, best - 0.04);
    return fromCell(a.cx + (b.cx - a.cx) * t, a.cy + (b.cy - a.cy) * t, grid, aspect);
  }

  function rayHit(origin, angle, segments) {
    const ray = { x: Math.cos(angle), y: Math.sin(angle) };
    let best = null;
    segments.forEach((seg) => {
      const sx = seg.b.cx - seg.a.cx;
      const sy = seg.b.cy - seg.a.cy;
      const den = ray.x * sy - ray.y * sx;
      if (Math.abs(den) < 1e-9) return;
      const qpx = seg.a.cx - origin.cx;
      const qpy = seg.a.cy - origin.cy;
      const t = (qpx * sy - qpy * sx) / den;
      const u = (qpx * ray.y - qpy * ray.x) / den;
      if (t > 0.02 && u >= 0 && u <= 1 && (!best || t < best.t)) {
        best = { t, cx: origin.cx + ray.x * t, cy: origin.cy + ray.y * t };
      }
    });
    return best;
  }

  function visionPolygon(x, y, walls, grid, aspect) {
    const m = metrics(grid, aspect);
    const origin = toCell(x, y, grid, aspect);
    const bounds = [
      [{ cx: -1, cy: -1 }, { cx: m.cols + 1, cy: -1 }],
      [{ cx: m.cols + 1, cy: -1 }, { cx: m.cols + 1, cy: m.rows + 1 }],
      [{ cx: m.cols + 1, cy: m.rows + 1 }, { cx: -1, cy: m.rows + 1 }],
      [{ cx: -1, cy: m.rows + 1 }, { cx: -1, cy: -1 }],
    ];
    const segments = bounds.map(([a, b]) => ({ a, b }));
    (walls || []).forEach((wall) => {
      if (!blocksSight(wall)) return;
      segments.push({
        a: toCell(wall.x, wall.y, grid, aspect),
        b: toCell(wall.x2, wall.y2, grid, aspect),
      });
    });
    const angles = [];
    segments.forEach((seg) => {
      [seg.a, seg.b].forEach((point) => {
        const angle = Math.atan2(point.cy - origin.cy, point.cx - origin.cx);
        angles.push(angle - 0.0004, angle, angle + 0.0004);
      });
    });
    angles.sort((left, right) => left - right);
    const points = [];
    angles.forEach((angle) => {
      const hit = rayHit(origin, angle, segments);
      if (!hit) return;
      const spot = fromCell(hit.cx, hit.cy, grid, aspect);
      const last = points[points.length - 1];
      if (last && Math.hypot(last[0] - spot.x, last[1] - spot.y) < 0.0008) return;
      points.push([spot.x, spot.y]);
    });
    return points;
  }

  function nearestWall(x, y, walls, grid, aspect) {
    const point = toCell(x, y, grid, aspect);
    let best = null;
    let bestD = 0.42;
    (walls || []).forEach((wall) => {
      const a = toCell(wall.x, wall.y, grid, aspect);
      const b = toCell(wall.x2, wall.y2, grid, aspect);
      const dx = b.cx - a.cx;
      const dy = b.cy - a.cy;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((point.cx - a.cx) * dx + (point.cy - a.cy) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const dist = Math.hypot(point.cx - (a.cx + dx * t), point.cy - (a.cy + dy * t));
      if (dist < bestD) {
        bestD = dist;
        best = wall;
      }
    });
    return best;
  }

  function splitOpening(wall, x, y, kind, grid, aspect) {
    const a = toCell(wall.x, wall.y, grid, aspect);
    const b = toCell(wall.x2, wall.y2, grid, aspect);
    const point = toCell(x, y, grid, aspect);
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    let t = ((point.cx - a.cx) * dx + (point.cy - a.cy) * dy) / (len * len);
    t = Math.max(0, Math.min(1, t));
    const half = 0.5 / len;
    const t0 = Math.max(0, t - half);
    const t1 = Math.min(1, t + half);
    const at = (value) => fromCell(a.cx + dx * value, a.cy + dy * value, grid, aspect);
    const pieces = [];
    const base = { mapId: wall.mapId, roomId: wall.roomId, groupId: wall.groupId };
    if (t0 > 0.08) pieces.push(Object.assign({ kind: 'wall', open: false }, base, { x: wall.x, y: wall.y }, { x2: at(t0).x, y2: at(t0).y }));
    const door = at(t0);
    const doorEnd = at(t1);
    pieces.push(Object.assign({ kind, open: false }, base, { x: door.x, y: door.y, x2: doorEnd.x, y2: doorEnd.y }));
    if (t1 < 0.92) pieces.push(Object.assign({ kind: 'wall', open: false }, base, { x: doorEnd.x, y: doorEnd.y, x2: wall.x2, y2: wall.y2 }));
    return pieces;
  }

  function roomPieces(x, y, x2, y2, grid, aspect) {
    const a = toCell(x, y, grid, aspect);
    const b = toCell(x2, y2, grid, aspect);
    const left = Math.round(Math.min(a.cx, b.cx));
    const right = Math.round(Math.max(a.cx, b.cx));
    const top = Math.round(Math.min(a.cy, b.cy));
    const bottom = Math.round(Math.max(a.cy, b.cy));
    if (right - left < 1 || bottom - top < 1) return null;
    const corner = (cx, cy) => fromCell(cx, cy, grid, aspect);
    const c1 = corner(left, top);
    const c2 = corner(right, top);
    const c3 = corner(right, bottom);
    const c4 = corner(left, bottom);
    const walls = [[c1, c2], [c2, c3], [c3, c4], [c4, c1]];
    const cells = [];
    for (let i = left; i < right; i += 1) {
      for (let j = top; j < bottom; j += 1) cells.push([i, j]);
    }
    return { walls, cells };
  }

  function corridorPieces(points, width, grid, aspect) {
    if (!points || points.length < 2) return null;
    const cells = points.map((point) => toCell(point.x, point.y, grid, aspect));
    const half = Math.max(1, Math.min(2, Number(width) || 1)) / 2;
    const left = [];
    const right = [];
    cells.forEach((cell, index) => {
      let nx = 0;
      let ny = 0;
      if (index < cells.length - 1) {
        const dx = cells[index + 1].cx - cell.cx;
        const dy = cells[index + 1].cy - cell.cy;
        const len = Math.hypot(dx, dy) || 1;
        nx += -dy / len;
        ny += dx / len;
      }
      if (index > 0) {
        const dx = cell.cx - cells[index - 1].cx;
        const dy = cell.cy - cells[index - 1].cy;
        const len = Math.hypot(dx, dy) || 1;
        nx += -dy / len;
        ny += dx / len;
      }
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      left.push(fromCell(cell.cx + nx * half, cell.cy + ny * half, grid, aspect));
      right.push(fromCell(cell.cx - nx * half, cell.cy - ny * half, grid, aspect));
    });
    const walls = [];
    for (let i = 1; i < left.length; i += 1) {
      walls.push([left[i - 1], left[i]]);
      walls.push([right[i - 1], right[i]]);
    }
    const m = metrics(grid, aspect);
    const floor = [];
    const span = half + 0.2;
    for (let i = -1; i <= m.cols; i += 1) {
      for (let j = -1; j <= m.rows; j += 1) {
        const center = { cx: i + 0.5, cy: j + 0.5 };
        const near = cells.some((cell, index) => {
          if (index === cells.length - 1) return Math.hypot(center.cx - cell.cx, center.cy - cell.cy) <= span;
          const next = cells[index + 1];
          const dx = next.cx - cell.cx;
          const dy = next.cy - cell.cy;
          const len2 = dx * dx + dy * dy || 1;
          let t = ((center.cx - cell.cx) * dx + (center.cy - cell.cy) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          return Math.hypot(center.cx - (cell.cx + dx * t), center.cy - (cell.cy + dy * t)) <= span;
        });
        if (near && i >= 0 && j >= 0 && i < m.cols && j < m.rows) floor.push([i, j]);
      }
    }
    return { walls, cells: floor };
  }

  function cellRect(cell, grid, aspect, width, height) {
    const a = fromCell(cell[0], cell[1], grid, aspect);
    const b = fromCell(cell[0] + 1, cell[1] + 1, grid, aspect);
    return {
      x: Math.min(a.x, b.x) * width,
      y: Math.min(a.y, b.y) * height,
      w: Math.abs(b.x - a.x) * width,
      h: Math.abs(b.y - a.y) * height,
    };
  }

  function paintCell(ctx, cell, grid, aspect, width, height) {
    const rect = cellRect(cell, grid, aspect, width, height);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  function strokeWall(ctx, wall, width, height, gm, selected) {
    const secretHidden = wall.kind === 'secret' && !wall.open && !gm;
    const kind = secretHidden ? 'wall' : wall.kind;
    const x1 = wall.x * width;
    const y1 = wall.y * height;
    const x2 = wall.x2 * width;
    const y2 = wall.y2 * height;
    ctx.save();
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    const thick = Math.max(4, width / 180);
    ctx.lineWidth = kind === 'window' ? thick * 0.45 : thick;
    ctx.strokeStyle = selected ? '#f6f0e4' : '#e7d7bc';
    if (kind === 'window') ctx.strokeStyle = selected ? '#f6f0e4' : '#d5e4ea';
    if (kind === 'door' || (kind === 'secret' && wall.open)) ctx.strokeStyle = selected ? '#f6f0e4' : '#c9844a';
    if (kind === 'secret' && !wall.open) {
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#e0c088';
    }
    if (kind === 'door' && wall.open) {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.hypot(x2 - x1, y2 - y1);
      ctx.beginPath();
      ctx.arc(x1, y1, len, angle, angle + Math.PI / 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    if (kind === 'grate') {
      ctx.setLineDash([]);
      const steps = 4;
      for (let i = 1; i < steps; i += 1) {
        const t = i / steps;
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        const ang = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(ang) * thick, py - Math.sin(ang) * thick);
        ctx.lineTo(px + Math.cos(ang) * thick, py + Math.sin(ang) * thick);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function paintProp(ctx, prop, grid, aspect, width, height, selected) {
    const cell = toCell(prop.x, prop.y, grid, aspect);
    const span = fromCell(cell.cx + 0.42, cell.cy + 0.42, grid, aspect);
    const radius = Math.max(6, Math.hypot((span.x - prop.x) * width, (span.y - prop.y) * height));
    const cx = prop.x * width;
    const cy = prop.y * height;
    ctx.save();
    ctx.strokeStyle = selected ? '#f6f0e4' : '#e7d7bc';
    ctx.fillStyle = selected ? 'rgba(246, 240, 228, 0.35)' : 'rgba(231, 215, 188, 0.28)';
    ctx.lineWidth = Math.max(2, width / 500);
    if (prop.kind === 'column') {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (prop.kind === 'pit') {
      ctx.fillStyle = 'rgba(8, 10, 12, 0.72)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (prop.kind === 'stairs') {
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath();
        ctx.moveTo(cx - radius, cy + i * radius * 0.45);
        ctx.lineTo(cx + radius, cy + i * radius * 0.45);
        ctx.stroke();
      }
    } else if (prop.kind === 'chest') {
      ctx.strokeRect(cx - radius, cy - radius * 0.55, radius * 2, radius * 1.1);
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.stroke();
    } else {
      ctx.strokeRect(cx - radius, cy - radius * 0.45, radius * 2, radius * 0.9);
    }
    ctx.restore();
  }

  function paintPlan(ctx, data, options) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;
    const grid = options.grid || { cols: 27, type: 'square' };
    const aspect = options.aspect;
    const selected = options.selected || {};
    const wallIds = new Set(selected.wallIds || []);
    (data.floors || []).forEach((floor) => {
      const picked = floor.id && floor.id === selected.floorId;
      ctx.save();
      ctx.globalAlpha = options.gm ? 0.55 : 0.88;
      ctx.fillStyle = FLOOR_COLORS[floor.kind] || FLOOR_COLORS.stone;
      (floor.cells || []).forEach((cell) => paintCell(ctx, cell, grid, aspect, width, height));
      ctx.restore();
      if (picked) {
        ctx.save();
        ctx.strokeStyle = '#e0c088';
        ctx.lineWidth = Math.max(2, width / 480);
        (floor.cells || []).forEach((cell) => {
          const rect = cellRect(cell, grid, aspect, width, height);
          ctx.strokeRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2));
        });
        ctx.restore();
      }
    });
    (data.previewCells || []).forEach((cell) => {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = FLOOR_COLORS[data.previewKind] || FLOOR_COLORS.stone;
      paintCell(ctx, cell, grid, aspect, width, height);
      ctx.restore();
    });
    (data.walls || []).forEach((wall) => strokeWall(ctx, wall, width, height, options.gm, wallIds.has(wall.id)));
    (data.previewWalls || []).forEach((wall) => strokeWall(ctx, wall, width, height, true, false));
    (data.props || []).forEach((prop) => paintProp(ctx, prop, grid, aspect, width, height, prop.id === selected.propId));
    if (options.gm && data.vision && data.vision.length > 2) {
      ctx.save();
      ctx.beginPath();
      data.vision.forEach((point, index) => {
        const px = point[0] * width;
        const py = point[1] * height;
        if (index) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(224, 192, 136, 0.18)';
      ctx.strokeStyle = 'rgba(246, 240, 228, 0.8)';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
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
    FLOOR_COLORS,
    snapCorner,
    lockAxis,
    toCell,
    fromCell,
    floodRoom,
    clampTravel,
    visionPolygon,
    nearestWall,
    splitOpening,
    roomPieces,
    corridorPieces,
    normalizePlan,
    paintPlan,
    blocksMove,
    blocksSight,
  };
})();
