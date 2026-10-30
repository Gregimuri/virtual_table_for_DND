'use strict';

(function () {
  const COLORS = ['#f4efe4', '#ff4d3a', '#ffb020', '#3dd68c', '#3aa0ff', '#c46bff', '#1a1a1a'];
  const PREFS_KEY = 'dnd-table-prefs';

  const ui = {
    board: document.getElementById('board'),
    stage: document.getElementById('stage'),
    empty: document.getElementById('empty'),
    mapImage: document.getElementById('mapImage'),
    mapVideo: document.getElementById('mapVideo'),
    drawLayer: document.getElementById('drawLayer'),
    fogLayer: document.getElementById('fogLayer'),
    gridLayer: document.getElementById('gridLayer'),
    planLayer: document.getElementById('planLayer'),
    floorLayer: document.getElementById('floorLayer'),
    tokenLayer: document.getElementById('tokenLayer'),
    backLayer: document.getElementById('backLayer'),
    pointerLayer: document.getElementById('pointerLayer'),
    shapeLayer: document.getElementById('shapeLayer'),
    markerLayer: document.getElementById('markerLayer'),
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
  const shapeCtx = ui.shapeLayer.getContext('2d');
  const planCtx = ui.planLayer.getContext('2d');
  const floorCtx = ui.floorLayer.getContext('2d');

  const state = {
    maps: [],
    scene: VTTDB.emptyScene(),
    tool: 'move',
    color: COLORS[1],
    size: 0.018,
    sizes: { draw: 0.018, erase: 0.03, fog: 0.055, reveal: 0.055 },
    fogView: 'soft',
    zoom: 1,
    panX: 0,
    panY: 0,
    selectedId: null,
    selection: [],
    snap: false,
    recentColors: [],
    gridPresets: [],
    measureKind: 'line',
    floorKind: 'stone',
    propKind: 'column',
    corridorWidth: 1,
    pathRadius: 0.5,
    planDiv: 1,
    ngonSides: 6,
    stairSteps: 4,
    rough: false,
    scrawlCut: false,
    wallsBlock: true,
    planSelect: { wallIds: [], floorId: null, propId: null },
    planAnchor: null,
    corridorPts: [],
    stairPts: [],
    planDraft: null,
    vision: null,
    lastFileSave: 0,
    remindedOn: '',
    ready: false,
    history: [],
    future: [],
    tableWin: null,
    lastPing: 0,
    spaceDown: false,
    screenDetails: null,
    project: null,
  };

  let saveChain = Promise.resolve();
  let sceneLoaded = false;
  let projectBusy = false;
  let library = { folders: [], items: [] };
  let libraryFolderId = null;
  let libraryEditId = null;
  let pickTarget = null;
  let cutTimer = 0;
  let noteTimer = 0;
  let editorFor = null;
  let dropKind = 'map';
  let toastTimer = 0;
  let stroke = null;
  let planDrag = null;
  let tokenGesture = null;
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
      if (prefs.sizes && typeof prefs.sizes === 'object') {
        Object.keys(state.sizes).forEach((tool) => {
          const value = Number(prefs.sizes[tool]);
          if (value) state.sizes[tool] = clamp(value, 0.002, 0.08);
        });
      } else if (prefs.size) {
        state.sizes.draw = clamp(Number(prefs.size) || state.sizes.draw, 0.002, 0.08);
      }
      if (state.sizes[state.tool]) state.size = state.sizes[state.tool];
      if (prefs.fogView) state.fogView = prefs.fogView;
      state.snap = !!prefs.snap;
      state.wallsBlock = prefs.wallsBlock !== false;
      if (prefs.floorKind && VTTPlay.FLOOR_COLORS[prefs.floorKind]) state.floorKind = prefs.floorKind;
      if (Number(prefs.corridorWidth) === 2) state.corridorWidth = 2;
      if (Number(prefs.pathRadius) >= 0.25) state.pathRadius = Math.max(0.25, Math.min(4, Number(prefs.pathRadius)));
      else if (state.corridorWidth === 2) state.pathRadius = 1;
      if ([1, 2, 4].includes(Number(prefs.planDiv))) state.planDiv = Number(prefs.planDiv);
      if (Number(prefs.ngonSides) >= 3) state.ngonSides = Math.max(3, Math.min(8, Math.round(Number(prefs.ngonSides))));
      if (Number(prefs.stairSteps) >= 2) state.stairSteps = Math.max(2, Math.min(12, Math.round(Number(prefs.stairSteps))));
      state.rough = !!prefs.rough;
      state.scrawlCut = !!prefs.scrawlCut;
      state.recentColors = Array.isArray(prefs.recentColors)
        ? prefs.recentColors.filter((color) => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 5)
        : [];
      state.gridPresets = Array.isArray(prefs.gridPresets) && prefs.gridPresets.length
        ? prefs.gridPresets
        : [
          { name: 'Боевая карта', type: 'square', cols: 27, major: 5 },
          { name: 'Гекс похода', type: 'hex-pointy', cols: 18, major: 0 },
        ];
      state.lastFileSave = Number(prefs.lastFileSave) || 0;
      state.remindedOn = prefs.remindedOn || '';
    } catch (error) {
      console.error(error);
    }
  }

  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      tool: state.tool,
      color: state.color,
      size: state.size,
      sizes: state.sizes,
      fogView: state.fogView,
      snap: state.snap,
      wallsBlock: state.wallsBlock,
      floorKind: state.floorKind,
      corridorWidth: state.corridorWidth,
      pathRadius: state.pathRadius,
      planDiv: state.planDiv,
      ngonSides: state.ngonSides,
      stairSteps: state.stairSteps,
      rough: state.rough,
      scrawlCut: state.scrawlCut,
      recentColors: state.recentColors,
      gridPresets: state.gridPresets,
      lastFileSave: state.lastFileSave,
      remindedOn: state.remindedOn,
    }));
  }

  let editsSinceFile = 0;

  function noteEdit() {
    if (!state.ready) return;
    editsSinceFile += 1;
    if (editsSinceFile < 8) return;
    const today = new Date().toDateString();
    if (state.remindedOn === today) return;
    if (state.lastFileSave && new Date(state.lastFileSave).toDateString() === today) return;
    state.remindedOn = today;
    savePrefs();
    toast('За этот вечер уже много правок. Сохраните проект в файл, чтобы он не остался только в браузере.');
  }

  let projectTouchedAt = 0;

  function commitScene(options) {
    if (!sceneLoaded) return saveChain;
    noteEdit();
    try {
      refreshMapThumbs();
    } catch (error) {
      console.error(error);
    }
    const reloadMap = Boolean(options && options.reloadMap);
    const forceProject = Boolean(options && options.touchProject);
    saveChain = saveChain.then(async () => {
      state.scene.rev += 1;
      await VTTDB.putScene(state.scene);
      if (state.project) {
        await VTTDB.putKv(`scene:${state.project.id}`, state.scene);
        const now = Date.now();
        if (forceProject || now - projectTouchedAt > 30000) {
          projectTouchedAt = now;
          state.project.updated = now;
          await VTTDB.putProject(state.project);
        }
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

  function selectedTokens() {
    const ids = state.selection.length ? state.selection : (state.selectedId ? [state.selectedId] : []);
    return ids.map((id) => state.scene.tokens.find((token) => token.id === id)).filter(Boolean);
  }

  function selectOne(id) {
    state.selectedId = id || null;
    state.selection = id ? [id] : [];
  }

  const TOOL_HINTS = {
    move: 'Тяните объект. Рамкой по пустому месту можно выбрать несколько. Замок с карты не хватается.',
    pointer: 'Щелчок ставит указку. На столе она вспыхивает и гаснет, у вас остаётся.',
    measure: 'Тяните линейку, конус, круг или квадрат. На стол он попадает отдельной кнопкой.',
    draw: 'Кисть рисует выбранным цветом. Её толщина запоминается отдельно.',
    erase: 'Ластик снимает рисунок и не трогает туман. Толщина своя.',
    fog: 'Туман закрывает карту от игроков. Толщина своя.',
    reveal: 'Стирает туман там, где игроки уже могут смотреть.',
    wall: 'Тяните от линии сетки до линии. Shift — наискосок. Следующая стена подхватит конец.',
    room: 'Прямоугольник — комната. Вплотную к другой появится общая стена, с наложением комнаты сольются.',
    poly: 'Щёлкайте углы комнаты. Двойной щелчок или «Закончить» замыкает фигуру.',
    ngon: 'Тяните от центра. Число граней — рядом или клавишами [ и ].',
    corridor: 'Щёлкайте центры клеток. Двойной щелчок заканчивает тропу. [ и ] меняют ширину.',
    carve: 'Тяните прямоугольник: он вырезает пол и оставляет стены по краю дыры.',
    pick: 'Щелчок выбирает комнату, тропу, лестницу или надпись. Потяните, чтобы сдвинуть.',
    stairs: 'Три щелчка: ширина верхней ступени и куда она спускается.',
    text: 'Щелчок ставит надпись из поля рядом. Сначала впишите текст.',
    floor: 'Щелчок красит комнату. На своей фигуре меняется её пол, в старой комнате — заливка.',
    door: 'Щелчок по стене ставит дверь. Повторный щелчок открывает её.',
    window: 'Окно тоньше стены: взгляд проходит, фигура нет.',
    grate: 'Решётка пускает взгляд и держит проход.',
    secret: 'Секрет виден вам. Игроки видят стену, пока дверь не открыта.',
    prop: 'Штамп встаёт в центр клетки. Потяните, чтобы сдвинуть.',
    vision: 'Щелчок показывает, что видно из этой клетки.',
  };

  const PLAN_TOOLS = ['wall', 'room', 'poly', 'ngon', 'corridor', 'carve', 'pick', 'stairs', 'text', 'floor', 'door', 'window', 'grate', 'secret', 'prop', 'vision'];

  function setTool(tool) {
    state.tool = tool;
    ['move', 'draw', 'erase', 'fog', 'reveal', 'pointer', 'measure'].concat(PLAN_TOOLS).forEach((name) => {
      ui.board.classList.remove(`tool-${name}`);
    });
    ui.board.classList.add(`tool-${tool}`);
    document.querySelectorAll('[data-tool]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.tool === tool ? 'true' : 'false');
    });
    document.querySelectorAll('[data-prop]').forEach((button) => {
      button.setAttribute('aria-pressed', state.tool === 'prop' && button.dataset.prop === state.propKind ? 'true' : 'false');
    });
    const hint = document.getElementById('toolHint');
    if (hint) hint.textContent = TOOL_HINTS[tool] || '';
    const sized = Object.prototype.hasOwnProperty.call(state.sizes, tool);
    document.getElementById('brushSection').hidden = !sized;
    ui.swatches.hidden = tool !== 'draw';
    if (sized) {
      state.size = state.sizes[tool];
      ui.brushSize.value = String(state.size);
    }
    updateSizeLabel();
    paintToolSizes();
    savePrefs();
    ui.brushCursor.style.display = 'none';
    if (tool === 'pointer' || tool === 'measure') showSide('scene');
    else if (tool === 'draw' || tool === 'erase' || tool === 'fog' || tool === 'reveal') showSide('tools');
    else if (PLAN_TOOLS.includes(tool)) showSide('plan');
    ui.board.classList.toggle('tool-plan', PLAN_TOOLS.includes(tool));
    if (tool !== 'corridor' && tool !== 'poly') {
      state.corridorPts = [];
      state.planDraft = null;
    }
    if (tool !== 'stairs') state.stairPts = [];
    syncPlanChrome();
  }

  function paintToolSizes() {
    document.querySelectorAll('.tool').forEach((button) => {
      const size = state.sizes[button.dataset.tool];
      let hint = button.querySelector('.tool-size');
      if (!size) {
        if (hint) hint.remove();
        return;
      }
      if (!hint) {
        hint = document.createElement('span');
        hint.className = 'tool-size';
        button.appendChild(hint);
      }
      hint.textContent = `${(size * 100).toFixed(1)}%`;
    });
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

  function fileKind(file) {
    return VTTMedia.fileKind(file);
  }

  function mapIsVideo(map) {
    return VTTMedia.mapIsVideo(map);
  }

  function mediaSize(el) {
    return VTTMedia.mediaSize(el);
  }

  function shownMedia() {
    return ui.mapVideo.hidden ? ui.mapImage : ui.mapVideo;
  }

  function stopMapVideo() {
    VTTMedia.stopVideo(ui.mapVideo);
  }

  function syncPlaybackControls() {
    const bar = document.getElementById('mapPlayback');
    const pauseBtn = document.getElementById('mapPause');
    const soundBtn = document.getElementById('mapSound');
    const on = mapIsVideo(currentMap());
    if (bar) bar.hidden = !on;
    const paused = Boolean(state.scene.mapPaused);
    const sound = Boolean(state.scene.mapSound);
    if (pauseBtn) {
      pauseBtn.textContent = paused ? 'Играть' : 'Пауза';
      pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    }
    if (soundBtn) {
      soundBtn.textContent = sound ? 'Без звука' : 'Звук';
      soundBtn.setAttribute('aria-pressed', sound ? 'true' : 'false');
    }
    if (on) VTTMedia.applyPlayback(ui.mapVideo, state.scene);
  }

  function layoutBoard() {
    const map = currentMap();
    const frame = mediaSize(shownMedia());
    if (!map || !frame) return;
    const rect = ui.stage.getBoundingClientRect();
    const fitted = VTTPaint.contain(rect.width - 28, rect.height - 28, frame.w, frame.h);
    ui.board.style.width = `${fitted.w}px`;
    ui.board.style.height = `${fitted.h}px`;
    const size = VTTPaint.canvasSize(frame.w, frame.h, 4096);
    const resized = ui.drawLayer.width !== size.w || ui.drawLayer.height !== size.h
      || ui.gridLayer.width !== size.w || ui.gridLayer.height !== size.h
      || ui.planLayer.width !== size.w || ui.planLayer.height !== size.h
      || ui.floorLayer.width !== size.w || ui.floorLayer.height !== size.h;
    if (resized) {
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
      replay();
    }
  }

  function replay() {
    const id = state.scene.currentMapId;
    if (!id || !ui.drawLayer.width) return;
    VTTPaint.replayDraw(drawCtx, state.scene.drawings[id] || []);
    VTTPaint.replayFog(fogCtx, state.scene.fog[id] || []);
    paintGrid();
    paintPlanLayer();
    paintShapes();
    paintActiveStroke();
  }

  function defaultGrid() {
    return {
      enabled: false,
      type: 'square',
      cols: 27,
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
    document.getElementById('gridCols').value = String(grid.cols || 27);
    document.getElementById('gridColsLabel').textContent = String(grid.cols || 27);
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

  function updateGrid(partial, persist) {
    const grid = currentGrid(true);
    if (!grid) return;
    Object.assign(grid, partial);
    if (partial.cols != null) {
      document.getElementById('gridColsLabel').textContent = String(grid.cols || 27);
      fitSizedTokens();
    }
    if (partial.opacity != null) {
      document.getElementById('gridOpacityLabel').textContent = `${Math.round((Number(grid.opacity) || 0.5) * 100)}%`;
    }
    paintGrid();
    if (persist !== false) commitScene();
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
  const thumbCache = new Map();

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
      const plan = document.createElement('canvas');
      plan.className = 'thumb-plan';
      plan.setAttribute('aria-hidden', 'true');
      if (mapIsVideo(map)) {
        const video = document.createElement('video');
        VTTMedia.bindPoster(video, map.url);
        thumb.append(video, plan);
        video.addEventListener('loadedmetadata', () => paintMapThumb(plan, map, video));
      } else {
        const image = document.createElement('img');
        image.src = map.url;
        image.alt = '';
        thumb.append(image, plan);
        image.addEventListener('load', () => paintMapThumb(plan, map, image));
      }
      paintMapThumb(plan, map, thumb.querySelector('img, video'));

      const meta = document.createElement('div');
      meta.className = 'map-meta';
      const title = document.createElement('div');
      title.className = 'map-title';
      const name = document.createElement('span');
      name.dataset.name = '1';
      name.textContent = map.name;
      name.title = map.name;
      title.appendChild(name);
      if (map.id === state.scene.tableMapId) {
        const badge = document.createElement('small');
        badge.className = 'on-table-badge';
        badge.textContent = 'на столе';
        title.appendChild(badge);
      }
      const actions = document.createElement('div');
      actions.className = 'map-actions';
      actions.append(
        miniButton('up', '↑', 'Раньше', mapIndex === 0),
        miniButton('down', '↓', 'Позже', mapIndex === maps.length - 1),
        miniButton('rename', 'Аа', 'Переименовать', false),
        miniButton('copy', 'Копия', 'Скопировать в новую карту', false),
        miniButton('delete', '×', 'Удалить карту', false)
      );
      meta.append(title, actions);
      item.append(thumb, meta);
      ui.mapList.appendChild(item);
    });
  }

  function thumbSignature(mapId) {
    let hash = 2166136261;
    const mix = (value) => {
      if (value == null || value === '') return;
      const text = String(value);
      for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    };
    const grid = state.scene.grids && state.scene.grids[mapId];
    mix(grid ? `${grid.cols}:${grid.offsetX}:${grid.offsetY}:${grid.type}` : 'grid');
    ['scrawls', 'walls', 'floors', 'openings', 'flights'].forEach((key) => {
      (state.scene[key] || []).forEach((item) => {
        if (!item || item.mapId !== mapId) return;
        mix(key);
        mix(item.kind);
        mix(item.op);
        mix(item.floor);
        mix(item.open);
        mix(item.edge);
        mix(item.x);
        mix(item.y);
        mix(item.x2);
        mix(item.y2);
        mix(item.x3);
        mix(item.y3);
        (item.points || []).forEach((point) => {
          mix(point.x);
          mix(point.y);
        });
        (item.cells || []).forEach((cell) => {
          hash = Math.imul(hash ^ (cell[0] | 0), 16777619);
          hash = Math.imul(hash ^ (cell[1] | 0), 16777619);
        });
      });
    });
    const cols = grid ? Number(grid.cols) || 27 : 27;
    (state.scene.tokens || []).forEach((token) => {
      if (!token || token.mapId !== mapId) return;
      if ((Number(token.scale) || 0) * cols < 1.6) return;
      mix(token.x);
      mix(token.y);
      mix(token.scale);
      mix(token.hidden);
    });
    return hash >>> 0;
  }

  function mediaAspect(media) {
    const width = media && (media.naturalWidth || media.videoWidth);
    const height = media && (media.naturalHeight || media.videoHeight);
    if (width > 0 && height > 0) return height / width;
    return 9 / 16;
  }

  function paintMapThumb(canvas, map, media) {
    if (!canvas || !map) return;
    const aspect = mediaAspect(media);
    const sig = `${thumbSignature(map.id)}:${aspect.toFixed(3)}`;
    let cached = thumbCache.get(map.id);
    if (!cached || cached.sig !== sig) {
      const holder = document.createElement('canvas');
      const grid = (state.scene.grids && state.scene.grids[map.id]) || { cols: 27, type: 'square' };
      const plan = VTTPlay.assemblePlan(state.scene, map.id, grid, aspect);
      const tokens = (state.scene.tokens || []).filter((token) => token.mapId === map.id);
      try {
        VTTPlay.paintSilhouette(holder.getContext('2d'), plan, tokens, grid, aspect);
      } catch (error) {
        console.error(error);
        holder.width = 280;
        holder.height = Math.max(48, Math.round(280 * aspect));
      }
      cached = { sig, canvas: holder };
      thumbCache.set(map.id, cached);
    }
    if (canvas.width !== cached.canvas.width || canvas.height !== cached.canvas.height) {
      canvas.width = cached.canvas.width;
      canvas.height = cached.canvas.height;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cached.canvas, 0, 0);
  }

  function refreshMapThumbs() {
    if (!ui.mapList) return;
    ui.mapList.querySelectorAll('.map-card').forEach((card) => {
      const canvas = card.querySelector('.thumb-plan');
      const map = mapById(card.dataset.map);
      if (!canvas || !map) return;
      paintMapThumb(canvas, map, card.querySelector('img, video'));
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

  function tokenHost(token) {
    return token && token.back ? ui.backLayer : ui.tokenLayer;
  }

  function tokenEl(id) {
    return ui.tokenLayer.querySelector(`[data-id="${id}"]`) || ui.backLayer.querySelector(`[data-id="${id}"]`);
  }

  function tokenClass(token, primary, picked) {
    return `token${primary ? ' selected' : ''}${picked && !primary ? ' in-selection' : ''}${token.hidden ? ' is-hidden' : ''}${token.locked ? ' is-locked' : ''}${token.back ? ' is-back' : ''}`;
  }

  function markTokenChrome() {
    [...ui.tokenLayer.children, ...ui.backLayer.children].forEach((el) => {
      const token = state.scene.tokens.find((item) => item.id === el.dataset.id);
      if (!token) return;
      const primary = token.id === state.selectedId;
      const picked = state.selection.includes(token.id);
      el.className = tokenClass(token, primary, picked);
      const host = tokenHost(token);
      if (el.parentElement !== host) host.appendChild(el);
    });
    [...ui.tokenList.children].forEach((row) => {
      row.classList.toggle('active', state.selection.includes(row.dataset.id));
    });
  }

  async function renderTokens() {
    const tokens = currentTokens().slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    const keep = new Set(tokens.map((token) => token.id));
    [...ui.tokenLayer.children, ...ui.backLayer.children].forEach((el) => {
      if (!keep.has(el.dataset.id)) el.remove();
    });
    [...ui.tokenList.children].forEach((el) => {
      if (!keep.has(el.dataset.id)) el.remove();
    });
    for (const token of tokens) {
      const source = token.libraryId || token.id;
      const key = lookKey(source, token.cut);
      let url = '';
      try {
        url = await lookUrl(source, token.cut);
      } catch (error) {
        console.error(error);
      }
      const host = tokenHost(token);
      let wrap = tokenEl(token.id);
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.dataset.id = token.id;
        const image = document.createElement('img');
        image.draggable = false;
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
        host.appendChild(wrap);
      } else if (wrap.parentElement !== host) {
        host.appendChild(wrap);
      }
      const primary = token.id === state.selectedId;
      const picked = state.selection.includes(token.id);
      wrap.className = tokenClass(token, primary, picked);
      const image = wrap.querySelector('img');
      if (image) {
        image.alt = token.name || '';
        if (url && image.dataset.look !== key) {
          image.dataset.look = key;
          image.src = url;
        }
      }
      VTTPaint.applyTokenStyle(wrap, token);
      VTTPlay.syncChrome(wrap, token, 'gm');

      let row = ui.tokenList.querySelector(`[data-id="${token.id}"]`);
      if (!row) {
        row = document.createElement('li');
        row.dataset.id = token.id;
        const thumb = document.createElement('img');
        thumb.alt = '';
        const name = document.createElement('div');
        name.className = 'name';
        const label = document.createElement('span');
        name.appendChild(label);
        row.append(thumb, name);
        ui.tokenList.appendChild(row);
      }
      row.className = `token-row${state.selection.includes(token.id) ? ' active' : ''}`;
      const thumb = row.querySelector('img');
      if (thumb && url && thumb.dataset.look !== key) {
        thumb.dataset.look = key;
        thumb.src = url;
      }
      const label = row.querySelector('.name span');
      if (label) {
        const bits = [];
        if (token.hidden) bits.push('скрыт');
        if (token.locked) bits.push('замок');
        if (token.back) bits.push('под сеткой');
        bits.push(token.name || 'Объект');
        label.textContent = bits.join(' · ');
      }
    }
    const turn = activeTurn();
    const turnToken = turn && turn.tokenId ? currentTokens().find((token) => token.id === turn.tokenId) : null;
    VTTPlay.placeRing(ui.markerLayer, turnToken || null);
    renderPointer();
    tokens.forEach((token) => {
      const wrap = tokenEl(token.id);
      if (wrap) tokenHost(token).appendChild(wrap);
      const row = ui.tokenList.querySelector(`[data-id="${token.id}"]`);
      if (row) ui.tokenList.appendChild(row);
    });
    syncTokenEditor(selectedToken());
  }

  const tokenUrls = new Map();
  const sourceImages = new Map();

  function lookKey(blobId, cut) {
    const mark = cut && cut.color ? `${cut.color}:${cut.tolerance || 0}` : '';
    return `${blobId}|${mark}`;
  }

  async function lookUrl(blobId, cut) {
    if (!blobId) return '';
    const key = lookKey(blobId, cut);
    if (tokenUrls.has(key)) return tokenUrls.get(key);
    const blob = await VTTDB.getBlob(blobId);
    if (!blob) return '';
    const painted = await VTTPaint.cutBlob(blob, cut);
    const url = URL.createObjectURL(painted || blob);
    tokenUrls.set(key, url);
    return url;
  }

  function forgetLooks(blobId) {
    [...tokenUrls.keys()].forEach((key) => {
      if (key === blobId || String(key).startsWith(`${blobId}|`)) {
        const url = tokenUrls.get(key);
        if (url) URL.revokeObjectURL(url);
        tokenUrls.delete(key);
      }
    });
    sourceImages.delete(blobId);
  }

  function cleanCut(cut) {
    if (!cut || !cut.color) return null;
    const color = String(cut.color).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) return null;
    return { color, tolerance: Math.max(0, Math.min(160, Math.round(Number(cut.tolerance) || 0))) };
  }

  function lightCut(threshold) {
    const tol = Math.round((255 - Number(threshold || 232)) * 0.85);
    return { color: '#ffffff', tolerance: Math.max(18, Math.min(80, tol)) };
  }

  function syncTokenEditor(token) {
    const editor = document.getElementById('tokenEditor');
    editor.hidden = !token;
    if (!token) {
      editorFor = null;
      return;
    }
    const fresh = editorFor !== token.id;
    editorFor = token.id;
    const name = document.getElementById('tokenName');
    const cutOn = document.getElementById('tokenCutOn');
    const cutColor = document.getElementById('tokenCutColor');
    const cutTol = document.getElementById('tokenCutTol');
    const tools = document.getElementById('tokenCutTools');
    const note = document.getElementById('tokenCutNote');
    const reset = document.getElementById('tokenCutReset');
    if (fresh || document.activeElement !== ui.tokenScale) ui.tokenScale.value = String(token.scale);
    if (fresh || document.activeElement !== ui.tokenRotate) ui.tokenRotate.value = String(Math.round(token.rotation || 0));
    if (fresh || document.activeElement !== name) name.value = token.name || '';
    const noteField = document.getElementById('tokenNote');
    if (fresh || document.activeElement !== noteField) noteField.value = token.note || '';
    const group = document.getElementById('tokenGroupNote');
    group.textContent = state.selection.length > 1 ? `Выбрано объектов: ${state.selection.length}. Сдвиг, поворот, скрытие, замок и слой применяются ко всем.` : '';
    const nameMode = document.getElementById('tokenNameMode');
    const size = document.getElementById('tokenSize');
    const hp = document.getElementById('tokenHp');
    const hpMax = document.getElementById('tokenHpMax');
    const hpPublic = document.getElementById('tokenHpPublic');
    const hidden = document.getElementById('tokenHidden');
    const locked = document.getElementById('tokenLocked');
    const back = document.getElementById('tokenBack');
    const parent = document.getElementById('tokenParent');
    const ac = document.getElementById('tokenAc');
    const attack = document.getElementById('tokenAttack');
    const trait = document.getElementById('tokenTrait');
    if (fresh || document.activeElement !== nameMode) nameMode.value = token.nameMode || 'hidden';
    if (fresh || document.activeElement !== size) size.value = token.size || '';
    if (fresh || document.activeElement !== hp) hp.value = token.hp == null ? '' : String(token.hp);
    if (fresh || document.activeElement !== hpMax) hpMax.value = token.hpMax == null ? '' : String(token.hpMax);
    if (fresh || document.activeElement !== hpPublic) hpPublic.checked = !!token.hpPublic;
    if (fresh || document.activeElement !== hidden) hidden.checked = !!token.hidden;
    if (fresh || document.activeElement !== locked) locked.checked = !!token.locked;
    if (back && (fresh || document.activeElement !== back)) back.checked = !!token.back;
    if (fresh || document.activeElement !== ac) ac.value = (token.stat && token.stat.ac) || '';
    if (fresh || document.activeElement !== attack) attack.value = (token.stat && token.stat.attack) || '';
    if (fresh || document.activeElement !== trait) trait.value = (token.stat && token.stat.trait) || '';
    if (fresh || document.activeElement !== parent) {
      parent.textContent = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'Ни к кому';
      parent.appendChild(none);
      currentTokens().forEach((item) => {
        if (item.id === token.id) return;
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name || 'Объект';
        parent.appendChild(option);
      });
      parent.value = token.parentId && currentTokens().some((item) => item.id === token.parentId) ? token.parentId : '';
    }
    document.getElementById('tokenStatPull').hidden = !token.libraryId;
    const own = token.cutMode === 'own';
    const inherited = Boolean(token.libraryId) && !own;
    if (fresh || (document.activeElement !== cutOn && document.activeElement !== cutColor && document.activeElement !== cutTol)) {
      const cut = cleanCut(token.cut);
      cutOn.checked = Boolean(cut);
      if (cut) cutColor.value = cut.color;
      cutTol.value = String(cut ? cut.tolerance : 30);
      document.getElementById('tokenCutTolLabel').textContent = cutTol.value;
    }
    tools.hidden = !cutOn.checked;
    reset.hidden = !token.libraryId || !own;
    if (token.libraryId && own) note.textContent = 'Фон этого экземпляра свой. Остальные экземпляры из библиотеки не изменятся.';
    else if (inherited) note.textContent = 'Фон общий: правка в папке изменит все такие экземпляры. Свой цвет затронет только этот.';
    else note.textContent = 'Пипеткой укажите цвет, который нужно сделать прозрачным.';
    const preview = document.getElementById('tokenCutPreview');
    preview.classList.toggle('picking', pickTarget === 'token');
    paintCutPreview(preview, token.libraryId || token.id, cutOn.checked ? cleanCut({ color: cutColor.value, tolerance: cutTol.value }) : null);
  }

  function showMap(id, fade) {
    const map = mapById(id);
    state.scene.currentMapId = map ? map.id : null;
    selectOne(null);
    state.planSelect = { wallIds: [], floorId: null, propId: null };
    state.corridorPts = [];
    state.stairPts = [];
    state.planDraft = null;
    state.planAnchor = null;
    state.vision = null;
    const has = Boolean(map);
    ui.board.hidden = !has;
    ui.empty.hidden = has;
    ui.board.classList.toggle('pixelated', !!state.scene.pixelated);
    if (!map) {
      stopMapVideo();
      ui.mapImage.removeAttribute('src');
      ui.mapImage.hidden = false;
      renderMapList();
      renderTokens();
      syncGridControls();
      syncPlaybackControls();
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
    const video = mapIsVideo(map);
    const el = video ? ui.mapVideo : ui.mapImage;
    if (video) {
      ui.mapImage.hidden = true;
      ui.mapImage.removeAttribute('src');
    } else {
      stopMapVideo();
      ui.mapImage.hidden = false;
    }
    el.hidden = false;
    if (el.getAttribute('src') !== map.url) {
      if (fade) ui.board.classList.add('switching');
      if (video) {
        el.onloadedmetadata = () => {
          syncPlaybackControls();
          apply();
        };
        el.onerror = () => {
          ui.board.classList.remove('switching');
          toast('Не удалось показать видео.');
        };
        el.src = map.url;
      } else {
        el.onload = apply;
        el.alt = map.name;
        el.src = map.url;
        if (el.complete && el.naturalWidth) apply();
      }
    } else if (video) {
      syncPlaybackControls();
      apply();
    } else {
      apply();
    }
    syncPlaybackControls();
    renderMapList();
    syncGridControls();
    const card = ui.mapList.querySelector(`[data-map="${id}"]`);
    if (card) card.scrollIntoView({ block: 'nearest' });
    renderRecent();
    renderTemplateList();
    renderInitiative();
    syncBlackout();
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
    commitScene({ reloadMap: true, touchProject: true });
    renderMapList();
    toast(`На столе карта «${map.name}»`);
  }

  function selectMap(id) {
    if (id === state.scene.currentMapId) return;
    touchRecent(id);
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

  function probeMedia(file, kind) {
    const url = URL.createObjectURL(file);
    const done = (node) => URL.revokeObjectURL(url);
    if (kind === 'video') {
      return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.onloadedmetadata = () => {
          done(video);
          if (!video.videoWidth) reject(new Error('empty'));
          else resolve();
        };
        video.onerror = () => {
          done(video);
          reject(new Error('video'));
        };
        video.src = url;
      });
    }
    return VTTPaint.loadImage(url).then((image) => {
      done();
      return image;
    }, (error) => {
      done();
      throw error;
    });
  }

  async function addMapFiles(files) {
    let lastId = null;
    let skipped = 0;
    for (const file of files) {
      const kind = fileKind(file);
      if (!kind) {
        skipped += 1;
        continue;
      }
      if (file.size > VTTMedia.MAP_BYTES) {
        const mb = Math.max(1, Math.round(file.size / (1024 * 1024)));
        const ok = await ask(`«${file.name}» весит ${mb} МБ. Такой файл занимает много места в браузере. Загрузить его?`, 'Загрузить');
        if (!ok) continue;
      }
      if (file.size > 8 * 1024 * 1024) toast(`Загружаю «${file.name}»…`);
      try {
        await probeMedia(file, kind);
      } catch (error) {
        toast(`Не удалось открыть «${file.name}».`);
        continue;
      }
      const record = {
        id: crypto.randomUUID(),
        name: prettyName(file.name),
        created: Date.now(),
        projectId: state.project && state.project.id,
        kind,
        blob: file,
      };
      await VTTDB.putMap(record);
      await rememberMap(record);
      lastId = record.id;
    }
    if (!lastId) {
      if (skipped) toast('Нужна картинка, гифка или видео.');
      return;
    }
    showMap(lastId, true);
    await commitScene();
  }

  async function addGrid() {
    const blob = await blankGridBlob();
    if (!blob) {
      toast('Не удалось создать пустую карту.');
      return;
    }
    const record = {
      id: crypto.randomUUID(),
      name: `Пустая карта ${state.maps.length + 1}`,
      created: Date.now(),
      projectId: state.project && state.project.id,
      blob,
    };
    await VTTDB.putMap(record);
    await rememberMap(record);
    if (!state.scene.grids) state.scene.grids = {};
    state.scene.grids[record.id] = Object.assign(defaultGrid(), { enabled: true });
    showMap(record.id, true);
    await commitScene();
  }

  function cloneStrokes(list, mapId) {
    return structuredClone(list || []).map((stroke) => {
      if (!stroke || typeof stroke !== 'object') return stroke;
      if (stroke.id) stroke.id = crypto.randomUUID();
      if (stroke.mapId) stroke.mapId = mapId;
      return stroke;
    });
  }

  function copyMapPieces(key, sourceId, mapId, cap) {
    const all = state.scene[key] || [];
    const source = all.filter((item) => item && item.mapId === sourceId);
    const room = cap == null ? source.length : Math.max(0, cap - all.length);
    const copies = source.slice(0, room).map((item) => {
      const copy = structuredClone(item);
      copy.id = crypto.randomUUID();
      copy.mapId = mapId;
      return copy;
    });
    state.scene[key] = all.concat(copies);
    return source.length - copies.length;
  }

  async function copyMap(id) {
    const source = mapById(id);
    if (!source || !source.blob) {
      toast('Эту карту нельзя скопировать.');
      return;
    }
    let name = `Копия · ${source.name}`.slice(0, 80);
    const taken = new Set(state.maps.map((map) => map.name));
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${name} ${n}`.slice(0, 80)) && n < 40) n += 1;
      name = `${name} ${n}`.slice(0, 80);
    }
    const record = {
      id: crypto.randomUUID(),
      name,
      created: Date.now(),
      projectId: state.project && state.project.id,
      kind: source.kind || (mapIsVideo(source) ? 'video' : 'image'),
      blob: source.blob,
    };
    await VTTDB.putMap(record);
    await rememberMap(record);
    if (state.scene.grids && state.scene.grids[id]) {
      state.scene.grids[record.id] = structuredClone(state.scene.grids[id]);
    }
    state.scene.drawings[record.id] = cloneStrokes(state.scene.drawings[id], record.id);
    state.scene.fog[record.id] = cloneStrokes(state.scene.fog[id], record.id);
    const dropped = [
      copyMapPieces('walls', id, record.id, 500),
      copyMapPieces('floors', id, record.id, 120),
      copyMapPieces('props', id, record.id, 240),
      copyMapPieces('scrawls', id, record.id, 240),
      copyMapPieces('openings', id, record.id, 400),
      copyMapPieces('labels', id, record.id, 80),
      copyMapPieces('flights', id, record.id, 60),
      copyMapPieces('templates', id, record.id, null),
    ].some(Boolean);
    const tokens = state.scene.tokens.filter((token) => token.mapId === id);
    const idMap = new Map();
    const copies = tokens.map((token) => {
      const copy = structuredClone(token);
      const nextId = crypto.randomUUID();
      idMap.set(token.id, nextId);
      copy.id = nextId;
      copy.mapId = record.id;
      copy.noteId = null;
      return copy;
    });
    copies.forEach((token) => {
      token.parentId = token.parentId && idMap.has(token.parentId) ? idMap.get(token.parentId) : null;
    });
    for (const token of tokens) {
      if (token.libraryId) continue;
      const blob = await VTTDB.getBlob(token.id);
      if (blob) await VTTDB.putBlob(idMap.get(token.id), blob);
    }
    state.scene.tokens = state.scene.tokens.concat(copies);
    showMap(record.id, true);
    await commitScene();
    toast(dropped
      ? `Карта скопирована в «${record.name}». Часть старых элементов не влезла.`
      : `Карта скопирована в «${record.name}». Игроки её пока не видят.`);
  }

  function blankGridBlob() {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a2420';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((next) => resolve(next || null), 'image/png'));
  }

  async function deleteMap(id) {
    const map = mapById(id);
    if (!map) return;
    const removed = state.scene.tokens.filter((token) => token.mapId === id);
    const own = removed.filter((token) => !token.libraryId);
    const fromLibrary = removed.length - own.length;
    const ok = await ask(
      fromLibrary
        ? `Удалить карту «${map.name}»? Рисунок и объекты с карты пропадут. ${fromLibrary} из библиотеки в библиотеке останутся.`
        : `Удалить карту «${map.name}» вместе с рисунком, туманом и объектами?`,
      'Удалить'
    );
    if (!ok) return;
    let keepOwn = false;
    if (own.length) {
      keepOwn = await ask(`На карте свои изображения: ${own.length}. Сохранить их в библиотеку перед удалением?`, 'Сохранить');
    }
    if (keepOwn) {
      const folder = {
        id: crypto.randomUUID(),
        name: `С карты ${map.name}`.slice(0, 80),
        parentId: null,
        created: Date.now(),
      };
      library.folders.push(folder);
      own.forEach((token) => {
        if (library.items.some((item) => item.id === token.id)) return;
        library.items.push({
          id: token.id,
          folderId: folder.id,
          name: token.name || 'Объект',
          created: Date.now(),
          cut: cleanCut(token.cut),
          stat: VTTPlay.cleanStat(token.stat),
        });
      });
      await saveLibrary();
      await renderLibrary();
    }
    state.scene.mapOrder = state.scene.mapOrder.filter((item) => item !== id);
    delete state.scene.drawings[id];
    delete state.scene.fog[id];
    if (state.scene.grids) delete state.scene.grids[id];
    state.scene.tokens = state.scene.tokens.filter((token) => token.mapId !== id);
    state.scene.templates = (state.scene.templates || []).filter((item) => item.mapId !== id);
    state.scene.walls = (state.scene.walls || []).filter((wall) => wall.mapId !== id);
    state.scene.floors = (state.scene.floors || []).filter((floor) => floor.mapId !== id);
    state.scene.props = (state.scene.props || []).filter((prop) => prop.mapId !== id);
    state.scene.scrawls = (state.scene.scrawls || []).filter((item) => item.mapId !== id);
    state.scene.openings = (state.scene.openings || []).filter((item) => item.mapId !== id);
    state.scene.labels = (state.scene.labels || []).filter((item) => item.mapId !== id);
    state.scene.flights = (state.scene.flights || []).filter((item) => item.mapId !== id);
    if (state.scene.gmPointer && state.scene.gmPointer.mapId === id) state.scene.gmPointer = null;
    const removedIds = new Set(removed.map((token) => token.id));
    (state.scene.initiative && state.scene.initiative.items || []).forEach((item) => {
      if (removedIds.has(item.tokenId)) item.tokenId = null;
    });
    state.scene.tokens.forEach((token) => {
      if (removedIds.has(token.parentId)) token.parentId = null;
    });
    if (!keepOwn) {
      await Promise.all(own.map((token) => VTTDB.deleteBlob(token.id)));
      own.forEach((token) => forgetLooks(token.id));
    }
    await VTTDB.deleteMap(id);
    thumbCache.delete(id);
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
    const card = ui.mapList.querySelector(`[data-map="${id}"] [data-name]`);
    const map = mapById(id);
    if (!card || !map) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = map.name;
    input.setAttribute('aria-label', 'Название карты');
    card.replaceWith(input);
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = save ? input.value.trim().slice(0, 80) : '';
      if (name) {
        map.name = name;
        if (state.scene.currentMapId === id) ui.mapImage.alt = name;
        if (map.blob) {
          VTTDB.putMap({
            id: map.id,
            name: map.name,
            created: map.created,
            projectId: map.projectId,
            kind: map.kind || (mapIsVideo(map) ? 'video' : 'image'),
            blob: map.blob,
          }).catch((error) => {
            console.error(error);
            toast('Не удалось сохранить название карты.');
          });
        }
      }
      renderMapList();
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => {
      if (done) return;
      input.focus();
      input.select();
    }, 0);
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
        blob = await prepareTokenBlob(file, false, 0);
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
        cut: knockout ? lightCut(threshold) : null,
        cutMode: 'own',
        note: '',
      };
      await VTTDB.putBlob(token.id, blob);
      state.scene.tokens.push(token);
      selectOne(token.id);
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

  function normalizeLibrary(value) {
    const folders = Array.isArray(value && value.folders) ? value.folders : [];
    const items = Array.isArray(value && value.items) ? value.items : [];
    const cleanFolders = folders.filter((folder) => folder && folder.id).map((folder) => ({
      id: folder.id,
      name: String(folder.name || 'Папка').slice(0, 80),
      parentId: folder.parentId || null,
      created: folder.created || Date.now(),
      faPack: folder.faPack === 'asset' || folder.faPack === 'token' ? folder.faPack : '',
    }));
    const known = new Set(cleanFolders.map((folder) => folder.id));
    cleanFolders.forEach((folder) => {
      if (folder.parentId === folder.id || !known.has(folder.parentId)) folder.parentId = null;
    });
    return {
      folders: cleanFolders,
      items: items.filter((item) => item && item.id && item.folderId).map((item) => ({
        id: item.id,
        folderId: item.folderId,
        name: String(item.name || 'Объект').slice(0, 80),
        created: item.created || Date.now(),
        cut: cleanCut(item.cut),
        stat: VTTPlay.cleanStat(item.stat),
        faKind: item.faKind === 'asset' || item.faKind === 'token' ? item.faKind : '',
        faCells: item.faCells > 0 ? Math.min(24, Math.round(Number(item.faCells) * 4) / 4) : 0,
      })),
    };
  }

  function childFolders(parentId) {
    const parent = parentId || null;
    return library.folders.filter((folder) => (folder.parentId || null) === parent);
  }

  function folderPath(id) {
    const names = [];
    let guard = 0;
    while (id && guard < 24) {
      const folder = library.folders.find((item) => item.id === id);
      if (!folder) break;
      names.unshift(folder.name);
      id = folder.parentId || null;
      guard += 1;
    }
    return names.join(' / ');
  }

  function descendantFolderIds(id) {
    const ids = [];
    const seen = new Set([id]);
    const walk = (parent) => {
      childFolders(parent).forEach((folder) => {
        if (seen.has(folder.id)) return;
        seen.add(folder.id);
        ids.push(folder.id);
        walk(folder.id);
      });
    };
    walk(id);
    return ids;
  }

  async function loadLibrary() {
    const stored = state.project ? await VTTDB.getKv(`library:${state.project.id}`) : null;
    library = normalizeLibrary(stored);
    if (!library.folders.some((folder) => folder.id === libraryFolderId)) libraryFolderId = null;
    await renderLibrary();
  }

  async function saveLibrary() {
    if (!state.project) return;
    await VTTDB.putKv(`library:${state.project.id}`, {
      folders: library.folders,
      items: library.items,
    });
  }

  async function paintCutPreview(canvas, blobId, cut) {
    if (!canvas || !blobId) return;
    const clean = cleanCut(cut);
    const key = lookKey(blobId, clean);
    if (canvas.dataset.look === key && canvas.dataset.fit) return;
    const url = await lookUrl(blobId, clean);
    if (!url) return;
    const image = await VTTPaint.loadImage(url);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fit = VTTPaint.contain(canvas.width, canvas.height, image.naturalWidth, image.naturalHeight);
    const x = (canvas.width - fit.w) / 2;
    const y = (canvas.height - fit.h) / 2;
    ctx.drawImage(image, x, y, fit.w, fit.h);
    canvas.dataset.fit = JSON.stringify({
      x, y, w: fit.w, h: fit.h, iw: image.naturalWidth, ih: image.naturalHeight,
    });
    canvas.dataset.blob = blobId;
    canvas.dataset.look = key;
  }

  async function sampleColor(canvas, event) {
    const blobId = canvas.dataset.blob;
    if (!blobId) return '';
    let fit;
    try { fit = JSON.parse(canvas.dataset.fit || ''); } catch (error) { return ''; }
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * canvas.height;
    if (px < fit.x || py < fit.y || px > fit.x + fit.w || py > fit.y + fit.h) return '';
    const ix = Math.min(fit.iw - 1, Math.max(0, Math.floor(((px - fit.x) / fit.w) * fit.iw)));
    const iy = Math.min(fit.ih - 1, Math.max(0, Math.floor(((py - fit.y) / fit.h) * fit.ih)));
    const image = await sourceImage(blobId);
    if (!image) return '';
    const probe = sampleColor.probe || (sampleColor.probe = document.createElement('canvas'));
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, ix, iy, 1, 1, 0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    if (!pixel[3]) return '';
    return `#${[pixel[0], pixel[1], pixel[2]].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }

  async function sourceImage(blobId) {
    if (sourceImages.has(blobId)) return sourceImages.get(blobId);
    const blob = await VTTDB.getBlob(blobId);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    try {
      const image = await VTTPaint.loadImage(url);
      sourceImages.set(blobId, image);
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function pushLibraryToTokens(item) {
    let touched = false;
    state.scene.tokens.forEach((token) => {
      if (token.libraryId !== item.id) return;
      if (!token.nameOwn && token.name !== item.name) {
        token.name = item.name;
        touched = true;
      }
      if (token.cutMode !== 'own') {
        token.cut = item.cut ? { color: item.cut.color, tolerance: item.cut.tolerance } : null;
        token.cutMode = 'library';
        touched = true;
      }
    });
    return touched;
  }

  async function commitLibraryItem(item, rerender) {
    item.cut = cleanCut(item.cut);
    await saveLibrary();
    forgetLooks(item.id);
    const touched = pushLibraryToTokens(item);
    if (rerender) await renderLibrary();
    else {
      const url = await lookUrl(item.id, item.cut);
      document.querySelectorAll(`[data-item="${item.id}"] img`).forEach((image) => {
        if (url) image.src = url;
      });
      const preview = document.getElementById('libraryCutPreview');
      if (preview) await paintCutPreview(preview, item.id, item.cut);
    }
    if (touched) {
      await renderTokens();
      await commitScene();
    }
  }

  async function renderLibrary() {
    const host = document.getElementById('libraryBody');
    if (!host) return;
    host.textContent = '';
    const query = (document.getElementById('librarySearch').value || '').trim().toLocaleLowerCase('ru');
    host.appendChild(breadcrumbBar());
    if (query) {
      await renderLibrarySearch(host, query);
      return;
    }
    host.appendChild(folderActions());
    const parent = libraryFolderId || null;
    const folders = childFolders(parent);
    const items = library.items.filter((item) => item.folderId === parent);
    if (!folders.length && !items.length) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = parent
        ? 'Папка пустая. Создайте папку внутри или загрузите изображения.'
        : 'Создайте папку. Внутри неё можно сделать ещё папки и загрузить изображения.';
      host.appendChild(empty);
      return;
    }
    if (folders.length) host.appendChild(folderList(folders));
    if (items.length) host.appendChild(await itemGrid(items, false));
    const edited = library.items.find((item) => item.id === libraryEditId && item.folderId === parent);
    if (edited) host.appendChild(itemSettings(edited));
  }

  function breadcrumbBar() {
    const bar = document.createElement('div');
    bar.className = 'crumb';
    const root = document.createElement('button');
    root.type = 'button';
    root.dataset.act = 'root';
    root.textContent = 'Все папки';
    root.disabled = !libraryFolderId;
    bar.appendChild(root);
    const chain = [];
    let id = libraryFolderId;
    let guard = 0;
    while (id && guard < 24) {
      const folder = library.folders.find((item) => item.id === id);
      if (!folder) break;
      chain.unshift(folder);
      id = folder.parentId || null;
      guard += 1;
    }
    chain.forEach((folder, index) => {
      const sep = document.createElement('span');
      sep.textContent = '/';
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.act = 'open-folder';
      button.dataset.folder = folder.id;
      button.textContent = folder.name;
      button.disabled = index === chain.length - 1;
      bar.append(sep, button);
    });
    return bar;
  }

  function folderActions() {
    const row = document.createElement('div');
    row.className = 'stack';
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'btn block';
    create.dataset.act = 'new-folder';
    create.textContent = libraryFolderId ? 'Папка внутри' : 'Новая папка';
    row.appendChild(create);
    if (libraryFolderId) {
      const upload = document.createElement('button');
      upload.type = 'button';
      upload.className = 'btn block';
      upload.dataset.act = 'upload';
      upload.textContent = 'Загрузить в эту папку';
      row.appendChild(upload);
    }
    return row;
  }

  function folderList(folders) {
    const list = document.createElement('div');
    list.className = 'stack';
    folders.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'folder-row';
      row.dataset.folder = item.id;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'folder-open';
      const objects = library.items.filter((entry) => entry.folderId === item.id).length;
      const nested = childFolders(item.id).length;
      const bits = [item.name];
      if (nested) bits.push(`папок ${nested}`);
      if (objects) bits.push(`объектов ${objects}`);
      open.textContent = bits.join(' · ');
      const actions = document.createElement('div');
      actions.className = 'folder-actions';
      actions.append(
        miniButton('rename-folder', 'Аа', 'Переименовать папку', false),
        miniButton('delete-folder', '×', 'Удалить папку', false)
      );
      row.append(open, actions);
      list.appendChild(row);
    });
    return list;
  }

  async function itemGrid(items, showPath) {
    const grid = document.createElement('div');
    grid.className = 'lib-grid';
    for (const item of items) {
      const card = document.createElement('div');
      card.className = `lib-card${item.id === libraryEditId ? ' editing' : ''}`;
      card.dataset.item = item.id;
      card.draggable = true;
      const place = document.createElement('button');
      place.type = 'button';
      place.className = 'lib-place';
      place.title = `Поставить «${item.name}» на карту`;
      const image = document.createElement('img');
      image.alt = '';
      const url = await lookUrl(item.id, item.cut);
      if (url) image.src = url;
      const label = document.createElement('span');
      label.textContent = item.name;
      if (item.faKind === 'asset' && item.faCells) place.title = `На пол, ${item.faCells} кл.`;
      else if (item.faKind === 'token' && item.faCells) place.title = `Поверх сетки, ${item.faCells} кл.`;
      place.append(image, label);
      if (showPath) {
        const path = document.createElement('small');
        path.className = 'lib-path';
        path.textContent = folderPath(item.folderId);
        place.appendChild(path);
      }
      const gear = miniButton('edit-item', '✎', 'Настроить объект', false);
      gear.classList.add('gear');
      card.append(place, gear, miniButton('delete-item', '×', 'Убрать из библиотеки', false));
      grid.appendChild(card);
    }
    return grid;
  }

  function itemSettings(item) {
    const box = document.createElement('div');
    box.className = 'stack lib-editor';
    box.dataset.editor = item.id;
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 80;
    name.value = item.name;
    name.setAttribute('aria-label', 'Имя объекта в библиотеке');
    item.stat = VTTPlay.cleanStat(item.stat);
    const ac = document.createElement('input');
    ac.type = 'text';
    ac.maxLength = 40;
    ac.value = item.stat.ac;
    ac.placeholder = 'Класс брони';
    ac.setAttribute('aria-label', 'Класс брони заготовки');
    const attack = document.createElement('input');
    attack.type = 'text';
    attack.maxLength = 180;
    attack.value = item.stat.attack;
    attack.placeholder = 'Атака';
    attack.setAttribute('aria-label', 'Атака заготовки');
    const trait = document.createElement('textarea');
    trait.maxLength = 500;
    trait.rows = 3;
    trait.value = item.stat.trait;
    trait.placeholder = 'Особое, только для мастера';
    trait.setAttribute('aria-label', 'Особое свойство заготовки');
    const cutOn = document.createElement('input');
    cutOn.type = 'checkbox';
    cutOn.checked = Boolean(item.cut);
    const cutLabel = document.createElement('label');
    cutLabel.className = 'check';
    cutLabel.append(cutOn, document.createTextNode(' Вырезать цвет фона'));
    const tools = document.createElement('div');
    tools.className = 'stack';
    tools.hidden = !item.cut;
    const row = document.createElement('div');
    row.className = 'row';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'btn';
    pick.dataset.act = 'pick-library';
    pick.textContent = 'Пипетка';
    pick.setAttribute('aria-pressed', pickTarget === 'library' ? 'true' : 'false');
    const color = document.createElement('input');
    color.type = 'color';
    color.value = item.cut ? item.cut.color : '#ffffff';
    color.setAttribute('aria-label', 'Цвет фона');
    row.append(pick, color);
    const tolLabel = document.createElement('span');
    tolLabel.textContent = String(item.cut ? item.cut.tolerance : 30);
    const tol = document.createElement('input');
    tol.type = 'range';
    tol.min = '0';
    tol.max = '140';
    tol.step = '1';
    tol.value = tolLabel.textContent;
    const tolField = document.createElement('label');
    tolField.className = 'field';
    tolField.append(document.createTextNode('Запас цвета '), tolLabel, tol);
    tools.append(row, tolField);
    const preview = document.createElement('canvas');
    preview.id = 'libraryCutPreview';
    preview.className = `cut-preview${pickTarget === 'library' ? ' picking' : ''}`;
    preview.width = 280;
    preview.height = 120;
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Так выглядят все экземпляры на картах, пока у экземпляра не включён свой фон.';
    box.append(name, ac, attack, trait, cutLabel, tools, preview, note);
    const writeStat = () => {
      item.stat = VTTPlay.cleanStat({ ac: ac.value, attack: attack.value, trait: trait.value });
      saveLibrary().catch((error) => console.error(error));
    };
    ac.addEventListener('change', writeStat);
    attack.addEventListener('change', writeStat);
    trait.addEventListener('change', writeStat);
    name.addEventListener('change', () => {
      const next = name.value.trim().slice(0, 80);
      if (!next) return;
      item.name = next;
      commitLibraryItem(item, true);
    });
    const writeCut = (rerender) => {
      item.cut = cutOn.checked ? cleanCut({ color: color.value, tolerance: Number(tol.value) }) : null;
      tolLabel.textContent = tol.value;
      tools.hidden = !cutOn.checked;
      commitLibraryItem(item, rerender);
    };
    cutOn.addEventListener('change', () => writeCut(false));
    color.addEventListener('input', () => writeCut(false));
    tol.addEventListener('input', () => {
      clearTimeout(tol._timer);
      tol._timer = setTimeout(() => {
        if (!tol.isConnected) return;
        writeCut(false);
      }, 80);
    });
    preview.addEventListener('click', async (event) => {
      if (pickTarget !== 'library') return;
      const hex = await sampleColor(preview, event);
      if (!hex) return;
      cutOn.checked = true;
      color.value = hex;
      pickTarget = null;
      pick.setAttribute('aria-pressed', 'false');
      preview.classList.remove('picking');
      writeCut(false);
    });
    paintCutPreview(preview, item.id, item.cut);
    return box;
  }

  function matchesObjectQuery(hay, query) {
    return VTTLex.objectHit(hay, VTTLex.objectQuery(query));
  }

  async function renderLibrarySearch(host, query) {
    const folders = library.folders.filter((folder) => matchesObjectQuery(folder.name, query));
    const items = library.items.filter((item) => matchesObjectQuery(`${item.name} ${folderPath(item.folderId)}`, query));
    if (!folders.length && !items.length) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = 'Ничего не найдено.';
      host.appendChild(empty);
      return;
    }
    if (folders.length) host.appendChild(folderList(folders));
    if (items.length) host.appendChild(await itemGrid(items, true));
    const edited = items.find((item) => item.id === libraryEditId);
    if (edited) host.appendChild(itemSettings(edited));
  }

  async function addFolder() {
    const folder = {
      id: crypto.randomUUID(),
      name: `Папка ${library.folders.length + 1}`,
      parentId: libraryFolderId || null,
      created: Date.now(),
    };
    library.folders.push(folder);
    libraryFolderId = folder.id;
    document.getElementById('librarySearch').value = '';
    await saveLibrary();
    await renderLibrary();
    toast(folder.parentId ? `Папка «${folder.name}» создана внутри` : `Папка «${folder.name}» создана`);
  }

  async function addLibraryFiles(files) {
    if (!libraryFolderId) {
      toast('Сначала откройте папку библиотеки.');
      return;
    }
    const knockout = document.getElementById('knockout').checked;
    const threshold = Number(document.getElementById('keyThreshold').value);
    let added = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      let blob = file;
      try {
        blob = await prepareTokenBlob(file, false, 0);
      } catch (error) {
        toast(`Не удалось открыть «${file.name}».`);
        continue;
      }
      const item = {
        id: crypto.randomUUID(),
        folderId: libraryFolderId,
        name: prettyName(file.name),
        created: Date.now(),
        cut: knockout ? lightCut(threshold) : null,
      };
      await VTTDB.putBlob(item.id, blob);
      library.items.push(item);
      added += 1;
    }
    if (!added) return;
    await saveLibrary();
    await renderLibrary();
    toast(added === 1 ? 'Изображение добавлено в папку' : `В папку добавлено изображений: ${added}`);
  }

  function faScale(item, grid) {
    const span = Number(item && item.faCells) || 0;
    const cols = Math.max(2, Math.min(80, Number(grid && grid.cols) || 27));
    if (span > 0) return Math.max(0.01, Math.min(1.5, span / cols));
    return VTTPlay.scaleForSize('medium', grid) || 0.18;
  }

  function faKindNow() {
    const value = document.getElementById('faKind').value;
    return value === 'token' ? 'token' : 'asset';
  }

  function faFolderParts(file) {
    const raw = String(file.faPath || file.webkitRelativePath || '');
    const parts = raw.split(/[\\/]/).filter((part) => part && part !== '.' && part !== '..');
    if (parts.length) parts.pop();
    return parts.map((part) => prettyName(part).slice(0, 80)).filter((part) => part && part !== 'Карта');
  }

  function faRoot(kind) {
    let folder = library.folders.find((item) => item.faPack === kind && !item.parentId);
    if (!folder) {
      folder = {
        id: crypto.randomUUID(),
        name: kind === 'token' ? 'FA · жетоны' : 'FA · элементы',
        parentId: null,
        created: Date.now(),
        faPack: kind,
      };
      library.folders.push(folder);
    }
    return folder;
  }

  function faChild(parentId, name) {
    const parent = parentId || null;
    let folder = library.folders.find((item) => (item.parentId || null) === parent && item.name === name);
    if (!folder) {
      folder = {
        id: crypto.randomUUID(),
        name,
        parentId: parent,
        created: Date.now(),
        faPack: '',
      };
      library.folders.push(folder);
    }
    return folder;
  }

  async function imageSize(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = await VTTPaint.loadImage(url);
      return { w: image.naturalWidth, h: image.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function zipEnd(bytes) {
    const min = Math.max(0, bytes.length - (22 + 0xffff));
    for (let i = bytes.length - 22; i >= min; i -= 1) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
    }
    return -1;
  }

  async function filesFromZip(file) {
    if (file.size > 80 * 1024 * 1024) return { error: 'Архив больше 80 МБ. Распакуйте его и добавьте одну папку.' };
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      return { error: 'Архив не открылся.' };
    }
    const end = zipEnd(bytes);
    if (end < 0) return { error: 'Это не архив zip.' };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint16(end + 10, true);
    let cursor = view.getUint32(end + 16, true);
    if (count === 0xffff || cursor === 0xffffffff) {
      return { error: 'Архив слишком большой. Распакуйте его и добавьте одну папку.' };
    }
    const files = [];
    for (let index = 0; index < count && files.length < 200; index += 1) {
      if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) break;
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const size = view.getUint32(cursor + 20, true);
      const nameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const local = view.getUint32(cursor + 42, true);
      const nameStart = cursor + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd > bytes.length) break;
      const name = new TextDecoder('utf-8').decode(bytes.subarray(nameStart, nameEnd));
      cursor = nameEnd + extraLen + commentLen;
      const base = name.split('/').pop();
      if (!name || name.endsWith('/') || name.includes('__MACOSX') || !base || base.startsWith('.')) continue;
      if (flags & 1) continue;
      if (!/\.(png|webp|gif|jpe?g)$/i.test(name)) continue;
      if (method !== 0 && method !== 8) continue;
      if (!size || size > 8 * 1024 * 1024) continue;
      if (local + 30 > bytes.length) continue;
      const localName = view.getUint16(local + 26, true);
      const localExtra = view.getUint16(local + 28, true);
      const data = local + 30 + localName + localExtra;
      if (data < 0 || data + size > bytes.length) continue;
      try {
        const slice = bytes.subarray(data, data + size);
        const raw = method === 0 ? slice : await inflateRaw(slice);
        if (!raw || raw.length > 12 * 1024 * 1024) continue;
        const type = /\.webp$/i.test(base) ? 'image/webp' : (/\.gif$/i.test(base) ? 'image/gif' : (/\.jpe?g$/i.test(base) ? 'image/jpeg' : 'image/png'));
        const image = new File([raw], base, { type });
        image.faPath = name;
        files.push(image);
      } catch (error) {
        continue;
      }
    }
    if (!files.length) return { error: 'В архиве нет картинок png, webp, gif или jpeg.' };
    return { files };
  }

  async function importFaFiles(files, kind) {
    if (!state.project) {
      toast('Сначала дождитесь загрузки стола.');
      return;
    }
    const unit = kind === 'token' ? 400 : 200;
    const list = [];
    let seen = 0;
    let bytes = 0;
    const cap = 120 * 1024 * 1024;
    for (const file of files) {
      const name = file.name || '';
      const image = (file.type || '').startsWith('image/') || /\.(png|webp|gif|jpe?g)$/i.test(name);
      if (!image || name.startsWith('.')) continue;
      seen += 1;
      if (list.length >= 200 || bytes + file.size > cap) continue;
      if (file.size > 8 * 1024 * 1024) continue;
      bytes += file.size;
      list.push(file);
    }
    if (!list.length) {
      toast(seen ? 'Картинки слишком большие или их слишком много для одного раза.' : 'В папке нет картинок png, webp, gif или jpeg.');
      return;
    }
    if (list.length > 24) toast('Добавляю картинки в библиотеку…');
    const parts = faFolderPartsList(list);
    const root = faRoot(kind);
    let added = 0;
    let skipped = 0;
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      let folder = root;
      parts[index].slice(0, 5).forEach((name) => {
        folder = faChild(folder.id, name);
      });
      const name = prettyName(file.name).slice(0, 80);
      if (library.items.some((item) => item.folderId === folder.id && item.name === name)) {
        skipped += 1;
        continue;
      }
      let size;
      try {
        size = await imageSize(file);
      } catch (error) {
        continue;
      }
      const span = VTTPlay.faCells(size.w, unit);
      if (!span) continue;
      const id = crypto.randomUUID();
      try {
        const blob = await prepareTokenBlob(file, false, 0);
        await VTTDB.putBlob(id, blob);
      } catch (error) {
        continue;
      }
      library.items.push({
        id,
        folderId: folder.id,
        name,
        created: Date.now(),
        cut: null,
        faKind: kind,
        faCells: span,
      });
      added += 1;
      if (added % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!added) {
      toast(skipped ? 'Эти картинки уже есть в библиотеке.' : 'Картинки не открылись.');
      return;
    }
    libraryFolderId = root.id;
    document.getElementById('librarySearch').value = '';
    await saveLibrary();
    await renderLibrary();
    const where = kind === 'token' ? 'Жетоны останутся поверх сетки.' : 'Элементы лягут на пол, под сетку.';
    const tail = seen > list.length ? ' Остальные не взяты: выберите папку поменьше.' : '';
    toast(`Добавлено: ${added}. ${where}${tail}`);
  }

  function faFolderPartsList(files) {
    const lists = files.map((file) => faFolderParts(file));
    const top = lists[0] && lists[0][0];
    if (!top || !lists.every((parts) => parts[0] === top)) return lists;
    return lists.map((parts) => parts.slice(1));
  }

  async function placeLibraryItem(id, at) {
    const item = library.items.find((entry) => entry.id === id);
    if (!item) return;
    if (!currentMap()) {
      toast('Сначала откройте карту.');
      return;
    }
    const blob = await VTTDB.getBlob(item.id);
    if (!blob) {
      toast('Изображение в библиотеке не найдено.');
      return;
    }
    const placed = currentTokens().length;
    const grid = currentGrid(false) || defaultGrid();
    const point = at ? (state.snap ? VTTPlay.snapPoint(at.x, at.y, grid, boardAspect()) : at) : null;
    const token = {
      id: crypto.randomUUID(),
      mapId: state.scene.currentMapId,
      libraryId: item.id,
      name: item.name,
      nameOwn: false,
      cutMode: 'library',
      cut: item.cut ? { color: item.cut.color, tolerance: item.cut.tolerance } : null,
      x: point ? point.x : 0.5 + (placed % 5) * 0.04,
      y: point ? point.y : 0.5 + (placed % 4) * 0.04,
      scale: faScale(item, grid),
      rotation: 0,
      back: item.faKind === 'asset',
      fa: item.faKind === 'asset' || item.faKind === 'token' ? item.faKind : '',
      z: ++state.scene.nextZ,
      note: '',
      hidden: false,
      locked: false,
      nameMode: 'hidden',
      hp: null,
      hpMax: null,
      hpPublic: false,
      size: 'medium',
      parentId: null,
      stat: VTTPlay.cleanStat(item.stat),
      noteId: null,
    };
    state.scene.tokens.push(token);
    selectOne(token.id);
    setTool('move');
    await renderTokens();
    await commitScene();
    toast(`«${item.name}» на карте «${currentMap().name}»`);
  }

  async function deleteLibraryItem(id) {
    const item = library.items.find((entry) => entry.id === id);
    if (!item) return;
    const ok = await ask(`Убрать «${item.name}» из библиотеки? Экземпляры на картах останутся самостоятельными.`, 'Убрать');
    if (!ok) return;
    await detachLibraryItem(item);
    library.items = library.items.filter((entry) => entry.id !== id);
    if (libraryEditId === id) libraryEditId = null;
    await VTTDB.deleteBlob(id);
    forgetLooks(id);
    await saveLibrary();
    await renderLibrary();
    await renderTokens();
    await commitScene();
  }

  async function detachLibraryItem(item) {
    const blob = await VTTDB.getBlob(item.id);
    const users = state.scene.tokens.filter((token) => token.libraryId === item.id);
    for (const token of users) {
      if (blob) await VTTDB.putBlob(token.id, blob);
      token.libraryId = null;
      token.cutMode = 'own';
      token.nameOwn = true;
    }
    forgetLooks(item.id);
  }

  async function deleteFolder(id) {
    const folder = library.folders.find((item) => item.id === id);
    if (!folder) return;
    const ok = await ask(`Удалить папку «${folder.name}» вместе с вложенными папками? Объекты на картах станут самостоятельными.`, 'Удалить');
    if (!ok) return;
    const folderIds = new Set([id, ...descendantFolderIds(id)]);
    const removed = library.items.filter((item) => folderIds.has(item.folderId));
    for (const item of removed) await detachLibraryItem(item);
    library.items = library.items.filter((item) => !folderIds.has(item.folderId));
    library.folders = library.folders.filter((item) => !folderIds.has(item.id));
    if (folderIds.has(libraryFolderId)) libraryFolderId = folder.parentId || null;
    if (removed.some((item) => item.id === libraryEditId)) libraryEditId = null;
    await Promise.all(removed.map((item) => VTTDB.deleteBlob(item.id)));
    await saveLibrary();
    await renderLibrary();
    await renderTokens();
    await commitScene();
  }

  function renameFolder(id) {
    const folder = library.folders.find((item) => item.id === id);
    const title = document.querySelector(`#libraryBody .crumb button[data-folder="${id}"]`)
      || document.querySelector(`#libraryBody [data-folder="${id}"] .folder-open`);
    if (!folder || !title) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = folder.name;
    input.setAttribute('aria-label', 'Название папки');
    title.replaceWith(input);
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = save ? input.value.trim().slice(0, 80) : '';
      if (name) folder.name = name;
      saveLibrary().then(() => renderLibrary()).catch((error) => {
        console.error(error);
        toast('Не удалось сохранить папку.');
      });
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => {
      if (done) return;
      input.focus();
      input.select();
    }, 0);
  }

  function bindLibrary() {
    const file = document.getElementById('libraryFile');
    file.addEventListener('change', () => {
      addLibraryFiles([...file.files]);
      file.value = '';
    });
    const faFolder = document.getElementById('faFolder');
    const faZip = document.getElementById('faZip');
    document.getElementById('faFolderBtn').addEventListener('click', () => faFolder.click());
    document.getElementById('faZipBtn').addEventListener('click', () => faZip.click());
    faFolder.addEventListener('change', () => {
      const picked = [...faFolder.files];
      faFolder.value = '';
      importFaFiles(picked, faKindNow());
    });
    faZip.addEventListener('change', () => {
      const picked = [...faZip.files];
      faZip.value = '';
      const zip = picked.find((item) => /\.zip$/i.test(item.name) || item.type === 'application/zip' || item.type === 'application/x-zip-compressed');
      if (zip) {
        filesFromZip(zip).then((result) => {
          if (result.error) {
            toast(result.error);
            return;
          }
          return importFaFiles(result.files, faKindNow());
        }).catch(() => toast('Архив не открылся.'));
        return;
      }
      importFaFiles(picked, faKindNow());
    });
    let librarySearchTimer = 0;
    document.getElementById('librarySearch').addEventListener('input', () => {
      clearTimeout(librarySearchTimer);
      librarySearchTimer = setTimeout(() => renderLibrary(), 140);
    });
    document.getElementById('libraryBody').addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      const action = act ? act.dataset.act : '';
      const folderEl = event.target.closest('[data-folder]');
      const itemEl = event.target.closest('[data-item]');
      if (event.target.closest('.lib-editor') && action !== 'pick-library') return;
      if (action === 'new-folder') addFolder();
      else if (action === 'root') {
        libraryFolderId = null;
        renderLibrary();
      } else if (action === 'open-folder' && folderEl) {
        libraryFolderId = folderEl.dataset.folder;
        document.getElementById('librarySearch').value = '';
        renderLibrary();
      } else if (action === 'upload') file.click();
      else if (action === 'rename-folder' && folderEl) renameFolder(folderEl.dataset.folder);
      else if (action === 'delete-folder' && folderEl) deleteFolder(folderEl.dataset.folder);
      else if (action === 'delete-item' && itemEl) deleteLibraryItem(itemEl.dataset.item);
      else if (action === 'edit-item' && itemEl) {
        libraryEditId = libraryEditId === itemEl.dataset.item ? null : itemEl.dataset.item;
        renderLibrary();
      } else if (action === 'pick-library') {
        pickTarget = pickTarget === 'library' ? null : 'library';
        renderLibrary();
      } else if (event.target.closest('.lib-place') && itemEl) placeLibraryItem(itemEl.dataset.item);
      else if (folderEl && !itemEl) {
        libraryFolderId = folderEl.dataset.folder;
        document.getElementById('librarySearch').value = '';
        renderLibrary();
      }
    });
    document.getElementById('librarySection').addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-item]');
      if (!card || !event.dataTransfer) return;
      event.dataTransfer.setData('text/vtt-item', card.dataset.item);
      event.dataTransfer.effectAllowed = 'copy';
    });
    ui.board.addEventListener('dragover', (event) => {
      const types = event.dataTransfer ? [...event.dataTransfer.types] : [];
      if (!types.includes('text/vtt-item')) return;
      event.preventDefault();
      event.stopPropagation();
    });
    ui.board.addEventListener('drop', (event) => {
      const id = event.dataTransfer ? event.dataTransfer.getData('text/vtt-item') : '';
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      placeLibraryItem(id, pointerNorm(event));
    });
    document.getElementById('librarySection').addEventListener('dragenter', (event) => {
      dropKind = 'library';
      event.stopPropagation();
    });
  }

  function applyInstanceCutFromForm() {
    const token = selectedToken();
    if (!token) return;
    const on = document.getElementById('tokenCutOn').checked;
    const tol = document.getElementById('tokenCutTol');
    document.getElementById('tokenCutTools').hidden = !on;
    document.getElementById('tokenCutTolLabel').textContent = tol.value;
    token.cut = on ? cleanCut({
      color: document.getElementById('tokenCutColor').value,
      tolerance: Number(tol.value),
    }) : null;
    token.cutMode = 'own';
    forgetLooks(token.libraryId || token.id);
    renderTokens();
    commitScene();
  }

  async function duplicateSelected() {
    const token = selectedToken();
    if (!token) return;
    const copy = Object.assign({}, token, {
      id: crypto.randomUUID(),
      x: clamp(token.x + 0.04, -0.25, 1.25),
      y: clamp(token.y + 0.04, -0.25, 1.25),
      z: ++state.scene.nextZ,
      cut: cleanCut(token.cut),
      stat: VTTPlay.cleanStat(token.stat),
      noteId: null,
    });
    if (!copy.libraryId) {
      const blob = await VTTDB.getBlob(token.id);
      if (blob) await VTTDB.putBlob(copy.id, blob);
    }
    state.scene.tokens.push(copy);
    selectOne(copy.id);
    editorFor = null;
    setTool('move');
    await renderTokens();
    await commitScene();
    toast('Объект продублирован');
  }

  async function deleteSelectedToken() {
    const tokens = selectedTokens();
    if (!tokens.length) return;
    const label = tokens.length > 1
      ? `Удалить объекты (${tokens.length}) с карты?`
      : `Удалить объект «${tokens[0].name || 'Объект'}» с карты?`;
    const ok = await ask(label, 'Удалить');
    if (!ok) return;
    pushHistory({ type: 'restore-tokens', tokens: tokens.map((token) => Object.assign({}, token)) });
    const ids = new Set(tokens.map((token) => token.id));
    state.scene.tokens = state.scene.tokens.filter((item) => !ids.has(item.id));
    state.scene.tokens.forEach((item) => {
      if (ids.has(item.parentId)) item.parentId = null;
    });
    (state.scene.initiative && state.scene.initiative.items || []).forEach((item) => {
      if (ids.has(item.tokenId)) item.tokenId = null;
    });
    selectOne(null);
    editorFor = null;
    await renderTokens();
    await commitScene();
  }

  function updateToken(partial, live, scope) {
    const leader = selectedToken();
    if (!leader) return;
    const group = scope === 'group'
      ? selectedTokens().filter((token) => !token.locked || token.id === leader.id)
      : [leader];
    const before = live ? null : poseSnapshot(group);
    if (partial.x != null || partial.y != null) {
      const dx = partial.x != null ? partial.x - leader.x : 0;
      const dy = partial.y != null ? partial.y - leader.y : 0;
      moveBy(group, dx, dy);
    }
    group.forEach((token) => {
      if (partial.scale != null) token.scale = partial.scale;
      if (partial.rotation != null) token.rotation = partial.rotation;
      if (partial.x == null && partial.y == null) {
        const el = tokenEl(token.id);
        if (el) VTTPaint.applyTokenStyle(el, token);
        broadcastPose(token);
      }
    });
    if (partial.scale != null) ui.tokenScale.value = String(leader.scale);
    if (partial.rotation != null) ui.tokenRotate.value = String(Math.round(leader.rotation || 0));
    if (!live) {
      rememberPoses(before);
      commitScene();
    }
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
    state.future = [];
    while (state.history.length > 40) discardHistory(state.history.shift());
  }

  function discardHistory(entry) {
    if (!entry || entry.type !== 'restore-tokens') return;
    (entry.tokens || []).forEach((token) => {
      if (token.libraryId) return;
      if (state.scene.tokens.some((item) => item.id === token.id)) return;
      VTTDB.deleteBlob(token.id).catch((error) => console.error(error));
      forgetLooks(token.id);
    });
  }

  function poseSnapshot(tokens) {
    const ids = new Set();
    const list = [];
    const add = (token) => {
      if (!token || ids.has(token.id)) return;
      ids.add(token.id);
      list.push({
        id: token.id,
        x: token.x,
        y: token.y,
        scale: token.scale,
        rotation: token.rotation || 0,
      });
      state.scene.tokens.forEach((child) => {
        if (child.parentId === token.id && child.mapId === token.mapId) add(child);
      });
    };
    tokens.forEach(add);
    return list;
  }

  function rememberPoses(before) {
    if (!before || !before.length) return;
    const changed = before.some((pose) => {
      const token = state.scene.tokens.find((item) => item.id === pose.id);
      if (!token) return false;
      return token.x !== pose.x || token.y !== pose.y || token.scale !== pose.scale || (token.rotation || 0) !== pose.rotation;
    });
    if (changed) pushHistory({ type: 'poses', before });
  }

  function broadcastPose(token) {
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

  function followChildren(token, dx, dy, skip) {
    state.scene.tokens.forEach((child) => {
      if (child.parentId !== token.id || child.mapId !== token.mapId || skip.has(child.id)) return;
      skip.add(child.id);
      child.x = clamp(child.x + dx, -0.25, 1.25);
      child.y = clamp(child.y + dy, -0.25, 1.25);
      const el = tokenEl(child.id);
      if (el) VTTPaint.applyTokenStyle(el, child);
      broadcastPose(child);
      followChildren(child, dx, dy, skip);
    });
  }

  function moveBy(tokens, dx, dy) {
    const skip = new Set(tokens.map((token) => token.id));
    tokens.forEach((token) => {
      token.x = clamp(token.x + dx, -0.25, 1.25);
      token.y = clamp(token.y + dy, -0.25, 1.25);
      const el = tokenEl(token.id);
      if (el) VTTPaint.applyTokenStyle(el, token);
      broadcastPose(token);
    });
    tokens.forEach((token) => followChildren(token, dx, dy, skip));
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

  function poseNow(list) {
    return (list || []).map((pose) => {
      const token = state.scene.tokens.find((item) => item.id === pose.id);
      if (!token) return pose;
      return { id: token.id, x: token.x, y: token.y, scale: token.scale, rotation: token.rotation || 0 };
    });
  }

  function snapshotForRedo(action) {
    if (!action) return null;
    if (action.type === 'pop-draw') {
      const list = state.scene.drawings[action.mapId] || [];
      const stroke = list[list.length - 1];
      return stroke ? { type: 'push-draw', mapId: action.mapId, stroke: structuredClone(stroke) } : null;
    }
    if (action.type === 'pop-fog') {
      const list = state.scene.fog[action.mapId] || [];
      const stroke = list[list.length - 1];
      return stroke ? { type: 'push-fog', mapId: action.mapId, stroke: structuredClone(stroke) } : null;
    }
    if (action.type === 'push-draw') return { type: 'pop-draw', mapId: action.mapId };
    if (action.type === 'push-fog') return { type: 'pop-fog', mapId: action.mapId };
    if (action.type === 'restore-draw') {
      return { type: 'restore-draw', mapId: action.mapId, data: structuredClone(state.scene.drawings[action.mapId] || []) };
    }
    if (action.type === 'restore-fog') {
      return { type: 'restore-fog', mapId: action.mapId, data: structuredClone(state.scene.fog[action.mapId] || []) };
    }
    if (action.type === 'restore-arch') return archSnapshot();
    if (action.type === 'poses') return { type: 'poses', before: poseNow(action.before) };
    if (action.type === 'restore-tokens') return { type: 'drop-tokens', tokens: action.tokens };
    if (action.type === 'drop-tokens') return { type: 'restore-tokens', tokens: action.tokens };
    return null;
  }

  function applyHistory(action) {
    if (action.type === 'pop-draw') {
      const list = state.scene.drawings[action.mapId];
      if (list) list.pop();
    } else if (action.type === 'pop-fog') {
      const list = state.scene.fog[action.mapId];
      if (list) list.pop();
    } else if (action.type === 'push-draw') {
      if (!state.scene.drawings[action.mapId]) state.scene.drawings[action.mapId] = [];
      state.scene.drawings[action.mapId].push(action.stroke);
    } else if (action.type === 'push-fog') {
      if (!state.scene.fog[action.mapId]) state.scene.fog[action.mapId] = [];
      state.scene.fog[action.mapId].push(action.stroke);
    } else if (action.type === 'restore-draw') {
      state.scene.drawings[action.mapId] = action.data;
    } else if (action.type === 'restore-fog') {
      state.scene.fog[action.mapId] = action.data;
    } else if (action.type === 'poses') {
      (action.before || []).forEach((pose) => {
        const token = state.scene.tokens.find((item) => item.id === pose.id);
        if (!token) return;
        token.x = pose.x;
        token.y = pose.y;
        token.scale = pose.scale;
        token.rotation = pose.rotation;
      });
      renderTokens();
    } else if (action.type === 'restore-tokens') {
      (action.tokens || []).forEach((token) => {
        if (!state.scene.tokens.some((item) => item.id === token.id)) state.scene.tokens.push(token);
      });
      renderTokens();
    } else if (action.type === 'drop-tokens') {
      const ids = new Set((action.tokens || []).map((token) => token.id));
      state.scene.tokens = state.scene.tokens.filter((token) => !ids.has(token.id));
      renderTokens();
    } else if (action.type === 'restore-arch') {
      state.scene.walls = action.walls;
      state.scene.floors = action.floors;
      state.scene.props = action.props;
      state.scene.scrawls = action.scrawls || [];
      state.scene.openings = action.openings || [];
      state.scene.labels = action.labels || [];
      state.scene.flights = action.flights || [];
      state.planSelect = { wallIds: [], floorId: null, propId: null };
      syncPlanChrome();
    }
    if ((action.mapId && action.mapId === state.scene.currentMapId) || action.type === 'restore-arch' || action.type === 'poses' || action.type === 'restore-tokens' || action.type === 'drop-tokens') replay();
    commitScene();
  }

  function undo() {
    const action = state.history.pop();
    if (!action) return;
    const again = snapshotForRedo(action);
    applyHistory(action);
    if (again) state.future.push(again);
  }

  function redo() {
    const action = state.future.pop();
    if (!action) return;
    const back = snapshotForRedo(action);
    applyHistory(action);
    if (back) state.history.push(back);
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

  function boardAspect() {
    return ui.board.clientHeight / Math.max(1, ui.board.clientWidth);
  }

  function paintShapes() {
    if (!ui.shapeLayer.width) return;
    const id = state.scene.currentMapId;
    const list = (state.scene.templates || []).filter((item) => item.mapId === id);
    if (state.draft && state.draft.mapId === id) list.push(state.draft);
    VTTPlay.paintShapes(shapeCtx, list, {
      gm: true,
      grid: currentGrid(false) || defaultGrid(),
      aspect: boardAspect(),
    });
  }

  function renderPointer() {
    ui.markerLayer.querySelectorAll('.gm-ping').forEach((el) => el.remove());
    const pointer = state.scene.gmPointer;
    if (!pointer || pointer.mapId !== state.scene.currentMapId) return;
    const ping = document.createElement('div');
    ping.className = 'gm-ping';
    ping.style.left = `${pointer.x * 100}%`;
    ping.style.top = `${pointer.y * 100}%`;
    ui.markerLayer.appendChild(ping);
  }

  function placePointer(point) {
    if (!state.scene.currentMapId) return;
    const snapped = state.snap
      ? VTTPlay.snapPoint(point.x, point.y, currentGrid(false) || defaultGrid(), boardAspect())
      : point;
    state.scene.gmPointer = { mapId: state.scene.currentMapId, x: snapped.x, y: snapped.y };
    renderPointer();
    VTTBus.send({ type: 'pointer', mapId: state.scene.currentMapId, x: snapped.x, y: snapped.y });
    commitScene();
  }

  function clearPointer() {
    if (!state.scene.gmPointer) return;
    state.scene.gmPointer = null;
    renderPointer();
    commitScene();
  }

  function beginMeasure(point) {
    const grid = currentGrid(false) || defaultGrid();
    const origin = state.snap ? VTTPlay.snapPoint(point.x, point.y, grid, boardAspect()) : point;
    state.draft = {
      id: 'draft',
      mapId: state.scene.currentMapId,
      kind: state.measureKind || 'line',
      x: origin.x,
      y: origin.y,
      x2: origin.x,
      y2: origin.y,
      shown: false,
    };
    const move = (ev) => {
      const next = pointerNorm(ev);
      if (!next || !state.draft) return;
      const snapped = state.snap ? VTTPlay.snapPoint(next.x, next.y, grid, boardAspect()) : next;
      state.draft.x2 = snapped.x;
      state.draft.y2 = snapped.y;
      paintShapes();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const draft = state.draft;
      state.draft = null;
      if (!draft || Math.hypot(draft.x2 - draft.x, draft.y2 - draft.y) < 0.008) {
        paintShapes();
        return;
      }
      if (!Array.isArray(state.scene.templates)) state.scene.templates = [];
      state.scene.templates.push({
        id: crypto.randomUUID(),
        mapId: draft.mapId,
        kind: draft.kind,
        x: draft.x,
        y: draft.y,
        x2: draft.x2,
        y2: draft.y2,
        shown: false,
      });
      renderTemplateList();
      paintShapes();
      commitScene();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    paintShapes();
  }

  function renderTemplateList() {
    const host = document.getElementById('templateList');
    if (!host) return;
    host.textContent = '';
    const list = (state.scene.templates || []).filter((item) => item.mapId === state.scene.currentMapId);
    if (!list.length) return;
    const names = { line: 'Линейка', cone: 'Конус', circle: 'Круг', square: 'Квадрат' };
    list.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'template-row';
      const label = document.createElement('span');
      label.textContent = `${names[item.kind] || 'Шаблон'} · ${VTTPlay.measureText(item, currentGrid(false) || defaultGrid(), boardAspect())}`;
      const show = document.createElement('button');
      show.type = 'button';
      show.className = 'btn';
      show.textContent = item.shown ? 'Скрыть' : 'На стол';
      show.addEventListener('click', () => {
        item.shown = !item.shown;
        renderTemplateList();
        paintShapes();
        commitScene();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Удалить шаблон');
      remove.addEventListener('click', () => {
        state.scene.templates = state.scene.templates.filter((entry) => entry.id !== item.id);
        renderTemplateList();
        paintShapes();
        commitScene();
      });
      row.append(label, show, remove);
      host.appendChild(row);
    });
  }

  function activeTurn() {
    const init = state.scene.initiative;
    if (!init || !Array.isArray(init.items) || !init.items.length) return null;
    return init.items[init.index] || init.items[0] || null;
  }

  function renderInitiative() {
    const host = document.getElementById('initiativeList');
    if (!host || host.contains(document.activeElement)) return;
    const init = VTTPlay.normalizeInitiative(state.scene.initiative);
    state.scene.initiative = init;
    host.textContent = '';
    init.items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `init-row${index === init.index ? ' active' : ''}`;
      const mark = document.createElement('span');
      mark.textContent = index === init.index ? '●' : '';
      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 80;
      name.value = item.name;
      name.setAttribute('aria-label', 'Имя в очереди');
      name.addEventListener('input', () => {
        item.name = name.value.slice(0, 80);
      });
      name.addEventListener('change', () => commitScene());
      const secret = document.createElement('input');
      secret.type = 'checkbox';
      secret.checked = item.secret;
      secret.title = 'Скрыть этот ход от игроков';
      secret.setAttribute('aria-label', 'Скрыть ход от игроков');
      secret.addEventListener('change', () => {
        item.secret = secret.checked;
        renderTokens();
        commitScene();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Убрать из очереди');
      remove.addEventListener('click', () => {
        init.items.splice(index, 1);
        if (init.index >= init.items.length) init.index = Math.max(0, init.items.length - 1);
        renderInitiative();
        renderTokens();
        commitScene();
      });
      row.append(mark, name, secret, remove);
      host.appendChild(row);
    });
  }

  function stepTurn(delta) {
    const init = VTTPlay.normalizeInitiative(state.scene.initiative);
    state.scene.initiative = init;
    if (!init.items.length) return;
    init.index = (init.index + delta + init.items.length) % init.items.length;
    renderInitiative();
    renderTokens();
    commitScene();
  }

  function addTurn(name, tokenId) {
    const init = VTTPlay.normalizeInitiative(state.scene.initiative);
    state.scene.initiative = init;
    init.items.push({
      id: crypto.randomUUID(),
      name: String(name || 'Ход').slice(0, 80),
      tokenId: tokenId || null,
      secret: false,
    });
    if (init.items.length === 1) init.index = 0;
    renderInitiative();
    renderTokens();
    commitScene();
  }

  function syncBlackout() {
    const button = document.getElementById('blackoutBtn');
    if (!button) return;
    const on = !!state.scene.blackout;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.textContent = on ? 'Вернуть стол' : 'Погасить';
  }

  function toggleBlackout() {
    state.scene.blackout = !state.scene.blackout;
    if (state.scene.blackout) state.scene.card = null;
    syncBlackout();
    commitScene();
    toast(state.scene.blackout ? 'Стол погашен' : 'Стол снова показывает картину');
  }

  function touchRecent(id) {
    if (!id) return;
    const list = (Array.isArray(state.scene.recentMaps) ? state.scene.recentMaps : []).filter((item) => item !== id);
    list.unshift(id);
    state.scene.recentMaps = list.slice(0, 6);
  }

  function renderRecent() {
    const host = document.getElementById('recentMaps');
    if (!host) return;
    host.textContent = '';
    (state.scene.recentMaps || []).filter((id) => id !== state.scene.currentMapId && mapById(id)).slice(0, 4).forEach((id) => {
      const map = mapById(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = map.name;
      button.addEventListener('click', () => selectMap(id));
      host.appendChild(button);
    });
  }

  function renderGridPresets() {
    const select = document.getElementById('gridPreset');
    if (!select) return;
    select.textContent = '';
    state.gridPresets.forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = preset.name || 'Сетка';
      select.appendChild(option);
    });
  }

  function rememberColor(color) {
    const hex = toHex(color).toLowerCase();
    if (COLORS.includes(hex)) return;
    state.recentColors = [hex, ...state.recentColors.filter((item) => item.toLowerCase() !== hex)].slice(0, 5);
    savePrefs();
    buildSwatches();
  }

  function runGlobalSearch() {
    const input = document.getElementById('globalSearch');
    const host = document.getElementById('globalSearchResults');
    const query = (input.value || '').trim().toLocaleLowerCase('ru');
    host.textContent = '';
    if (!query) {
      host.hidden = true;
      return;
    }
    const results = [];
    orderedMaps().forEach((map) => {
      if (map.name.toLocaleLowerCase('ru').includes(query)) results.push({ kind: 'map', id: map.id, title: map.name, meta: 'Карта' });
    });
    state.scene.tokens.forEach((token) => {
      const hay = `${token.name || ''} ${token.note || ''}`;
      if (matchesObjectQuery(hay, query)) {
        const map = mapById(token.mapId);
        results.push({ kind: 'token', id: token.id, title: token.name || 'Объект', meta: map ? `Объект · ${map.name}` : 'Объект' });
      }
    });
    library.folders.forEach((folder) => {
      if (matchesObjectQuery(folder.name, query)) results.push({ kind: 'folder', id: folder.id, title: folder.name, meta: 'Папка' });
    });
    library.items.forEach((item) => {
      if (matchesObjectQuery(`${item.name} ${folderPath(item.folderId)}`, query)) results.push({ kind: 'item', id: item.id, title: item.name, meta: 'Библиотека' });
    });
    VTTDesk.findNotes(query).forEach((note) => {
      results.push({ kind: 'note', id: note.id, title: note.title || 'Заметка', meta: 'Заметка' });
    });
    results.slice(0, 12).forEach((result) => {
      const button = document.createElement('button');
      button.type = 'button';
      const title = document.createElement('strong');
      title.textContent = result.title;
      const meta = document.createElement('small');
      meta.textContent = result.meta;
      button.append(title, meta);
      button.addEventListener('click', () => openSearchResult(result));
      host.appendChild(button);
    });
    if (!host.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = 'Ничего не найдено.';
      host.appendChild(empty);
    }
    host.hidden = false;
  }

  function openSearchResult(result) {
    document.getElementById('globalSearchResults').hidden = true;
    if (result.kind === 'map') {
      showView('table');
      selectMap(result.id);
      return;
    }
    if (result.kind === 'token') {
      const token = state.scene.tokens.find((item) => item.id === result.id);
      if (!token) return;
      showView('table');
      if (token.mapId !== state.scene.currentMapId) {
        showMap(token.mapId, true);
        commitScene();
      }
      selectOne(token.id);
      setTool('move');
      showSide('tokens');
      renderTokens();
      return;
    }
    if (result.kind === 'folder' || result.kind === 'item') {
      showView('table');
      showSide('tokens');
      if (result.kind === 'folder') libraryFolderId = result.id;
      else {
        const item = library.items.find((entry) => entry.id === result.id);
        libraryFolderId = item ? item.folderId : null;
        libraryEditId = result.id;
      }
      const search = document.getElementById('librarySearch');
      if (search) search.value = '';
      renderLibrary();
      return;
    }
    if (result.kind === 'note') {
      VTTDesk.openNote(result.id);
      showView('notes');
    }
  }

  function wouldCycle(token, parentId) {
    let id = parentId;
    let guard = 0;
    while (id && guard < 30) {
      if (id === token.id) return true;
      const next = state.scene.tokens.find((item) => item.id === id);
      id = next ? next.parentId : null;
      guard += 1;
    }
    return false;
  }

  function fitSizedTokens() {
    const grid = currentGrid(false) || defaultGrid();
    currentTokens().forEach((token) => {
      const scale = VTTPlay.scaleForSize(token.size, grid);
      if (!scale) return;
      token.scale = scale;
      const el = tokenEl(token.id);
      if (el) VTTPaint.applyTokenStyle(el, token);
      broadcastPose(token);
    });
  }

  function manualWalls(mapId) {
    const id = mapId || state.scene.currentMapId;
    return (state.scene.walls || []).filter((wall) => wall.mapId === id);
  }

  function wallsHere(mapId) {
    const id = mapId || state.scene.currentMapId;
    const { grid, aspect } = planLattice();
    return VTTPlay.assemblePlan(state.scene, id, grid, aspect).walls;
  }

  function floorsHere() {
    const id = state.scene.currentMapId;
    return (state.scene.floors || []).filter((floor) => floor.mapId === id);
  }

  function propsHere() {
    const id = state.scene.currentMapId;
    return (state.scene.props || []).filter((prop) => prop.mapId === id);
  }

  function ensurePlan() {
    if (!Array.isArray(state.scene.walls)) state.scene.walls = [];
    if (!Array.isArray(state.scene.floors)) state.scene.floors = [];
    if (!Array.isArray(state.scene.props)) state.scene.props = [];
    if (!Array.isArray(state.scene.scrawls)) state.scene.scrawls = [];
    if (!Array.isArray(state.scene.openings)) state.scene.openings = [];
    if (!Array.isArray(state.scene.labels)) state.scene.labels = [];
    if (!Array.isArray(state.scene.flights)) state.scene.flights = [];
  }

  function planLattice() {
    return { grid: currentGrid(false) || defaultGrid(), aspect: boardAspect() };
  }

  function archSnapshot() {
    ensurePlan();
    return {
      type: 'restore-arch',
      walls: structuredClone(state.scene.walls),
      floors: structuredClone(state.scene.floors),
      props: structuredClone(state.scene.props),
      scrawls: structuredClone(state.scene.scrawls),
      openings: structuredClone(state.scene.openings),
      labels: structuredClone(state.scene.labels),
      flights: structuredClone(state.scene.flights),
    };
  }

  function planSelectionLive() {
    const pick = state.planSelect;
    return pick.wallIds.length || pick.floorId || pick.propId || pick.scrawlId || pick.labelId || pick.flightId || pick.openingId;
  }

  function wallLabel(wall) {
    const names = { wall: 'Стена', door: 'Дверь', secret: 'Секрет', window: 'Окно', grate: 'Решётка' };
    const name = names[wall.kind] || 'Стена';
    if (wall.kind === 'door' || wall.kind === 'secret') return wall.open ? `${name}, открыта` : `${name}, закрыта`;
    return name;
  }

  function propLabel(kind) {
    return { column: 'Колонна', stairs: 'Лестница', table: 'Стол', chest: 'Сундук', pit: 'Яма' }[kind] || 'Штамп';
  }

  function syncPlanChrome() {
    const meta = document.getElementById('planMeta');
    const openWrap = document.getElementById('planOpenWrap');
    const open = document.getElementById('planOpen');
    const done = document.getElementById('corridorDone');
    if (done) {
      const polyReady = state.tool === 'poly' && state.corridorPts.length >= 3;
      const pathReady = state.tool === 'corridor' && state.corridorPts.length >= 2;
      done.hidden = !(polyReady || pathReady);
      done.textContent = state.tool === 'poly' ? 'Замкнуть фигуру' : 'Закончить тропу';
    }
    document.querySelectorAll('[data-prop]').forEach((button) => {
      button.setAttribute('aria-pressed', state.tool === 'prop' && button.dataset.prop === state.propKind ? 'true' : 'false');
    });
    if (!meta) return;
    const walls = wallsHere().filter((wall) => state.planSelect.wallIds.includes(wall.id));
    const prop = propsHere().find((item) => item.id === state.planSelect.propId);
    const floor = floorsHere().find((item) => item.id === state.planSelect.floorId);
    const scrawl = (state.scene.scrawls || []).find((item) => item.id === state.planSelect.scrawlId);
    const label = (state.scene.labels || []).find((item) => item.id === state.planSelect.labelId);
    const flight = (state.scene.flights || []).find((item) => item.id === state.planSelect.flightId);
    const opening = (state.scene.openings || []).find((item) => item.id === state.planSelect.openingId);
    const copy = document.getElementById('planCopy');
    const remove = document.getElementById('planDelete');
    const clear = document.getElementById('visionClear');
    const chosen = Boolean(prop || walls.length || floor || scrawl || label || flight || opening);
    if (copy) copy.disabled = !chosen;
    if (remove) remove.disabled = !chosen;
    if (clear) clear.hidden = !(state.vision && state.vision.mapId === state.scene.currentMapId);
    if (label) {
      meta.textContent = `Надпись: ${label.text}`;
      if (openWrap) openWrap.hidden = true;
    } else if (flight) {
      meta.textContent = `Лестница · ступеней ${flight.steps}`;
      if (openWrap) openWrap.hidden = true;
    } else if (scrawl) {
      const names = { rect: 'Комната', poly: 'Многоугольник', path: 'Тропа', ngon: 'Круг' };
      meta.textContent = `${names[scrawl.kind] || 'Фигура'}${scrawl.op === 'sub' ? ' · вырез' : ''}`;
      if (openWrap) openWrap.hidden = true;
    } else if (opening) {
      meta.textContent = wallLabel(opening);
      if (openWrap) openWrap.hidden = opening.kind !== 'door' && opening.kind !== 'secret';
      if (open && (opening.kind === 'door' || opening.kind === 'secret')) open.checked = opening.open;
    } else if (prop) {
      meta.textContent = propLabel(prop.kind);
      if (openWrap) openWrap.hidden = true;
    } else if (walls.length) {
      const doors = walls.filter((wall) => wall.kind === 'door' || wall.kind === 'secret');
      meta.textContent = walls.length > 1 ? planGroupLabel(walls) : wallLabel(walls[0]);
      if (openWrap) openWrap.hidden = !doors.length;
      if (open && doors.length) open.checked = doors.every((door) => door.open);
    } else if (floor) {
      const names = { stone: 'Камень', wood: 'Дерево', water: 'Вода', void: 'Пустота' };
      meta.textContent = `Пол: ${names[floor.kind] || 'камень'}`;
      if (openWrap) openWrap.hidden = true;
    } else if (state.corridorPts.length && (state.tool === 'corridor' || state.tool === 'poly')) {
      meta.textContent = state.tool === 'poly'
        ? `Углов: ${state.corridorPts.length}. Двойной щелчок замыкает.`
        : `Точек тропы: ${state.corridorPts.length}. Двойной щелчок заканчивает.`;
      if (openWrap) openWrap.hidden = true;
    } else if (state.stairPts.length) {
      meta.textContent = state.stairPts.length === 1 ? 'Второй щелчок — ширина ступени.' : 'Третий щелчок — низ лестницы.';
      if (openWrap) openWrap.hidden = true;
    } else {
      meta.textContent = 'Комната, тропа, дверь или надпись.';
      if (openWrap) openWrap.hidden = true;
    }
  }

  function planGroupLabel(walls) {
    const sameRoom = walls.every((wall) => wall.roomId && wall.roomId === walls[0].roomId);
    const sameRun = walls.every((wall) => wall.groupId && wall.groupId === walls[0].groupId);
    const name = sameRoom ? 'Комната' : (sameRun ? 'Коридор' : 'Стены');
    const doors = walls.filter((wall) => wall.kind === 'door' || wall.kind === 'secret');
    if (doors.length === 1) return `${name} · ${doors[0].open ? 'дверь открыта' : 'дверь закрыта'}`;
    if (doors.length) return `${name} · дверей ${doors.length}`;
    return `${name} · ${walls.length}`;
  }

  function selectWall(wall) {
    if (!wall) {
      state.planSelect = { wallIds: [], floorId: null, propId: null };
    } else if (wall.roomId) {
      const ids = wallsHere().filter((item) => item.roomId === wall.roomId).map((item) => item.id);
      const floor = floorsHere().find((item) => item.roomId === wall.roomId);
      state.planSelect = { wallIds: ids, floorId: floor ? floor.id : null, propId: null };
    } else if (wall.groupId) {
      const ids = wallsHere().filter((item) => item.groupId === wall.groupId).map((item) => item.id);
      const floor = floorsHere().find((item) => item.roomId === wall.groupId);
      state.planSelect = { wallIds: ids, floorId: floor ? floor.id : null, propId: null };
    } else {
      state.planSelect = { wallIds: [wall.id], floorId: null, propId: null };
    }
    syncPlanChrome();
    paintPlanLayer();
  }

  function snapLine(x, y) {
    const { grid, aspect } = planLattice();
    return VTTPlay.snapDivide(x, y, grid, aspect, state.planDiv || 1);
  }

  function snapPath(x, y) {
    const { grid, aspect } = planLattice();
    return VTTPlay.snapCenter(x, y, grid, aspect, state.planDiv || 1);
  }

  function blankShape(kind, points, op) {
    return {
      id: 'draft',
      mapId: state.scene.currentMapId,
      kind,
      op: op || 'add',
      points,
      radius: state.pathRadius,
      sides: state.ngonSides,
      floor: state.floorKind,
      rough: state.rough ? 1 : 0,
    };
  }

  function shapeOp() {
    return state.scrawlCut ? 'sub' : 'add';
  }

  function draftShape() {
    const draft = state.planDraft;
    const { grid, aspect } = planLattice();
    if (draft && draft.kind !== 'hover' && draft.mapId === state.scene.currentMapId) {
      const end = snapLine(draft.x2, draft.y2);
      if (draft.kind === 'wall') {
        let endCell = VTTPlay.toCell(draft.x2, draft.y2, grid, aspect);
        const startCell = VTTPlay.toCell(draft.x, draft.y, grid, aspect);
        if (!draft.shift) endCell = VTTPlay.lockAxis(startCell, endCell);
        const step = state.planDiv || 1;
        endCell = { cx: Math.round(endCell.cx * step) / step, cy: Math.round(endCell.cy * step) / step };
        const tip = VTTPlay.fromCell(endCell.cx, endCell.cy, grid, aspect);
        return { wall: { id: 'draft', kind: 'wall', x: draft.x, y: draft.y, x2: tip.x, y2: tip.y } };
      }
      if (draft.kind === 'room' || draft.kind === 'carve') {
        return { shape: blankShape('rect', [{ x: draft.x, y: draft.y }, end], draft.kind === 'carve' ? 'sub' : shapeOp()) };
      }
      if (draft.kind === 'ngon') {
        return { shape: blankShape('ngon', [{ x: draft.x, y: draft.y }, { x: draft.x2, y: draft.y2 }], shapeOp()) };
      }
    }
    if ((state.tool === 'corridor' || state.tool === 'poly') && state.corridorPts.length && draft && draft.kind === 'hover') {
      const points = state.corridorPts.concat([{ x: draft.x, y: draft.y }]);
      if (state.tool === 'poly' && points.length >= 3) return { shape: blankShape('poly', points, shapeOp()) };
      if (state.tool === 'corridor' && points.length >= 2) return { shape: blankShape('path', points, shapeOp()) };
    }
    return {};
  }

  function paintPlanLayer() {
    if (!ui.planLayer.width) return;
    const id = state.scene.currentMapId;
    const { grid, aspect } = planLattice();
    const draft = draftShape();
    const data = VTTPlay.assemblePlan(state.scene, id, grid, aspect, draft.shape ? [draft.shape] : []);
    data.vision = state.vision && state.vision.mapId === id ? state.vision.points : null;
    data.previewWalls = draft.wall ? [draft.wall] : [];
    data.previewCells = draft.shape && draft.shape.op === 'sub' ? VTTPlay.scrawlCells(draft.shape, grid, aspect) : [];
    data.previewKind = 'void';
    if (state.planSelect.scrawlId) {
      const shape = (state.scene.scrawls || []).find((item) => item.id === state.planSelect.scrawlId);
      data.selectedCells = shape ? VTTPlay.scrawlCells(shape, grid, aspect) : [];
    }
    if (state.tool === 'stairs' && state.stairPts.length === 2 && state.planDraft && state.planDraft.kind === 'hover') {
      data.flights = data.flights.concat([{
        id: 'draft',
        x: state.stairPts[0].x,
        y: state.stairPts[0].y,
        x2: state.stairPts[1].x,
        y2: state.stairPts[1].y,
        x3: state.planDraft.x,
        y3: state.planDraft.y,
        steps: state.stairSteps,
      }]);
    }
    const view = { gm: true, grid, aspect, selected: state.planSelect };
    VTTPlay.paintPlan(floorCtx, data, Object.assign({ part: 'floor' }, view));
    VTTPlay.paintPlan(planCtx, data, Object.assign({ part: 'above' }, view));
  }

  function quantCell(cell) {
    const step = state.planDiv || 1;
    return { cx: Math.round(cell.cx * step) / step, cy: Math.round(cell.cy * step) / step };
  }

  function wallStart(point) {
    const { grid, aspect } = planLattice();
    const snapped = snapLine(point.x, point.y);
    if (!state.planAnchor) return snapped;
    const a = VTTPlay.toCell(state.planAnchor.x, state.planAnchor.y, grid, aspect);
    const b = VTTPlay.toCell(snapped.x, snapped.y, grid, aspect);
    if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < 0.6) return { x: state.planAnchor.x, y: state.planAnchor.y };
    return snapped;
  }

  function nearestEnd(wall, point) {
    const { grid, aspect } = planLattice();
    const p = VTTPlay.toCell(point.x, point.y, grid, aspect);
    const a = VTTPlay.toCell(wall.x, wall.y, grid, aspect);
    const b = VTTPlay.toCell(wall.x2, wall.y2, grid, aspect);
    const da = Math.hypot(p.cx - a.cx, p.cy - a.cy);
    const db = Math.hypot(p.cx - b.cx, p.cy - b.cy);
    if (da <= db && da < 0.45) return 'a';
    if (db < 0.45) return 'b';
    return null;
  }

  function roundCells(cells) {
    return (cells || []).map((cell) => [Math.round(cell[0]), Math.round(cell[1])]);
  }

  function commitWall(start, end, shift) {
    const { grid, aspect } = planLattice();
    const a = VTTPlay.toCell(start.x, start.y, grid, aspect);
    let b = VTTPlay.toCell(end.x, end.y, grid, aspect);
    if (!shift) b = VTTPlay.lockAxis(a, b);
    b = quantCell(b);
    const startRounded = quantCell(a);
    if (Math.hypot(b.cx - startRounded.cx, b.cy - startRounded.cy) < 0.4) return false;
    const p1 = VTTPlay.fromCell(startRounded.cx, startRounded.cy, grid, aspect);
    const p2 = VTTPlay.fromCell(b.cx, b.cy, grid, aspect);
    ensurePlan();
    pushHistory(archSnapshot());
    const wall = {
      id: crypto.randomUUID(),
      mapId: state.scene.currentMapId,
      roomId: null,
      groupId: null,
      kind: 'wall',
      open: false,
      x: p1.x,
      y: p1.y,
      x2: p2.x,
      y2: p2.y,
    };
    state.scene.walls.push(wall);
    state.planAnchor = { x: p2.x, y: p2.y };
    selectWall(wall);
    commitScene();
    return true;
  }

  function addScrawl(shape) {
    const { grid, aspect } = planLattice();
    const cells = VTTPlay.scrawlCells(shape, grid, aspect);
    if (!cells.length) {
      toast('Фигура слишком мала');
      return false;
    }
    ensurePlan();
    if (state.scene.scrawls.length >= 240) {
      toast('На карте уже много фигур');
      return false;
    }
    pushHistory(archSnapshot());
    shape.id = crypto.randomUUID();
    shape.mapId = state.scene.currentMapId;
    state.scene.scrawls.push(shape);
    state.planSelect = { wallIds: [], floorId: null, propId: null, scrawlId: shape.id };
    syncPlanChrome();
    commitScene();
    return true;
  }

  function commitRoom(start, end) {
    const a = snapLine(start.x, start.y);
    const b = snapLine(end.x, end.y);
    return addScrawl(blankShape('rect', [a, b], shapeOp()));
  }

  function commitCarve(start, end) {
    const a = snapLine(start.x, start.y);
    const b = snapLine(end.x, end.y);
    return addScrawl(blankShape('rect', [a, b], 'sub'));
  }

  function commitNgon(start, end) {
    return addScrawl(blankShape('ngon', [{ x: start.x, y: start.y }, { x: end.x, y: end.y }], shapeOp()));
  }

  function addCorridorPoint(point) {
    const snapped = state.tool === 'poly' ? snapLine(point.x, point.y) : snapPath(point.x, point.y);
    const last = state.corridorPts[state.corridorPts.length - 1];
    if (last) {
      const { grid, aspect } = planLattice();
      const a = VTTPlay.toCell(last.x, last.y, grid, aspect);
      const b = VTTPlay.toCell(snapped.x, snapped.y, grid, aspect);
      if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < 0.35) return;
    }
    state.corridorPts.push(snapped);
    syncPlanChrome();
    paintPlanLayer();
  }

  function finishCorridor() {
    const kind = state.tool === 'poly' ? 'poly' : 'path';
    const need = kind === 'poly' ? 3 : 2;
    const points = state.corridorPts.slice();
    if (points.length < need) {
      toast(kind === 'poly' ? 'Нужны хотя бы три угла' : 'Нужны хотя бы две точки тропы');
      return;
    }
    const shape = blankShape(kind, points, shapeOp());
    const { grid, aspect } = planLattice();
    if (!VTTPlay.scrawlCells(shape, grid, aspect).length) {
      toast('Фигура слишком мала');
      return;
    }
    state.corridorPts = [];
    state.planDraft = null;
    addScrawl(shape);
  }

  function placeEdgeOpening(wall, kind) {
    const edge = wall.edge;
    const mapId = state.scene.currentMapId;
    if (!state.scene.openings) state.scene.openings = [];
    const existing = state.scene.openings.find((item) => item.mapId === mapId && item.edge === edge);
    const live = wallsHere();
    const seed = live.find((item) => item.edge === edge) || wall;
    pushHistory(archSnapshot());
    if (existing && existing.kind === kind && (kind === 'door' || kind === 'secret')) {
      const nextOpen = !existing.open;
      VTTPlay.openingChain(live, seed).forEach((item) => {
        const found = state.scene.openings.find((opening) => opening.mapId === mapId && opening.edge === item.edge);
        if (found && found.kind === kind) found.open = nextOpen;
      });
      state.planSelect = { wallIds: [], floorId: null, propId: null, openingId: existing.id };
    } else if (existing) {
      existing.kind = kind;
      existing.open = false;
      state.planSelect = { wallIds: [], floorId: null, propId: null, openingId: existing.id };
    } else {
      const touch = live.filter((item) => item.kind === kind && item.edge && item.edge !== edge && VTTPlay.openingsTouch(item, seed));
      const nextOpen = touch.length && (kind === 'door' || kind === 'secret') ? !!touch[0].open : false;
      const opening = { id: crypto.randomUUID(), mapId, edge, kind, open: nextOpen };
      state.scene.openings.push(opening);
      state.planSelect = { wallIds: [], floorId: null, propId: null, openingId: opening.id };
    }
    syncPlanChrome();
    commitScene();
    paintPlanLayer();
  }

  function placeOpening(point, kind) {
    const { grid, aspect } = planLattice();
    const wall = VTTPlay.nearestWall(point.x, point.y, wallsHere(), grid, aspect);
    if (!wall) {
      toast('Рядом нет стены');
      return;
    }
    ensurePlan();
    if (wall.edge) {
      placeEdgeOpening(wall, kind);
      return;
    }
    const live = state.scene.walls.find((item) => item.id === wall.id);
    if (!live) return;
    if (live.kind === kind && (kind === 'door' || kind === 'secret')) {
      pushHistory(archSnapshot());
      const nextOpen = !live.open;
      VTTPlay.openingChain(state.scene.walls.filter((item) => item.mapId === live.mapId), live).forEach((item) => {
        const found = state.scene.walls.find((wall) => wall.id === item.id);
        if (found && found.kind === kind) found.open = nextOpen;
      });
      selectWall(live);
      commitScene();
      return;
    }
    if (live.kind !== 'wall') {
      pushHistory(archSnapshot());
      live.kind = kind;
      live.open = false;
      if (kind === 'door' || kind === 'secret') {
        const touch = state.scene.walls.filter((item) => item.id !== live.id && item.mapId === live.mapId && item.kind === kind && VTTPlay.openingsTouch(item, live));
        if (touch.length) live.open = !!touch[0].open;
      }
      selectWall(live);
      commitScene();
      return;
    }
    pushHistory(archSnapshot());
    const pieces = VTTPlay.splitOpening(live, point.x, point.y, kind, grid, aspect);
    state.scene.walls = state.scene.walls.filter((item) => item.id !== live.id);
    const created = pieces.map((piece) => Object.assign({ id: crypto.randomUUID() }, piece));
    state.scene.walls.push(...created);
    const fresh = created.find((piece) => piece.kind === kind);
    if (fresh && (kind === 'door' || kind === 'secret')) {
      const touch = state.scene.walls.filter((item) => item !== fresh && item.mapId === fresh.mapId && item.kind === kind && VTTPlay.openingsTouch(item, fresh));
      if (touch.length) fresh.open = !!touch[0].open;
    }
    selectWall(fresh || created[0]);
    commitScene();
  }

  function paintFloorAt(point) {
    const { grid, aspect } = planLattice();
    const cell = VTTPlay.toCell(point.x, point.y, grid, aspect);
    const i = Math.floor(cell.cx);
    const j = Math.floor(cell.cy);
    const view = VTTPlay.assemblePlan(state.scene, state.scene.currentMapId, grid, aspect);
    const ownerId = view.owner[`${i}:${j}`];
    if (ownerId) {
      const shape = (state.scene.scrawls || []).find((item) => item.id === ownerId);
      if (!shape) return;
      ensurePlan();
      pushHistory(archSnapshot());
      shape.floor = state.floorKind;
      state.planSelect = { wallIds: [], floorId: null, propId: null, scrawlId: shape.id };
      syncPlanChrome();
      commitScene();
      paintPlanLayer();
      return;
    }
    const existing = floorsHere().find((floor) => (floor.cells || []).some((pair) => pair[0] === i && pair[1] === j));
    ensurePlan();
    if (existing) {
      pushHistory(archSnapshot());
      const live = state.scene.floors.find((floor) => floor.id === existing.id);
      if (live) live.kind = state.floorKind;
      state.planSelect = { wallIds: [], floorId: existing.id, propId: null };
      syncPlanChrome();
      commitScene();
      paintPlanLayer();
      return;
    }
    const flood = VTTPlay.floodRoom(point.x, point.y, wallsHere(), grid, aspect);
    if (!flood.closed) {
      toast('Комната не замкнута');
      return;
    }
    pushHistory(archSnapshot());
    const floor = {
      id: crypto.randomUUID(),
      mapId: state.scene.currentMapId,
      roomId: null,
      kind: state.floorKind,
      cells: roundCells(flood.cells),
    };
    state.scene.floors.push(floor);
    state.planSelect = { wallIds: [], floorId: floor.id, propId: null };
    syncPlanChrome();
    commitScene();
    paintPlanLayer();
  }

  function hitProp(point) {
    const { grid, aspect } = planLattice();
    const p = VTTPlay.toCell(point.x, point.y, grid, aspect);
    let best = null;
    let bestD = 0.55;
    propsHere().forEach((prop) => {
      const cell = VTTPlay.toCell(prop.x, prop.y, grid, aspect);
      const dist = Math.hypot(p.cx - cell.cx, p.cy - cell.cy);
      if (dist < bestD) {
        bestD = dist;
        best = prop;
      }
    });
    return best;
  }

  function placeProp(point) {
    const { grid, aspect } = planLattice();
    const snapped = VTTPlay.snapPoint(point.x, point.y, grid, aspect);
    ensurePlan();
    pushHistory(archSnapshot());
    const prop = {
      id: crypto.randomUUID(),
      mapId: state.scene.currentMapId,
      kind: state.propKind,
      x: snapped.x,
      y: snapped.y,
    };
    state.scene.props.push(prop);
    state.planSelect = { wallIds: [], floorId: null, propId: prop.id };
    syncPlanChrome();
    commitScene();
    paintPlanLayer();
    return prop;
  }

  function showVision(x, y) {
    const { grid, aspect } = planLattice();
    state.vision = {
      mapId: state.scene.currentMapId,
      points: VTTPlay.visionPolygon(x, y, wallsHere(), grid, aspect),
    };
    paintPlanLayer();
    syncPlanChrome();
  }

  function clearVision() {
    state.vision = null;
    paintPlanLayer();
    syncPlanChrome();
  }

  function visionFromToken() {
    const token = selectedToken();
    if (!token || token.mapId !== state.scene.currentMapId) {
      toast('Выберите фигуру на этой карте');
      return;
    }
    showVision(token.x, token.y);
  }

  function revealVision() {
    const id = state.scene.currentMapId;
    if (!id) return;
    if (!state.vision || state.vision.mapId !== id || !state.vision.points || state.vision.points.length < 3) {
      const token = selectedToken();
      if (!token || token.mapId !== id) {
        toast('Сначала посмотрите из фигуры или щёлкните взглядом');
        return;
      }
      showVision(token.x, token.y);
    }
    const list = ensureLayer('fog');
    if (!list.length) {
      toast('Сначала залейте карту туманом');
      return;
    }
    pushHistory({ type: 'pop-fog', mapId: id });
    list.push({ op: 'poly', erase: true, points: state.vision.points });
    replay();
    commitScene();
  }

  function sameOpeningGroup(opening) {
    if (!opening) return [];
    const live = wallsHere(opening.mapId);
    const seed = live.find((wall) => wall.edge === opening.edge && wall.kind === opening.kind);
    if (!seed) return [opening];
    const edges = new Set(VTTPlay.openingChain(live, seed).map((wall) => wall.edge).filter(Boolean));
    const found = (state.scene.openings || []).filter((item) => item.mapId === opening.mapId && item.kind === opening.kind && edges.has(item.edge));
    return found.length ? found : [opening];
  }

  function deletePlanSelection() {
    if (!planSelectionLive()) return;
    ensurePlan();
    pushHistory(archSnapshot());
    const ids = new Set(state.planSelect.wallIds);
    (state.scene.walls || []).forEach((wall) => {
      if (!ids.has(wall.id)) return;
      if (wall.kind !== 'door' && wall.kind !== 'window' && wall.kind !== 'grate' && !(wall.kind === 'secret' && wall.open)) return;
      VTTPlay.openingChain((state.scene.walls || []).filter((item) => item.mapId === wall.mapId), wall).forEach((item) => {
        if (item.id) ids.add(item.id);
      });
    });
    const roomIds = new Set();
    const groupIds = new Set();
    state.scene.walls.forEach((wall) => {
      if (!ids.has(wall.id)) return;
      if (wall.roomId) roomIds.add(wall.roomId);
      if (wall.groupId) groupIds.add(wall.groupId);
    });
    state.scene.walls = state.scene.walls.filter((wall) => !ids.has(wall.id) && !(wall.roomId && roomIds.has(wall.roomId)) && !(wall.groupId && groupIds.has(wall.groupId)));
    state.scene.floors = state.scene.floors.filter((floor) => floor.id !== state.planSelect.floorId && !(floor.roomId && (roomIds.has(floor.roomId) || groupIds.has(floor.roomId))));
    state.scene.props = state.scene.props.filter((prop) => prop.id !== state.planSelect.propId);
    state.scene.scrawls = state.scene.scrawls.filter((item) => item.id !== state.planSelect.scrawlId);
    state.scene.labels = state.scene.labels.filter((item) => item.id !== state.planSelect.labelId);
    state.scene.flights = state.scene.flights.filter((item) => item.id !== state.planSelect.flightId);
    const opening = (state.scene.openings || []).find((item) => item.id === state.planSelect.openingId);
    const dropOpenings = new Set(sameOpeningGroup(opening).map((item) => item.id));
    if (state.planSelect.openingId) dropOpenings.add(state.planSelect.openingId);
    state.scene.openings = state.scene.openings.filter((item) => !dropOpenings.has(item.id));
    state.planSelect = { wallIds: [], floorId: null, propId: null };
    syncPlanChrome();
    commitScene();
    paintPlanLayer();
  }

  function shiftPoint(point, dcx, dcy, grid, aspect) {
    const cell = VTTPlay.toCell(point.x, point.y, grid, aspect);
    return VTTPlay.fromCell(cell.cx + dcx, cell.cy + dcy, grid, aspect);
  }

  function shiftEdge(edge, dcx, dcy) {
    const parts = String(edge).split(':');
    return `${parts[0]}:${Number(parts[1]) + dcx}:${Number(parts[2]) + dcy}`;
  }

  function copyPlan() {
    const ids = state.planSelect.wallIds.slice();
    const propId = state.planSelect.propId;
    const floorId = state.planSelect.floorId;
    const scrawlId = state.planSelect.scrawlId;
    const labelId = state.planSelect.labelId;
    const flightId = state.planSelect.flightId;
    if (!ids.length && !propId && !floorId && !scrawlId && !labelId && !flightId) {
      toast('Сначала выберите комнату, стену или надпись');
      return;
    }
    if (scrawlId || labelId || flightId) {
      const { grid, aspect } = planLattice();
      ensurePlan();
      pushHistory(archSnapshot());
      if (scrawlId) {
        const shape = state.scene.scrawls.find((item) => item.id === scrawlId);
        if (shape) {
          const edges = new Set(VTTPlay.compileScrawl([shape], [], grid, aspect, shape.mapId).walls.map((wall) => wall.edge));
          const copy = structuredClone(shape);
          copy.id = crypto.randomUUID();
          copy.points = copy.points.map((point) => shiftPoint(point, 1, 0, grid, aspect));
          state.scene.scrawls.push(copy);
          state.scene.openings.forEach((opening) => {
            if (opening.mapId === shape.mapId && edges.has(opening.edge)) {
              state.scene.openings.push(Object.assign({}, opening, {
                id: crypto.randomUUID(),
                edge: shiftEdge(opening.edge, 1, 0),
              }));
            }
          });
          state.planSelect = { wallIds: [], floorId: null, propId: null, scrawlId: copy.id };
        }
      }
      if (labelId) {
        const label = state.scene.labels.find((item) => item.id === labelId);
        if (label) {
          const moved = shiftPoint(label, 1, 0, grid, aspect);
          const copy = Object.assign({}, label, { id: crypto.randomUUID(), x: moved.x, y: moved.y });
          state.scene.labels.push(copy);
          state.planSelect = { wallIds: [], floorId: null, propId: null, labelId: copy.id };
        }
      }
      if (flightId) {
        const flight = state.scene.flights.find((item) => item.id === flightId);
        if (flight) {
          const a = shiftPoint(flight, 1, 0, grid, aspect);
          const b = shiftPoint({ x: flight.x2, y: flight.y2 }, 1, 0, grid, aspect);
          const c = shiftPoint({ x: flight.x3, y: flight.y3 }, 1, 0, grid, aspect);
          const copy = Object.assign({}, flight, { id: crypto.randomUUID(), x: a.x, y: a.y, x2: b.x, y2: b.y, x3: c.x, y3: c.y });
          state.scene.flights.push(copy);
          state.planSelect = { wallIds: [], floorId: null, propId: null, flightId: copy.id };
        }
      }
      syncPlanChrome();
      commitScene();
      paintPlanLayer();
      return;
    }
    const { grid, aspect } = planLattice();
    const step = VTTPlay.fromCell(1, 0, grid, aspect);
    const zero = VTTPlay.fromCell(0, 0, grid, aspect);
    const dx = step.x - zero.x;
    const dy = step.y - zero.y;
    ensurePlan();
    pushHistory(archSnapshot());
    const roomAlias = new Map();
    const groupAlias = new Map();
    const aliasOf = (bag, key) => {
      if (!key) return null;
      if (!bag.has(key)) bag.set(key, crypto.randomUUID());
      return bag.get(key);
    };
    const newIds = [];
    ids.forEach((id) => {
      const wall = state.scene.walls.find((item) => item.id === id);
      if (!wall) return;
      const copy = Object.assign({}, wall, {
        id: crypto.randomUUID(),
        x: wall.x + dx,
        y: wall.y + dy,
        x2: wall.x2 + dx,
        y2: wall.y2 + dy,
        roomId: aliasOf(roomAlias, wall.roomId),
        groupId: aliasOf(groupAlias, wall.groupId),
      });
      state.scene.walls.push(copy);
      newIds.push(copy.id);
    });
    let newFloor = null;
    floorsHere().forEach((floor) => {
      const linked = (floor.roomId && (roomAlias.has(floor.roomId) || groupAlias.has(floor.roomId))) || floor.id === floorId;
      if (!linked) return;
      const nextRoom = floor.roomId && roomAlias.has(floor.roomId)
        ? roomAlias.get(floor.roomId)
        : (floor.roomId && groupAlias.has(floor.roomId) ? groupAlias.get(floor.roomId) : null);
      const copy = {
        id: crypto.randomUUID(),
        mapId: floor.mapId,
        roomId: nextRoom,
        kind: floor.kind,
        cells: (floor.cells || []).map((cell) => [cell[0] + 1, cell[1]]),
      };
      state.scene.floors.push(copy);
      newFloor = copy.id;
    });
    let newProp = null;
    if (propId) {
      const prop = state.scene.props.find((item) => item.id === propId);
      if (prop) {
        const copy = Object.assign({}, prop, { id: crypto.randomUUID(), x: prop.x + dx, y: prop.y + dy });
        state.scene.props.push(copy);
        newProp = copy.id;
      }
    }
    state.planSelect = { wallIds: newIds, floorId: newFloor, propId: newProp };
    syncPlanChrome();
    commitScene();
    paintPlanLayer();
  }

  function listenPlanDrag() {
    window.addEventListener('pointermove', movePlanDrag);
    window.addEventListener('pointerup', endPlanDrag);
    window.addEventListener('pointercancel', endPlanDrag);
  }

  function hitLabel(point) {
    const { grid, aspect } = planLattice();
    const p = VTTPlay.toCell(point.x, point.y, grid, aspect);
    let best = null;
    let bestD = 1.1;
    (state.scene.labels || []).forEach((label) => {
      if (label.mapId !== state.scene.currentMapId) return;
      const cell = VTTPlay.toCell(label.x, label.y, grid, aspect);
      const dist = Math.hypot(p.cx - cell.cx, p.cy - cell.cy);
      if (dist < bestD) {
        bestD = dist;
        best = label;
      }
    });
    return best;
  }

  function hitFlight(point) {
    const { grid, aspect } = planLattice();
    const p = VTTPlay.toCell(point.x, point.y, grid, aspect);
    let best = null;
    let bestD = 0.7;
    (state.scene.flights || []).forEach((flight) => {
      if (flight.mapId !== state.scene.currentMapId) return;
      const a = VTTPlay.toCell(flight.x, flight.y, grid, aspect);
      const b = VTTPlay.toCell(flight.x2, flight.y2, grid, aspect);
      const c = VTTPlay.toCell(flight.x3, flight.y3, grid, aspect);
      const dist = Math.min(
        Math.hypot(p.cx - (a.cx + b.cx) / 2, p.cy - (a.cy + b.cy) / 2),
        Math.hypot(p.cx - c.cx, p.cy - c.cy)
      );
      if (dist < bestD) {
        bestD = dist;
        best = flight;
      }
    });
    return best;
  }

  function addStairPoint(point) {
    state.stairPts.push(snapLine(point.x, point.y));
    if (state.stairPts.length < 3) {
      syncPlanChrome();
      paintPlanLayer();
      return;
    }
    const [a, b, c] = state.stairPts;
    state.stairPts = [];
    state.planDraft = null;
    const { grid, aspect } = planLattice();
    const left = VTTPlay.toCell(a.x, a.y, grid, aspect);
    const right = VTTPlay.toCell(b.x, b.y, grid, aspect);
    if (Math.hypot(left.cx - right.cx, left.cy - right.cy) < 0.4) {
      toast('Верхняя ступень слишком короткая');
      syncPlanChrome();
      paintPlanLayer();
      return;
    }
    ensurePlan();
    if (state.scene.flights.length >= 60) {
      toast('На карте уже много лестниц');
      return;
    }
    pushHistory(archSnapshot());
    const flight = {
      id: crypto.randomUUID(),
      mapId: state.scene.currentMapId,
      x: a.x,
      y: a.y,
      x2: b.x,
      y2: b.y,
      x3: c.x,
      y3: c.y,
      steps: state.stairSteps,
    };
    state.scene.flights.push(flight);
    state.planSelect = { wallIds: [], floorId: null, propId: null, flightId: flight.id };
    syncPlanChrome();
    commitScene();
    paintPlanLayer();
  }

  function placeLabel(point) {
    const input = document.getElementById('labelText');
    const text = String(input && input.value || '').trim().slice(0, 80);
    if (!text) {
      toast('Сначала впишите надпись');
      if (input) input.focus();
      return;
    }
    ensurePlan();
    if (state.scene.labels.length >= 80) {
      toast('Надписей уже много');
      return;
    }
    const snapped = snapPath(point.x, point.y);
    pushHistory(archSnapshot());
    const label = {
      id: crypto.randomUUID(),
      mapId: state.scene.currentMapId,
      x: snapped.x,
      y: snapped.y,
      text,
    };
    state.scene.labels.push(label);
    state.planSelect = { wallIds: [], floorId: null, propId: null, labelId: label.id };
    syncPlanChrome();
    commitScene();
    paintPlanLayer();
  }

  function beginPick(point) {
    const { grid, aspect } = planLattice();
    const label = hitLabel(point);
    const flight = label ? null : hitFlight(point);
    const grab = (originals, select) => {
      state.planSelect = Object.assign({ wallIds: [], floorId: null, propId: null }, select);
      planDrag = { mode: 'scrawl', origin: point, before: archSnapshot(), moved: false, originals };
      syncPlanChrome();
      listenPlanDrag();
      paintPlanLayer();
    };
    if (label) {
      const field = document.getElementById('labelText');
      if (field) field.value = label.text;
      grab([{ kind: 'label', id: label.id, x: label.x, y: label.y }], { labelId: label.id });
      return;
    }
    if (flight) {
      grab([{
        kind: 'flight',
        id: flight.id,
        x: flight.x,
        y: flight.y,
        x2: flight.x2,
        y2: flight.y2,
        x3: flight.x3,
        y3: flight.y3,
      }], { flightId: flight.id });
      return;
    }
    const cell = VTTPlay.toCell(point.x, point.y, grid, aspect);
    const view = VTTPlay.assemblePlan(state.scene, state.scene.currentMapId, grid, aspect);
    const owner = view.owner[`${Math.floor(cell.cx)}:${Math.floor(cell.cy)}`];
    const shape = owner ? (state.scene.scrawls || []).find((item) => item.id === owner) : null;
    if (!shape) {
      state.planSelect = { wallIds: [], floorId: null, propId: null };
      syncPlanChrome();
      paintPlanLayer();
      return;
    }
    const edges = new Set(VTTPlay.compileScrawl([shape], [], grid, aspect, shape.mapId).walls.map((wall) => wall.edge));
    const openings = (state.scene.openings || []).filter((item) => item.mapId === shape.mapId && edges.has(item.edge));
    grab([
      { kind: 'scrawl', id: shape.id, points: shape.points.map((spot) => ({ x: spot.x, y: spot.y })) },
    ].concat(openings.map((item) => ({ kind: 'opening', id: item.id, edge: item.edge }))), { scrawlId: shape.id });
  }

  function beginPlanPointer(event, point) {
    if (planDrag) return;
    const tool = state.tool;
    if (tool === 'vision') {
      const { grid, aspect } = planLattice();
      const snapped = VTTPlay.snapPoint(point.x, point.y, grid, aspect);
      showVision(snapped.x, snapped.y);
      return;
    }
    if (tool === 'floor') {
      paintFloorAt(point);
      return;
    }
    if (tool === 'door' || tool === 'window' || tool === 'grate' || tool === 'secret') {
      placeOpening(point, tool);
      return;
    }
    if (tool === 'corridor' || tool === 'poly') {
      if (event.detail >= 2) finishCorridor();
      else addCorridorPoint(point);
      return;
    }
    if (tool === 'stairs') {
      addStairPoint(point);
      return;
    }
    if (tool === 'text') {
      placeLabel(point);
      return;
    }
    if (tool === 'pick') {
      beginPick(point);
      return;
    }
    if (tool === 'prop') {
      const hit = hitProp(point);
      const prop = hit || placeProp(point);
      state.planSelect = { wallIds: [], floorId: null, propId: prop.id };
      syncPlanChrome();
      planDrag = { mode: 'prop', propId: prop.id, before: hit ? archSnapshot() : null, placed: !hit, moved: false };
      listenPlanDrag();
      return;
    }
    if (tool !== 'wall' && tool !== 'room' && tool !== 'carve' && tool !== 'ngon') return;
    const { grid, aspect } = planLattice();
    const hit = tool === 'wall' ? VTTPlay.nearestWall(point.x, point.y, manualWalls(), grid, aspect) : null;
    const chained = tool === 'wall' && state.planAnchor && (() => {
      const start = wallStart(point);
      return Math.abs(start.x - state.planAnchor.x) < 1e-4 && Math.abs(start.y - state.planAnchor.y) < 1e-4;
    })();
    if (hit && !chained) {
      selectWall(hit);
      const end = nearestEnd(hit, point);
      planDrag = {
        mode: end ? 'end' : 'move',
        wallId: hit.id,
        end,
        origin: point,
        before: archSnapshot(),
        originals: {
          walls: state.scene.walls.filter((wall) => state.planSelect.wallIds.includes(wall.id)).map((wall) => Object.assign({}, wall)),
          floors: state.scene.floors.filter((floor) => floor.id === state.planSelect.floorId).map((floor) => ({
            id: floor.id,
            cells: (floor.cells || []).map((cell) => cell.slice()),
          })),
        },
        moved: false,
      };
      listenPlanDrag();
      return;
    }
    const start = tool === 'wall' ? wallStart(point) : (tool === 'ngon' ? snapPath(point.x, point.y) : snapLine(point.x, point.y));
    state.planDraft = { kind: tool, mapId: state.scene.currentMapId, x: start.x, y: start.y, x2: start.x, y2: start.y, shift: event.shiftKey };
    planDrag = { mode: 'draw' };
    listenPlanDrag();
    paintPlanLayer();
  }

  function movePlanDrag(event) {
    if (!planDrag) return;
    const point = pointerNorm(event);
    if (!point) return;
    const { grid, aspect } = planLattice();
    if (planDrag.mode === 'draw' && state.planDraft) {
      state.planDraft.x2 = point.x;
      state.planDraft.y2 = point.y;
      state.planDraft.shift = event.shiftKey;
      paintPlanLayer();
      return;
    }
    if (planDrag.mode === 'scrawl') {
      const originCell = VTTPlay.toCell(planDrag.origin.x, planDrag.origin.y, grid, aspect);
      const nowCell = VTTPlay.toCell(point.x, point.y, grid, aspect);
      const dcx = Math.round(nowCell.cx - originCell.cx);
      const dcy = Math.round(nowCell.cy - originCell.cy);
      planDrag.originals.forEach((src) => {
        if (src.kind === 'scrawl') {
          const shape = state.scene.scrawls.find((item) => item.id === src.id);
          if (!shape) return;
          shape.points = src.points.map((spot) => shiftPoint(spot, dcx, dcy, grid, aspect));
        } else if (src.kind === 'label') {
          const label = state.scene.labels.find((item) => item.id === src.id);
          if (!label) return;
          const moved = shiftPoint(src, dcx, dcy, grid, aspect);
          label.x = moved.x;
          label.y = moved.y;
        } else if (src.kind === 'flight') {
          const flight = state.scene.flights.find((item) => item.id === src.id);
          if (!flight) return;
          const a = shiftPoint(src, dcx, dcy, grid, aspect);
          const b = shiftPoint({ x: src.x2, y: src.y2 }, dcx, dcy, grid, aspect);
          const c = shiftPoint({ x: src.x3, y: src.y3 }, dcx, dcy, grid, aspect);
          flight.x = a.x;
          flight.y = a.y;
          flight.x2 = b.x;
          flight.y2 = b.y;
          flight.x3 = c.x;
          flight.y3 = c.y;
        } else if (src.kind === 'opening') {
          const opening = state.scene.openings.find((item) => item.id === src.id);
          if (opening) opening.edge = shiftEdge(src.edge, dcx, dcy);
        }
      });
      if (dcx || dcy) planDrag.moved = true;
      paintPlanLayer();
      return;
    }
    if (planDrag.mode === 'prop') {
      const snapped = VTTPlay.snapPoint(point.x, point.y, grid, aspect);
      const prop = state.scene.props.find((item) => item.id === planDrag.propId);
      if (!prop) return;
      if (prop.x !== snapped.x || prop.y !== snapped.y) planDrag.moved = true;
      prop.x = snapped.x;
      prop.y = snapped.y;
      paintPlanLayer();
      return;
    }
    if (planDrag.mode === 'end') {
      const wall = state.scene.walls.find((item) => item.id === planDrag.wallId);
      const src = planDrag.originals.walls.find((item) => item.id === planDrag.wallId);
      if (!wall || !src) return;
      let endCell = VTTPlay.toCell(point.x, point.y, grid, aspect);
      const fixed = planDrag.end === 'a'
        ? VTTPlay.toCell(src.x2, src.y2, grid, aspect)
        : VTTPlay.toCell(src.x, src.y, grid, aspect);
      if (!event.shiftKey) endCell = VTTPlay.lockAxis(fixed, endCell);
      const snapped = VTTPlay.fromCell(Math.round(endCell.cx), Math.round(endCell.cy), grid, aspect);
      if (planDrag.end === 'a') {
        wall.x = snapped.x;
        wall.y = snapped.y;
      } else {
        wall.x2 = snapped.x;
        wall.y2 = snapped.y;
      }
      planDrag.moved = true;
      paintPlanLayer();
      return;
    }
    if (planDrag.mode !== 'move') return;
    const originCell = VTTPlay.toCell(planDrag.origin.x, planDrag.origin.y, grid, aspect);
    const nowCell = VTTPlay.toCell(point.x, point.y, grid, aspect);
    const dcx = Math.round(nowCell.cx - originCell.cx);
    const dcy = Math.round(nowCell.cy - originCell.cy);
    planDrag.originals.walls.forEach((src) => {
      const wall = state.scene.walls.find((item) => item.id === src.id);
      if (!wall) return;
      const a = VTTPlay.toCell(src.x, src.y, grid, aspect);
      const b = VTTPlay.toCell(src.x2, src.y2, grid, aspect);
      const p1 = VTTPlay.fromCell(a.cx + dcx, a.cy + dcy, grid, aspect);
      const p2 = VTTPlay.fromCell(b.cx + dcx, b.cy + dcy, grid, aspect);
      wall.x = p1.x;
      wall.y = p1.y;
      wall.x2 = p2.x;
      wall.y2 = p2.y;
    });
    planDrag.originals.floors.forEach((src) => {
      const floor = state.scene.floors.find((item) => item.id === src.id);
      if (!floor) return;
      floor.cells = src.cells.map((cell) => [cell[0] + dcx, cell[1] + dcy]);
    });
    if (dcx || dcy) planDrag.moved = true;
    paintPlanLayer();
  }

  function endPlanDrag(event) {
    window.removeEventListener('pointermove', movePlanDrag);
    window.removeEventListener('pointerup', endPlanDrag);
    window.removeEventListener('pointercancel', endPlanDrag);
    const drag = planDrag;
    planDrag = null;
    if (!drag) return;
    if (drag.mode === 'draw') {
      const draft = state.planDraft;
      state.planDraft = null;
      if (!draft) {
        paintPlanLayer();
        return;
      }
      const point = pointerNorm(event) || { x: draft.x2, y: draft.y2 };
      if (Math.hypot(point.x - draft.x, point.y - draft.y) < 0.004) {
        state.planSelect = { wallIds: [], floorId: null, propId: null };
        syncPlanChrome();
        paintPlanLayer();
        return;
      }
      draft.shift = event.shiftKey;
      if (draft.kind === 'room') commitRoom(draft, point);
      else if (draft.kind === 'carve') commitCarve(draft, point);
      else if (draft.kind === 'ngon') commitNgon(draft, point);
      else commitWall({ x: draft.x, y: draft.y }, point, draft.shift);
      paintPlanLayer();
      return;
    }
    if (drag.mode === 'prop') {
      if (drag.moved && drag.before) pushHistory(drag.before);
      if (drag.moved) commitScene();
      paintPlanLayer();
      return;
    }
    if (drag.moved) {
      pushHistory(drag.before);
      commitScene();
    }
    paintPlanLayer();
  }

  function bindPlan() {
    const floorKind = document.getElementById('floorKind');
    const corridorWidth = document.getElementById('corridorWidth');
    const wallsBlock = document.getElementById('wallsBlock');
    if (floorKind) floorKind.value = state.floorKind;
    if (corridorWidth) corridorWidth.value = String(state.corridorWidth);
    if (wallsBlock) wallsBlock.checked = state.wallsBlock;
    if (floorKind) floorKind.addEventListener('change', () => {
      state.floorKind = VTTPlay.FLOOR_COLORS[floorKind.value] ? floorKind.value : 'stone';
      savePrefs();
    });
    if (corridorWidth) corridorWidth.addEventListener('change', () => {
      state.corridorWidth = corridorWidth.value === '2' ? 2 : 1;
      savePrefs();
    });
    if (wallsBlock) wallsBlock.addEventListener('change', () => {
      state.wallsBlock = wallsBlock.checked;
      savePrefs();
    });
    document.querySelectorAll('[data-prop]').forEach((button) => {
      button.addEventListener('click', () => {
        state.propKind = button.dataset.prop;
        setTool('prop');
      });
    });
    document.getElementById('corridorDone').addEventListener('click', finishCorridor);
    document.getElementById('planCopy').addEventListener('click', copyPlan);
    document.getElementById('planDelete').addEventListener('click', deletePlanSelection);
    document.getElementById('planOpen').addEventListener('change', () => {
      const open = document.getElementById('planOpen').checked;
      const opening = (state.scene.openings || []).find((item) => item.id === state.planSelect.openingId);
      if (opening && (opening.kind === 'door' || opening.kind === 'secret')) {
        pushHistory(archSnapshot());
        sameOpeningGroup(opening).forEach((item) => { item.open = open; });
        syncPlanChrome();
        commitScene();
        paintPlanLayer();
        return;
      }
      const doors = (state.scene.walls || []).filter((wall) => state.planSelect.wallIds.includes(wall.id) && (wall.kind === 'door' || wall.kind === 'secret'));
      if (!doors.length) return;
      pushHistory(archSnapshot());
      const pool = (state.scene.walls || []).filter((wall) => wall.mapId === state.scene.currentMapId);
      const seen = new Set();
      doors.forEach((door) => {
        VTTPlay.openingChain(pool, door).forEach((item) => {
          if (!item.id || seen.has(item.id)) return;
          seen.add(item.id);
          const found = state.scene.walls.find((wall) => wall.id === item.id);
          if (found && (found.kind === 'door' || found.kind === 'secret')) found.open = open;
        });
      });
      syncPlanChrome();
      commitScene();
      paintPlanLayer();
    });
    document.getElementById('visionShow').addEventListener('click', visionFromToken);
    document.getElementById('visionFog').addEventListener('click', revealVision);
    document.getElementById('visionClear').addEventListener('click', clearVision);
    const pathRadius = document.getElementById('pathRadius');
    const planDiv = document.getElementById('planDiv');
    const ngonSides = document.getElementById('ngonSides');
    const rough = document.getElementById('roughPlan');
    const scrawlCut = document.getElementById('scrawlCut');
    const labelText = document.getElementById('labelText');
    if (pathRadius) {
      pathRadius.value = String(state.pathRadius);
      pathRadius.addEventListener('input', () => {
        state.pathRadius = Math.max(0.25, Math.min(4, Number(pathRadius.value) || 0.5));
        const label = document.getElementById('pathRadiusLabel');
        if (label) label.textContent = state.pathRadius.toFixed(1);
        savePrefs();
        paintPlanLayer();
      });
    }
    if (planDiv) {
      planDiv.value = String(state.planDiv);
      planDiv.addEventListener('change', () => {
        state.planDiv = [1, 2, 4].includes(Number(planDiv.value)) ? Number(planDiv.value) : 1;
        savePrefs();
      });
    }
    if (ngonSides) {
      ngonSides.value = String(state.ngonSides);
      ngonSides.addEventListener('change', () => {
        state.ngonSides = Math.max(3, Math.min(8, Number(ngonSides.value) || 6));
        savePrefs();
      });
    }
    if (rough) {
      rough.checked = state.rough;
      rough.addEventListener('change', () => {
        state.rough = rough.checked;
        savePrefs();
      });
    }
    if (scrawlCut) {
      scrawlCut.checked = state.scrawlCut;
      scrawlCut.addEventListener('change', () => {
        state.scrawlCut = scrawlCut.checked;
        savePrefs();
      });
    }
    if (labelText) labelText.addEventListener('change', () => {
      const label = (state.scene.labels || []).find((item) => item.id === state.planSelect.labelId);
      const text = labelText.value.trim().slice(0, 80);
      if (!label || !text || text === label.text) return;
      pushHistory(archSnapshot());
      label.text = text;
      syncPlanChrome();
      commitScene();
      paintPlanLayer();
    });
    const redoBtn = document.getElementById('redoBtn');
    if (redoBtn) redoBtn.addEventListener('click', redo);
    const exportPlan = document.getElementById('exportPlan');
    if (exportPlan) exportPlan.addEventListener('click', exportMapPng);
    const radiusLabel = document.getElementById('pathRadiusLabel');
    if (radiusLabel) radiusLabel.textContent = state.pathRadius.toFixed(1);
    syncPlanChrome();
  }

  function exportMapPng() {
    const w = ui.planLayer.width;
    const h = ui.planLayer.height;
    const map = mapById(state.scene.currentMapId);
    if (!w || !h || !map) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a2420';
    ctx.fillRect(0, 0, w, h);
    const video = document.getElementById('mapVideo');
    try {
      if (video && !video.hidden && video.readyState >= 2) ctx.drawImage(video, 0, 0, w, h);
      else if (ui.mapImage && !ui.mapImage.hidden && ui.mapImage.naturalWidth) ctx.drawImage(ui.mapImage, 0, 0, w, h);
    } catch (error) {
      console.error(error);
    }
    const plate = document.createElement('canvas');
    plate.width = w;
    plate.height = h;
    const plateCtx = plate.getContext('2d');
    const { grid, aspect } = planLattice();
    const plan = VTTPlay.assemblePlan(state.scene, map.id, grid, aspect);
    VTTPlay.paintPlan(plateCtx, plan, { gm: false, grid, aspect, part: 'floor' });
    ctx.drawImage(plate, 0, 0);
    if (ui.gridLayer.width) ctx.drawImage(ui.gridLayer, 0, 0, w, h);
    VTTPlay.paintPlan(plateCtx, plan, { gm: false, grid, aspect, part: 'above' });
    ctx.drawImage(plate, 0, 0);
    if (ui.drawLayer.width) ctx.drawImage(ui.drawLayer, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${map.name || 'karta'}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, 'image/png');
    toast('Карта скачивается');
  }

  function bindDrawing() {
    ui.pointerLayer.addEventListener('pointerdown', (event) => {
      if (state.spaceDown) return;
      if (event.button === 2 && state.tool === 'pointer') {
        clearPointer();
        return;
      }
      if (event.button !== 0) return;
      if (startGridDrag(event)) return;
      const point = pointerNorm(event);
      if (!point) return;
      if (state.tool === 'pointer') {
        placePointer(point);
        return;
      }
      if (state.tool === 'measure') {
        beginMeasure(point, event);
        return;
      }
      if (PLAN_TOOLS.includes(state.tool)) {
        beginPlanPointer(event, point);
        return;
      }
      if (!brushMode()) return;
      try { ui.pointerLayer.setPointerCapture(event.pointerId); } catch (err) { /* указатель уже захвачен или событие синтетическое */ }
      beginStroke(point);
    });
    ui.pointerLayer.addEventListener('pointermove', (event) => {
      moveBrushCursor(event);
      if ((state.tool === 'corridor' || state.tool === 'poly' || state.tool === 'stairs') && !planDrag) {
        const point = pointerNorm(event);
        const waiting = (state.tool !== 'stairs' && state.corridorPts.length) || (state.tool === 'stairs' && state.stairPts.length);
        if (point && waiting) {
          const snapped = state.tool === 'corridor' ? snapPath(point.x, point.y) : snapLine(point.x, point.y);
          state.planDraft = { kind: 'hover', mapId: state.scene.currentMapId, x: snapped.x, y: snapped.y };
          paintPlanLayer();
        }
      }
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
    const onTokenDown = (event) => {
      if (startGridDrag(event)) return;
      if (state.tool !== 'move' || event.button !== 0) return;
      const wrap = event.target.closest('.token');
      if (!wrap) return;
      event.preventDefault();
      event.stopPropagation();
      const token = state.scene.tokens.find((item) => item.id === wrap.dataset.id);
      if (!token) return;
      if (event.shiftKey) {
        const set = new Set(state.selection);
        if (set.has(token.id)) set.delete(token.id);
        else set.add(token.id);
        state.selection = [...set];
        state.selectedId = state.selection[state.selection.length - 1] || null;
        markTokenChrome();
        syncTokenEditor(selectedToken());
        return;
      }
      if (!state.selection.includes(token.id)) selectOne(token.id);
      else state.selectedId = token.id;
      token.z = ++state.scene.nextZ;
      showSide('tokens');
      markTokenChrome();
      syncTokenEditor(token);
      const row = ui.tokenList.querySelector(`[data-id="${token.id}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
      if (token.locked) return;
      if (tokenGesture) tokenGesture.up();
      const handle = event.target.dataset ? event.target.dataset.handle : '';
      const movers = handle ? [token] : selectedTokens().filter((item) => !item.locked);
      const before = poseSnapshot(movers);
      const start = pointerNorm(event);
      const origin = { x: token.x, y: token.y, scale: token.scale, rotation: token.rotation || 0 };
      const center = wrap.getBoundingClientRect();
      const cx = center.left + center.width / 2;
      const cy = center.top + center.height / 2;
      const startAngle = Math.atan2(event.clientY - cy, event.clientX - cx);
      const startDist = Math.max(8, Math.hypot(event.clientX - cx, event.clientY - cy));
      const grid = currentGrid(false) || defaultGrid();
      const aspect = boardAspect();
      const walls = state.wallsBlock ? wallsHere(token.mapId) : null;
      const move = (ev) => {
        if (!tokenGesture) return;
        tokenGesture.moved = true;
        if (handle === 'rot') {
          const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
          let deg = origin.rotation + ((angle - startAngle) * 180) / Math.PI;
          deg = (deg % 360 + 360) % 360;
          updateToken({ rotation: deg }, true);
          return;
        }
        if (handle === 'scale') {
          const dist = Math.max(8, Math.hypot(ev.clientX - cx, ev.clientY - cy));
          token.size = '';
          updateToken({ scale: clamp(origin.scale * (dist / startDist), 0.03, 1.5) }, true);
          return;
        }
        const point = pointerNorm(ev);
        if (!point || !start) return;
        let x = origin.x + (point.x - start.x);
        let y = origin.y + (point.y - start.y);
        if (state.snap) {
          const snapped = VTTPlay.snapPoint(x, y, grid, aspect);
          x = snapped.x;
          y = snapped.y;
        }
        if (walls) {
          const stopped = VTTPlay.clampTravel(origin.x, origin.y, x, y, walls, grid, aspect);
          x = stopped.x;
          y = stopped.y;
        }
        updateToken({
          x: clamp(x, -0.25, 1.25),
          y: clamp(y, -0.25, 1.25),
        }, true, 'group');
      };
      const up = () => {
        if (!tokenGesture || tokenGesture.up !== up) return;
        tokenGesture = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        rememberPoses(before);
        commitScene();
        renderTokens().catch((error) => console.error(error));
      };
      tokenGesture = { up, moved: false };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };
    ui.tokenLayer.addEventListener('pointerdown', onTokenDown);
    ui.backLayer.addEventListener('pointerdown', onTokenDown);

    ui.board.addEventListener('pointerdown', (event) => {
      if (state.tool !== 'move' || event.button !== 0 || state.spaceDown || event.altKey) return;
      if (event.target.closest('.token, button, input, a, textarea, select')) return;
      const start = pointerNorm(event);
      if (!start) return;
      const box = document.createElement('div');
      box.className = 'marquee';
      ui.board.appendChild(box);
      const move = (ev) => {
        const end = pointerNorm(ev);
        if (!end) return;
        box.style.left = `${Math.min(start.x, end.x) * 100}%`;
        box.style.top = `${Math.min(start.y, end.y) * 100}%`;
        box.style.width = `${Math.abs(end.x - start.x) * 100}%`;
        box.style.height = `${Math.abs(end.y - start.y) * 100}%`;
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        box.remove();
        const end = pointerNorm(ev) || start;
        const dragged = Math.hypot(ev.clientX - event.clientX, ev.clientY - event.clientY) > 4;
        if (!dragged) {
          if (!ev.shiftKey) selectOne(null);
          renderTokens();
          return;
        }
        const hits = currentTokens().filter((token) => (
          !token.locked
          && token.x >= Math.min(start.x, end.x) && token.x <= Math.max(start.x, end.x)
          && token.y >= Math.min(start.y, end.y) && token.y <= Math.max(start.y, end.y)
        )).map((token) => token.id);
        if (ev.shiftKey) {
          const set = new Set(state.selection);
          hits.forEach((id) => set.add(id));
          state.selection = [...set];
        } else state.selection = hits;
        state.selectedId = state.selection[state.selection.length - 1] || null;
        if (state.selectedId) showSide('tokens');
        renderTokens();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });

    ui.tokenList.addEventListener('click', (event) => {
      const row = event.target.closest('[data-id]');
      if (!row) return;
      if (event.shiftKey) {
        const set = new Set(state.selection);
        if (set.has(row.dataset.id)) set.delete(row.dataset.id);
        else set.add(row.dataset.id);
        state.selection = [...set];
        state.selectedId = state.selection[state.selection.length - 1] || null;
      } else selectOne(row.dataset.id);
      setTool('move');
      const token = selectedToken();
      if (token) {
        token.z = ++state.scene.nextZ;
        broadcastPose(token);
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
      if (event.key === 'Escape') {
        if ((state.tool === 'corridor' || state.tool === 'poly') && state.corridorPts.length) {
          state.corridorPts = [];
          state.planDraft = null;
          syncPlanChrome();
          paintPlanLayer();
          return;
        }
        if (state.tool === 'stairs' && state.stairPts.length) {
          state.stairPts = [];
          state.planDraft = null;
          syncPlanChrome();
          paintPlanLayer();
          return;
        }
        if (state.vision) {
          clearVision();
          return;
        }
      }
      if (event.altKey || event.ctrlKey || event.metaKey) {
        if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && !event.shiftKey) {
          event.preventDefault();
          undo();
          react('Ctrl+Z', 'Отмена', document.getElementById('undoBtn'));
        } else if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey))) {
          event.preventDefault();
          redo();
          react('Ctrl+Y', 'Повтор', document.getElementById('redoBtn'));
        } else if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyC' || event.code === 'KeyV') && PLAN_TOOLS.includes(state.tool) && planSelectionLive()) {
          event.preventDefault();
          copyPlan();
        }
        return;
      }
      if (event.code === 'KeyP') {
        showView('table');
        setTool('pointer');
        react('P', 'Указка', document.querySelector('[data-tool="pointer"]'));
      } else if (event.code === 'KeyL') {
        showView('table');
        setTool('measure');
        react('L', 'Шаблоны', document.querySelector('[data-tool="measure"]'));
      } else if (event.code === 'KeyM') {
        state.snap = !state.snap;
        const snap = document.getElementById('snapGrid');
        if (snap) snap.checked = state.snap;
        savePrefs();
        react('M', state.snap ? 'Прилипание включено' : 'Прилипание выключено', snap);
      } else if (event.code === 'KeyH') {
        toggleBlackout();
        react('H', state.scene.blackout ? 'Стол погашен' : 'Стол включён', document.getElementById('blackoutBtn'));
      } else if (event.code === 'KeyT') {
        stepTurn(1);
        react('T', 'Следующий ход', document.getElementById('initiativeNext'));
      } else if (event.code === 'Digit1') {
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
      } else if (event.code === 'KeyW') {
        showView('table');
        setTool('wall');
        react('W', 'Стена', document.getElementById('wallTool'));
      } else if (event.code === 'KeyO') {
        showView('table');
        setTool('room');
        react('O', 'Комната', document.querySelector('[data-tool="room"]'));
      } else if (event.code === 'KeyC') {
        showView('table');
        setTool('corridor');
        react('C', 'Коридор', document.querySelector('[data-tool="corridor"]'));
      } else if (event.code === 'KeyJ') {
        showView('table');
        setTool('floor');
        react('J', 'Пол', document.querySelector('[data-tool="floor"]'));
      } else if (event.code === 'KeyD') {
        showView('table');
        setTool('door');
        react('D', 'Дверь', document.getElementById('doorTool'));
      } else if (event.code === 'Enter' && (state.tool === 'corridor' || state.tool === 'poly')) {
        event.preventDefault();
        finishCorridor();
      } else if (event.code === 'KeyG') {
        const grid = currentGrid(true);
        if (!grid) return;
        updateGrid({ enabled: !grid.enabled });
        react('G', grid.enabled ? 'Сетка включена' : 'Сетка выключена', document.getElementById('gridOn'));
      } else if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        const up = event.code === 'BracketRight';
        if (state.tool === 'corridor') {
          state.pathRadius = Math.max(0.25, Math.min(4, Math.round((state.pathRadius + (up ? 0.1 : -0.1)) * 10) / 10));
          const field = document.getElementById('pathRadius');
          if (field) field.value = String(state.pathRadius);
          const label = document.getElementById('pathRadiusLabel');
          if (label) label.textContent = state.pathRadius.toFixed(1);
          savePrefs();
          paintPlanLayer();
          react(up ? ']' : '[', `Ширина ${state.pathRadius.toFixed(1)}`);
          return;
        }
        if (state.tool === 'ngon') {
          state.ngonSides = Math.max(3, Math.min(8, state.ngonSides + (up ? 1 : -1)));
          const field = document.getElementById('ngonSides');
          if (field) field.value = String(state.ngonSides);
          savePrefs();
          react(up ? ']' : '[', `Граней ${state.ngonSides}`);
          return;
        }
        if (state.tool === 'stairs') {
          state.stairSteps = Math.max(2, Math.min(12, state.stairSteps + (up ? 1 : -1)));
          savePrefs();
          paintPlanLayer();
          react(up ? ']' : '[', `Ступеней ${state.stairSteps}`);
          return;
        }
        if (!state.sizes[state.tool]) return;
        state.size = clamp(state.size + (event.code === 'BracketRight' ? 0.002 : -0.002), 0.002, 0.08);
        state.sizes[state.tool] = state.size;
        ui.brushSize.value = String(state.size);
        updateSizeLabel();
        paintToolSizes();
        savePrefs();
        react(event.code === 'BracketRight' ? ']' : '[', `Толщина ${(state.size * 100).toFixed(1)}%`);
      }
      if (state.selectedId && state.tool === 'move' && event.key.startsWith('Arrow')) {
        const token = selectedToken();
        if (!token) return;
        event.preventDefault();
        const step = event.shiftKey ? 0.05 : 0.01;
        const grid = currentGrid(false) || defaultGrid();
        const cellX = state.snap ? 1 / VTTPlay.colsOf(grid) : step;
        const cellY = state.snap ? cellX / boardAspect() : step;
        let x = token.x;
        let y = token.y;
        if (event.key === 'ArrowLeft') x -= cellX;
        if (event.key === 'ArrowRight') x += cellX;
        if (event.key === 'ArrowUp') y -= cellY;
        if (event.key === 'ArrowDown') y += cellY;
        if (state.wallsBlock) {
          const stopped = VTTPlay.clampTravel(token.x, token.y, x, y, wallsHere(token.mapId), grid, boardAspect());
          x = stopped.x;
          y = stopped.y;
        }
        updateToken({ x: clamp(x, -0.25, 1.25), y: clamp(y, -0.25, 1.25) }, false, 'group');
        if (!event.repeat) react(event.key.replace('Arrow', ''), 'Объект');
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
          react('Delete', 'Объект удалён');
        } else if (planSelectionLive()) {
          event.preventDefault();
          deletePlanSelection();
          react('Delete', 'С чертежа убрано');
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
      cols: grid.cols || 27,
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
    const names = { draw: 'Кисть', erase: 'Ластик', fog: 'Туман', reveal: 'Стирание тумана' };
    const name = names[state.tool] || 'Толщина';
    ui.sizeLabel.textContent = `${name} · ${(state.size * 100).toFixed(1)}% карты`;
  }

  function buildSwatches() {
    ui.swatches.textContent = '';
    COLORS.concat(state.recentColors.filter((color) => !COLORS.includes(color.toLowerCase()))).forEach((color) => {
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
    picker.addEventListener('change', () => rememberColor(picker.value));
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

    document.getElementById('mapPanel').addEventListener('dragenter', () => { dropKind = 'map'; });
    document.getElementById('tokenPanel').addEventListener('dragenter', () => { dropKind = 'token'; });
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      const files = [...event.dataTransfer.files];
      if (dropKind === 'library') addLibraryFiles(files.filter((file) => fileKind(file) === 'image'));
      else if (dropKind === 'token' && currentMap()) addTokenFiles(files.filter((file) => fileKind(file) === 'image'));
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
      else if (action === 'copy') copyMap(id);
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
    document.getElementById('mapPause').addEventListener('click', () => {
      if (!mapIsVideo(currentMap())) return;
      state.scene.mapPaused = !state.scene.mapPaused;
      syncPlaybackControls();
      commitScene();
    });
    document.getElementById('mapSound').addEventListener('click', () => {
      if (!mapIsVideo(currentMap())) return;
      state.scene.mapSound = !state.scene.mapSound;
      syncPlaybackControls();
      commitScene();
    });
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
    const readGrid = () => ({
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
    const apply = (persist) => updateGrid(readGrid(), persist);
    const inputs = [on, onTable, type, cols, offsetX, offsetY, color, opacity, major];
    if (inputs.some((input) => !input)) return;
    inputs.forEach((input) => {
      input.addEventListener('input', () => apply(false));
      input.addEventListener('change', () => apply(true));
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
    if (next.mapPaused == null) next.mapPaused = false;
    if (next.mapSound == null) next.mapSound = false;
    if (next.tableMapId === undefined) next.tableMapId = next.currentMapId || null;
    if (!Array.isArray(next.templates)) next.templates = [];
    next.templates = next.templates.map((item) => {
      const kinds = ['line', 'cone', 'circle', 'square'];
      if (!item || !item.id || !kinds.includes(item.kind)) return null;
      const num = (value) => Math.max(-0.25, Math.min(1.25, Number(value) || 0));
      return {
        id: item.id,
        mapId: item.mapId || null,
        kind: item.kind,
        x: num(item.x),
        y: num(item.y),
        x2: num(item.x2),
        y2: num(item.y2),
        shown: !!item.shown,
      };
    }).filter(Boolean);
    next.initiative = VTTPlay.normalizeInitiative(next.initiative);
    next.card = VTTPlay.normalizeCard(next.card);
    next.blackout = !!next.blackout;
    next.gmPointer = next.gmPointer && next.gmPointer.mapId
      ? { mapId: next.gmPointer.mapId, x: Number(next.gmPointer.x) || 0, y: Number(next.gmPointer.y) || 0 }
      : null;
    next.recentMaps = Array.isArray(next.recentMaps) ? next.recentMaps.filter((id) => typeof id === 'string').slice(0, 6) : [];
    const ids = new Set();
    (next.tokens || []).forEach((token) => {
      VTTPlay.normalizeToken(token);
      ids.add(token.id);
    });
    (next.tokens || []).forEach((token) => {
      if (token.parentId === token.id || !ids.has(token.parentId)) token.parentId = null;
    });
    next.initiative.items.forEach((item) => {
      if (item.tokenId && !ids.has(item.tokenId)) item.tokenId = null;
    });
    return VTTPlay.normalizePlan(next);
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
    await VTTDB.putKv(`tables:${state.project.id}`, pack.tables);
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
    const stored = await VTTDB.getKv(`scene:${id}`);
    state.scene = normalizeScene(stored || await VTTDB.getScene());
    sceneLoaded = true;
    state.history = [];
    selectOne(null);
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    applyZoom();
    ui.pixelated.checked = !!state.scene.pixelated;
    const notes = await VTTDB.getKv(`notes:${id}`);
    const dice = await VTTDB.getKv(`dice:${id}`);
    const tables = await VTTDB.getKv(`tables:${id}`);
    await VTTDesk.importPack({
      notes: notes || null,
      presets: dice && Array.isArray(dice.presets) ? dice.presets : null,
      history: dice && Array.isArray(dice.history) ? dice.history : [],
      tables: tables || null,
    });
    adoptMaps(await VTTDB.allMaps());
    libraryFolderId = null;
    await loadLibrary();
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
    const lib = normalizeLibrary(await VTTDB.getKv(`library:${id}`));
    await Promise.all(lib.items.map((item) => VTTDB.deleteBlob(item.id)));
    await VTTDB.deleteKv(`library:${id}`);
    const maps = (await VTTDB.allMaps() || []).filter((map) => map.projectId === id);
    await Promise.all(maps.map((map) => VTTDB.deleteMap(map.id)));
    await VTTDB.deleteKv(`scene:${id}`);
    await VTTDB.deleteKv(`notes:${id}`);
    await VTTDB.deleteKv(`dice:${id}`);
    await VTTDB.deleteKv(`tables:${id}`);
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
        selectOne(null);
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
          kind: map.kind === 'video' ? 'video' : 'image',
          type: encoded.type || (map.kind === 'video' ? 'video/mp4' : 'image/png'),
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
      const libraryItems = [];
      for (const item of library.items) {
        const blob = await VTTDB.getBlob(item.id);
        if (!blob) continue;
        const encoded = await blobToBase64(blob);
        libraryItems.push({
          id: item.id,
          folderId: item.folderId,
          name: item.name,
          created: item.created,
          cut: item.cut || null,
          stat: VTTPlay.cleanStat(item.stat),
          type: encoded.type,
          data: encoded.data,
        });
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
        library: { folders: library.folders, items: libraryItems },
        notes: pack.notes,
        dice: { presets: pack.presets, history: pack.history },
        tables: pack.tables,
      });
      editsSinceFile = 0;
      state.lastFileSave = Date.now();
      savePrefs();
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
      token.parentId = aliasId(tokenAlias, token.parentId);
    });
    (next.templates || []).forEach((item) => {
      item.mapId = mapOf(item.mapId);
    });
    (next.walls || []).forEach((wall) => { wall.mapId = mapOf(wall.mapId); });
    (next.floors || []).forEach((floor) => { floor.mapId = mapOf(floor.mapId); });
    (next.props || []).forEach((prop) => { prop.mapId = mapOf(prop.mapId); });
    (next.scrawls || []).forEach((item) => { item.mapId = mapOf(item.mapId); });
    (next.openings || []).forEach((item) => { item.mapId = mapOf(item.mapId); });
    (next.labels || []).forEach((item) => { item.mapId = mapOf(item.mapId); });
    (next.flights || []).forEach((item) => { item.mapId = mapOf(item.mapId); });
    (next.initiative.items || []).forEach((item) => {
      item.tokenId = aliasId(tokenAlias, item.tokenId);
    });
    if (next.gmPointer) next.gmPointer.mapId = mapOf(next.gmPointer.mapId);
    next.recentMaps = (next.recentMaps || []).map(mapOf);
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
    const foreignLibrary = new Set();
    for (const project of projects) {
      if (project.id === projectId) continue;
      const stored = await VTTDB.getKv(`scene:${project.id}`);
      ((stored && stored.tokens) || []).forEach((token) => foreignTokens.add(token.id));
      normalizeLibrary(await VTTDB.getKv(`library:${project.id}`)).items.forEach((item) => foreignLibrary.add(item.id));
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
      const kind = map.kind === 'video' || String(map.type || '').startsWith('video/') ? 'video' : 'image';
      await VTTDB.putMap({
        id: map.id,
        name: map.name || 'Карта',
        created: map.created || Date.now(),
        projectId,
        kind,
        blob: await base64ToBlob(map.data, map.type || (kind === 'video' ? 'video/mp4' : 'image/png')),
      });
    }
    for (const token of incoming) {
      if (!token || !token.id || !token.data) continue;
      await VTTDB.putBlob(token.id, await base64ToBlob(token.data, token.type));
    }
    const oldLibrary = normalizeLibrary(await VTTDB.getKv(`library:${projectId}`));
    for (const item of oldLibrary.items) {
      if (!nextIds.has(item.id)) await VTTDB.deleteBlob(item.id);
    }
    const sourceLibrary = data.library && typeof data.library === 'object' ? data.library : { folders: [], items: [] };
    const itemAlias = new Map();
    (sourceLibrary.items || []).forEach((item) => {
      if (item && item.id && (foreignLibrary.has(item.id) || foreignTokens.has(item.id))) {
        itemAlias.set(item.id, crypto.randomUUID());
      }
    });
    const nextFolders = (sourceLibrary.folders || []).filter((folder) => folder && folder.id).map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId || null,
      created: folder.created,
    }));
    const nextItems = [];
    for (const item of sourceLibrary.items || []) {
      if (!item || !item.id || !item.data || !item.folderId) continue;
      const id = itemAlias.get(item.id) || item.id;
      await VTTDB.putBlob(id, await base64ToBlob(item.data, item.type));
      nextItems.push({
        id,
        folderId: item.folderId,
        name: item.name,
        created: item.created,
        cut: item.cut || null,
        stat: VTTPlay.cleanStat(item.stat),
      });
    }
    (scene.tokens || []).forEach((token) => {
      if (token.libraryId && itemAlias.has(token.libraryId)) token.libraryId = itemAlias.get(token.libraryId);
    });
    await VTTDB.putKv(`library:${projectId}`, normalizeLibrary({ folders: nextFolders, items: nextItems }));
    await VTTDB.putKv(`scene:${projectId}`, scene);
    if (data.notes) await VTTDB.putKv(`notes:${projectId}`, data.notes);
    else await VTTDB.deleteKv(`notes:${projectId}`);
    if (data.dice) await VTTDB.putKv(`dice:${projectId}`, data.dice);
    else await VTTDB.deleteKv(`dice:${projectId}`);
    if (data.notes && Array.isArray(data.notes.items)) {
      data.notes.items.forEach((note) => {
        if (!note) return;
        if (note.mapId) note.mapId = aliasId(mapAlias, note.mapId);
        if (note.tokenId) note.tokenId = aliasId(tokenAlias, note.tokenId);
      });
    }
    if (data.tables && Array.isArray(data.tables.items)) await VTTDB.putKv(`tables:${projectId}`, data.tables);
    else await VTTDB.deleteKv(`tables:${projectId}`);
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
    bindPlan();
    bindTokens();
    bindPanZoom();
    bindKeys();
    bindFiles();
    bindLists();
    bindLibrary();

    document.querySelector('.panel.right').addEventListener('click', (event) => {
      const button = event.target.closest('[data-tool]');
      if (button) setTool(button.dataset.tool);
    });
    ui.brushSize.addEventListener('input', () => {
      state.size = Number(ui.brushSize.value);
      if (state.sizes[state.tool] != null) state.sizes[state.tool] = state.size;
      updateSizeLabel();
      paintToolSizes();
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
    document.getElementById('duplicateToken').addEventListener('click', () => duplicateSelected());
    document.getElementById('tokenNote').addEventListener('input', () => {
      const token = selectedToken();
      if (!token) return;
      token.note = document.getElementById('tokenNote').value.slice(0, 2000);
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => commitScene(), 400);
    });
    document.getElementById('tokenName').addEventListener('change', () => {
      const token = selectedToken();
      if (!token) return;
      const name = document.getElementById('tokenName').value.trim().slice(0, 80);
      if (!name) return;
      token.name = name;
      if (token.libraryId) token.nameOwn = true;
      renderTokens();
      commitScene();
    });
    document.getElementById('tokenCutOn').addEventListener('change', applyInstanceCutFromForm);
    document.getElementById('tokenCutColor').addEventListener('input', applyInstanceCutFromForm);
    document.getElementById('tokenCutTol').addEventListener('input', () => {
      document.getElementById('tokenCutTolLabel').textContent = document.getElementById('tokenCutTol').value;
      clearTimeout(cutTimer);
      cutTimer = setTimeout(applyInstanceCutFromForm, 80);
    });
    document.getElementById('tokenPick').addEventListener('click', () => {
      pickTarget = pickTarget === 'token' ? null : 'token';
      document.getElementById('tokenPick').setAttribute('aria-pressed', pickTarget === 'token' ? 'true' : 'false');
      document.getElementById('tokenCutPreview').classList.toggle('picking', pickTarget === 'token');
    });
    document.getElementById('tokenCutPreview').addEventListener('click', async (event) => {
      if (pickTarget !== 'token') return;
      const hex = await sampleColor(event.currentTarget, event);
      if (!hex) return;
      document.getElementById('tokenCutOn').checked = true;
      document.getElementById('tokenCutColor').value = hex;
      pickTarget = null;
      applyInstanceCutFromForm();
    });
    document.getElementById('tokenCutReset').addEventListener('click', () => {
      const token = selectedToken();
      if (!token || !token.libraryId) return;
      const item = library.items.find((entry) => entry.id === token.libraryId);
      token.cutMode = 'library';
      token.cut = item && item.cut ? { color: item.cut.color, tolerance: item.cut.tolerance } : null;
      editorFor = null;
      forgetLooks(token.libraryId);
      renderTokens();
      commitScene();
    });
    let poseBefore = null;
    const armPose = () => { poseBefore = poseSnapshot(selectedTokens()); };
    ui.tokenScale.addEventListener('pointerdown', armPose);
    ui.tokenRotate.addEventListener('pointerdown', armPose);
    ui.tokenScale.addEventListener('input', () => {
      const token = selectedToken();
      if (token) token.size = '';
      updateToken({ scale: Number(ui.tokenScale.value) }, true);
    });
    ui.tokenRotate.addEventListener('input', () => updateToken({ rotation: Number(ui.tokenRotate.value) }, true, 'group'));
    const finishPose = () => {
      rememberPoses(poseBefore);
      poseBefore = null;
      commitScene();
    };
    ui.tokenScale.addEventListener('change', finishPose);
    ui.tokenRotate.addEventListener('change', finishPose);
    document.getElementById('tokenNameMode').addEventListener('change', () => {
      const mode = document.getElementById('tokenNameMode').value;
      selectedTokens().forEach((token) => { token.nameMode = mode; });
      renderTokens();
      commitScene();
    });
    document.getElementById('tokenSize').addEventListener('change', () => {
      const size = document.getElementById('tokenSize').value;
      const before = poseSnapshot(selectedTokens());
      const scale = VTTPlay.scaleForSize(size, currentGrid(false) || defaultGrid());
      selectedTokens().forEach((token) => {
        token.size = size;
        if (scale) token.scale = scale;
      });
      rememberPoses(before);
      renderTokens();
      commitScene();
    });
    const saveHp = () => {
      const token = selectedToken();
      if (!token) return;
      const hp = document.getElementById('tokenHp').value;
      const hpMax = document.getElementById('tokenHpMax').value;
      token.hp = hp === '' ? null : Math.max(0, Math.round(Number(hp) || 0));
      token.hpMax = hpMax === '' ? null : Math.max(0, Math.round(Number(hpMax) || 0));
      token.hpPublic = document.getElementById('tokenHpPublic').checked;
      renderTokens();
      commitScene();
    };
    document.getElementById('tokenHp').addEventListener('change', saveHp);
    document.getElementById('tokenHpMax').addEventListener('change', saveHp);
    document.getElementById('tokenHpPublic').addEventListener('change', saveHp);
    document.getElementById('tokenHidden').addEventListener('change', () => {
      const on = document.getElementById('tokenHidden').checked;
      selectedTokens().forEach((token) => { token.hidden = on; });
      renderTokens();
      commitScene();
    });
    document.getElementById('tokenLocked').addEventListener('change', () => {
      const on = document.getElementById('tokenLocked').checked;
      selectedTokens().forEach((token) => { token.locked = on; });
      renderTokens();
      commitScene();
    });
    document.getElementById('tokenBack').addEventListener('change', () => {
      const on = document.getElementById('tokenBack').checked;
      selectedTokens().forEach((token) => { token.back = on; });
      renderTokens();
      commitScene();
    });
    document.getElementById('tokenParent').addEventListener('change', () => {
      const token = selectedToken();
      if (!token) return;
      const parentId = document.getElementById('tokenParent').value || null;
      if (parentId && wouldCycle(token, parentId)) {
        toast('Нельзя привязать объект к самому себе по кругу.');
        document.getElementById('tokenParent').value = token.parentId || '';
        return;
      }
      token.parentId = parentId;
      commitScene();
    });
    const saveStat = () => {
      const token = selectedToken();
      if (!token) return;
      token.stat = VTTPlay.cleanStat({
        ac: document.getElementById('tokenAc').value,
        attack: document.getElementById('tokenAttack').value,
        trait: document.getElementById('tokenTrait').value,
      });
      commitScene();
    };
    ['tokenAc', 'tokenAttack', 'tokenTrait'].forEach((id) => {
      document.getElementById(id).addEventListener('change', saveStat);
    });
    document.getElementById('tokenStatPull').addEventListener('click', () => {
      const token = selectedToken();
      if (!token || !token.libraryId) return;
      const item = library.items.find((entry) => entry.id === token.libraryId);
      token.stat = VTTPlay.cleanStat(item && item.stat);
      editorFor = null;
      syncTokenEditor(token);
      commitScene();
      toast('Заготовка взята из библиотеки');
    });
    document.getElementById('tokenOpenNote').addEventListener('click', () => {
      const token = selectedToken();
      if (!token) return;
      VTTDesk.openForToken(token);
      showView('notes');
    });
    document.querySelectorAll('[data-measure]').forEach((button) => {
      button.addEventListener('click', () => {
        state.measureKind = button.dataset.measure;
        document.querySelectorAll('[data-measure]').forEach((item) => {
          item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
        });
        setTool('measure');
      });
    });
    document.getElementById('clearPointer').addEventListener('click', clearPointer);
    document.getElementById('blackoutBtn').addEventListener('click', toggleBlackout);
    document.getElementById('initiativeAdd').addEventListener('click', () => {
      const field = document.getElementById('initiativeName');
      addTurn(field.value.trim() || 'Ход', null);
      field.value = '';
    });
    document.getElementById('initiativeFromTokens').addEventListener('click', () => {
      const tokens = selectedTokens();
      if (!tokens.length) {
        toast('Сначала выберите объекты.');
        return;
      }
      tokens.forEach((token) => addTurn(token.name || 'Объект', token.id));
    });
    document.getElementById('initiativePrev').addEventListener('click', () => stepTurn(-1));
    document.getElementById('initiativeNext').addEventListener('click', () => stepTurn(1));
    const snap = document.getElementById('snapGrid');
    snap.checked = state.snap;
    snap.addEventListener('change', () => {
      state.snap = snap.checked;
      savePrefs();
    });
    renderGridPresets();
    document.getElementById('gridPresetApply').addEventListener('click', () => {
      const preset = state.gridPresets[Number(document.getElementById('gridPreset').value)];
      if (!preset || !currentMap()) return;
      const partial = {
        type: preset.type || 'square',
        cols: Number(preset.cols) || 27,
        major: Number(preset.major) || 0,
      };
      if (preset.color) partial.color = preset.color;
      if (preset.opacity) partial.opacity = Number(preset.opacity);
      updateGrid(partial, true);
      syncGridControls();
      toast(`Сетка «${preset.name}»`);
    });
    document.getElementById('gridPresetSave').addEventListener('click', () => {
      const grid = currentGrid(true);
      if (!grid) return;
      const name = document.getElementById('gridPresetName').value.trim().slice(0, 40) || 'Сетка';
      const preset = { name, type: grid.type, cols: grid.cols, major: grid.major, color: grid.color, opacity: grid.opacity };
      const index = state.gridPresets.findIndex((item) => item.name === name);
      if (index >= 0) state.gridPresets[index] = preset;
      else state.gridPresets.push(preset);
      savePrefs();
      renderGridPresets();
      document.getElementById('gridPreset').value = String(Math.max(0, state.gridPresets.findIndex((item) => item.name === name)));
      toast(`Заготовка «${name}» запомнена`);
    });
    let searchTimer = 0;
    document.getElementById('globalSearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runGlobalSearch, 120);
    });
    document.getElementById('globalSearch').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        document.getElementById('globalSearchResults').hidden = true;
      }
    });
    window.addEventListener('vtt-show-card', (event) => {
      const detail = event.detail || {};
      state.scene.card = VTTPlay.normalizeCard(detail);
      if (!state.scene.card) return;
      state.scene.blackout = false;
      syncBlackout();
      commitScene();
      toast('Текст на столе');
    });
    window.addEventListener('vtt-clear-card', () => {
      state.scene.card = null;
      commitScene();
      toast('Текст убран со стола');
    });

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
      const searchResults = document.getElementById('globalSearchResults');
      if (searchResults && !searchResults.hidden && !event.target.closest('.global-search')) searchResults.hidden = true;
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
    const storedScene = await VTTDB.getKv(`scene:${state.project.id}`) || await VTTDB.getScene();
    state.scene = normalizeScene(storedScene);
    sceneLoaded = true;
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
    VTTDesk.bindWorld({
      projectId: () => (state.project ? state.project.id : null),
      mapName: (id) => {
        const map = mapById(id);
        return map ? map.name : '';
      },
      tokenName: (id) => {
        const token = state.scene.tokens.find((item) => item.id === id);
        return token ? (token.name || 'Объект') : '';
      },
      currentMapId: () => state.scene.currentMapId,
      currentTokenId: () => state.selectedId,
      openMap: (id) => {
        showView('table');
        if (mapById(id)) selectMap(id);
      },
      openToken: (id) => {
        const token = state.scene.tokens.find((item) => item.id === id);
        if (!token) return;
        showView('table');
        if (token.mapId !== state.scene.currentMapId) {
          showMap(token.mapId, true);
          commitScene();
        }
        selectOne(token.id);
        setTool('move');
        showSide('tokens');
        renderTokens();
      },
    });
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
    await loadLibrary();
    const initial = mapById(state.scene.currentMapId) ? state.scene.currentMapId : (orderedMaps()[0] || {}).id;
    showMap(initial || null, false);
    syncBlackout();
    state.ready = true;
    if (tableKnown) commitScene();
  }

  init().catch((error) => {
    console.error(error);
    toast('Не удалось открыть локальное хранилище браузера.');
  });
})();
