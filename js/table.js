'use strict';

(function () {
  const ui = {
    board: document.getElementById('board'),
    stage: document.getElementById('stage'),
    mapImage: document.getElementById('mapImage'),
    mapVideo: document.getElementById('mapVideo'),
    mapInner: document.getElementById('mapInner'),
    drawLayer: document.getElementById('drawLayer'),
    fogLayer: document.getElementById('fogLayer'),
    gridLayer: document.getElementById('gridLayer'),
    planLayer: document.getElementById('planLayer'),
    floorLayer: document.getElementById('floorLayer'),
    tokenLayer: document.getElementById('tokenLayer'),
    backLayer: document.getElementById('backLayer'),
    shapeLayer: document.getElementById('shapeLayer'),
    markerLayer: document.getElementById('markerLayer'),
    tableCard: document.getElementById('tableCard'),
    blackout: document.getElementById('blackout'),
    turnBanner: document.getElementById('turnBanner'),
    faCredit: document.getElementById('faCredit'),
    fsHint: document.getElementById('fsHint'),
  };
  const drawCtx = ui.drawLayer.getContext('2d');
  const fogCtx = ui.fogLayer.getContext('2d');
  const gridCtx = ui.gridLayer.getContext('2d');
  const planCtx = ui.planLayer.getContext('2d');
  const floorCtx = ui.floorLayer.getContext('2d');
  const shapeCtx = ui.shapeLayer.getContext('2d');
  const tokenUrls = new Map();

  let scene = VTTDB.emptyScene();
  let mapUrl = '';
  let mapId = null;
  let live = null;
  let applying = false;

  function shownMedia() {
    return ui.mapVideo.hidden ? ui.mapImage : ui.mapVideo;
  }

  function layout() {
    const frame = VTTMedia.mediaSize(shownMedia());
    if (!frame) return;
    const fit = VTTPlay.normalizeFit(scene.fits && scene.fits[shownMapId()]);
    const out = VTTPlay.fitOutSize(frame.w, frame.h, fit);
    const fitted = VTTPaint.contain(window.innerWidth, window.innerHeight, out.w, out.h);
    ui.board.style.width = `${fitted.w}px`;
    ui.board.style.height = `${fitted.h}px`;
    VTTPlay.applyMapFit(ui.mapInner, shownMedia(), frame.w, frame.h, fitted.w, fitted.h, fit);
    const size = VTTPaint.canvasSize(out.w, out.h, 4096);
    if (ui.drawLayer.width !== size.w || ui.drawLayer.height !== size.h || ui.gridLayer.width !== size.w || ui.planLayer.width !== size.w || ui.floorLayer.width !== size.w || ui.shapeLayer.width !== size.w) {
      ui.drawLayer.width = size.w;
      ui.drawLayer.height = size.h;
      ui.fogLayer.width = size.w;
      ui.fogLayer.height = size.h;
      ui.gridLayer.width = size.w;
      ui.gridLayer.height = size.h;
      ui.planLayer.width = size.w;
      ui.planLayer.height = size.h;
      ui.floorLayer.width = size.w;
      ui.floorLayer.height = size.h;
      ui.shapeLayer.width = size.w;
      ui.shapeLayer.height = size.h;
    }
    replay();
  }

  function shownMapId() {
    if (scene && Object.prototype.hasOwnProperty.call(scene, 'tableMapId')) return scene.tableMapId;
    return scene.currentMapId;
  }

  function replay() {
    if (!ui.drawLayer.width) return;
    const id = shownMapId();
    VTTPaint.replayDraw(drawCtx, (scene.drawings && scene.drawings[id]) || []);
    VTTPaint.replayFog(fogCtx, (scene.fog && scene.fog[id]) || []);
    const grid = scene.grids && scene.grids[id];
    VTTPaint.drawGrid(gridCtx, grid && grid.enabled && grid.onTable !== false ? grid : null);
    const aspect = ui.board.clientHeight / Math.max(1, ui.board.clientWidth);
    const lattice = grid || { cols: 27, type: 'square' };
    const plan = VTTPlay.assemblePlan(scene, id, lattice, aspect);
    VTTPlay.paintPlan(floorCtx, plan, { gm: false, grid: lattice, aspect, part: 'floor' });
    VTTPlay.paintPlan(planCtx, plan, { gm: false, grid: lattice, aspect, part: 'above' });
    const templates = (scene.templates || []).filter((item) => item.mapId === id);
    VTTPlay.paintShapes(shapeCtx, templates, { gm: false, grid: grid || { cols: 27, type: 'square' }, aspect });
    restoreLive();
  }

  function strokeIsStored(id) {
    const drawings = (scene.drawings && scene.drawings[shownMapId()]) || [];
    const fog = (scene.fog && scene.fog[shownMapId()]) || [];
    return drawings.concat(fog).some((item) => item.id === id);
  }

  function restoreLive() {
    if (!live) return;
    if (live.mapId !== shownMapId() || strokeIsStored(live.strokeId)) {
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

  function lookKey(token) {
    const source = token.libraryId || token.id;
    const cut = token.cut && token.cut.color ? `${token.cut.color}:${token.cut.tolerance || 0}` : '';
    return `${source}|${cut}`;
  }

  async function tokenLook(token) {
    const key = lookKey(token);
    if (tokenUrls.has(key)) return tokenUrls.get(key);
    const blob = await VTTDB.getBlob(token.libraryId || token.id);
    if (!blob) return '';
    const painted = await VTTPaint.cutBlob(blob, token.cut);
    const url = URL.createObjectURL(painted || blob);
    tokenUrls.set(key, url);
    return url;
  }

  function turnItem() {
    const init = scene.initiative;
    if (!init || !Array.isArray(init.items) || !init.items.length) return null;
    return init.items[init.index] || null;
  }

  function renderTableChrome() {
    const item = turnItem();
    const secret = !item || item.secret;
    ui.turnBanner.hidden = secret || !item.name;
    ui.turnBanner.textContent = secret ? '' : item.name;
    const turnToken = !secret && item && item.tokenId
      ? (scene.tokens || []).find((token) => token.id === item.tokenId && token.mapId === shownMapId() && !token.hidden)
      : null;
    VTTPlay.placeRing(ui.markerLayer, turnToken || null);
    ui.blackout.hidden = !scene.blackout;
    const card = !scene.blackout && scene.card && scene.card.text ? scene.card : null;
    ui.tableCard.hidden = !card;
    ui.tableCard.textContent = '';
    if (!card) return;
    const title = document.createElement('h2');
    title.textContent = card.title || '';
    const body = document.createElement('p');
    body.textContent = card.text || '';
    if (!card.title) title.hidden = true;
    ui.tableCard.append(title, body);
  }

  async function syncTokens() {
    const tokens = (scene.tokens || [])
      .filter((token) => token.mapId === shownMapId() && !token.hidden)
      .sort((a, b) => (a.z || 0) - (b.z || 0));
    const keep = new Set(tokens.map((token) => token.id));
    const hostFor = (token) => (token.back ? ui.backLayer : ui.tokenLayer);
    const findEl = (id) => ui.tokenLayer.querySelector(`[data-id="${id}"]`) || ui.backLayer.querySelector(`[data-id="${id}"]`);
    [...ui.tokenLayer.children, ...ui.backLayer.children].forEach((el) => {
      if (!keep.has(el.dataset.id)) el.remove();
    });
    for (const token of tokens) {
      const host = hostFor(token);
      let el = findEl(token.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'token';
        el.dataset.id = token.id;
        const image = document.createElement('img');
        image.alt = '';
        image.draggable = false;
        el.appendChild(image);
        host.appendChild(el);
      } else if (el.parentElement !== host) {
        host.appendChild(el);
      }
      const image = el.querySelector('img');
      const key = lookKey(token);
      if (image && image.dataset.look !== key) {
        let url = '';
        try {
          url = await tokenLook(token);
        } catch (error) {
          console.error(error);
        }
        if (url && el.isConnected) {
          image.dataset.look = key;
          image.src = url;
        }
      }
      VTTPaint.applyTokenStyle(el, token);
      VTTPlay.syncChrome(el, token, 'table');
    }
    tokens.forEach((token) => {
      const el = findEl(token.id);
      if (el) hostFor(token).appendChild(el);
    });
    renderTableChrome();
  }

  function stopMapVideo() {
    VTTMedia.stopVideo(ui.mapVideo);
  }

  function showStoredMap(map, pixelated) {
    return new Promise((resolve) => {
      if (mapUrl) URL.revokeObjectURL(mapUrl);
      mapUrl = URL.createObjectURL(map.blob);
      mapId = map.id;
      const video = VTTMedia.mapIsVideo(map);
      const el = video ? ui.mapVideo : ui.mapImage;
      ui.board.hidden = false;
      ui.board.classList.toggle('pixelated', !!pixelated);
      ui.board.classList.add('switching');
      if (video) {
        ui.mapImage.hidden = true;
        ui.mapImage.removeAttribute('src');
        el.hidden = false;
        el.onloadedmetadata = () => {
          VTTMedia.applyPlayback(el, scene);
          layout();
          ui.board.classList.remove('switching');
          resolve();
        };
        el.onerror = () => resolve();
        el.src = mapUrl;
        return;
      }
      stopMapVideo();
      el.hidden = false;
      el.onload = () => {
        layout();
        ui.board.classList.remove('switching');
        resolve();
      };
      el.src = mapUrl;
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
        ui.backLayer.textContent = '';
      }
      const shown = shownMapId();
      if (!shown) {
        ui.board.hidden = true;
        ui.faCredit.hidden = true;
        stopMapVideo();
        mapId = null;
        live = null;
        renderTableChrome();
        return;
      }
      if (shown !== mapId) {
        const map = await VTTDB.getMap(shown);
        if (!map) {
          ui.board.hidden = true;
          ui.faCredit.hidden = true;
          return;
        }
        await showStoredMap(map, scene.pixelated);
      } else {
        replay();
      }
      VTTMedia.applyPlayback(ui.mapVideo, scene);
      await syncTokens();
      const mapNow = shownMapId();
      ui.faCredit.hidden = !(scene.tokens || []).some((token) => token.mapId === mapNow && token.fa);
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
    const token = (scene.tokens || []).find((item) => item.id === msg.id);
    if (token && token.hidden) return;
    const el = ui.tokenLayer.querySelector(`[data-id="${msg.id}"]`) || ui.backLayer.querySelector(`[data-id="${msg.id}"]`);
    if (!el) return;
    VTTPaint.applyTokenStyle(el, msg);
    if (token) {
      token.x = msg.x;
      token.y = msg.y;
      token.scale = msg.scale;
      token.rotation = msg.rotation;
      token.z = msg.z;
      const item = turnItem();
      if (item && !item.secret && item.tokenId === token.id) VTTPlay.placeRing(ui.markerLayer, token);
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
    if (msg.type === 'pointer' && msg.mapId === shownMapId()) {
      const ping = document.createElement('div');
      ping.className = 'table-ping';
      ping.style.left = `${Number(msg.x) * 100}%`;
      ping.style.top = `${Number(msg.y) * 100}%`;
      ui.markerLayer.appendChild(ping);
      setTimeout(() => ping.remove(), 1000);
    }
  });

  setInterval(() => VTTBus.send({ type: 'ping' }), 2000);
  VTTBus.send({ type: 'hello' });
  applyScene();
  setPresenting(Boolean(document.fullscreenElement));
})();
