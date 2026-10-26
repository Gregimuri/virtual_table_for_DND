const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

['js/db.js', 'js/bus.js', 'js/paint.js', 'js/media.js', 'js/play.js', 'js/desk.js', 'js/gm.js', 'js/table.js'].forEach((file) => {
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
  'pathRadius', 'exportPlan', 'redoBtn', 'labelText', 'ngonSides', 'tokenBack', 'backLayer',
].forEach((id) => {
  if (!indexIds.has(id)) fail(`index.html: нет #${id}`);
});

['stage', 'board', 'mapImage', 'mapVideo', 'gridLayer', 'planLayer', 'drawLayer', 'fogLayer', 'tokenLayer', 'shapeLayer', 'markerLayer', 'tableCard', 'blackout', 'turnBanner'].forEach((id) => {
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
const piece = { back: 1, hidden: 0, locked: 0 };
plan.normalizeToken(piece);
if (piece.back !== true) fail('объект не остаётся под сеткой');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('check ok');
