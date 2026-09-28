'use strict';

(function () {
  const COLORS = ['#f4efe4', '#ff4d3a', '#ffb020', '#3dd68c', '#3aa0ff', '#c46bff', '#1a1a1a'];
  const PREFS_KEY = 'dnd-table-prefs';

  const ui = {
    board: document.getElementById('board'),
    stage: document.getElementById('stage'),
    empty: document.getElementById('empty'),
    mapImage: document.getElementById('mapImage'),
    drawLayer: document.getElementById('drawLayer'),
    fogLayer: document.getElementById('fogLayer'),
    gridLayer: document.getElementById('gridLayer'),
    tokenLayer: document.getElementById('tokenLayer'),
    pointerLayer: document.getElementById('pointerLayer'),
    mapList: document.getElementById('mapList'),
    tokenList: document.getElementById('tokenList'),
    slideLabel: document.getElementById('slideLabel'),
    prevMap: document.getElementById('prevMap'),
    nextMap: document.getElementById('nextMap'),
    brushSize: document.getElementById('brushSize'),
    sizeLabel: document.getElementById('sizeLabel'),
    fogView: document.getElementById('fogView'),
    pixelated: document.getElementById('pixelated'),
    tokenEditor: document.getElementById('tokenEditor'),
    tokenScale: document.getElementById('tokenScale'),
    tokenRotate: document.getElementById('tokenRotate'),
    brushCursor: document.getElementById('brushCursor'),
    screenPicker: document.getElementById('screenPicker'),
    screenList: document.getElementById('screenList'),
    screenNote: document.getElementById('screenNote'),
    openTable: document.getElementById('openTable'),
    linkStatus: document.getElementById('linkStatus'),
    linkText: document.getElementById('linkText'),
    toast: document.getElementById('toast'),
    modal: document.getElementById('modal'),
    modalText: document.getElementById('modalText'),
    modalOk: document.getElementById('modalOk'),
    modalCancel: document.getElementById('modalCancel'),
    zoomReset: document.getElementById('zoomReset'),
    swatches: document.getElementById('swatches'),
    thresholdField: document.getElementById('thresholdField'),
  };

  const drawCtx = ui.drawLayer.getContext('2d');
  const fogCtx = ui.fogLayer.getContext('2d');
  const gridCtx = ui.gridLayer.getContext('2d');

  const state = {
    maps: [],
    scene: VTTDB.emptyScene(),
    tool: 'move',
    color: COLORS[1],
    size: 0.018,
    fogView: 'soft',
    zoom: 1,
    panX: 0,
    panY: 0,
    selectedId: null,
    history: [],
    tableWin: null,
    lastPing: 0,
    spaceDown: false,
    screenDetails: null,
    project: null,
  };

  let saveChain = Promise.resolve();
  let projectBusy = false;
  let toastTimer = 0;
  let stroke = null;
  let liveBatch = [];
  let liveFrame = 0;

  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3600);
  }

  function ask(text, okLabel) {
    ui.modalText.textContent = text;
    ui.modalOk.textContent = okLabel || 'Удалить';
    ui.modal.hidden = false;
    return new Promise((resolve) => {
      const finish = (value) => {
        ui.modal.hidden = true;
        ui.modalOk.removeEventListener('click', onOk);
        ui.modalCancel.removeEventListener('click', onCancel);
        resolve(value);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      ui.modalOk.addEventListener('click', onOk);
      ui.modalCancel.addEventListener('click', onCancel);
    });
  }

  function loadPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (prefs.tool) state.tool = prefs.tool;
      if (prefs.color) state.color = prefs.color;
      if (prefs.size) state.size = prefs.size;
      if (prefs.fogView) state.fogView = prefs.fogView;
    } catch (error) {
      console.error(error);
    }
  }

  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      tool: state.tool,
      color: state.color,
      size: state.size,
      fogView: state.fogView,
    }));
  }

  function commitScene(options) {
    const reloadMap = Boolean(options && options.reloadMap);
    saveChain = saveChain.then(async () => {
      state.scene.rev += 1;
      await VTTDB.putScene(state.scene);
      if (state.project) {
        await VTTDB.putKv(`scene:${state.project.id}`, state.scene);
        state.project.updated = Date.now();
        await VTTDB.putProject(state.project);
      }
      VTTBus.send({ type: 'scene', rev: state.scene.rev, reloadMap });
    }).catch((error) => {
      console.error(error);
      const quota = error && (error.name === 'QuotaExceededError' || error.code === 22);
      toast(quota
        ? 'В браузере кончилось место. Удалите старые карты или выберите файл меньше.'
        : 'Не удалось сохранить сцену.');
    });
    return saveChain;
  }

  function mapById(id) {
    return state.maps.find((map) => map.id === id) || null;
  }

  function currentMap() {
    return mapById(state.scene.currentMapId);
  }

  function ensureLayer(kind) {
    const id = state.scene.currentMapId;
    if (!id) return [];
    const bag = kind === 'fog' ? state.scene.fog : state.scene.drawings;
    if (!bag[id]) bag[id] = [];
    return bag[id];
  }

  function orderedMaps() {
    const known = new Map(state.maps.map((map) => [map.id, map]));
    const ordered = [];
    state.scene.mapOrder.forEach((id) => {
      if (known.has(id)) ordered.push(known.get(id));
    });
    state.maps.forEach((map) => {
      if (!state.scene.mapOrder.includes(map.id)) ordered.push(map);
    });
    return ordered;
  }

  function currentTokens() {
    const id = state.scene.currentMapId;
    return state.scene.tokens.filter((token) => token.mapId === id);
  }

  function selectedToken() {
    return state.scene.tokens.find((token) => token.id === state.selectedId) || null;
  }

  function setTool(tool) {
    state.tool = tool;
    savePrefs();
    ui.board.classList.remove('tool-move', 'tool-draw', 'tool-erase', 'tool-fog', 'tool-reveal');
    ui.board.classList.add(`tool-${tool}`);
    document.querySelectorAll('.tool').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.tool === tool ? 'true' : 'false');
    });
    ui.brushCursor.style.display = 'none';
  }

  function applyFogView() {
    ui.fogLayer.classList.remove('soft', 'solid', 'hidden');
    ui.fogLayer.classList.add(state.fogView);
    ui.fogView.value = state.fogView;
  }

  function applyZoom() {
    ui.board.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    ui.zoomReset.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function layoutBoard() {
    const map = currentMap();
    if (!map || !ui.mapImage.naturalWidth) return;
    const rect = ui.stage.getBoundingClientRect();
    const fitted = VTTPaint.contain(rect.width - 28, rect.height - 28, ui.mapImage.naturalWidth, ui.mapImage.naturalHeight);
    ui.board.style.width = `${fitted.w}px`;
    ui.board.style.height = `${fitted.h}px`;
    const size = VTTPaint.canvasSize(ui.mapImage.naturalWidth, ui.mapImage.naturalHeight, 4096);
    const resized = ui.drawLayer.width !== size.w || ui.drawLayer.height !== size.h
      || ui.gridLayer.width !== size.w || ui.gridLayer.height !== size.h;
    if (resized) {
      ui.drawLayer.width = size.w;
      ui.drawLayer.height = size.h;
      ui.fogLayer.width = size.w;
      ui.fogLayer.height = size.h;
      ui.gridLayer.width = size.w;
      ui.gridLayer.height = size.h;
      replay();
    }
  }

  function replay() {
    const id = state.scene.currentMapId;
    if (!id || !ui.drawLayer.width) return;
    VTTPaint.replayDraw(drawCtx, state.scene.drawings[id] || []);
    VTTPaint.replayFog(fogCtx, state.scene.fog[id] || []);
    paintGrid();
    paintActiveStroke();
  }

  function defaultGrid() {
    return {
      enabled: false,
      type: 'square',
      cols: 22,
      offsetX: 0,
      offsetY: 0,
      color: '#e0c088',
      opacity: 0.5,
      major: 5,
      onTable: true,
    };
  }

  function currentGrid(create) {
    const id = state.scene.currentMapId;
    if (!id) return null;
    if (!state.scene.grids) state.scene.grids = {};
    if (!state.scene.grids[id] && create) state.scene.grids[id] = defaultGrid();
    return state.scene.grids[id] || null;
  }

  function paintGrid() {
    if (!ui.gridLayer.width) return;
    VTTPaint.drawGrid(gridCtx, currentGrid(false));
  }

  function syncGridControls() {
    const grid = currentGrid(false) || defaultGrid();
    const enabled = Boolean(currentGrid(false) && currentGrid(false).enabled);
    document.getElementById('gridOn').checked = enabled;
    document.getElementById('gridTable').checked = grid.onTable !== false;
    document.getElementById('gridType').value = grid.type || 'square';
    document.getElementById('gridCols').value = String(grid.cols || 22);
    document.getElementById('gridColsLabel').textContent = String(grid.cols || 22);
    document.getElementById('gridOffsetX').value = String(grid.offsetX || 0);
    document.getElementById('gridOffsetY').value = String(grid.offsetY || 0);
    document.getElementById('gridColor').value = grid.color || '#e0c088';
    document.getElementById('gridOpacity').value = String(grid.opacity || 0.5);
    document.getElementById('gridOpacityLabel').textContent = `${Math.round((grid.opacity || 0.5) * 100)}%`;
    document.getElementById('gridMajor').value = String(grid.major || 0);
    document.getElementById('gridSection').querySelectorAll('input, select').forEach((input) => {
      if (input.id !== 'gridOn') input.disabled = !state.scene.currentMapId;
    });
    document.getElementById('gridOn').disabled = !state.scene.currentMapId;
  }

  function updateGrid(partial) {
    const grid = currentGrid(true);
    if (!grid) return;
    Object.assign(grid, partial);
    syncGridControls();
    paintGrid();
    commitScene();
  }

  function paintActiveStroke() {
    if (!stroke || stroke.mapId !== state.scene.currentMapId || !stroke.points.length) return;
    const ctx = stroke.layer === 'fog' ? fogCtx : drawCtx;
    const points = stroke.points;
    if (points.length === 1) {
      VTTPaint.drawSegment(ctx, null, null, points[0][0], points[0][1], stroke.size, stroke.color, stroke.erase);
      return;
    }
    for (let i = 1; i < points.length; i += 1) {
      VTTPaint.drawSegment(
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

  let mapQuery = '';

  function renderMapList() {
    const maps = orderedMaps();
    ui.mapList.textContent = '';
    const index = maps.findIndex((map) => map.id === state.scene.currentMapId);
    ui.slideLabel.textContent = maps.length ? `${index + 1} / ${maps.length}` : '0 / 0';
    ui.prevMap.disabled = index <= 0;
    ui.nextMap.disabled = index < 0 || index >= maps.length - 1;
    updateShowButton();
    const query = mapQuery.trim().toLocaleLowerCase('ru');
    const visible = query
      ? maps.filter((map) => map.name.toLocaleLowerCase('ru').includes(query))
      : maps;
    if (!visible.length) {
      const empty = document.createElement('li');
      empty.className = 'map-empty';
      empty.textContent = maps.length ? 'Ничего не найдено' : 'Карт пока нет';
      ui.mapList.appendChild(empty);
      return;
    }
    visible.forEach((map) => {
      const mapIndex = maps.findIndex((item) => item.id === map.id);
      const item = document.createElement('li');
      const onTable = map.id === state.scene.tableMapId;
      item.className = `map-card${map.id === state.scene.currentMapId ? ' active' : ''}${onTable ? ' on-table' : ''}`;
      item.dataset.map = map.id;

      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'thumb';
      thumb.dataset.act = 'open';
      const image = document.createElement('img');
      image.src = map.url;
      image.alt = '';
      thumb.appendChild(image);

      const meta = document.createElement('div');
      meta.className = 'map-meta';
      const name = document.createElement('span');
      name.textContent = map.name;
      if (map.id === state.scene.tableMapId) {
        const badge = document.createElement('small');
        badge.className = 'on-table-badge';
        badge.textContent = 'на столе';
        name.appendChild(document.createTextNode(' '));
        name.appendChild(badge);
      }
      const actions = document.createElement('div');
      actions.className = 'map-actions';
      actions.append(
        miniButton('up', '↑', 'Раньше', mapIndex === 0),
        miniButton('down', '↓', 'Позже', mapIndex === maps.length - 1),
        miniButton('rename', 'Аа', 'Переименовать', false),
        miniButton('delete', '×', 'Удалить карту', false)
      );
      meta.append(name, actions);
      item.append(thumb, meta);
      ui.mapList.appendChild(item);
    });
  }

  function miniButton(act, text, label, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini';
    button.dataset.act = act;
    button.textContent = text;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.disabled = disabled;
    return button;
  }

  async function renderTokens() {
    const tokens = currentTokens().slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    ui.tokenLayer.textContent = '';
    ui.tokenList.textContent = '';
    for (const token of tokens) {
      const url = await tokenUrl(token.id);
      const wrap = document.createElement('div');
      wrap.className = `token${token.id === state.selectedId ? ' selected' : ''}`;
      wrap.dataset.id = token.id;
      const image = document.createElement('img');
      image.alt = token.name || '';
      image.draggable = false;
      if (url) image.src = url;
      const rot = document.createElement('button');
      rot.type = 'button';
      rot.className = 'handle rot';
      rot.dataset.handle = 'rot';
      rot.setAttribute('aria-label', 'Повернуть');
      const scale = document.createElement('button');
      scale.type = 'button';
      scale.className = 'handle scale';
      scale.dataset.handle = 'scale';
      scale.setAttribute('aria-label', 'Масштаб');
      wrap.append(image, rot, scale);
      VTTPaint.applyTokenStyle(wrap, token);
      ui.tokenLayer.appendChild(wrap);

      const row = document.createElement('li');
      row.className = `token-row${token.id === state.selectedId ? ' active' : ''}`;
      row.dataset.id = token.id;
      const thumb = document.createElement('img');
      thumb.alt = '';
      if (url) thumb.src = url;
      const name = document.createElement('div');
      name.className = 'name';
      const label = document.createElement('span');
      label.textContent = token.name || 'Фигура';
      name.appendChild(label);
      row.append(thumb, name);
      ui.tokenList.appendChild(row);
    }
    const selected = selectedToken();
    ui.tokenEditor.hidden = !selected;
    if (selected) {
      ui.tokenScale.value = String(selected.scale);
      ui.tokenRotate.value = String(Math.round(selected.rotation || 0));
    }
  }

  const tokenUrls = new Map();

  async function tokenUrl(id) {
    if (tokenUrls.has(id)) return tokenUrls.get(id);
    const blob = await VTTDB.getBlob(id);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    tokenUrls.set(id, url);
    return url;
  }

  function showMap(id, fade) {
    const map = mapById(id);
    state.scene.currentMapId = map ? map.id : null;
    state.selectedId = null;
    const has = Boolean(map);
    ui.board.hidden = !has;
    ui.empty.hidden = has;
    ui.board.classList.toggle('pixelated', !!state.scene.pixelated);
    if (!map) {
      renderMapList();
      renderTokens();
      syncGridControls();
      return;
    }
    let applied = false;
    const apply = () => {
      if (applied) return;
      applied = true;
      layoutBoard();
      replay();
      renderTokens();
      ui.board.classList.remove('switching');
    };
    if (ui.mapImage.getAttribute('src') !== map.url) {
      if (fade) ui.board.classList.add('switching');
      ui.mapImage.onload = apply;
      ui.mapImage.alt = map.name;
      ui.mapImage.src = map.url;
      if (ui.mapImage.complete && ui.mapImage.naturalWidth) apply();
    } else {
      apply();
    }
    renderMapList();
    syncGridControls();
    const card = ui.mapList.querySelector(`[data-map="${id}"]`);
    if (card) card.scrollIntoView({ block: 'nearest' });
  }

  function updateShowButton() {
    const button = document.getElementById('showSlide');
    const note = document.getElementById('tableSlideNote');
    if (!button || !note) return;
    const gm = mapById(state.scene.currentMapId);
    const table = mapById(state.scene.tableMapId);
    const same = Boolean(gm) && state.scene.tableMapId === state.scene.currentMapId;
    button.disabled = !gm || same;
    button.textContent = same ? 'На столе' : 'Показать игрокам';
    note.classList.toggle('pending', Boolean(gm) && !same);
    if (!table) note.textContent = 'Игроки пока ничего не видят';
    else if (same) note.textContent = 'Игроки видят эту карту';
    else note.textContent = `Игроки видят «${table.name}»`;
  }

  function showSlide() {
    const map = currentMap();
    if (!map || state.scene.tableMapId === map.id) return;
    state.scene.tableMapId = map.id;
    commitScene({ reloadMap: true });
    renderMapList();
    toast(`На столе карта «${map.name}»`);
  }

  function selectMap(id) {
    if (id === state.scene.currentMapId) return;
    showMap(id, true);
    commitScene();
  }

  function stepMap(delta) {
    const maps = orderedMaps();
    const index = maps.findIndex((map) => map.id === state.scene.currentMapId);
    const next = maps[index + delta];
    if (next) selectMap(next.id);
  }

  async function rememberMap(record) {
    record.url = URL.createObjectURL(record.blob);
    state.maps.push(record);
    if (!state.scene.mapOrder.includes(record.id)) state.scene.mapOrder.push(record.id);
    if (!state.scene.drawings[record.id]) state.scene.drawings[record.id] = [];
    if (!state.scene.fog[record.id]) state.scene.fog[record.id] = [];
  }

  async function addMapFiles(files) {
    let lastId = null;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const url = URL.createObjectURL(file);
        await VTTPaint.loadImage(url);
        URL.revokeObjectURL(url);
      } catch (error) {
        toast(`Не удалось открыть «${file.name}».`);
        continue;
      }
      const record = {
        id: crypto.randomUUID(),
        name: prettyName(file.name),
        created: Date.now(),
        projectId: state.project && state.project.id,
        blob: file,
      };
      await VTTDB.putMap(record);
      await rememberMap(record);
      lastId = record.id;
    }
    if (!lastId) return;
    showMap(lastId, true);
    await commitScene();
  }

  async function addGrid() {
    const blob = await blankGridBlob();
    const record = {
      id: crypto.randomUUID(),
      name: `Пустая карта ${state.maps.length + 1}`,
      created: Date.now(),
      projectId: state.project && state.project.id,
      blob,
    };
    await VTTDB.putMap(record);
    await rememberMap(record);
    showMap(record.id, true);
    await commitScene();
  }

  function blankGridBlob() {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a2420';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(224, 192, 136, 0.16)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= canvas.width; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(224, 192, 136, 0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(36, 36, canvas.width - 72, canvas.height - 72);
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
  }

  async function deleteMap(id) {
    const map = mapById(id);
    if (!map) return;
    const ok = await ask(`Удалить карту «${map.name}» вместе с рисунком, туманом и фигурами?`, 'Удалить');
    if (!ok) return;
    state.scene.mapOrder = state.scene.mapOrder.filter((item) => item !== id);
    delete state.scene.drawings[id];
    delete state.scene.fog[id];
    if (state.scene.grids) delete state.scene.grids[id];
    const removed = state.scene.tokens.filter((token) => token.mapId === id);
    state.scene.tokens = state.scene.tokens.filter((token) => token.mapId !== id);
    await Promise.all(removed.map((token) => VTTDB.deleteBlob(token.id)));
    removed.forEach((token) => {
      const url = tokenUrls.get(token.id);
      if (url) URL.revokeObjectURL(url);
      tokenUrls.delete(token.id);
    });
    await VTTDB.deleteMap(id);
    URL.revokeObjectURL(map.url);
    state.maps = state.maps.filter((item) => item.id !== id);
    const wasOnTable = state.scene.tableMapId === id;
    if (wasOnTable) state.scene.tableMapId = null;
    const next = orderedMaps()[0];
    showMap(next ? next.id : null, true);
    await commitScene(wasOnTable ? { reloadMap: true } : undefined);
  }

  function moveMap(id, delta) {
    const order = state.scene.mapOrder.slice();
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    const swap = order[target];
    order[target] = order[index];
    order[index] = swap;
    state.scene.mapOrder = order;
    renderMapList();
    commitScene();
  }

  function renameMap(id) {
    const card = ui.mapList.querySelector(`[data-map="${id}"] .map-meta span`);
    const map = mapById(id);
    if (!card || !map) return;
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = map.name;
    card.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) {
        const name = input.value.trim();
        if (name) {
          map.name = name;
          if (state.scene.currentMapId === id) ui.mapImage.alt = name;
        }
      }
      renderMapList();
      if (save) commitScene();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  async function addTokenFiles(files) {
    if (!currentMap()) {
      toast('Сначала выберите карту.');
      return;
    }
    const knockout = document.getElementById('knockout').checked;
    const threshold = Number(document.getElementById('keyThreshold').value);
    let added = false;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      let blob = file;
      try {
        blob = await prepareTokenBlob(file, knockout, threshold);
      } catch (error) {
        toast(`Не удалось открыть «${file.name}».`);
        continue;
      }
      const token = {
        id: crypto.randomUUID(),
        mapId: state.scene.currentMapId,
        name: prettyName(file.name),
        x: 0.5 + (currentTokens().length % 5) * 0.04,
        y: 0.5 + (currentTokens().length % 4) * 0.04,
        scale: 0.18,
        rotation: 0,
        z: ++state.scene.nextZ,
      };
      await VTTDB.putBlob(token.id, blob);
      state.scene.tokens.push(token);
      state.selectedId = token.id;
      setTool('move');
      added = true;
    }
    if (!added) return;
    await renderTokens();
    await commitScene();
  }

  async function prepareTokenBlob(file, knockout, threshold) {
    const url = URL.createObjectURL(file);
    try {
      const image = await VTTPaint.loadImage(url);
      const maxEdge = 2048;
      const edge = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = edge > maxEdge ? maxEdge / edge : 1;
      if (!knockout && scale === 1) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: knockout });
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (knockout) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        VTTPaint.keyLight(imageData, threshold);
        ctx.putImageData(imageData, 0, 0);
      }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return blob || file;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function deleteSelectedToken() {
    const token = selectedToken();
    if (!token) return;
    state.scene.tokens = state.scene.tokens.filter((item) => item.id !== token.id);
    await VTTDB.deleteBlob(token.id);
    const url = tokenUrls.get(token.id);
    if (url) URL.revokeObjectURL(url);
    tokenUrls.delete(token.id);
    state.selectedId = null;
    await renderTokens();
    await commitScene();
  }

  function updateToken(partial, live) {
    const token = selectedToken();
    if (!token) return;
    Object.assign(token, partial);
    const el = ui.tokenLayer.querySelector(`[data-id="${token.id}"]`);
    if (el) VTTPaint.applyTokenStyle(el, token);
    if (partial.scale != null) ui.tokenScale.value = String(token.scale);
    if (partial.rotation != null) ui.tokenRotate.value = String(Math.round(token.rotation));
    VTTBus.send({
      type: 'token-pose',
      id: token.id,
      x: token.x,
      y: token.y,
      scale: token.scale,
      rotation: token.rotation,
      z: token.z,
    });
    if (!live) commitScene();
  }

  function pointerNorm(event) {
    const rect = ui.board.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function brushMode() {
    if (state.tool === 'draw') return { layer: 'draw', erase: false, color: state.color };
    if (state.tool === 'erase') return { layer: 'draw', erase: true, color: '#000000' };
    if (state.tool === 'fog') return { layer: 'fog', erase: false, color: '#000000' };
    if (state.tool === 'reveal') return { layer: 'fog', erase: true, color: '#000000' };
    return null;
  }

  function pushHistory(entry) {
    state.history.push(entry);
    if (state.history.length > 80) state.history.shift();
  }

  function beginStroke(point) {
    const mode = brushMode();
    if (!mode || !state.scene.currentMapId) return;
    stroke = {
      id: crypto.randomUUID(),
      mapId: state.scene.currentMapId,
      layer: mode.layer,
      erase: mode.erase,
      color: mode.color,
      size: state.size,
      points: [[VTTPaint.roundPoint(point.x), VTTPaint.roundPoint(point.y)]],
      last: point,
    };
    const ctx = mode.layer === 'fog' ? fogCtx : drawCtx;
    VTTPaint.drawSegment(ctx, null, null, point.x, point.y, state.size, mode.color, mode.erase);
    VTTBus.send({
      type: 'live-start',
      mapId: stroke.mapId,
      strokeId: stroke.id,
      layer: stroke.layer,
      erase: stroke.erase,
      color: stroke.color,
      size: stroke.size,
    });
    queueLive([[point.x, point.y]]);
  }

  function extendStroke(point) {
    if (!stroke) return;
    const last = stroke.last;
    const dx = point.x - last.x;
    const dy = (point.y - last.y) * (ui.drawLayer.height / Math.max(1, ui.drawLayer.width));
    if (Math.hypot(dx, dy) < 0.0012) return;
    const rounded = [VTTPaint.roundPoint(point.x), VTTPaint.roundPoint(point.y)];
    stroke.points.push(rounded);
    stroke.last = point;
    const ctx = stroke.layer === 'fog' ? fogCtx : drawCtx;
    VTTPaint.drawSegment(ctx, last.x, last.y, point.x, point.y, stroke.size, stroke.color, stroke.erase);
    queueLive([rounded]);
  }

  function queueLive(points) {
    if (!stroke) return;
    liveBatch.push(...points);
    if (liveFrame) return;
    liveFrame = requestAnimationFrame(() => {
      liveFrame = 0;
      if (!stroke || !liveBatch.length) return;
      const points = liveBatch;
      liveBatch = [];
      VTTBus.send({
        type: 'live',
        mapId: stroke.mapId,
        strokeId: stroke.id,
        points,
      });
    });
  }

  function endStroke() {
    if (!stroke) return;
    if (liveFrame) {
      cancelAnimationFrame(liveFrame);
      liveFrame = 0;
    }
    if (liveBatch.length) {
      VTTBus.send({
        type: 'live',
        mapId: stroke.mapId,
        strokeId: stroke.id,
        points: liveBatch,
      });
      liveBatch = [];
    }
    const finished = stroke;
    stroke = null;
    if (!finished.points.length) return;
    const bag = finished.layer === 'fog' ? state.scene.fog : state.scene.drawings;
    if (!bag[finished.mapId]) bag[finished.mapId] = [];
    pushHistory({ type: finished.layer === 'fog' ? 'pop-fog' : 'pop-draw', mapId: finished.mapId });
    bag[finished.mapId].push(finished.layer === 'fog'
      ? { id: finished.id, op: 'stroke', erase: finished.erase, size: finished.size, points: finished.points }
      : { id: finished.id, color: finished.color, erase: finished.erase, size: finished.size, points: finished.points });
    commitScene();
  }

  function undo() {
    const action = state.history.pop();
    if (!action) return;
    if (action.type === 'pop-draw') {
      const list = state.scene.drawings[action.mapId];
      if (list) list.pop();
    } else if (action.type === 'pop-fog') {
      const list = state.scene.fog[action.mapId];
      if (list) list.pop();
    } else if (action.type === 'restore-draw') {
      state.scene.drawings[action.mapId] = action.data;
    } else if (action.type === 'restore-fog') {
      state.scene.fog[action.mapId] = action.data;
    }
    if (action.mapId === state.scene.currentMapId) replay();
    commitScene();
  }

  async function clearLayer(kind) {
    const id = state.scene.currentMapId;
    if (!id) return;
    const label = kind === 'fog' ? 'Убрать весь туман с этой карты?' : 'Удалить весь рисунок с этой карты?';
    const ok = await ask(label, kind === 'fog' ? 'Убрать' : 'Удалить');
    if (!ok) return;
    if (kind === 'fog') {
      pushHistory({ type: 'restore-fog', mapId: id, data: structuredClone(state.scene.fog[id] || []) });
      state.scene.fog[id] = [];
    } else {
      pushHistory({ type: 'restore-draw', mapId: id, data: structuredClone(state.scene.drawings[id] || []) });
      state.scene.drawings[id] = [];
    }
    replay();
    commitScene();
  }

  function fillFog() {
    const id = state.scene.currentMapId;
    if (!id) return;
    const list = ensureLayer('fog');
    pushHistory({ type: 'pop-fog', mapId: id });
    list.push({ op: 'fill' });
    replay();
    commitScene();
  }

  function bindDrawing() {
    ui.pointerLayer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || state.spaceDown || !brushMode()) return;
      if (startGridDrag(event)) return;
      const point = pointerNorm(event);
      if (!point) return;
      try { ui.pointerLayer.setPointerCapture(event.pointerId); } catch (err) { /* указатель уже захвачен или событие синтетическое */ }
      beginStroke(point);
    });
    ui.pointerLayer.addEventListener('pointermove', (event) => {
      moveBrushCursor(event);
      if (!stroke) return;
      const point = pointerNorm(event);
      if (point) extendStroke(point);
    });
    ui.pointerLayer.addEventListener('pointerup', endStroke);
    ui.pointerLayer.addEventListener('pointercancel', endStroke);
    ui.stage.addEventListener('pointermove', moveBrushCursor);
    ui.stage.addEventListener('pointerleave', () => {
      ui.brushCursor.style.display = 'none';
    });
  }

  function moveBrushCursor(event) {
    const brushing = brushMode();
    if (!brushing || ui.board.hidden) {
      ui.brushCursor.style.display = 'none';
      return;
    }
    const rect = ui.board.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) {
      ui.brushCursor.style.display = 'none';
      return;
    }
    const diameter = Math.max(4, state.size * rect.width);
    ui.brushCursor.style.display = 'block';
    ui.brushCursor.style.width = `${diameter}px`;
    ui.brushCursor.style.height = `${diameter}px`;
    ui.brushCursor.style.left = `${event.clientX}px`;
    ui.brushCursor.style.top = `${event.clientY}px`;
  }

  function bindTokens() {
    ui.tokenLayer.addEventListener('pointerdown', (event) => {
      if (startGridDrag(event)) return;
      if (state.tool !== 'move' || event.button !== 0) return;
      const wrap = event.target.closest('.token');
      if (!wrap) return;
      event.preventDefault();
      event.stopPropagation();
      const token = state.scene.tokens.find((item) => item.id === wrap.dataset.id);
      if (!token) return;
      state.selectedId = token.id;
      token.z = ++state.scene.nextZ;
      VTTPaint.applyTokenStyle(wrap, token);
      wrap.classList.add('selected');
      ui.tokenList.querySelectorAll('.token-row').forEach((row) => {
        row.classList.toggle('active', row.dataset.id === token.id);
      });
      ui.tokenLayer.querySelectorAll('.token').forEach((el) => {
        el.classList.toggle('selected', el.dataset.id === token.id);
      });
      ui.tokenEditor.hidden = false;
      ui.tokenScale.value = String(token.scale);
      ui.tokenRotate.value = String(Math.round(token.rotation || 0));

      const handle = event.target.dataset ? event.target.dataset.handle : '';
      const start = pointerNorm(event);
      const origin = { x: token.x, y: token.y, scale: token.scale, rotation: token.rotation || 0 };
      const center = wrap.getBoundingClientRect();
      const cx = center.left + center.width / 2;
      const cy = center.top + center.height / 2;
      const startAngle = Math.atan2(event.clientY - cy, event.clientX - cx);
      const startDist = Math.max(8, Math.hypot(event.clientX - cx, event.clientY - cy));
      try { wrap.setPointerCapture(event.pointerId); } catch (err) { /* указатель уже захвачен */ }

      const move = (ev) => {
        if (handle === 'rot') {
          const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
          let deg = origin.rotation + ((angle - startAngle) * 180) / Math.PI;
          deg = (deg % 360 + 360) % 360;
          updateToken({ rotation: deg }, true);
          return;
        }
        if (handle === 'scale') {
          const dist = Math.max(8, Math.hypot(ev.clientX - cx, ev.clientY - cy));
          updateToken({ scale: clamp(origin.scale * (dist / startDist), 0.03, 1.5) }, true);
          return;
        }
        const point = pointerNorm(ev);
        if (!point || !start) return;
        updateToken({
          x: clamp(origin.x + (point.x - start.x), -0.25, 1.25),
          y: clamp(origin.y + (point.y - start.y), -0.25, 1.25),
        }, true);
      };
      const up = () => {
        wrap.removeEventListener('pointermove', move);
        wrap.removeEventListener('pointerup', up);
        wrap.removeEventListener('pointercancel', up);
        commitScene();
      };
      wrap.addEventListener('pointermove', move);
      wrap.addEventListener('pointerup', up);
      wrap.addEventListener('pointercancel', up);
    });

    ui.tokenList.addEventListener('click', (event) => {
      const row = event.target.closest('[data-id]');
      if (!row) return;
      state.selectedId = row.dataset.id;
      setTool('move');
      const token = selectedToken();
      if (token) {
        token.z = ++state.scene.nextZ;
        VTTBus.send({
          type: 'token-pose',
          id: token.id,
          x: token.x,
          y: token.y,
          scale: token.scale,
          rotation: token.rotation,
          z: token.z,
        });
      }
      renderTokens();
      commitScene();
    });
  }

  function bindPanZoom() {
    ui.stage.addEventListener('wheel', (event) => {
      if (ui.board.hidden) return;
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      state.zoom = clamp(state.zoom * factor, 0.25, 6);
      applyZoom();
    }, { passive: false });

    let pan = null;
    ui.stage.addEventListener('pointerdown', (event) => {
      if (startGridDrag(event)) return;
      const onToken = event.target.closest('.token');
      const panButton = event.button === 1 || event.button === 2 || (event.button === 0 && state.spaceDown && !onToken);
      if (!panButton) return;
      event.preventDefault();
      pan = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      ui.stage.setPointerCapture(event.pointerId);
    });
    ui.stage.addEventListener('pointermove', (event) => {
      if (!pan) return;
      state.panX = pan.panX + (event.clientX - pan.x);
      state.panY = pan.panY + (event.clientY - pan.y);
      applyZoom();
    });
    const endPan = () => { pan = null; };
    ui.stage.addEventListener('pointerup', endPan);
    ui.stage.addEventListener('pointercancel', endPan);
    ui.stage.addEventListener('contextmenu', (event) => event.preventDefault());
    document.getElementById('zoomIn').addEventListener('click', () => {
      state.zoom = clamp(state.zoom * 1.15, 0.25, 6);
      applyZoom();
    });
    document.getElementById('zoomOut').addEventListener('click', () => {
      state.zoom = clamp(state.zoom / 1.15, 0.25, 6);
      applyZoom();
    });
    ui.zoomReset.addEventListener('click', () => {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      applyZoom();
    });
  }

  function bindKeys() {
    window.addEventListener('keydown', (event) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
      if (event.code === 'Space' && !typing) state.spaceDown = true;
      if (!ui.modal.hidden && event.key === 'Escape') {
        ui.modalCancel.click();
        return;
      }
      const projectMenu = document.getElementById('projectMenu');
      if (projectMenu && !projectMenu.hidden && event.key === 'Escape') {
        closeProjectMenu();
        return;
      }
      const repeatable = event.key.startsWith('Arrow') || event.code === 'BracketLeft' || event.code === 'BracketRight';
      if (event.repeat && !repeatable) return;
      if (ui.modal.hidden && (event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
        event.preventDefault();
        saveProjectFile();
        return;
      }
      if (ui.modal.hidden && (event.ctrlKey || event.metaKey) && event.code === 'KeyO') {
        event.preventDefault();
        document.getElementById('projectFile').click();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'Enter') {
        event.preventDefault();
        showView('dice');
        const total = VTTDesk.roll();
        react('Ctrl+Enter', total == null ? 'Кубики' : `Бросок: ${total}`, document.querySelector('[data-tab="dice"]'));
        return;
      }
      if (typing || !ui.modal.hidden) return;
      if (event.altKey || event.ctrlKey || event.metaKey) {
        if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
          event.preventDefault();
          undo();
          react('Ctrl+Z', 'Отменить штрих', document.getElementById('undoBtn'));
        }
        return;
      }
      if (event.code === 'Digit1') {
        showView('table');
        react('1', 'Стол', document.querySelector('[data-tab="table"]'));
      } else if (event.code === 'Digit2' || event.code === 'KeyN') {
        showView('notes');
        react(event.code === 'KeyN' ? 'N' : '2', 'Заметки', document.querySelector('[data-tab="notes"]'));
      } else if (event.code === 'Digit3' || event.code === 'KeyK') {
        showView('dice');
        react(event.code === 'KeyK' ? 'K' : '3', 'Кубики', document.querySelector('[data-tab="dice"]'));
      } else if (event.code === 'KeyV') {
        setTool('move');
        react('V', 'Двигать', document.querySelector('[data-tool="move"]'));
      } else if (event.code === 'KeyB') {
        setTool('draw');
        react('B', 'Кисть', document.querySelector('[data-tool="draw"]'));
      } else if (event.code === 'KeyE') {
        setTool('erase');
        react('E', 'Ластик', document.querySelector('[data-tool="erase"]'));
      } else if (event.code === 'KeyF') {
        setTool('fog');
        react('F', 'Туман', document.querySelector('[data-tool="fog"]'));
      } else if (event.code === 'KeyR') {
        setTool('reveal');
        react('R', 'Стереть туман', document.querySelector('[data-tool="reveal"]'));
      } else if (event.code === 'KeyG') {
        const grid = currentGrid(true);
        if (!grid) return;
        updateGrid({ enabled: !grid.enabled });
        react('G', grid.enabled ? 'Сетка включена' : 'Сетка выключена', document.getElementById('gridOn'));
      } else if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        state.size = clamp(state.size + (event.code === 'BracketRight' ? 0.002 : -0.002), 0.002, 0.08);
        ui.brushSize.value = String(state.size);
        updateSizeLabel();
        savePrefs();
        react(event.code === 'BracketRight' ? ']' : '[', `Толщина ${(state.size * 100).toFixed(1)}%`);
      }
      if (state.selectedId && state.tool === 'move' && event.key.startsWith('Arrow')) {
        const token = selectedToken();
        if (!token) return;
        event.preventDefault();
        const step = event.shiftKey ? 0.05 : 0.01;
        if (event.key === 'ArrowLeft') updateToken({ x: clamp(token.x - step, -0.25, 1.25) });
        if (event.key === 'ArrowRight') updateToken({ x: clamp(token.x + step, -0.25, 1.25) });
        if (event.key === 'ArrowUp') updateToken({ y: clamp(token.y - step, -0.25, 1.25) });
        if (event.key === 'ArrowDown') updateToken({ y: clamp(token.y + step, -0.25, 1.25) });
        if (!event.repeat) react(event.key.replace('Arrow', ''), 'Фигура');
        return;
      }
      if (event.key === 'ArrowLeft') {
        stepMap(-1);
        react('←', 'Предыдущая карта');
      }
      if (event.key === 'ArrowRight') {
        stepMap(1);
        react('→', 'Следующая карта');
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selectedId && state.tool === 'move') {
          event.preventDefault();
          deleteSelectedToken();
          react('Delete', 'Фигура удалена');
        }
      }
      if (event.code === 'Digit0') {
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        applyZoom();
        react('0', 'Масштаб 100%');
      }
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'Space') state.spaceDown = false;
    });
  }

  let reactionTimer = 0;

  function react(keyLabel, text, target) {
    const el = document.getElementById('keyReaction');
    el.hidden = false;
    el.classList.remove('show');
    el.querySelector('kbd').textContent = keyLabel;
    el.querySelector('span').textContent = text;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(reactionTimer);
    reactionTimer = setTimeout(() => {
      el.classList.remove('show');
      el.hidden = true;
    }, 900);
    if (!target) return;
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 450);
  }

  function showView(name) {
    state.view = name;
    document.getElementById('viewTable').hidden = name !== 'table';
    document.getElementById('viewNotes').hidden = name !== 'notes';
    document.getElementById('viewDice').hidden = name !== 'dice';
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.tab === name ? 'true' : 'false');
    });
    if (name === 'table') requestAnimationFrame(() => layoutBoard());
    if (name === 'notes') VTTDesk.focusNotes();
  }

  function startGridDrag(event) {
    const grid = currentGrid(false);
    if (!event.altKey || event.button !== 0 || !grid || !grid.enabled) return false;
    event.preventDefault();
    event.stopPropagation();
    const origin = {
      x: event.clientX,
      y: event.clientY,
      offsetX: grid.offsetX || 0,
      offsetY: grid.offsetY || 0,
      cols: grid.cols || 22,
    };
    const move = (ev) => {
      const rect = ui.board.getBoundingClientRect();
      const cell = rect.width / origin.cols;
      if (!cell) return;
      const next = currentGrid(true);
      next.offsetX = origin.offsetX + (ev.clientX - origin.x) / cell;
      next.offsetY = origin.offsetY + (ev.clientY - origin.y) / cell;
      syncGridControls();
      paintGrid();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      commitScene();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return true;
  }

  function updateSizeLabel() {
    ui.sizeLabel.textContent = `${(state.size * 100).toFixed(1)}% карты`;
  }

  function buildSwatches() {
    COLORS.forEach((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = color;
      button.dataset.color = color;
      button.setAttribute('aria-label', color);
      button.setAttribute('aria-pressed', color === state.color ? 'true' : 'false');
      button.addEventListener('click', () => {
        state.color = color;
        savePrefs();
        paintSwatchState();
        if (state.tool !== 'draw') setTool('draw');
      });
      ui.swatches.appendChild(button);
    });
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = toHex(state.color);
    picker.setAttribute('aria-label', 'Свой цвет');
    picker.addEventListener('input', () => {
      state.color = picker.value;
      savePrefs();
      paintSwatchState();
      setTool('draw');
    });
    ui.swatches.appendChild(picker);
  }

  function paintSwatchState() {
    ui.swatches.querySelectorAll('.swatch').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.color === state.color ? 'true' : 'false');
    });
  }

  function toHex(color) {
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    return '#ff4d3a';
  }

  async function loadScreens() {
    ui.screenList.textContent = '';
    ui.screenNote.textContent = '';
    if (!('getScreenDetails' in window)) {
      ui.screenNote.textContent = 'Этот браузер не сообщает список мониторов. Откройте окно и перетащите его на экран стола. Список дисплеев доступен в Chrome и Edge.';
      addScreenChoice(null, 'Открыть окно стола', false);
      return;
    }
    try {
      state.screenDetails = await window.getScreenDetails();
      const screens = state.screenDetails.screens || [];
      if (!screens.length) {
        addScreenChoice(null, 'Открыть окно стола', false);
        return;
      }
      screens.forEach((screen, index) => {
        const current = screen === state.screenDetails.currentScreen;
        const kind = screen.isInternal ? 'встроенный' : 'внешний';
        const title = `${current ? 'Этот монитор' : `Монитор ${index + 1}`} · ${screen.width}×${screen.height} · ${kind}`;
        addScreenChoice(screen, title, !current);
      });
      if (screens.length === 1) {
        ui.screenNote.textContent = 'Сейчас виден один монитор. Когда второй будет подключён, откройте список ещё раз.';
      }
    } catch (error) {
      ui.screenNote.textContent = 'Доступ к списку экранов не дан. Окно стола можно открыть и перенести на нужный монитор вручную.';
      addScreenChoice(null, 'Открыть окно стола', false);
    }
  }

  function addScreenChoice(screen, label, recommend) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn screen-choice${recommend ? ' recommend' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => openTable(screen));
    ui.screenList.appendChild(button);
  }

  function openTable(screen) {
    const url = new URL('table.html', location.href).href;
    const features = screen
      ? `popup=yes,left=${screen.availLeft},top=${screen.availTop},width=${screen.availWidth},height=${screen.availHeight}`
      : 'popup=yes,width=1280,height=720';
    if (state.tableWin && !state.tableWin.closed) {
      try {
        if (screen) {
          state.tableWin.moveTo(screen.availLeft, screen.availTop);
          state.tableWin.resizeTo(screen.availWidth, screen.availHeight);
        }
        state.tableWin.focus();
      } catch (error) {
        console.error(error);
      }
      ui.screenPicker.hidden = true;
      ui.openTable.setAttribute('aria-expanded', 'false');
      return;
    }
    const win = window.open(url, 'dndTable', features);
    if (!win) {
      toast('Браузер заблокировал окно. Разрешите всплывающие окна для этого сайта и повторите.');
      return;
    }
    state.tableWin = win;
    ui.screenPicker.hidden = true;
    ui.openTable.setAttribute('aria-expanded', 'false');
    toast('На экране стола щёлкните один раз, чтобы развернуть карту на весь экран.');
  }

  function bindFiles() {
    const mapFile = document.getElementById('mapFile');
    const tokenFile = document.getElementById('tokenFile');
    document.getElementById('uploadMap').addEventListener('click', () => mapFile.click());
    document.getElementById('uploadToken').addEventListener('click', () => tokenFile.click());
    mapFile.addEventListener('change', () => {
      addMapFiles([...mapFile.files]);
      mapFile.value = '';
    });
    tokenFile.addEventListener('change', () => {
      addTokenFiles([...tokenFile.files]);
      tokenFile.value = '';
    });
    document.getElementById('addGrid').addEventListener('click', () => addGrid());
    document.getElementById('knockout').addEventListener('change', (event) => {
      ui.thresholdField.hidden = !event.target.checked;
    });

    let dropKind = 'map';
    document.getElementById('mapPanel').addEventListener('dragenter', () => { dropKind = 'map'; });
    document.getElementById('tokenPanel').addEventListener('dragenter', () => { dropKind = 'token'; });
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'));
      if (!files.length) return;
      if (dropKind === 'token' && currentMap()) addTokenFiles(files);
      else addMapFiles(files);
    });
  }

  function showSide(name) {
    document.querySelectorAll('[data-side]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.side === name ? 'true' : 'false');
    });
    document.querySelectorAll('[data-side-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.sidePane !== name;
    });
  }

  function bindLists() {
    ui.mapList.addEventListener('click', (event) => {
      const card = event.target.closest('[data-map]');
      if (!card) return;
      const id = card.dataset.map;
      const act = event.target.closest('[data-act]');
      const action = act ? act.dataset.act : 'open';
      if (action === 'delete') deleteMap(id);
      else if (action === 'up') moveMap(id, -1);
      else if (action === 'down') moveMap(id, 1);
      else if (action === 'rename') renameMap(id);
      else selectMap(id);
    });
    const publishFromMaps = (event) => {
      const act = event.target.closest('[data-act]');
      if ((act && act.dataset.act !== 'open') || event.target.closest('input, .map-actions, #uploadMap, #addGrid')) return;
      const card = event.target.closest('[data-map]');
      if (card && card.dataset.map !== state.scene.currentMapId) selectMap(card.dataset.map);
      showSlide();
    };
    ui.mapList.addEventListener('dblclick', publishFromMaps);
    document.getElementById('mapPanel').addEventListener('dblclick', (event) => {
      if (event.target.closest('#mapList')) return;
      publishFromMaps(event);
    });
    document.getElementById('mapSearch').addEventListener('input', (event) => {
      mapQuery = event.target.value;
      renderMapList();
    });
    document.querySelectorAll('[data-side]').forEach((button) => {
      button.addEventListener('click', () => showSide(button.dataset.side));
    });
    document.getElementById('showSlide').addEventListener('click', showSlide);
    ui.prevMap.addEventListener('click', () => stepMap(-1));
    ui.nextMap.addEventListener('click', () => stepMap(1));
  }

  function setLinked(on) {
    ui.linkStatus.classList.toggle('on', on);
    ui.linkText.textContent = on ? 'Стол на связи' : 'Стол не подключён';
  }

  function prettyName(name) {
    const raw = String(name || '').replace(/\.[^.]+$/, '').trim();
    return raw || 'Карта';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function bindGridControls() {
    const on = document.getElementById('gridOn');
    const onTable = document.getElementById('gridTable');
    const type = document.getElementById('gridType');
    const cols = document.getElementById('gridCols');
    const offsetX = document.getElementById('gridOffsetX');
    const offsetY = document.getElementById('gridOffsetY');
    const color = document.getElementById('gridColor');
    const opacity = document.getElementById('gridOpacity');
    const major = document.getElementById('gridMajor');
    const apply = () => updateGrid({
      enabled: on.checked,
      onTable: onTable.checked,
      type: type.value,
      cols: Number(cols.value),
      offsetX: Number(offsetX.value),
      offsetY: Number(offsetY.value),
      color: color.value,
      opacity: Number(opacity.value),
      major: Number(major.value) || 0,
    });
    [on, onTable, type, cols, offsetX, offsetY, color, opacity, major].forEach((input) => {
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
    });
  }

  function normalizeScene(scene) {
    const next = scene && scene.version === 1 ? scene : VTTDB.emptyScene();
    if (!next.mapOrder) next.mapOrder = [];
    if (!next.drawings) next.drawings = {};
    if (!next.fog) next.fog = {};
    if (!next.tokens) next.tokens = [];
    if (!next.nextZ) next.nextZ = 1;
    if (!next.grids) next.grids = {};
    if (next.tableMapId === undefined) next.tableMapId = next.currentMapId || null;
    return next;
  }

  function closeProjectMenu() {
    const menu = document.getElementById('projectMenu');
    if (!menu) return;
    menu.hidden = true;
    document.getElementById('projectMenuBtn').setAttribute('aria-expanded', 'false');
  }

  function renderProjectButton() {
    if (!state.project) return;
    document.getElementById('projectTitle').textContent = state.project.name;
    const input = document.getElementById('projectName');
    if (document.activeElement !== input) input.value = state.project.name;
  }

  async function renderProjectList() {
    const list = document.getElementById('projectList');
    const projects = (await VTTDB.allProjects() || []).slice().sort((a, b) => {
      if (a.id === state.project.id) return -1;
      if (b.id === state.project.id) return 1;
      return (b.updated || 0) - (a.updated || 0);
    });
    list.textContent = '';
    projects.forEach((project) => {
      const row = document.createElement('li');
      row.className = 'project-row';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn project-open';
      open.textContent = project.id === state.project.id ? `${project.name} · открыт` : project.name;
      if (project.id === state.project.id) {
        open.classList.add('is-current');
        open.setAttribute('aria-current', 'true');
      }
      open.addEventListener('click', () => {
        if (project.id === state.project.id) closeProjectMenu();
        else switchProject(project.id);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Удалить проект ${project.name}`);
      remove.addEventListener('click', () => removeProject(project.id));
      row.append(open, remove);
      list.appendChild(row);
    });
  }

  async function archiveActive() {
    if (!state.project) return;
    await saveChain;
    await VTTDesk.flush();
    const pack = VTTDesk.exportPack();
    await VTTDB.putKv(`notes:${state.project.id}`, pack.notes);
    await VTTDB.putKv(`dice:${state.project.id}`, { presets: pack.presets, history: pack.history });
    await VTTDB.putKv(`scene:${state.project.id}`, state.scene);
    state.project.updated = Date.now();
    await VTTDB.putProject(state.project);
  }

  function releaseMedia() {
    state.maps.forEach((map) => {
      if (map.url) URL.revokeObjectURL(map.url);
    });
    tokenUrls.forEach((url) => URL.revokeObjectURL(url));
    tokenUrls.clear();
    state.maps = [];
  }

  function adoptMaps(records) {
    releaseMedia();
    state.maps = (records || []).filter((map) => map.projectId === state.project.id && map.blob).map((map) => {
      map.url = URL.createObjectURL(map.blob);
      return map;
    });
    state.scene.mapOrder = (state.scene.mapOrder || []).filter((id) => mapById(id));
    state.maps.forEach((map) => {
      if (!state.scene.mapOrder.includes(map.id)) state.scene.mapOrder.push(map.id);
    });
  }

  async function loadProject(id) {
    const project = await VTTDB.getProject(id);
    if (!project) return;
    await saveChain;
    state.project = project;
    await VTTDB.putKv('activeProject', id);
    state.scene = normalizeScene(await VTTDB.getKv(`scene:${id}`));
    state.history = [];
    state.selectedId = null;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    applyZoom();
    ui.pixelated.checked = !!state.scene.pixelated;
    const notes = await VTTDB.getKv(`notes:${id}`);
    const dice = await VTTDB.getKv(`dice:${id}`);
    await VTTDesk.importPack({
      notes: notes || null,
      presets: dice && Array.isArray(dice.presets) ? dice.presets : null,
      history: dice && Array.isArray(dice.history) ? dice.history : [],
    });
    adoptMaps(await VTTDB.allMaps());
    const initial = mapById(state.scene.currentMapId) ? state.scene.currentMapId : (orderedMaps()[0] || {}).id;
    showMap(initial || null, false);
    renderProjectButton();
    await commitScene({ reloadMap: true });
    if (!document.getElementById('projectMenu').hidden) await renderProjectList();
  }

  async function switchProject(id) {
    if (projectBusy || !state.project || id === state.project.id) return;
    projectBusy = true;
    try {
      await archiveActive();
      await loadProject(id);
      closeProjectMenu();
      toast(`Открыт проект «${state.project.name}»`);
    } catch (error) {
      console.error(error);
      toast('Не удалось открыть проект.');
    } finally {
      projectBusy = false;
    }
  }

  async function purgeProject(id) {
    const scene = await VTTDB.getKv(`scene:${id}`);
    const tokens = (scene && scene.tokens) || [];
    await Promise.all(tokens.map((token) => VTTDB.deleteBlob(token.id)));
    const maps = (await VTTDB.allMaps() || []).filter((map) => map.projectId === id);
    await Promise.all(maps.map((map) => VTTDB.deleteMap(map.id)));
    await VTTDB.deleteKv(`scene:${id}`);
    await VTTDB.deleteKv(`notes:${id}`);
    await VTTDB.deleteKv(`dice:${id}`);
  }

  async function createProject() {
    if (projectBusy) return;
    projectBusy = true;
    try {
      await archiveActive();
      const count = (await VTTDB.allProjects() || []).length;
      const project = {
        id: crypto.randomUUID(),
        name: `Проект ${count + 1}`,
        created: Date.now(),
        updated: Date.now(),
      };
      await VTTDB.putProject(project);
      await VTTDB.putKv(`scene:${project.id}`, VTTDB.emptyScene());
      await loadProject(project.id);
      const input = document.getElementById('projectName');
      input.focus();
      input.select();
      toast(`Создан «${project.name}». Можно дать ему имя.`);
    } catch (error) {
      console.error(error);
      toast('Не удалось создать проект.');
    } finally {
      projectBusy = false;
    }
  }

  async function renameProject() {
    const input = document.getElementById('projectName');
    const name = input.value.trim().slice(0, 80) || 'Без названия';
    input.value = name;
    if (!state.project || state.project.name === name) {
      renderProjectButton();
      return;
    }
    state.project.name = name;
    state.project.updated = Date.now();
    await VTTDB.putProject(state.project);
    renderProjectButton();
    if (!document.getElementById('projectMenu').hidden) await renderProjectList();
  }

  async function removeProject(id) {
    if (projectBusy) return;
    const project = await VTTDB.getProject(id);
    if (!project) return;
    const ok = await ask(`Удалить проект «${project.name}» из браузера? Файл на диске, если вы его сохраняли, останется.`, 'Удалить');
    if (!ok) return;
    projectBusy = true;
    try {
      const others = (await VTTDB.allProjects() || [])
        .filter((item) => item.id !== id)
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
      if (state.project.id === id && others.length) {
        await archiveActive();
        await loadProject(others[0].id);
      } else if (state.project.id === id) {
        await purgeProject(id);
        state.scene = VTTDB.emptyScene();
        state.history = [];
        state.selectedId = null;
        await VTTDB.putKv(`scene:${id}`, state.scene);
        await VTTDesk.importPack(null);
        adoptMaps([]);
        showMap(null, false);
        await commitScene({ reloadMap: true });
      }
      if (state.project.id !== id) {
        await purgeProject(id);
        await VTTDB.deleteProject(id);
      }
      await renderProjectList();
      toast(`Проект «${project.name}» удалён из браузера`);
    } catch (error) {
      console.error(error);
      toast('Не удалось удалить проект.');
    } finally {
      projectBusy = false;
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const comma = text.indexOf(',');
        resolve({ type: blob.type || 'application/octet-stream', data: text.slice(comma + 1) });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(data, type) {
    return fetch(`data:${type || 'application/octet-stream'};base64,${data}`).then((response) => response.blob());
  }

  function fileNameFor(name) {
    const clean = String(name || 'проект').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'проект';
    return `${clean}.dndtable.json`;
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function saveProjectFile() {
    if (projectBusy || !state.project) return;
    projectBusy = true;
    try {
      await saveChain;
      await VTTDesk.flush();
      const maps = [];
      for (const map of state.maps) {
        if (!map.blob) continue;
        const encoded = await blobToBase64(map.blob);
        maps.push({
          id: map.id,
          name: map.name,
          created: map.created,
          type: encoded.type,
          data: encoded.data,
        });
      }
      const tokens = [];
      for (const token of state.scene.tokens || []) {
        const blob = await VTTDB.getBlob(token.id);
        if (!blob) continue;
        const encoded = await blobToBase64(blob);
        tokens.push({ id: token.id, type: encoded.type, data: encoded.data });
      }
      const pack = VTTDesk.exportPack();
      downloadJson(fileNameFor(state.project.name), {
        format: 'dnd-virtual-table',
        version: 1,
        id: state.project.id,
        name: state.project.name,
        created: state.project.created,
        saved: new Date().toISOString(),
        scene: state.scene,
        maps,
        tokens,
        notes: pack.notes,
        dice: { presets: pack.presets, history: pack.history },
      });
      toast(`Файл «${fileNameFor(state.project.name)}» сохранён`);
    } catch (error) {
      console.error(error);
      toast('Не удалось сохранить проект.');
    } finally {
      projectBusy = false;
    }
  }

  function aliasId(table, id) {
    if (!id || !table.has(id)) return id;
    return table.get(id);
  }

  function retargetScene(scene, mapAlias, tokenAlias) {
    const next = normalizeScene(JSON.parse(JSON.stringify(scene)));
    const mapOf = (id) => aliasId(mapAlias, id);
    next.currentMapId = mapOf(next.currentMapId);
    next.tableMapId = mapOf(next.tableMapId);
    next.mapOrder = (next.mapOrder || []).map(mapOf);
    const moveBag = (bag) => {
      const out = {};
      Object.keys(bag || {}).forEach((key) => {
        out[mapOf(key)] = bag[key];
      });
      return out;
    };
    next.drawings = moveBag(next.drawings);
    next.fog = moveBag(next.fog);
    next.grids = moveBag(next.grids);
    (next.tokens || []).forEach((token) => {
      token.mapId = mapOf(token.mapId);
      token.id = aliasId(tokenAlias, token.id);
    });
    return next;
  }

  async function installPackage(data, projectId) {
    const projects = await VTTDB.allProjects() || [];
    const foreignMaps = new Set(
      (await VTTDB.allMaps() || [])
        .filter((map) => map.projectId && map.projectId !== projectId)
        .map((map) => map.id)
    );
    const foreignTokens = new Set();
    for (const project of projects) {
      if (project.id === projectId) continue;
      const stored = await VTTDB.getKv(`scene:${project.id}`);
      ((stored && stored.tokens) || []).forEach((token) => foreignTokens.add(token.id));
    }
    const mapAlias = new Map();
    const tokenAlias = new Map();
    (data.maps || []).forEach((map) => {
      if (map && map.id && foreignMaps.has(map.id)) mapAlias.set(map.id, crypto.randomUUID());
    });
    (data.tokens || []).forEach((token) => {
      if (token && token.id && foreignTokens.has(token.id)) tokenAlias.set(token.id, crypto.randomUUID());
    });
    const scene = retargetScene(data.scene, mapAlias, tokenAlias);
    const nextMaps = (Array.isArray(data.maps) ? data.maps : []).map((map) => (
      map && mapAlias.has(map.id) ? Object.assign({}, map, { id: mapAlias.get(map.id) }) : map
    ));
    const incoming = (Array.isArray(data.tokens) ? data.tokens : []).map((token) => (
      token && tokenAlias.has(token.id) ? Object.assign({}, token, { id: tokenAlias.get(token.id) }) : token
    ));
    const previous = await VTTDB.getKv(`scene:${projectId}`);
    const oldIds = new Set(((previous && previous.tokens) || []).map((token) => token.id));
    const nextIds = new Set(incoming.map((token) => token && token.id));
    for (const tokenId of oldIds) {
      if (!nextIds.has(tokenId)) await VTTDB.deleteBlob(tokenId);
    }
    const oldMaps = (await VTTDB.allMaps() || []).filter((map) => map.projectId === projectId);
    const nextMapIds = new Set(nextMaps.map((map) => map && map.id));
    for (const map of oldMaps) {
      if (!nextMapIds.has(map.id)) await VTTDB.deleteMap(map.id);
    }
    for (const map of nextMaps) {
      if (!map || !map.id || !map.data) continue;
      await VTTDB.putMap({
        id: map.id,
        name: map.name || 'Карта',
        created: map.created || Date.now(),
        projectId,
        blob: await base64ToBlob(map.data, map.type),
      });
    }
    for (const token of incoming) {
      if (!token || !token.id || !token.data) continue;
      await VTTDB.putBlob(token.id, await base64ToBlob(token.data, token.type));
    }
    await VTTDB.putKv(`scene:${projectId}`, scene);
    if (data.notes) await VTTDB.putKv(`notes:${projectId}`, data.notes);
    else await VTTDB.deleteKv(`notes:${projectId}`);
    if (data.dice) await VTTDB.putKv(`dice:${projectId}`, data.dice);
    else await VTTDB.deleteKv(`dice:${projectId}`);
    const existing = await VTTDB.getProject(projectId);
    const name = String(data.name || (existing && existing.name) || 'Проект').trim().slice(0, 80) || 'Проект';
    await VTTDB.putProject({
      id: projectId,
      name,
      created: (existing && existing.created) || data.created || Date.now(),
      updated: Date.now(),
    });
  }

  async function openProjectFile(file) {
    if (projectBusy) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (error) {
      toast('Не удалось прочитать файл.');
      return;
    }
    if (!data || data.format !== 'dnd-virtual-table' || !data.scene || typeof data.scene !== 'object') {
      toast('Это не файл проекта виртуального стола.');
      return;
    }
    const projects = await VTTDB.allProjects() || [];
    const id = typeof data.id === 'string' && data.id ? data.id : crypto.randomUUID();
    const existing = projects.find((item) => item.id === id);
    if (existing) {
      const ok = await ask(`Заменить проект «${existing.name}» содержимым файла «${data.name || existing.name}»?`, 'Заменить');
      if (!ok) return;
    }
    projectBusy = true;
    try {
      if (!state.project || state.project.id !== id) await archiveActive();
      await installPackage(data, id);
      await loadProject(id);
      closeProjectMenu();
      toast(`Открыт проект «${state.project.name}»`);
    } catch (error) {
      console.error(error);
      toast('Не удалось открыть файл проекта.');
    } finally {
      projectBusy = false;
    }
  }

  async function ensureProjects() {
    let projects = await VTTDB.allProjects() || [];
    if (!projects.length) {
      const id = crypto.randomUUID();
      const project = { id, name: 'Кампания', created: Date.now(), updated: Date.now() };
      const maps = await VTTDB.allMaps() || [];
      for (const map of maps) {
        if (!map.projectId) {
          await VTTDB.putMap({
            id: map.id,
            name: map.name,
            created: map.created,
            blob: map.blob,
            projectId: id,
          });
        }
      }
      const scene = await VTTDB.getScene();
      if (scene) await VTTDB.putKv(`scene:${id}`, scene);
      await VTTDB.putProject(project);
      await VTTDB.putKv('activeProject', id);
      projects = [project];
    }
    let activeId = await VTTDB.getKv('activeProject');
    let project = projects.find((item) => item.id === activeId);
    if (!project) {
      project = projects.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
      await VTTDB.putKv('activeProject', project.id);
    }
    const maps = await VTTDB.allMaps() || [];
    for (const map of maps) {
      if (!map.projectId) {
        await VTTDB.putMap({
          id: map.id,
          name: map.name,
          created: map.created,
          blob: map.blob,
          projectId: project.id,
        });
      }
    }
    return project;
  }

  function bindProjectMenu() {
    const menu = document.getElementById('projectMenu');
    const button = document.getElementById('projectMenuBtn');
    button.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open;
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        ui.screenPicker.hidden = true;
        ui.openTable.setAttribute('aria-expanded', 'false');
        document.getElementById('projectName').value = state.project.name;
        renderProjectList();
      }
    });
    const nameInput = document.getElementById('projectName');
    nameInput.addEventListener('change', () => {
      renameProject().catch((error) => console.error(error));
    });
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
      }
    });
    document.getElementById('newProject').addEventListener('click', () => createProject());
    document.getElementById('saveProject').addEventListener('click', () => saveProjectFile());
    document.getElementById('openProjectFile').addEventListener('click', () => {
      document.getElementById('projectFile').click();
    });
    document.getElementById('projectFile').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) openProjectFile(file);
    });
  }

  async function init() {
    loadPrefs();
    buildSwatches();
    setTool(state.tool);
    applyFogView();
    updateSizeLabel();
    ui.brushSize.value = String(state.size);
    applyZoom();
    bindDrawing();
    bindTokens();
    bindPanZoom();
    bindKeys();
    bindFiles();
    bindLists();

    document.getElementById('tools').addEventListener('click', (event) => {
      const button = event.target.closest('[data-tool]');
      if (button) setTool(button.dataset.tool);
    });
    ui.brushSize.addEventListener('input', () => {
      state.size = Number(ui.brushSize.value);
      updateSizeLabel();
      savePrefs();
    });
    ui.fogView.addEventListener('change', () => {
      state.fogView = ui.fogView.value;
      applyFogView();
      savePrefs();
    });
    ui.pixelated.addEventListener('change', () => {
      state.scene.pixelated = ui.pixelated.checked;
      ui.board.classList.toggle('pixelated', state.scene.pixelated);
      commitScene();
    });
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('clearDraw').addEventListener('click', () => clearLayer('draw'));
    document.getElementById('clearFog').addEventListener('click', () => clearLayer('fog'));
    document.getElementById('fillFog').addEventListener('click', fillFog);
    document.getElementById('deleteToken').addEventListener('click', deleteSelectedToken);
    ui.tokenScale.addEventListener('input', () => updateToken({ scale: Number(ui.tokenScale.value) }, true));
    ui.tokenScale.addEventListener('change', () => commitScene());
    ui.tokenRotate.addEventListener('input', () => updateToken({ rotation: Number(ui.tokenRotate.value) }, true));
    ui.tokenRotate.addEventListener('change', () => commitScene());

    ui.openTable.addEventListener('click', async () => {
      const open = ui.screenPicker.hidden;
      ui.screenPicker.hidden = !open;
      ui.openTable.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        closeProjectMenu();
        await loadScreens();
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!ui.screenPicker.hidden && !event.target.closest('#screenPicker') && !event.target.closest('#openTable')) {
        ui.screenPicker.hidden = true;
        ui.openTable.setAttribute('aria-expanded', 'false');
      }
      const projectMenu = document.getElementById('projectMenu');
      if (projectMenu && !projectMenu.hidden && !event.target.closest('#projectMenu') && !event.target.closest('#projectMenuBtn')) {
        closeProjectMenu();
      }
    });

    let tableKnown = false;
    VTTBus.on((msg) => {
      if (msg.type === 'ping' || msg.type === 'hello') {
        state.lastPing = Date.now();
        setLinked(true);
        if (msg.type === 'hello' || !tableKnown) {
          tableKnown = true;
          commitScene();
        }
      }
    });
    setInterval(() => setLinked(Date.now() - state.lastPing < 5000), 1000);
    window.addEventListener('resize', layoutBoard);
    new ResizeObserver(() => layoutBoard()).observe(ui.stage);

    state.project = await ensureProjects();
    const storedMaps = await VTTDB.allMaps();
    state.maps = (storedMaps || []).filter((map) => map.projectId === state.project.id && map.blob).map((map) => {
      map.url = URL.createObjectURL(map.blob);
      return map;
    });
    state.scene = normalizeScene(await VTTDB.getScene());
    state.maps.forEach((map) => {
      if (!state.scene.mapOrder.includes(map.id)) state.scene.mapOrder.push(map.id);
    });
    state.scene.mapOrder = state.scene.mapOrder.filter((id) => mapById(id));
    ui.pixelated.checked = !!state.scene.pixelated;
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        showView(button.dataset.tab);
        const labels = { table: 'Стол', notes: 'Заметки', dice: 'Кубики' };
        react(button.querySelector('kbd').textContent, labels[button.dataset.tab] || '', button);
      });
    });
    bindGridControls();
    bindProjectMenu();
    await VTTDesk.init();
    const pack = VTTDesk.exportPack();
    if (!(await VTTDB.getKv(`notes:${state.project.id}`))) {
      await VTTDB.putKv(`notes:${state.project.id}`, pack.notes);
    }
    if (!(await VTTDB.getKv(`dice:${state.project.id}`))) {
      await VTTDB.putKv(`dice:${state.project.id}`, { presets: pack.presets, history: pack.history });
    }
    if (!(await VTTDB.getKv(`scene:${state.project.id}`))) {
      await VTTDB.putKv(`scene:${state.project.id}`, state.scene);
    }
    renderProjectButton();
    const initial = mapById(state.scene.currentMapId) ? state.scene.currentMapId : (orderedMaps()[0] || {}).id;
    showMap(initial || null, false);
  }

  init().catch((error) => {
    console.error(error);
    toast('Не удалось открыть локальное хранилище браузера.');
  });
})();
