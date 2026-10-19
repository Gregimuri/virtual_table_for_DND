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
  'tokenSize', 'tokenHp', 'tokenHidden', 'recentMaps',
].forEach((id) => {
  if (!indexIds.has(id)) fail(`index.html: нет #${id}`);
});

['stage', 'board', 'mapImage', 'mapVideo', 'gridLayer', 'drawLayer', 'fogLayer', 'tokenLayer', 'shapeLayer', 'markerLayer', 'tableCard', 'blackout', 'turnBanner'].forEach((id) => {
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

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('check ok');
