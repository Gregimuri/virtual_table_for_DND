'use strict';

(function () {
  const ui = {
    board: document.getElementById('board'),
    stage: document.getElementById('stage'),
    mapImage: document.getElementById('mapImage'),
    drawLayer: document.getElementById('drawLayer'),
    fogLayer: document.getElementById('fogLayer'),
    gridLayer: document.getElementById('gridLayer'),
    tokenLayer: document.getElementById('tokenLayer'),
    fsHint: document.getElementById('fsHint'),
  };
  const drawCtx = ui.drawLayer.getContext('2d');
  const fogCtx = ui.fogLayer.getContext('2d');
  const gridCtx = ui.gridLayer.getContext('2d');
  const tokenUrls = new Map();

  let scene = VTTDB.emptyScene();
  let mapUrl = '';
  let mapId = null;
  let live = null;
  let applying = false;

  function layout() {
    if (!ui.mapImage.naturalWidth) return;
    const fitted = VTTPaint.contain(window.innerWidth, window.innerHeight, ui.mapImage.naturalWidth, ui.mapImage.naturalHeight);
    ui.board.style.width = `${fitted.w}px`;
    ui.board.style.height = `${fitted.h}px`;
    const size = VTTPaint.canvasSize(ui.mapImage.naturalWidth, ui.mapImage.naturalHeight, 4096);
    if (ui.drawLayer.width !== size.w || ui.drawLayer.height !== size.h || ui.gridLayer.width !== size.w) {
      ui.drawLayer.width = size.w;
      ui.drawLayer.height = size.h;
      ui.fogLayer.width = size.w;
      ui.fogLayer.height = size.h;
      ui.gridLayer.width = size.w;
      ui.gridLayer.height = size.h;
    }
    replay();
  }

  function replay() {
    if (!ui.drawLayer.width) return;
    const id = scene.currentMapId;
    VTTPaint.replayDraw(drawCtx, (scene.drawings && scene.drawings[id]) || []);
    VTTPaint.replayFog(fogCtx, (scene.fog && scene.fog[id]) || []);
    const grid = scene.grids && scene.grids[id];
    VTTPaint.drawGrid(gridCtx, grid && grid.enabled && grid.onTable !== false ? grid : null);
    restoreLive();
  }

  function strokeIsStored(id) {
    const drawings = (scene.drawings && scene.drawings[scene.currentMapId]) || [];
    const fog = (scene.fog && scene.fog[scene.currentMapId]) || [];
    return drawings.concat(fog).some((item) => item.id === id);
  }

  function restoreLive() {
    if (!live) return;
    if (live.mapId !== scene.currentMapId || strokeIsStored(live.strokeId)) {
      live = null;
      return;
    }
    if (!ui.drawLayer.width) return;
    const ctx = live.layer === 'fog' ? fogCtx : drawCtx;
    let last = null;
    live.points.forEach((point) => {
      if (!last) VTTPaint.drawSegment(ctx, null, null, point[0], point[1], live.size, live.color, live.erase);
      else VTTPaint.drawSegment(ctx, last[0], last[1], point[0], point[1], live.size, live.color, live.erase);
      last = point;
    });
    live.last = last;
  }

  async function tokenUrl(id) {
    if (tokenUrls.has(id)) return tokenUrls.get(id);
    const blob = await VTTDB.getBlob(id);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    tokenUrls.set(id, url);
    return url;
  }

  async function syncTokens() {
    const tokens = (scene.tokens || [])
      .filter((token) => token.mapId === scene.currentMapId)
      .sort((a, b) => (a.z || 0) - (b.z || 0));
    const keep = new Set(tokens.map((token) => token.id));
    [...ui.tokenLayer.children].forEach((el) => {
      if (!keep.has(el.dataset.id)) el.remove();
    });
    for (const token of tokens) {
      let el = ui.tokenLayer.querySelector(`[data-id="${token.id}"]`);
      if (!el) {
        el = document.createElement('img');
        el.className = 'token';
        el.dataset.id = token.id;
        el.alt = '';
        el.draggable = false;
        ui.tokenLayer.appendChild(el);
        const url = await tokenUrl(token.id);
        if (url && el.isConnected) el.src = url;
      }
      VTTPaint.applyTokenStyle(el, token);
    }
  }

  function showStoredMap(blob, id, pixelated) {
    return new Promise((resolve) => {
      if (mapUrl) URL.revokeObjectURL(mapUrl);
      mapUrl = URL.createObjectURL(blob);
      mapId = id;
      ui.board.hidden = false;
      ui.board.classList.toggle('pixelated', !!pixelated);
      ui.board.classList.add('switching');
      ui.mapImage.onload = () => {
        layout();
        ui.board.classList.remove('switching');
        resolve();
      };
      ui.mapImage.src = mapUrl;
    });
  }

  let applyQueued = false;
  let forceMap = false;

  async function applyScene(reload) {
    if (reload) forceMap = true;
    if (applying) {
      applyQueued = true;
      return;
    }
    applying = true;
    const reloadMap = forceMap;
    forceMap = false;
    try {
      const stored = await VTTDB.getScene();
      if (!stored) return;
      scene = stored;
      ui.board.classList.toggle('pixelated', !!scene.pixelated);
      if (reloadMap) {
        mapId = null;
        live = null;
        tokenUrls.forEach((url) => URL.revokeObjectURL(url));
        tokenUrls.clear();
        ui.tokenLayer.textContent = '';
      }
      if (!scene.currentMapId) {
        ui.board.hidden = true;
        mapId = null;
        live = null;
        return;
      }
      if (scene.currentMapId !== mapId) {
        const map = await VTTDB.getMap(scene.currentMapId);
        if (!map) {
          ui.board.hidden = true;
          return;
        }
        await showStoredMap(map.blob, map.id, scene.pixelated);
      } else {
        replay();
      }
      await syncTokens();
    } finally {
      applying = false;
      if (applyQueued) {
        applyQueued = false;
        applyScene();
      }
    }
  }

  function onLiveStart(msg) {
    live = {
      mapId: msg.mapId,
      strokeId: msg.strokeId,
      layer: msg.layer,
      erase: !!msg.erase,
      color: msg.color || '#000000',
      size: msg.size,
      points: [],
      last: null,
    };
  }

  function onLive(msg) {
    if (!live || msg.strokeId !== live.strokeId) return;
    const points = msg.points || [];
    const canDraw = mapId === live.mapId && ui.drawLayer.width;
    const ctx = live.layer === 'fog' ? fogCtx : drawCtx;
    points.forEach((point) => {
      live.points.push(point);
      if (!canDraw) return;
      const x = point[0];
      const y = point[1];
      if (!live.last) VTTPaint.drawSegment(ctx, null, null, x, y, live.size, live.color, live.erase);
      else VTTPaint.drawSegment(ctx, live.last[0], live.last[1], x, y, live.size, live.color, live.erase);
      live.last = [x, y];
    });
  }

  function onPose(msg) {
    const el = ui.tokenLayer.querySelector(`[data-id="${msg.id}"]`);
    if (!el) return;
    VTTPaint.applyTokenStyle(el, msg);
    const token = (scene.tokens || []).find((item) => item.id === msg.id);
    if (token) {
      token.x = msg.x;
      token.y = msg.y;
      token.scale = msg.scale;
      token.rotation = msg.rotation;
      token.z = msg.z;
    }
  }

  function setPresenting(on) {
    document.body.classList.toggle('presenting', on);
    ui.fsHint.hidden = on;
  }

  async function goFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.error(error);
    }
  }

  ui.fsHint.addEventListener('click', goFullscreen);
  document.addEventListener('fullscreenchange', () => {
    setPresenting(Boolean(document.fullscreenElement));
  });
  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'f') goFullscreen();
  });
  window.addEventListener('resize', () => {
    if (mapId) layout();
  });

  VTTBus.on((msg) => {
    if (msg.type === 'scene') applyScene(!!msg.reloadMap);
    if (msg.type === 'live-start') onLiveStart(msg);
    if (msg.type === 'live') onLive(msg);
    if (msg.type === 'token-pose') onPose(msg);
  });

  setInterval(() => VTTBus.send({ type: 'ping' }), 2000);
  VTTBus.send({ type: 'hello' });
  applyScene();
  setPresenting(Boolean(document.fullscreenElement));
})();
