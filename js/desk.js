'use strict';

const VTTDesk = (() => {
  const NOTE_KEY = 'notes';
  const PRESET_KEY = 'dnd-table-dice-presets';
  const HISTORY_KEY = 'dnd-table-dice-history';
  const TAGS = ['Сюжет', 'NPC', 'Бой', 'Секрет', 'Лут', 'Правило'];
  const TEMPLATES = {
    Сцена: 'Место\n\nЧто видят игроки\n\nЧто скрыто\n\nЕсли пойдут дальше\n',
    NPC: 'Имя\n\nЧего хочет\n\nЧто скрывает\n\nКак говорит\n',
    Бой: 'Стороны\n\nТактика\n\nКогда отступают\n\nДобыча\n',
    Секрет: 'Правда\n\nЛожный след\n\nКак можно узнать\n',
  };

  const dice = {
    terms: [{ count: 1, sides: 20, keep: '', keepN: 1, reroll: 0, explode: false }],
    mod: 0,
    mode: 'normal',
    dc: '',
    label: '',
  };
  let notes = { items: [], activeId: null };
  let tagFilter = 'все';
  let saveTimer = 0;
  let formulaLock = false;

  function $(id) { return document.getElementById(id); }

  function rollDie(sides) {
    const span = Math.max(1, sides | 0);
    const limit = Math.floor(0x100000000 / span) * span;
    const buf = new Uint32Array(1);
    let value = 0;
    do {
      crypto.getRandomValues(buf);
      value = buf[0];
    } while (value >= limit);
    return (value % span) + 1;
  }

  function defaultNotes() {
    return {
      activeId: null,
      items: [{
        id: crypto.randomUUID(),
        title: 'Подготовка к сессии',
        tag: 'Сюжет',
        pinned: true,
        updated: Date.now(),
        body: 'С чего начать\n\nЧто игроки уже знают\n\nЧто должно случиться\n\nЗапасной поворот\n',
      }],
    };
  }

  async function loadNotes() {
    const stored = await VTTDB.getKv(NOTE_KEY);
    notes = stored && Array.isArray(stored.items) ? stored : defaultNotes();
    if (!notes.items.length) notes = defaultNotes();
    if (!notes.items.some((item) => item.id === notes.activeId)) {
      notes.activeId = notes.items[0].id;
    }
    if (!stored) scheduleNotes();
    renderNotes();
  }

  function scheduleNotes() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      VTTDB.putKv(NOTE_KEY, notes).catch((error) => console.error(error));
    }, 250);
  }

  function activeNote() {
    return notes.items.find((item) => item.id === notes.activeId) || null;
  }

  function renderNotes() {
    const query = ($('noteSearch').value || '').trim().toLowerCase();
    const list = $('noteList');
    list.textContent = '';
    const items = notes.items
      .filter((item) => tagFilter === 'все' || item.tag === tagFilter)
      .filter((item) => {
        if (!query) return true;
        return `${item.title} ${item.body} ${item.tag}`.toLowerCase().includes(query);
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
    items.forEach((item) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `note-link${item.id === notes.activeId ? ' active' : ''}`;
      button.dataset.id = item.id;
      const title = document.createElement('strong');
      title.textContent = item.pinned ? `★ ${item.title || 'Без названия'}` : (item.title || 'Без названия');
      const meta = document.createElement('small');
      meta.textContent = item.tag || 'Заметка';
      button.append(title, meta);
      row.appendChild(button);
      list.appendChild(row);
    });
    const note = activeNote();
    $('noteEditor').hidden = !note;
    if (!note) return;
    $('noteTitle').value = note.title || '';
    $('noteBody').value = note.body || '';
    $('noteTag').value = note.tag || 'Сюжет';
    $('notePin').checked = !!note.pinned;
    const when = new Date(note.updated || Date.now());
    $('noteMeta').textContent = `Изменено ${when.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`;
  }

  function touch(note) {
    note.updated = Date.now();
    scheduleNotes();
    renderNotes();
  }

  function createNote(partial) {
    const note = Object.assign({
      id: crypto.randomUUID(),
      title: 'Новая заметка',
      tag: 'Сюжет',
      pinned: false,
      updated: Date.now(),
      body: '',
    }, partial);
    notes.items.unshift(note);
    notes.activeId = note.id;
    scheduleNotes();
    renderNotes();
    $('noteTitle').focus();
    $('noteTitle').select();
  }

  function readNoteForm() {
    const note = activeNote();
    if (!note) return;
    note.title = $('noteTitle').value;
    note.body = $('noteBody').value;
    note.tag = $('noteTag').value;
    note.pinned = $('notePin').checked;
    note.updated = Date.now();
    scheduleNotes();
    $('noteMeta').textContent = 'Сохранено';
    const button = document.querySelector(`.note-link[data-id="${note.id}"] strong`);
    if (button) button.textContent = note.pinned ? `★ ${note.title || 'Без названия'}` : (note.title || 'Без названия');
  }

  function formulaFromModel() {
    const chunks = dice.terms.map((term) => {
      const sign = term.sign === -1 ? '-' : '+';
      let chunk = `${sign}${term.count}d${term.sides}`;
      if (term.keep === 'kh' || term.keep === 'kl') chunk += `${term.keep}${Math.max(1, term.keepN || 1)}`;
      if (term.reroll) chunk += `r${term.reroll}`;
      if (term.explode) chunk += '!';
      return chunk;
    });
    if (dice.mod) chunks.push(dice.mod > 0 ? `+${dice.mod}` : String(dice.mod));
    let text = chunks.join('').replace(/^\+/, '');
    if (dice.mode === 'adv') text += ' преимущество';
    if (dice.mode === 'dis') text += ' помеха';
    if (dice.dc !== '' && dice.dc != null) text += ` dc${dice.dc}`;
    return text;
  }

  function parseFormula(raw) {
    let text = String(raw || '').toLowerCase().replace(/д/g, 'd');
    let mode = 'normal';
    if (/(преимущество|\badv\b|\badvantage\b)/.test(text)) mode = 'adv';
    if (/(помеха|\bdis\b|\bdisadvantage\b)/.test(text)) mode = 'dis';
    text = text.replace(/преимущество|помеха|\badv\b|\badvantage\b|\bdis\b|\bdisadvantage\b/g, ' ');
    let dc = '';
    text = text.replace(/\bdc\s*(\d+)\b/g, (_, n) => {
      dc = String(Number(n));
      return ' ';
    });
    const terms = [];
    let mod = 0;
    const re = /([+-]?\s*\d*)\s*d\s*(\d+)\s*(kh\s*\d+|kl\s*\d+)?\s*(r\s*\d+|ro\s*\d+)?\s*(!)?|([+-]\s*\d+)(?!\s*d)/gi;
    let match = re.exec(text);
    while (match) {
      if (match[2]) {
        const countRaw = (match[1] || '').replace(/\s/g, '');
        const sign = countRaw.startsWith('-') ? -1 : 1;
        let count = Math.abs(parseInt(countRaw, 10));
        if (!count) count = 1;
        let keep = '';
        let keepN = 1;
        if (match[3]) {
          const keepRaw = match[3].replace(/\s/g, '');
          keep = keepRaw.startsWith('kh') ? 'kh' : 'kl';
          keepN = parseInt(keepRaw.slice(2), 10) || 1;
        }
        let reroll = 0;
        if (match[4]) reroll = parseInt(match[4].replace(/\s/g, '').replace(/^ro?/, ''), 10) || 0;
        terms.push({
          sign,
          count: Math.min(40, count),
          sides: Math.min(1000, Math.max(1, parseInt(match[2], 10) || 1)),
          keep,
          keepN,
          reroll,
          explode: Boolean(match[5]),
        });
      } else if (match[6]) {
        mod += parseInt(match[6].replace(/\s/g, ''), 10) || 0;
      }
      match = re.exec(text);
    }
    return { terms, mod, mode, dc, ok: terms.length > 0 || mod !== 0 };
  }

  function writeFormula() {
    const field = $('diceFormula');
    if (document.activeElement === field) return;
    formulaLock = true;
    field.value = formulaFromModel();
    formulaLock = false;
  }

  function renderTerms() {
    const host = $('diceTerms');
    host.textContent = '';
    dice.terms.forEach((term, index) => {
      const row = document.createElement('div');
      row.className = 'dice-term';
      row.innerHTML = `
        <label>Знак
          <select data-field="sign">
            <option value="1">+</option>
            <option value="-1">−</option>
          </select>
        </label>
        <label>Костей <input data-field="count" type="number" min="1" max="40" value="${term.count}"></label>
        <label>Граней <input data-field="sides" type="number" min="2" max="1000" value="${term.sides}"></label>
        <label>Оставить
          <select data-field="keep">
            <option value="">все</option>
            <option value="kh">лучшие</option>
            <option value="kl">худшие</option>
          </select>
        </label>
        <label>Сколько <input data-field="keepN" type="number" min="1" max="40" value="${term.keepN || 1}"></label>
        <label>Переброс ≤ <input data-field="reroll" type="number" min="0" max="999" value="${term.reroll || 0}"></label>
        <label class="check"><input data-field="explode" type="checkbox"${term.explode ? ' checked' : ''}> Взрыв</label>
        <button type="button" class="mini" data-act="remove" aria-label="Убрать кость">×</button>`;
      row.querySelector('[data-field="keep"]').value = term.keep || '';
      row.querySelector('[data-field="sign"]').value = term.sign === -1 ? '-1' : '1';
      row.querySelectorAll('input, select').forEach((input) => {
        input.addEventListener('input', () => {
          const field = input.dataset.field;
          if (field === 'explode') term.explode = input.checked;
          else if (field === 'keep') term.keep = input.value;
          else if (field === 'sign') term.sign = Number(input.value) === -1 ? -1 : 1;
          else term[field] = Math.max(0, Number(input.value) || 0);
          if (field === 'count') term.count = Math.max(1, term.count);
          if (field === 'sides') term.sides = Math.max(2, term.sides);
          writeFormula();
        });
      });
      row.querySelector('[data-act="remove"]').addEventListener('click', () => {
        if (dice.terms.length === 1) return;
        dice.terms.splice(index, 1);
        renderTerms();
        writeFormula();
      });
      host.appendChild(row);
    });
  }

  function syncControlsFromModel() {
    $('diceMod').value = String(dice.mod || 0);
    $('diceMode').value = dice.mode;
    $('diceDc').value = dice.dc === '' || dice.dc == null ? '' : String(dice.dc);
    $('diceLabel').value = dice.label || '';
    renderTerms();
    writeFormula();
  }

  function applyParsed(parsed) {
    if (!parsed.ok) return false;
    dice.terms = parsed.terms.length ? parsed.terms.map((term) => ({
      count: term.count,
      sides: term.sides,
      keep: term.keep || '',
      keepN: term.keepN || 1,
      reroll: term.reroll || 0,
      explode: !!term.explode,
      sign: term.sign,
    })) : dice.terms;
    dice.mod = parsed.mod;
    dice.mode = parsed.mode;
    if (parsed.dc !== '') dice.dc = parsed.dc;
    renderTerms();
    $('diceMod').value = String(dice.mod || 0);
    $('diceMode').value = dice.mode;
    if (parsed.dc !== '') $('diceDc').value = parsed.dc;
    return true;
  }

  function termFaces(term) {
    const sign = term.sign === -1 ? -1 : 1;
    const faces = [];
    for (let i = 0; i < term.count; i += 1) {
      const chain = [];
      let value = rollDie(term.sides);
      let rerolled = false;
      if (term.reroll && value <= term.reroll) {
        value = rollDie(term.sides);
        rerolled = true;
      }
      chain.push({ value, rerolled, exploded: false });
      let guard = 0;
      while (term.explode && value === term.sides && guard < 24) {
        value = rollDie(term.sides);
        chain.push({ value, rerolled: false, exploded: true });
        guard += 1;
      }
      faces.push({
        sides: term.sides,
        sign,
        chain,
        total: chain.reduce((sum, face) => sum + face.value, 0),
        keep: true,
      });
    }
    if ((term.keep === 'kh' || term.keep === 'kl') && faces.length) {
      const keepN = Math.max(1, Math.min(faces.length, term.keepN || 1));
      const ranked = faces.slice().sort((a, b) => a.total - b.total);
      const losers = term.keep === 'kh' ? ranked.slice(0, faces.length - keepN) : ranked.slice(keepN);
      losers.forEach((face) => { face.keep = false; });
    }
    return faces;
  }

  function sumFaces(groups, mod) {
    const diceSum = groups.reduce((sum, group) => sum + group.reduce((inner, face) => inner + (face.keep ? face.sign * face.total : 0), 0), 0);
    return diceSum + (mod || 0);
  }

  function rollOnce() {
    const groups = dice.terms.map((term) => termFaces(term));
    return { groups, total: sumFaces(groups, dice.mod) };
  }

  function faceNode(face) {
    const el = document.createElement('span');
    el.className = `die-face${face.keep ? '' : ' dropped'}`;
    const shown = face.chain.map((part) => part.value).join('→');
    el.textContent = face.sign === -1 ? `−${shown}` : shown;
    el.title = `d${face.sides}`;
    if (face.chain.some((part) => part.exploded)) el.classList.add('exploded');
    if (face.sides === 20 && face.chain[0].value === 20 && face.keep) el.classList.add('crit');
    if (face.sides === 20 && face.chain[0].value === 1 && face.keep) el.classList.add('fail');
    return el;
  }

  function renderPool(pool, title) {
    const block = document.createElement('div');
    block.className = 'pool';
    const heading = document.createElement('div');
    heading.className = 'pool-total';
    const name = document.createElement('span');
    name.textContent = title;
    const total = document.createElement('strong');
    total.textContent = String(pool.total);
    heading.append(name, total);
    const faces = document.createElement('div');
    faces.className = 'die-row';
    pool.groups.forEach((group) => group.forEach((face) => faces.appendChild(faceNode(face))));
    if (dice.mod) {
      const mod = document.createElement('span');
      mod.className = 'die-face mod';
      mod.textContent = dice.mod > 0 ? `+${dice.mod}` : String(dice.mod);
      faces.appendChild(mod);
    }
    block.append(heading, faces);
    return block;
  }

  function outcomeText(chosen, other) {
    const parts = [];
    if (dice.mode === 'adv') parts.push('преимущество');
    if (dice.mode === 'dis') parts.push('помеха');
    if (dice.dc !== '' && dice.dc != null) {
      parts.push(chosen.total >= Number(dice.dc) ? `успех против ${dice.dc}` : `провал против ${dice.dc}`);
    }
    const kept = chosen.groups.flat().filter((face) => face.keep && face.sides === 20);
    if (kept.some((face) => face.chain[0].value === 20)) parts.push('натуральная 20');
    if (kept.length === 1 && kept[0].chain[0].value === 1 && chosen.groups.flat().filter((face) => face.sides === 20).length === 1) {
      parts.push('натуральная 1');
    }
    if (other) parts.push(`второй бросок ${other.total}`);
    return parts.join(' · ');
  }

  function remember(entry) {
    const history = loadHistory();
    history.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 40)));
    renderHistory();
  }

  function loadHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function renderHistory() {
    const list = $('diceHistory');
    list.textContent = '';
    loadHistory().forEach((entry) => {
      const row = document.createElement('li');
      const when = new Date(entry.at);
      const time = document.createElement('time');
      time.textContent = when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const text = document.createElement('span');
      text.textContent = `${entry.label ? `${entry.label}: ` : ''}${entry.formula}`;
      const total = document.createElement('strong');
      total.textContent = String(entry.total);
      row.append(time, text, total);
      list.appendChild(row);
    });
  }

  function loadPresets() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRESET_KEY) || 'null');
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (error) {
      console.error(error);
    }
    return [
      { name: 'Атака', formula: '1d20' },
      { name: 'Преимущество', formula: '1d20 преимущество' },
      { name: 'Помеха', formula: '1d20 помеха' },
      { name: 'Урон', formula: '1d8+3' },
      { name: '4d6 лучшие 3', formula: '4d6kh3' },
      { name: 'Процент', formula: '1d100' },
    ];
  }

  function savePresets(list) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list));
    renderPresets();
  }

  function renderPresets() {
    const host = $('dicePresets');
    host.textContent = '';
    loadPresets().forEach((preset, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn preset';
      button.textContent = preset.name;
      button.title = preset.formula;
      button.addEventListener('click', () => {
        $('diceFormula').value = preset.formula;
        dice.label = preset.name;
        $('diceLabel').value = preset.name;
        const parsed = parseFormula(preset.formula);
        if (parsed.ok) applyParsed(parsed);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Удалить набор ${preset.name}`);
      remove.addEventListener('click', () => {
        const next = loadPresets();
        next.splice(index, 1);
        savePresets(next);
      });
      const wrap = document.createElement('div');
      wrap.className = 'preset-row';
      wrap.append(button, remove);
      host.appendChild(wrap);
    });
  }

  function roll() {
    if (!formulaLock) {
      const parsed = parseFormula($('diceFormula').value);
      if (parsed.ok) applyParsed(parsed);
    }
    if (!dice.terms.length) return null;
    const first = rollOnce();
    let second = null;
    let chosen = first;
    if (dice.mode === 'adv' || dice.mode === 'dis') {
      second = rollOnce();
      const takeHigh = dice.mode === 'adv';
      chosen = takeHigh
        ? (first.total >= second.total ? first : second)
        : (first.total <= second.total ? first : second);
    }
    const other = second && second !== chosen ? (chosen === first ? second : first) : null;
    const result = $('diceResult');
    result.textContent = '';
    const hero = document.createElement('div');
    hero.className = 'dice-hero';
    const big = document.createElement('strong');
    big.textContent = String(chosen.total);
    const caption = document.createElement('p');
    caption.textContent = outcomeText(chosen, other);
    hero.append(big, caption);
    result.appendChild(hero);
    if (dice.mode === 'normal') result.appendChild(renderPool(first, dice.label || 'Бросок'));
    else {
      result.appendChild(renderPool(first, 'Первый'));
      result.appendChild(renderPool(second, 'Второй'));
    }
    remember({
      at: Date.now(),
      total: chosen.total,
      formula: $('diceFormula').value,
      label: dice.label,
    });
    return chosen.total;
  }

  function focusNotes() {
    const note = activeNote();
    if (note) $('noteBody').focus();
    else $('noteSearch').focus();
  }

  function bindNotes() {
    $('noteList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-id]');
      if (!button) return;
      readNoteForm();
      notes.activeId = button.dataset.id;
      renderNotes();
    });
    $('newNote').addEventListener('click', () => createNote());
    ['noteTitle', 'noteBody', 'noteTag', 'notePin'].forEach((id) => {
      $(id).addEventListener('input', readNoteForm);
      $(id).addEventListener('change', readNoteForm);
    });
    $('noteSearch').addEventListener('input', renderNotes);
    $('noteTags').addEventListener('click', (event) => {
      const button = event.target.closest('[data-tag]');
      if (!button) return;
      tagFilter = button.dataset.tag;
      $('noteTags').querySelectorAll('[data-tag]').forEach((item) => {
        item.setAttribute('aria-pressed', item.dataset.tag === tagFilter ? 'true' : 'false');
      });
      renderNotes();
    });
    $('deleteNote').addEventListener('click', () => {
      const note = activeNote();
      if (!note) return;
      notes.items = notes.items.filter((item) => item.id !== note.id);
      notes.activeId = notes.items.length ? notes.items[0].id : null;
      if (!notes.items.length) notes = defaultNotes();
      scheduleNotes();
      renderNotes();
    });
    document.querySelectorAll('[data-template]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.template;
        createNote({ title: name, tag: name === 'Секрет' ? 'Секрет' : name, body: TEMPLATES[name] || '' });
      });
    });
  }

  function bindDice() {
    $('addTerm').addEventListener('click', () => {
      dice.terms.push({ count: 1, sides: 6, keep: '', keepN: 1, reroll: 0, explode: false });
      renderTerms();
      writeFormula();
    });
    document.querySelectorAll('[data-add-die]').forEach((button) => {
      button.addEventListener('click', () => {
        dice.terms.push({ count: 1, sides: Number(button.dataset.addDie), keep: '', keepN: 1, reroll: 0, explode: false });
        renderTerms();
        writeFormula();
      });
    });
    $('diceMod').addEventListener('input', () => {
      dice.mod = Number($('diceMod').value) || 0;
      writeFormula();
    });
    $('diceMode').addEventListener('change', () => {
      dice.mode = $('diceMode').value;
      writeFormula();
    });
    $('diceDc').addEventListener('input', () => {
      dice.dc = $('diceDc').value === '' ? '' : String(Math.max(0, Number($('diceDc').value) || 0));
      writeFormula();
    });
    $('diceLabel').addEventListener('input', () => {
      dice.label = $('diceLabel').value;
    });
    $('diceFormula').addEventListener('input', () => {
      if (formulaLock) return;
      const parsed = parseFormula($('diceFormula').value);
      $('formulaState').textContent = parsed.ok ? '' : 'Формула пока не разбирается';
      if (parsed.ok) applyParsed(parsed);
    });
    $('diceFormula').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        roll();
      }
    });
    $('rollDice').addEventListener('click', () => roll());
    $('savePreset').addEventListener('click', () => {
      const name = (dice.label || $('diceFormula').value || 'Набор').trim().slice(0, 40);
      const list = loadPresets().filter((preset) => preset.name !== name);
      list.unshift({ name, formula: $('diceFormula').value });
      savePresets(list.slice(0, 24));
    });
    syncControlsFromModel();
    renderPresets();
    renderHistory();
  }

  function fillTags() {
    const select = $('noteTag');
    TAGS.forEach((tag) => {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tag;
      select.appendChild(option);
    });
    const host = $('noteTags');
    ['все'].concat(TAGS).forEach((tag) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.dataset.tag = tag;
      button.textContent = tag === 'все' ? 'Все' : tag;
      button.setAttribute('aria-pressed', tag === 'все' ? 'true' : 'false');
      host.appendChild(button);
    });
  }

  return {
    async init() {
      fillTags();
      bindNotes();
      bindDice();
      await loadNotes();
    },
    roll,
    focusNotes,
    parseFormula,
  };
})();
