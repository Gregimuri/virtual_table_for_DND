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
    token.back = !!token.back;
    token.fa = token.fa === 'asset' || token.fa === 'token' ? token.fa : '';
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

  function faCells(px, unit) {
    const width = Number(px);
    const step = Number(unit);
    if (!(width > 0) || !(step > 0)) return null;
    const cells = Math.round((width / step) * 4) / 4;
    if (!(cells > 0)) return null;
    return Math.min(24, cells);
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
    stone: '#a39484',
    wood: '#8d5e36',
    water: '#3f7390',
    void: '#171c1a',
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

  function snapDivide(x, y, grid, aspect, div) {
    const cell = toCell(x, y, grid, aspect);
    const step = Math.max(1, Math.min(8, Math.round(Number(div) || 1)));
    return fromCell(Math.round(cell.cx * step) / step, Math.round(cell.cy * step) / step, grid, aspect);
  }

  function snapCenter(x, y, grid, aspect, div) {
    const cell = toCell(x, y, grid, aspect);
    const step = Math.max(1, Math.min(8, Math.round(Number(div) || 1)));
    const cx = Math.floor(cell.cx * step) / step + 0.5 / step;
    const cy = Math.floor(cell.cy * step) / step + 0.5 / step;
    return fromCell(cx, cy, grid, aspect);
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

  function normalizePoint(point) {
    if (!point) return null;
    return { x: numUnit(point.x), y: numUnit(point.y) };
  }

  function normalizeScrawl(shape) {
    const kinds = ['rect', 'path', 'poly', 'ngon'];
    if (!shape || !shape.id || !kinds.includes(shape.kind)) return null;
    const points = (Array.isArray(shape.points) ? shape.points : []).map(normalizePoint).filter(Boolean).slice(0, 80);
    const least = shape.kind === 'poly' ? 3 : 2;
    if (points.length < least) return null;
    const floors = Object.keys(FLOOR_COLORS);
    return {
      id: String(shape.id),
      mapId: shape.mapId || null,
      kind: shape.kind,
      op: shape.op === 'sub' ? 'sub' : 'add',
      points,
      radius: Math.max(0.25, Math.min(4, Number(shape.radius) || 0.5)),
      sides: Math.max(3, Math.min(8, Math.round(Number(shape.sides) || 6))),
      floor: floors.includes(shape.floor) ? shape.floor : 'stone',
      rough: shape.rough ? 1 : 0,
    };
  }

  function normalizeOpening(item) {
    if (!item || !item.id || !/^([vh]):-?\d+:-?\d+$/.test(String(item.edge || ''))) return null;
    if (!WALL_KINDS.includes(item.kind) || item.kind === 'wall') return null;
    return {
      id: String(item.id),
      mapId: item.mapId || null,
      edge: item.edge,
      kind: item.kind,
      open: !!item.open,
    };
  }

  function normalizeLabel(item) {
    const text = String(item && item.text || '').trim().slice(0, 80);
    if (!item || !item.id || !text) return null;
    return { id: String(item.id), mapId: item.mapId || null, x: numUnit(item.x), y: numUnit(item.y), text };
  }

  function normalizeFlight(item) {
    if (!item || !item.id) return null;
    return {
      id: String(item.id),
      mapId: item.mapId || null,
      x: numUnit(item.x),
      y: numUnit(item.y),
      x2: numUnit(item.x2),
      y2: numUnit(item.y2),
      x3: numUnit(item.x3),
      y3: numUnit(item.y3),
      steps: Math.max(2, Math.min(12, Math.round(Number(item.steps) || 4))),
    };
  }

  function normalizePlan(scene) {
    scene.walls = (Array.isArray(scene.walls) ? scene.walls : []).map(normalizeWall).filter(Boolean).slice(0, 500);
    scene.floors = (Array.isArray(scene.floors) ? scene.floors : []).map(normalizeFloor).filter(Boolean).slice(0, 120);
    scene.props = (Array.isArray(scene.props) ? scene.props : []).map(normalizeProp).filter(Boolean).slice(0, 240);
    scene.scrawls = (Array.isArray(scene.scrawls) ? scene.scrawls : []).map(normalizeScrawl).filter(Boolean).slice(0, 240);
    scene.openings = (Array.isArray(scene.openings) ? scene.openings : []).map(normalizeOpening).filter(Boolean).slice(0, 400);
    scene.labels = (Array.isArray(scene.labels) ? scene.labels : []).map(normalizeLabel).filter(Boolean).slice(0, 80);
    scene.flights = (Array.isArray(scene.flights) ? scene.flights : []).map(normalizeFlight).filter(Boolean).slice(0, 60);
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

  function wobbleOf(id) {
    let hash = 0;
    const text = String(id || 'x');
    for (let i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
    return hash;
  }

  function paintFlight(ctx, flight, width, height, selected) {
    const steps = Math.max(2, flight.steps || 4);
    const x1 = flight.x * width;
    const y1 = flight.y * height;
    const x2 = flight.x2 * width;
    const y2 = flight.y2 * height;
    const mx = (flight.x + flight.x2) / 2;
    const my = (flight.y + flight.y2) / 2;
    const dx = (flight.x3 - mx) * width;
    const dy = (flight.y3 - my) * height;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 + dx, y2 + dy);
    ctx.lineTo(x1 + dx, y1 + dy);
    ctx.closePath();
    ctx.fillStyle = selected ? 'rgba(224, 192, 136, 0.35)' : 'rgba(28, 22, 18, 0.42)';
    ctx.fill();
    ctx.strokeStyle = '#120e0c';
    ctx.lineWidth = Math.max(2, width / 380);
    ctx.stroke();
    ctx.beginPath();
    for (let step = 1; step < steps; step += 1) {
      const t = step / steps;
      ctx.moveTo(x1 + dx * t, y1 + dy * t);
      ctx.lineTo(x2 + dx * t, y2 + dy * t);
    }
    ctx.stroke();
    ctx.restore();
  }

  function paintLabel(ctx, label, width, height, selected) {
    const text = String(label.text || '').slice(0, 80);
    if (!text) return;
    ctx.save();
    ctx.font = `${Math.max(16, Math.round(width / 42))}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = selected ? '#3a2a16' : 'rgba(18, 16, 14, 0.72)';
    ctx.fillStyle = selected ? '#f6f0e4' : '#f3e6cf';
    const x = label.x * width;
    const y = label.y * height;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function paintCell(ctx, cell, grid, aspect, width, height) {
    const rect = cellRect(cell, grid, aspect, width, height);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  function cellPixels(width, height, grid, aspect) {
    const cols = colsOf(grid);
    const ratio = aspectOf(aspect);
    return {
      x: width / cols,
      y: height / Math.max(1, cols * ratio),
    };
  }

  function wallThickness(wall, cell, kind) {
    const unit = (cell.x + cell.y) / 2;
    if (kind === 'window') return Math.max(3, unit * 0.14);
    if (wall.outer) return Math.max(4, unit * 0.32);
    return Math.max(3, unit * 0.2);
  }

  function edgeGeom(wall, width, height) {
    const x1 = wall.x * width;
    const y1 = wall.y * height;
    const x2 = wall.x2 * width;
    const y2 = wall.y2 * height;
    const at = (t) => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    const seg = (a, b) => {
      const from = at(a);
      const to = at(b);
      return { x: from.x, y: from.y, x2: to.x, y2: to.y };
    };
    return { x1, y1, x2, y2, at, seg, full: { x: x1, y: y1, x2, y2 } };
  }

  function pointKey(x, y) {
    return `${Math.round(x * 100000)}:${Math.round(y * 100000)}`;
  }

  function edgesJoin(a, b) {
    if (!a || !b) return false;
    const ax = a.x2 - a.x;
    const ay = a.y2 - a.y;
    const bx = b.x2 - b.x;
    const by = b.y2 - b.y;
    const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (scale > 1e-8 && Math.abs(ax * by - ay * bx) / scale > 0.08) return false;
    const ae = [pointKey(a.x, a.y), pointKey(a.x2, a.y2)];
    const be = [pointKey(b.x, b.y), pointKey(b.x2, b.y2)];
    return ae.some((item) => be.includes(item));
  }

  function openingChain(walls, seed) {
    if (!seed) return [];
    const kind = seed.kind;
    const open = !!seed.open;
    const mergeable = kind === 'door' || kind === 'window' || kind === 'grate' || (kind === 'secret' && open);
    if (!mergeable) return [seed];
    const pool = (walls || []).filter((wall) => wall && wall.kind === kind && !!wall.open === open);
    const seen = new Set();
    const chain = [];
    const queue = [seed];
    while (queue.length) {
      const current = queue.pop();
      const id = current.id || pointKey(current.x, current.y) + pointKey(current.x2, current.y2);
      if (seen.has(id)) continue;
      seen.add(id);
      chain.push(current);
      pool.forEach((other) => {
        const otherId = other.id || pointKey(other.x, other.y) + pointKey(other.x2, other.y2);
        if (!seen.has(otherId) && edgesJoin(current, other)) queue.push(other);
      });
    }
    return chain;
  }

  function chainSpan(chain) {
    const points = [];
    chain.forEach((wall) => {
      points.push({ x: wall.x, y: wall.y });
      points.push({ x: wall.x2, y: wall.y2 });
    });
    let best = -1;
    let from = points[0];
    let to = points[0];
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const dist = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        if (dist > best) {
          best = dist;
          from = points[i];
          to = points[j];
        }
      }
    }
    const first = chain[0];
    return {
      x: from.x,
      y: from.y,
      x2: to.x,
      y2: to.y,
      nx: first.nx || 0,
      ny: first.ny || 0,
      open: !!first.open,
      outer: chain.some((wall) => wall.outer),
      kind: first.kind,
      ids: chain.map((wall) => wall.id),
    };
  }

  function strokeSegs(ctx, segs, color, lineWidth) {
    if (!segs.length) return;
    ctx.beginPath();
    segs.forEach((seg) => {
      ctx.moveTo(seg.x, seg.y);
      ctx.lineTo(seg.x2, seg.y2);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.stroke();
  }

  function paintRoughWall(ctx, wall, width, height, thick) {
    const edge = edgeGeom(wall, width, height);
    const bend = wobbleOf(wall.id || `${edge.x1}:${edge.y1}`);
    const ang = Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1) + Math.PI / 2;
    const kick = thick * 0.45 * (bend % 2 ? 1 : -1);
    ctx.beginPath();
    ctx.moveTo(edge.x1, edge.y1);
    ctx.quadraticCurveTo(
      (edge.x1 + edge.x2) / 2 + Math.cos(ang) * kick,
      (edge.y1 + edge.y2) / 2 + Math.sin(ang) * kick,
      edge.x2,
      edge.y2
    );
    ctx.lineWidth = thick;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#120e0c';
    ctx.stroke();
  }

  function fillLeaf(ctx, x, y, x2, y2, thick) {
    const len = Math.hypot(x2 - x, y2 - y) || 1;
    const px = -(y2 - y) / len;
    const py = (x2 - x) / len;
    const half = Math.max(2, thick * 0.28);
    ctx.beginPath();
    ctx.moveTo(x + px * half, y + py * half);
    ctx.lineTo(x2 + px * half, y2 + py * half);
    ctx.lineTo(x2 - px * half, y2 - py * half);
    ctx.lineTo(x - px * half, y - py * half);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function paintDoorLeaf(ctx, edge, t0, t1, thick, knobAt) {
    const from = edge.at(t0);
    const to = edge.at(t1);
    ctx.save();
    ctx.fillStyle = '#a56b3c';
    ctx.strokeStyle = '#5c3a22';
    ctx.lineWidth = Math.max(1, thick * 0.08);
    fillLeaf(ctx, from.x, from.y, to.x, to.y, thick);
    const knob = edge.at(knobAt);
    ctx.fillStyle = '#e0c088';
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, Math.max(1.5, thick * 0.12), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function paintSwungLeaf(ctx, hinge, nx, ny, length, thick) {
    const norm = Math.hypot(nx, ny) || 1;
    ctx.save();
    ctx.fillStyle = '#a56b3c';
    ctx.strokeStyle = '#5c3a22';
    ctx.lineWidth = Math.max(1, thick * 0.08);
    fillLeaf(ctx, hinge.x, hinge.y, hinge.x + (nx / norm) * length, hinge.y + (ny / norm) * length, thick);
    ctx.fillStyle = '#5c3a22';
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, Math.max(1.5, thick * 0.14), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function floorNormal(span, edge, cell) {
    let nx = (span.nx || 0) * cell.x;
    let ny = (span.ny || 0) * cell.y;
    if (Math.hypot(nx, ny) < 1) {
      nx = -(edge.y2 - edge.y1);
      ny = edge.x2 - edge.x1;
    }
    return { x: nx, y: ny };
  }

  function paintSpanOpening(ctx, span, thick, width, height, grid, aspect) {
    const edge = edgeGeom(span, width, height);
    const cell = cellPixels(width, height, grid, aspect);
    const unit = (cell.x + cell.y) / 2;
    const len = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1) || 1;
    const inset = Math.max(0.05, Math.min(0.22, (unit * 0.18) / len));
    const kind = span.kind === 'secret' ? 'door' : span.kind;
    const wide = len > unit * 1.45;
    if (kind === 'window') {
      strokeSegs(ctx, [edge.seg(inset, 1 - inset)], '#d7e6ee', Math.max(2, thick * 0.5));
      return;
    }
    if (kind === 'grate') {
      const ang = Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1) + Math.PI / 2;
      const bar = thick * 0.9;
      const count = Math.max(3, Math.round(len / unit));
      ctx.save();
      ctx.strokeStyle = '#120e0c';
      ctx.lineWidth = Math.max(2, thick * 0.16);
      ctx.lineCap = 'butt';
      for (let i = 1; i <= count; i += 1) {
        const point = edge.at(inset + ((1 - inset * 2) * i) / (count + 1));
        ctx.beginPath();
        ctx.moveTo(point.x - Math.cos(ang) * bar, point.y - Math.sin(ang) * bar);
        ctx.lineTo(point.x + Math.cos(ang) * bar, point.y + Math.sin(ang) * bar);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const normal = floorNormal(span, edge, cell);
    const clear = 1 - inset * 2;
    if (span.open) {
      if (wide) {
        const leaf = len * clear * 0.46;
        paintSwungLeaf(ctx, edge.at(inset), normal.x, normal.y, leaf, thick);
        paintSwungLeaf(ctx, edge.at(1 - inset), normal.x, normal.y, leaf, thick);
      } else {
        paintSwungLeaf(ctx, edge.at(inset), normal.x, normal.y, len * clear * 0.92, thick);
      }
    } else if (wide) {
      paintDoorLeaf(ctx, edge, inset, 0.5 - 0.02, thick, inset + (0.5 - inset) * 0.78);
      paintDoorLeaf(ctx, edge, 0.5 + 0.02, 1 - inset, thick, (1 - inset) - (0.5 - inset) * 0.78);
    } else {
      paintDoorLeaf(ctx, edge, inset, 1 - inset, thick, inset + clear * 0.72);
    }
  }

  function paintSecretMark(ctx, wall, width, height, thick) {
    const edge = edgeGeom(wall, width, height);
    const mid = edge.at(0.5);
    ctx.save();
    ctx.fillStyle = '#e0c088';
    ctx.translate(mid.x, mid.y);
    ctx.rotate(Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1));
    ctx.fillRect(-thick * 0.22, -thick * 0.22, thick * 0.44, thick * 0.44);
    ctx.restore();
  }

  function paintWalls(ctx, walls, width, height, grid, aspect, gm, wallIds) {
    const cell = cellPixels(width, height, grid, aspect);
    const body = new Map();
    const shadow = new Map();
    const brass = [];
    const rough = [];
    const holes = [];
    const marks = [];
    const pushSolid = (bucket, thick, segs) => {
      const key = thick.toFixed(2);
      if (!bucket.has(key)) bucket.set(key, []);
      segs.forEach((seg) => bucket.get(key).push(seg));
    };
    (walls || []).forEach((wall) => {
      const secretHidden = wall.kind === 'secret' && !wall.open && !gm;
      const kind = secretHidden ? 'wall' : wall.kind;
      const openHole = !secretHidden && (kind === 'door' || kind === 'window' || kind === 'grate' || (kind === 'secret' && wall.open));
      if (openHole) {
        holes.push(wall);
        return;
      }
      const thick = wallThickness(wall, cell, kind);
      if (wall.rough && kind === 'wall') {
        rough.push({ wall, thick, outer: !!wall.outer });
        return;
      }
      const edge = edgeGeom(wall, width, height);
      pushSolid(body, thick, [edge.full]);
      if (wall.outer) pushSolid(shadow, thick, [edge.full]);
      if (wallIds && wallIds.has(wall.id)) brass.push({ segs: [edge.full], width: thick + Math.max(4, (cell.x + cell.y) * 0.05) });
      if (wall.kind === 'secret' && !wall.open && gm) marks.push({ wall, thick });
    });
    const seen = new Set();
    const spans = [];
    holes.forEach((wall) => {
      const id = wall.id || pointKey(wall.x, wall.y) + pointKey(wall.x2, wall.y2);
      if (seen.has(id)) return;
      const chain = openingChain(holes, wall);
      chain.forEach((item) => seen.add(item.id || pointKey(item.x, item.y) + pointKey(item.x2, item.y2)));
      const span = chainSpan(chain);
      const sample = chain[0];
      const thick = wallThickness(Object.assign({}, sample, { outer: span.outer }), cell, sample.kind === 'window' ? 'window' : 'door');
      const edge = edgeGeom(span, width, height);
      const unit = (cell.x + cell.y) / 2;
      const len = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1) || 1;
      const inset = Math.max(0.05, Math.min(0.22, (unit * 0.18) / len));
      const solids = [edge.seg(0, inset), edge.seg(1 - inset, 1)];
      pushSolid(body, thick, solids);
      if (span.outer) pushSolid(shadow, thick, solids);
      if (wallIds && chain.some((item) => wallIds.has(item.id))) {
        brass.push({ segs: solids, width: thick + Math.max(4, (cell.x + cell.y) * 0.05) });
      }
      spans.push({ span, thick });
    });
    if (shadow.size) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = (cell.x + cell.y) * 0.28;
      ctx.shadowOffsetX = cell.x * 0.05;
      ctx.shadowOffsetY = cell.y * 0.1;
      shadow.forEach((segs, key) => strokeSegs(ctx, segs, '#120e0c', Number(key)));
      ctx.restore();
    }
    brass.forEach((item) => strokeSegs(ctx, item.segs, '#e0c088', item.width));
    body.forEach((segs, key) => strokeSegs(ctx, segs, '#120e0c', Number(key)));
    rough.forEach((item) => {
      if (!item.outer) {
        paintRoughWall(ctx, item.wall, width, height, item.thick);
        return;
      }
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = (cell.x + cell.y) * 0.28;
      ctx.shadowOffsetX = cell.x * 0.05;
      ctx.shadowOffsetY = cell.y * 0.1;
      paintRoughWall(ctx, item.wall, width, height, item.thick);
      ctx.restore();
      paintRoughWall(ctx, item.wall, width, height, item.thick);
    });
    marks.forEach((item) => paintSecretMark(ctx, item.wall, width, height, item.thick));
    spans.forEach((item) => paintSpanOpening(ctx, item.span, item.thick, width, height, grid, aspect));
  }

  function paintProp(ctx, prop, grid, aspect, width, height, selected) {
    const cell = toCell(prop.x, prop.y, grid, aspect);
    const span = fromCell(cell.cx + 0.42, cell.cy + 0.42, grid, aspect);
    const radius = Math.max(6, Math.hypot((span.x - prop.x) * width, (span.y - prop.y) * height));
    const cx = prop.x * width;
    const cy = prop.y * height;
    ctx.save();
    ctx.strokeStyle = selected ? '#f6f0e4' : '#120e0c';
    ctx.fillStyle = selected ? 'rgba(246, 240, 228, 0.35)' : 'rgba(18, 14, 12, 0.38)';
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
    const part = options.part || 'all';
    if (part === 'above') {
      paintPlanAbove(ctx, data, options, width, height, grid, aspect, selected, wallIds);
      return;
    }
    (data.floors || []).forEach((floor) => {
      const picked = floor.id && floor.id === selected.floorId;
      ctx.save();
      ctx.globalAlpha = options.gm ? 0.84 : 0.95;
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
    if (part === 'floor') return;
    paintPlanAbove(ctx, data, options, width, height, grid, aspect, selected, wallIds);
  }

  function paintPlanAbove(ctx, data, options, width, height, grid, aspect, selected, wallIds) {
    if ((data.selectedCells || []).length) {
      ctx.save();
      ctx.strokeStyle = '#e0c088';
      ctx.lineWidth = Math.max(2, width / 480);
      data.selectedCells.forEach((cell) => {
        const rect = cellRect(cell, grid, aspect, width, height);
        ctx.strokeRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2));
      });
      ctx.restore();
    }
    paintWalls(ctx, data.walls, width, height, grid, aspect, options.gm, wallIds);
    ctx.save();
    ctx.globalAlpha = 0.55;
    paintWalls(ctx, data.previewWalls, width, height, grid, aspect, true, new Set());
    ctx.restore();
    (data.props || []).forEach((prop) => paintProp(ctx, prop, grid, aspect, width, height, prop.id === selected.propId));
    (data.flights || []).forEach((flight) => paintFlight(ctx, flight, width, height, flight.id === selected.flightId));
    (data.labels || []).forEach((label) => paintLabel(ctx, label, width, height, label.id === selected.labelId));
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

  function distToSeg(px, py, a, b) {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-8) t = Math.max(0, Math.min(1, ((px - a.cx) * dx + (py - a.cy) * dy) / len2));
    return Math.hypot(px - (a.cx + dx * t), py - (a.cy + dy * t));
  }

  function insidePoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].cx;
      const yi = pts[i].cy;
      const xj = pts[j].cx;
      const yj = pts[j].cy;
      const cross = (yj - yi) || 1e-9;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / cross + xi) inside = !inside;
    }
    return inside;
  }

  function pushCell(bag, seen, i, j, grid, aspect) {
    const m = metrics(grid, aspect);
    if (i < -2 || j < -2 || i > m.cols + 2 || j > m.rows + 2) return;
    const key = `${i}:${j}`;
    if (seen.has(key)) return;
    seen.add(key);
    bag.push([i, j]);
  }

  function rectCells(a, b, grid, aspect) {
    const left = Math.min(a.cx, b.cx);
    const right = Math.max(a.cx, b.cx);
    const top = Math.min(a.cy, b.cy);
    const bottom = Math.max(a.cy, b.cy);
    if (right - left < 0.2 || bottom - top < 0.2) return [];
    const cells = [];
    const seen = new Set();
    const i0 = Math.floor(left);
    const i1 = Math.floor(right - 1e-6);
    const j0 = Math.floor(top);
    const j1 = Math.floor(bottom - 1e-6);
    if (i1 - i0 > 90 || j1 - j0 > 90) return [];
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const overlapX = Math.min(i + 1, right) - Math.max(i, left);
        const overlapY = Math.min(j + 1, bottom) - Math.max(j, top);
        if (overlapX > 0.2 && overlapY > 0.2) pushCell(cells, seen, i, j, grid, aspect);
      }
    }
    return cells;
  }

  function polyCells(pts, grid, aspect) {
    if (!pts || pts.length < 3) return [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((point) => {
      minX = Math.min(minX, point.cx);
      maxX = Math.max(maxX, point.cx);
      minY = Math.min(minY, point.cy);
      maxY = Math.max(maxY, point.cy);
    });
    const cells = [];
    const seen = new Set();
    const i0 = Math.floor(minX);
    const i1 = Math.floor(maxX);
    const j0 = Math.floor(minY);
    const j1 = Math.floor(maxY);
    if (i1 - i0 > 90 || j1 - j0 > 90) return [];
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        if (insidePoly(i + 0.5, j + 0.5, pts)) pushCell(cells, seen, i, j, grid, aspect);
      }
    }
    return cells;
  }

  function pathCells(pts, radius, grid, aspect) {
    if (!pts || pts.length < 2) return [];
    const reach = Math.max(0.25, Math.min(4, Number(radius) || 0.5));
    const cells = [];
    const seen = new Set();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((point) => {
      minX = Math.min(minX, point.cx);
      maxX = Math.max(maxX, point.cx);
      minY = Math.min(minY, point.cy);
      maxY = Math.max(maxY, point.cy);
    });
    const pad = Math.ceil(reach + 1);
    const i0 = Math.floor(minX) - pad;
    const i1 = Math.ceil(maxX) + pad;
    const j0 = Math.floor(minY) - pad;
    const j1 = Math.ceil(maxY) + pad;
    if (i1 - i0 > 90 || j1 - j0 > 90) return [];
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        let near = false;
        for (let n = 0; n < pts.length - 1; n += 1) {
          if (distToSeg(i + 0.5, j + 0.5, pts[n], pts[n + 1]) <= reach + 0.05) {
            near = true;
            break;
          }
        }
        if (near) pushCell(cells, seen, i, j, grid, aspect);
      }
    }
    return cells;
  }

  function shapeCellPoints(shape, grid, aspect) {
    return (shape.points || []).map((point) => toCell(point.x, point.y, grid, aspect));
  }

  function scrawlCells(shape, grid, aspect) {
    if (!shape || !shape.points) return [];
    const pts = shapeCellPoints(shape, grid, aspect);
    if (shape.kind === 'rect' && pts.length >= 2) return rectCells(pts[0], pts[1], grid, aspect);
    if (shape.kind === 'path') return pathCells(pts, shape.radius, grid, aspect);
    if (shape.kind === 'poly') return polyCells(pts, grid, aspect);
    if (shape.kind === 'ngon' && pts.length >= 2) {
      const rad = Math.hypot(pts[1].cx - pts[0].cx, pts[1].cy - pts[0].cy);
      if (rad < 0.4) return [];
      const sides = Math.max(3, Math.min(8, shape.sides || 6));
      const rot = Math.atan2(pts[1].cy - pts[0].cy, pts[1].cx - pts[0].cx);
      const ring = [];
      for (let i = 0; i < sides; i += 1) {
        const ang = rot + (i * Math.PI * 2) / sides;
        ring.push({ cx: pts[0].cx + Math.cos(ang) * rad, cy: pts[0].cy + Math.sin(ang) * rad });
      }
      return polyCells(ring, grid, aspect);
    }
    return [];
  }

  function sharesShape(left, right) {
    if (!left || !right) return false;
    return left.some((id) => right.includes(id));
  }

  function edgeLine(key, grid, aspect) {
    const parts = String(key).split(':');
    const axis = parts[0];
    const i = Number(parts[1]);
    const j = Number(parts[2]);
    if (axis === 'v') {
      const a = fromCell(i, j, grid, aspect);
      const b = fromCell(i, j + 1, grid, aspect);
      return { x: a.x, y: a.y, x2: b.x, y2: b.y };
    }
    const a = fromCell(i, j, grid, aspect);
    const b = fromCell(i + 1, j, grid, aspect);
    return { x: a.x, y: a.y, x2: b.x, y2: b.y };
  }

  function compileScrawl(shapes, openings, grid, aspect, mapId) {
    const members = new Map();
    const floorOf = new Map();
    const roughOf = new Map();
    (shapes || []).forEach((shape) => {
      const cells = scrawlCells(shape, grid, aspect);
      cells.forEach(([i, j]) => {
        const key = `${i}:${j}`;
        if (shape.op === 'sub') {
          members.delete(key);
          floorOf.delete(key);
          roughOf.delete(key);
          return;
        }
        if (!members.has(key)) members.set(key, []);
        members.get(key).push(shape.id);
        floorOf.set(key, shape.floor || 'stone');
        if (shape.rough) roughOf.set(key, 1);
      });
    });
    const edges = new Map();
    members.forEach((ids, key) => {
      const [i, j] = key.split(':').map(Number);
      const rough = !!roughOf.get(key);
      const consider = (di, dj, edge, nx, ny) => {
        const other = members.get(`${i + di}:${j + dj}`);
        if (sharesShape(ids, other)) return;
        const outer = !other;
        const prev = edges.get(edge);
        if (!prev) edges.set(edge, { rough, outer, nx, ny });
        else {
          if (rough) prev.rough = true;
          if (!outer) prev.outer = false;
        }
      };
      consider(1, 0, `v:${i + 1}:${j}`, -1, 0);
      consider(-1, 0, `v:${i}:${j}`, 1, 0);
      consider(0, 1, `h:${i}:${j + 1}`, 0, -1);
      consider(0, -1, `h:${i}:${j}`, 0, 1);
    });
    const openByEdge = new Map();
    (openings || []).forEach((opening) => {
      if (opening && edges.has(opening.edge)) openByEdge.set(opening.edge, opening);
    });
    const walls = [];
    edges.forEach((info, edge) => {
      const opening = openByEdge.get(edge);
      const line = edgeLine(edge, grid, aspect);
      walls.push({
        id: `edge:${edge}`,
        mapId: mapId || null,
        kind: opening ? opening.kind : 'wall',
        open: opening ? !!opening.open : false,
        rough: !!(info.rough && !opening),
        outer: !!info.outer,
        nx: info.nx || 0,
        ny: info.ny || 0,
        edge,
        openingId: opening ? opening.id : null,
        x: line.x,
        y: line.y,
        x2: line.x2,
        y2: line.y2,
      });
    });
    const groups = { stone: [], wood: [], water: [], void: [] };
    const cells = [];
    const owner = {};
    floorOf.forEach((kind, key) => {
      const pair = key.split(':').map(Number);
      (groups[kind] || groups.stone).push(pair);
      cells.push(pair);
      const ids = members.get(key);
      if (ids && ids.length) owner[key] = ids[ids.length - 1];
    });
    const floors = Object.keys(groups).filter((kind) => groups[kind].length).map((kind) => ({
      id: `scrawl:${mapId || 'map'}:${kind}`,
      mapId: mapId || null,
      kind,
      cells: groups[kind],
    }));
    return { floors, walls, cells, owner };
  }

  function assemblePlan(scene, mapId, grid, aspect, extra) {
    const shapes = (scene.scrawls || []).filter((item) => item.mapId === mapId).concat(extra || []);
    const openings = (scene.openings || []).filter((item) => item.mapId === mapId);
    const compiled = compileScrawl(shapes, openings, grid, aspect, mapId);
    return {
      walls: (scene.walls || []).filter((item) => item.mapId === mapId).concat(compiled.walls),
      floors: (scene.floors || []).filter((item) => item.mapId === mapId).concat(compiled.floors),
      props: (scene.props || []).filter((item) => item.mapId === mapId),
      labels: (scene.labels || []).filter((item) => item.mapId === mapId),
      flights: (scene.flights || []).filter((item) => item.mapId === mapId),
      owner: compiled.owner,
      cells: compiled.cells,
    };
  }

  return {
    SIZES,
    colsOf,
    cleanStat,
    normalizeToken,
    scaleForSize,
    faCells,
    snapPoint,
    measureText,
    paintShapes,
    syncChrome,
    placeRing,
    normalizeInitiative,
    normalizeCard,
    FLOOR_COLORS,
    snapCorner,
    snapDivide,
    snapCenter,
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
    scrawlCells,
    compileScrawl,
    assemblePlan,
    normalizePlan,
    paintPlan,
    blocksMove,
    blocksSight,
    openingChain,
    openingsTouch: edgesJoin,
  };
})();
