const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

['js/db.js', 'js/bus.js', 'js/paint.js', 'js/desk.js', 'js/gm.js', 'js/table.js'].forEach((file) => {
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
  'showSlide', 'mapSearch', 'librarySearch', 'tools', 'brushSize', 'tokenList',
  'gridCols', 'gridOpacity', 'viewTable', 'viewNotes', 'viewDice',
].forEach((id) => {
  if (!indexIds.has(id)) fail(`index.html: нет #${id}`);
});

['stage', 'board', 'mapImage', 'gridLayer', 'drawLayer', 'fogLayer', 'tokenLayer'].forEach((id) => {
  if (!tableIds.has(id)) fail(`table.html: нет #${id}`);
});

['index.html', 'table.html', 'css/app.css', 'favicon.svg', 'README.md', '.nojekyll'].forEach((file) => {
  if (!fs.existsSync(path.join(root, file))) fail(`нет файла ${file}`);
});

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
if (!readme.includes('Показать игрокам')) fail('README не объясняет показ карты игрокам');
if (readme.includes('как презентация')) fail('README всё ещё описывает старое листание слайдов');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('check ok');
