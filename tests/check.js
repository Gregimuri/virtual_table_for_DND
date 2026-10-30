const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

['js/db.js', 'js/bus.js', 'js/paint.js', 'js/media.js', 'js/play.js', 'js/lexicon.js', 'js/desk.js', 'js/gm.js', 'js/table.js'].forEach((file) => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${file}: ${result.stderr || result.stdout || 'syntax error'}`);
});

function idsOf(file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const seen = new Set();
  ids.forEach((id) => {
    if (seen.has(id)) fail(`${file}: повтор id «${id}»`);
    seen.add(id);
  });
  return seen;
}

const indexIds = idsOf('index.html');
const tableIds = idsOf('table.html');

[
  'showSlide', 'mapSearch', 'mapVideo', 'mapPause', 'mapSound', 'librarySearch', 'tools', 'brushSize', 'tokenList', 'tokenNote',
  'gridCols', 'gridOpacity', 'viewTable', 'viewNotes', 'viewDice',
  'globalSearch', 'snapGrid', 'blackoutBtn', 'initiativeList', 'rollTable', 'noteShowTable', 'shapeLayer', 'markerLayer',
  'tokenSize', 'tokenHp', 'tokenHidden', 'recentMaps', 'planLayer', 'wallTool', 'visionShow', 'visionClear', 'floorKind', 'wallsBlock',
  'pathRadius', 'exportPlan', 'redoBtn', 'labelText', 'ngonSides', 'tokenBack', 'backLayer', 'floorLayer',
  'faKind', 'faFolderBtn', 'faZipBtn', 'faFolder', 'faZip',
  'mapZoom', 'mapCropL', 'mapRotLeft', 'mapFitReset', 'mapInner',
].forEach((id) => {
  if (!indexIds.has(id)) fail(`index.html: нет #${id}`);
});

['stage', 'board', 'mapImage', 'mapVideo', 'mapInner', 'gridLayer', 'floorLayer', 'planLayer', 'drawLayer', 'fogLayer', 'tokenLayer', 'shapeLayer', 'markerLayer', 'tableCard', 'blackout', 'turnBanner', 'faCredit'].forEach((id) => {
  if (!tableIds.has(id)) fail(`table.html: нет #${id}`);
});

['index.html', 'table.html', 'css/app.css', 'favicon.svg', 'README.md', '.nojekyll'].forEach((file) => {
  if (!fs.existsSync(path.join(root, file))) fail(`нет файла ${file}`);
});

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
if (!readme.includes('Показать игрокам')) fail('README не объясняет показ карты игрокам');
if (readme.includes('как презентация')) fail('README всё ещё описывает старое листание слайдов');

['index.html', 'table.html'].forEach((file) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  if (!html.includes('js/media.js')) fail(`${file}: нет js/media.js`);
  if (!html.includes('js/play.js')) fail(`${file}: нет js/play.js`);
  if (!html.includes('Content-Security-Policy')) fail(`${file}: нет политики страницы`);
  if (!html.includes("script-src 'self'")) fail(`${file}: политика пускает чужие скрипты`);
});

const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
if (!css.includes(':focus-visible')) fail('css/app.css: нет видимого фокуса');

const media = fs.readFileSync(path.join(root, 'js/media.js'), 'utf8');
if (!media.includes('40 * 1024 * 1024')) fail('js/media.js: нет предела 40 МБ');
if (!media.includes('bindPoster')) fail('js/media.js: список карт не умеет спокойный кадр');

const playContext = {};
require('vm').createContext(playContext);
require('vm').runInContext(
  `${fs.readFileSync(path.join(root, 'js/play.js'), 'utf8')}\nthis.API = VTTPlay;`,
  playContext
);
const plan = playContext.API;
const grid = { cols: 27, type: 'square' };
const aspect = 9 / 16;
const start = plan.snapCorner(0.2, 0.2, grid, aspect);
const end = plan.snapCorner(0.55, 0.6, grid, aspect);
const room = plan.roomPieces(start.x, start.y, end.x, end.y, grid, aspect);
if (!room || room.walls.length !== 4) fail('комната не собирает четыре стены');
if (!room.cells.every((cell) => Number.isInteger(cell[0]) && Number.isInteger(cell[1]))) fail('клетки комнаты не целые');
const walls = room.walls.map((pair, index) => ({
  id: String(index),
  kind: 'wall',
  open: false,
  x: pair[0].x,
  y: pair[0].y,
  x2: pair[1].x,
  y2: pair[1].y,
}));
const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
const sealed = plan.floodRoom(middle.x, middle.y, walls, grid, aspect);
if (!sealed.closed || sealed.cells.length !== room.cells.length) fail('замкнутая комната не заливается');
const opened = walls.map((wall, index) => (index ? wall : Object.assign({}, wall, { kind: 'door', open: true })));
if (plan.floodRoom(middle.x, middle.y, opened, grid, aspect).closed) fail('открытая дверь всё ещё замыкает комнату');
if (plan.blocksSight({ kind: 'window' }) || plan.blocksSight({ kind: 'grate' })) fail('окно или решётка прячут взгляд');
if (!plan.blocksSight({ kind: 'secret', open: false }) || !plan.blocksMove({ kind: 'grate' })) fail('секрет или решётка пропускают не то');
const corridor = plan.corridorPieces([start, plan.snapCorner(0.8, 0.2, grid, aspect)], 2, grid, aspect);
if (!corridor || corridor.cells.some((cell) => cell[0] < 0 || cell[1] < 0 || cell[0] >= 27)) fail('коридор выходит за карту');

function rectShape(id, x, y, x2, y2, op) {
  return {
    id,
    mapId: 'm',
    kind: 'rect',
    op: op || 'add',
    floor: 'stone',
    rough: 0,
    radius: 0.5,
    sides: 6,
    points: [plan.fromCell(x, y, grid, aspect), plan.fromCell(x2, y2, grid, aspect)],
  };
}
const sideBySide = plan.compileScrawl([rectShape('a', 2, 2, 6, 6), rectShape('b', 6, 2, 10, 6)], [], grid, aspect, 'm');
if (sideBySide.cells.length !== 32) fail('соседние комнаты потеряли или склеили клетки');
const inLeft = plan.fromCell(3.5, 3.5, grid, aspect);
const leftFlood = plan.floodRoom(inLeft.x, inLeft.y, sideBySide.walls, grid, aspect);
if (!leftFlood.closed || leftFlood.cells.length !== 16) fail('общая стена не отделяет соседние комнаты');
const alone = plan.compileScrawl([rectShape('a', 2, 2, 6, 6)], [], grid, aspect, 'm');
if (!alone.walls.length || alone.walls.some((wall) => !wall.outer)) fail('у комнаты нет цельного внешнего контура');
if (!sideBySide.walls.some((wall) => wall.outer) || !sideBySide.walls.some((wall) => !wall.outer)) fail('общая стена не отличается от внешнего контура');
const rim = alone.walls.find((wall) => wall.outer);
const framed = plan.compileScrawl(
  [rectShape('a', 2, 2, 6, 6)],
  [{ id: 'd', mapId: 'm', edge: rim.edge, kind: 'door', open: false }],
  grid,
  aspect,
  'm'
);
const framedDoor = framed.walls.find((wall) => wall.kind === 'door');
if (!framedDoor || !framedDoor.outer || (!framedDoor.nx && !framedDoor.ny)) fail('дверь не разрывает внешний контур');
const horizontal = alone.walls.filter((wall) => wall.y === wall.y2);
const rowY = Math.min.apply(null, horizontal.map((wall) => wall.y));
const top = horizontal.filter((wall) => wall.y === rowY).sort((a, b) => Math.min(a.x, a.x2) - Math.min(b.x, b.x2));
const doorPair = [Object.assign({}, top[0], { kind: 'door', open: true }), Object.assign({}, top[1], { kind: 'door', open: true })];
const doorChain = plan.openingChain(doorPair, doorPair[0]);
if (doorChain.length !== 2) fail('соседние двери не складываются в двустворчатую');
const windowPair = [Object.assign({}, top[0], { kind: 'window' }), Object.assign({}, top[1], { kind: 'window' })];
if (plan.openingChain(windowPair, windowPair[0]).length !== 2) fail('соседние окна не складываются в одно');
const corner = Object.assign({}, alone.walls.find((wall) => wall.x === wall.x2), { kind: 'door', open: true });
if (plan.openingChain(doorPair.concat(corner), doorPair[0]).length !== 2) fail('дверь на углу прилипла к соседней стене');
if (plan.openingChain([doorPair[0], windowPair[1]], doorPair[0]).length !== 1) fail('дверь слилась с окном');
const overlapped = plan.compileScrawl([rectShape('a', 2, 2, 7, 6), rectShape('b', 6, 2, 10, 6)], [], grid, aspect, 'm');
const overlapSpot = plan.fromCell(4.5, 3.5, grid, aspect);
const joined = plan.floodRoom(overlapSpot.x, overlapSpot.y, overlapped.walls, grid, aspect);
if (!joined.closed || joined.cells.length !== overlapped.cells.length) fail('наложенные комнаты не сливаются');
const carved = plan.compileScrawl([rectShape('a', 2, 2, 10, 8), rectShape('hole', 4, 4, 6, 6, 'sub')], [], grid, aspect, 'm');
const around = plan.fromCell(3.5, 3.5, grid, aspect);
const holed = plan.floodRoom(around.x, around.y, carved.walls, grid, aspect);
if (!holed.closed || holed.cells.some((cell) => cell[0] === 4 && cell[1] === 4)) fail('вырез не делает дыру');
const onlyA = plan.compileScrawl([rectShape('a', 2, 2, 6, 6)], [], grid, aspect, 'm');
const doorEdge = onlyA.walls[0] && onlyA.walls[0].edge;
const openedScrawl = plan.compileScrawl(
  [rectShape('a', 2, 2, 6, 6)],
  [{ id: 'd', mapId: 'm', edge: doorEdge, kind: 'door', open: true }],
  grid, aspect,
  'm'
);
const inside = plan.fromCell(3.5, 3.5, grid, aspect);
if (doorEdge && plan.floodRoom(inside.x, inside.y, openedScrawl.walls, grid, aspect).closed) fail('дверь в комнате не открывает проход');
const piece = { back: 1, hidden: 0, locked: 0, fa: 'asset' };
plan.normalizeToken(piece);
if (piece.back !== true) fail('объект не остаётся под сеткой');
if (piece.fa !== 'asset') fail('пометка Forgotten Adventures не сохраняется');
if (plan.faCells(200, 200) !== 1 || plan.faCells(400, 200) !== 2 || plan.faCells(400, 400) !== 1 || plan.faCells(250, 200) !== 1.25) {
  fail('размер элемента Forgotten Adventures считается не по клетке');
}
const turned = plan.fitOutSize(1000, 400, { rotate: 90 });
if (turned.w !== 400 || turned.h !== 1000) fail('поворот карты не меняет сторону картинки');
const cropped = plan.fitView({ left: 0.2, right: 0.2, zoom: 1 });
if (Math.abs(cropped.w - 0.6) > 0.001 || Math.abs(cropped.x - 0.2) > 0.001) fail('обрезка карты считает не ту ширину');
if (cropped.x + cropped.w > 1.0001 || cropped.y + cropped.h > 1.0001) fail('обрезка карты вылезает за край картинки');
const zoomed = plan.normalizeFit({ zoom: 9, rotate: 45, left: -1 });
if (zoomed.zoom !== 3 || zoomed.rotate !== 0 || zoomed.left !== 0) fail('настройка карты не держит безопасные пределы');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!indexHtml.includes('https://www.forgotten-adventures.net/')) fail('нет ссылки на Forgotten Adventures');
if (!indexHtml.includes('не разрешает вкладывать')) fail('нет пояснения, что картинки не вкладываются в программу');
if (!indexHtml.includes('js/lexicon.js')) fail('поиск объектов не подключает словарь');

const lexContext = {};
require('vm').createContext(lexContext);
require('vm').runInContext(`${fs.readFileSync(path.join(root, 'js/lexicon.js'), 'utf8')}\nthis.Lex = VTTLex;`, lexContext);
const lex = lexContext.Lex;
const food = lex.objectQuery('еда');
['Food_Plate', 'Meal_01', 'something_eats_here', 'Rations'].forEach((name) => {
  if (!lex.objectHit(name, food)) fail(`«еда» не находит ${name}`);
});
if (lex.objectHit('Leather_Armor', food) || lex.objectHit('Seat_Cushion', food)) fail('«еда» цепляет посторонние английские слова');
if (!lex.objectHit('Meal_Set', lex.objectQuery('еды'))) fail('падеж «еды» не находит meal');
if (!lex.objectHit('Wooden_Table', lex.objectQuery('деревянный стол'))) fail('два русских слова не находят деревянный стол');
if (lex.objectHit('Wooden_Chair', lex.objectQuery('деревянный стол'))) fail('запрос стола показывает стул');
if (!lex.objectHit('Chair_Oak', lex.objectQuery('стулья'))) fail('«стулья» не находит chair');
if (!lex.objectHit('Bat_Giant', lex.objectQuery('летучая мышь'))) fail('«летучая мышь» не находит bat');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('check ok');
