// Редактор слайдов и настроек сессии. Изменения сохраняются сами через полсекунды после правки.
'use strict';

(async () => {
  await requireUser();
  const id = +new URLSearchParams(location.search).get('id');
  const app = $('#app');
  let session, questions, joinUrl, current = null, timer = null, dragId = null;
  const listBox = h('div', { class: 'slide-list' });
  const editBox = h('div', { class: 'panel stack' });
  const saved = h('span', { class: 'hint', 'aria-live': 'polite' });
  const ACCENTS = ['#ffc83d', '#ff7a59', '#12b886', '#2bb5e8', '#e64fb5', '#8a5cf6'];
  const HAS_OPTIONS = ['poll', 'quiz', 'rank'];

  try {
    const r = await apiGet('session_get', { id });
    session = r.session; questions = r.questions; joinUrl = r.join_url;
  } catch (e) {
    app.append(topbar(), h('main', { class: 'page' }, h('div', { class: 'empty' }, h('h2', { text: 'Сессия не найдена' }), h('a', { class: 'btn', href: 'dashboard.html', text: 'К списку сессий' }))));
    return;
  }
  current = questions[0] || null;

  // ----- Сохранение -----
  let pending = null;
  function touch(q) {
    saved.textContent = 'Сохраняем…';
    clearTimeout(timer);
    // Правка другого слайда не должна отменить ещё не отправленное сохранение предыдущего.
    if (pending && pending !== q) save(pending);
    pending = q;
    timer = setTimeout(() => { pending = null; save(q); }, 500);
    drawList();
  }
  async function save(q) {
    try {
      await apiPost('question_save', { id: q.id, type: q.type, text: q.text, options: q.options, settings: q.settings, time_limit: q.time_limit });
      saved.textContent = 'Сохранено';
    } catch (e) { saved.textContent = ''; oops(e); }
  }
  async function saveSession(patch) {
    Object.assign(session, patch);
    try { await apiPost('session_update', { id, ...patch }); saved.textContent = 'Сохранено'; } catch (e) { oops(e); }
  }

  // ----- Список слайдов -----
  function drawList() {
    listBox.replaceChildren(...questions.map((q, i) => h('button', {
      class: 'slide-item' + (current && q.id === current.id ? ' on' : ''), draggable: 'true', type: 'button',
      onclick: () => { current = q; draw(); },
      ondragstart: (e) => { dragId = q.id; e.currentTarget.classList.add('drag'); },
      ondragend: (e) => e.currentTarget.classList.remove('drag'),
      ondragover: (e) => e.preventDefault(),
      ondrop: (e) => { e.preventDefault(); move(dragId, i); },
    }, h('span', { class: 'n', text: i + 1 }), h('span', {}, h('span', { class: 't', style: { display: 'block' }, text: q.text || 'Без текста' }), h('span', { class: 'k', text: TYPE_NAMES[q.type] })))));
  }
  async function move(qid, to) {
    const from = questions.findIndex((q) => q.id === qid);
    if (from < 0 || to < 0 || to >= questions.length || from === to) return;
    questions.splice(to, 0, questions.splice(from, 1)[0]);
    drawList();
    try { await apiPost('questions_reorder', { session_id: id, ids: questions.map((q) => q.id) }); } catch (e) { oops(e); }
  }

  function addSlide() {
    const grid = h('div', { class: 'choice-grid' }, Object.keys(TYPE_NAMES).map((type) => h('button', { class: 'choice', type: 'button', onclick: async () => {
      const blank = { session_id: id, type, text: '', options: HAS_OPTIONS.includes(type) ? [{ text: '' }, { text: '' }] : [], settings: {}, time_limit: type === 'quiz' ? 20 : 0 };
      if (type === 'qa') blank.text = 'Вопросы спикеру';
      if (type === 'nps') blank.text = 'Посоветуете ли вы эту встречу коллегам?';
      try {
        const r = await apiPost('question_save', blank);
        questions.push(r.question); current = r.question; close(); draw();
      } catch (e) { oops(e); }
    } }, h('b', { text: TYPE_NAMES[type] }), h('small', { text: TYPE_ABOUT[type] }))));
    const close = modal('Какой слайд добавить?', grid);
  }

  function importSlides() {
    const text = h('textarea', { class: 'input', rows: 7, placeholder: 'опрос; Любимый сезон?; Зима; Весна; Лето; Осень\nвикторина; Столица Австралии?; Сидней; *Канберра; Мельбурн' });
    modal('Импорт вопросов', h('div', { class: 'stack' }, text, h('p', { class: 'hint', text: 'Одна строка — один слайд: тип; вопрос; варианты через точку с запятой или табуляцию. Типы: ' + Object.values(TYPE_NAMES).join(', ').toLowerCase() + '. Верный ответ викторины отметьте звёздочкой.' })),
      [(close) => h('button', { class: 'btn', text: 'Добавить слайды', onclick: async () => {
        try { const r = await apiPost('questions_import', { session_id: id, text: text.value }); questions = r.questions; current = questions[questions.length - 1]; toast('Добавлено слайдов: ' + r.added); close(); draw(); } catch (e) { oops(e); }
      } })]);
  }

  // ----- Редактор одного слайда -----
  const labeled = (label, node, hint) => h('label', { class: 'field' }, h('span', { text: label }), node, hint ? h('span', { class: 'hint', text: hint }) : null);
  const select = (value, pairs, onChange) => {
    const el = h('select', { class: 'input', onchange: () => onChange(el.value) }, pairs.map(([v, name]) => h('option', { value: v, text: name })));
    el.value = String(value);
    return el;
  };
  const imageField = (label, url, onChange) => h('div', { class: 'row' },
    url ? h('img', { class: 'opt-thumb', src: url, alt: '' }) : null,
    h('button', { class: 'btn small ghost', type: 'button', text: url ? 'Заменить картинку' : label, onclick: () => pickImage(onChange) }),
    url ? h('button', { class: 'btn small danger', type: 'button', text: 'Убрать', onclick: () => onChange(null) }) : null);

  function optionsEditor(q) {
    const rows = q.options.map((opt, i) => h('div', { class: 'opt-row' },
      h('span', { class: 'mark', style: { background: COLORS[i % COLORS.length] }, text: i + 1 }),
      h('div', { class: 'row' },
        opt.img ? h('img', { class: 'opt-thumb', src: opt.img, alt: '' }) : null,
        h('input', { class: 'input grow', maxlength: 120, placeholder: 'Вариант ' + (i + 1), value: opt.text, oninput: (e) => { opt.text = e.target.value; touch(q); } })),
      q.type === 'quiz' ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!opt.correct, onchange: (e) => { opt.correct = e.target.checked; touch(q); } }), 'верный')
        : q.type === 'poll' ? h('button', { class: 'icon-btn', type: 'button', title: opt.img ? 'Убрать картинку' : 'Добавить картинку', 'aria-label': opt.img ? 'Убрать картинку' : 'Добавить картинку', text: opt.img ? '⊘' : '▣', onclick: () => {
          if (opt.img) { opt.img = null; touch(q); drawEditor(); } else pickImage((url) => { opt.img = url; touch(q); drawEditor(); });
        } }) : h('span'),
      h('button', { class: 'icon-btn', type: 'button', title: 'Удалить вариант', 'aria-label': 'Удалить вариант', text: '✕', disabled: q.options.length <= 2, onclick: () => { q.options.splice(i, 1); touch(q); drawEditor(); } })));
    return h('div', { class: 'stack' }, h('h3', { text: 'Варианты' }), rows,
      q.options.length < 10 ? h('button', { class: 'btn small ghost', type: 'button', style: { justifySelf: 'start' }, text: 'Добавить вариант', onclick: () => { q.options.push({ text: '' }); touch(q); drawEditor(); } }) : null,
      q.type === 'quiz' && !q.options.some((o) => o.correct) ? h('p', { class: 'error-text', text: 'Отметьте верный вариант — без него никто не получит очков.' }) : null);
  }

  function drawEditor() {
    const q = current;
    if (!q) {
      editBox.replaceChildren(h('div', { class: 'empty', style: { border: 0 } }, h('h2', { text: 'Добавьте первый слайд' }), h('p', { text: 'Опрос, облако слов, викторина — всего одиннадцать типов.' }), h('button', { class: 'btn', text: 'Добавить слайд', onclick: addSlide })));
      return;
    }
    const s = q.settings;
    const set = (k, v) => { if (v === '' || v === null || v === false) delete s[k]; else s[k] = v; touch(q); };
    const parts = [
      h('div', { class: 'row' }, h('span', { class: 'tag', text: TYPE_NAMES[q.type] }), h('div', { class: 'grow' }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Поднять слайд выше', 'aria-label': 'Поднять слайд выше', text: '↑', onclick: () => move(q.id, questions.indexOf(q) - 1) }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Опустить слайд ниже', 'aria-label': 'Опустить слайд ниже', text: '↓', onclick: () => move(q.id, questions.indexOf(q) + 1) }),
        h('button', { class: 'btn small ghost', type: 'button', text: 'Дублировать', onclick: async () => { try { const r = await apiPost('question_duplicate', { id: q.id }); questions.splice(questions.indexOf(q) + 1, 0, r.question); current = r.question; draw(); } catch (e) { oops(e); } } }),
        h('button', { class: 'btn small danger', type: 'button', text: 'Удалить слайд', onclick: () => confirmBox('Удалить слайд?', 'Ответы на него тоже удалятся.', 'Удалить', async () => {
          await apiPost('question_delete', { id: q.id });
          const i = questions.indexOf(q); questions.splice(i, 1); current = questions[Math.min(i, questions.length - 1)] || null; draw();
        }, true) })),
      labeled(q.type === 'info' ? 'Заголовок' : 'Вопрос', h('textarea', { class: 'input', rows: 2, maxlength: 300, value: q.text, placeholder: q.type === 'info' ? 'О чём этот слайд' : 'О чём спросим зал?', oninput: (e) => { q.text = e.target.value; touch(q); } })),
    ];
    if (HAS_OPTIONS.includes(q.type)) parts.push(optionsEditor(q));
    if (q.type === 'poll') {
      parts.push(switchField('Можно выбрать несколько вариантов', '', !!s.multi, (v) => { set('multi', v); drawEditor(); }));
      if (s.multi) parts.push(labeled('Сколько вариантов можно выбрать', select(s.max_choices || 0, [[0, 'Сколько угодно'], ...q.options.slice(1).map((_, i) => [i + 1, 'Не больше ' + (i + 1)])], (v) => set('max_choices', +v || null))));
      const polls = questions.filter((x) => x.type === 'poll' && x.id !== q.id);
      if (polls.length) parts.push(labeled('Показать срез по ответу на другой опрос', select(s.segment_by || 0, [[0, 'Без среза'], ...polls.map((x) => [x.id, x.text || 'Без текста'])], (v) => set('segment_by', +v || null)), 'На экране появится таблица: как голосовали те, кто выбрал каждый вариант в том опросе.'));
    }
    if (q.type === 'scale') {
      parts.push(h('div', { class: 'row' },
        h('div', { class: 'grow' }, labeled('От', select(s.min ?? 1, [[0, '0'], [1, '1']], (v) => { s.min = +v; touch(q); }))),
        h('div', { class: 'grow' }, labeled('До', select(s.max ?? 5, [[5, '5'], [7, '7'], [10, '10']], (v) => { s.max = +v; touch(q); })))),
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, labeled('Подпись слева', h('input', { class: 'input', maxlength: 40, value: s.label_min || '', placeholder: 'Плохо', oninput: (e) => set('label_min', e.target.value) }))),
        h('div', { class: 'grow' }, labeled('Подпись справа', h('input', { class: 'input', maxlength: 40, value: s.label_max || '', placeholder: 'Отлично', oninput: (e) => set('label_max', e.target.value) })))));
    }
    if (q.type === 'open') parts.push(labeled('Сколько ответов может отправить один человек', select(s.max_answers || 3, [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [10, '10']], (v) => set('max_answers', +v))));
    if (q.type === 'number') parts.push(labeled('Верный ответ', h('input', { class: 'input', inputmode: 'decimal', value: s.correct ?? '', placeholder: 'Например, 206', oninput: (e) => set('correct', e.target.value.trim()) }), 'Чем ближе ответ участника, тем больше очков. Оставьте пустым, если верного ответа нет.'));
    if (q.type === 'info') parts.push(labeled('Текст', h('textarea', { class: 'input', rows: 4, maxlength: 1000, value: s.body || '', oninput: (e) => set('body', e.target.value) })));
    if (q.type === 'info' || q.type === 'pin') parts.push(imageField('Загрузить картинку', s.image, (url) => { set('image', url); drawEditor(); }));
    if (q.type === 'pin' && !s.image) parts.push(h('p', { class: 'error-text', text: 'Загрузите картинку — участники будут ставить на ней отметки.' }));
    if (['quiz', 'number'].includes(q.type)) parts.push(labeled('Время на ответ', select(q.time_limit, [[0, 'Без таймера'], [10, '10 секунд'], [20, '20 секунд'], [30, '30 секунд'], [60, '1 минута'], [120, '2 минуты']], (v) => { q.time_limit = +v; touch(q); }), q.type === 'quiz' ? 'С таймером за быстрый верный ответ дают до 1000 очков, за медленный — от 500.' : ''));
    if (['poll', 'quiz', 'scale', 'rank', 'number'].includes(q.type)) parts.push(switchField('Скрыть результаты до закрытия приёма', 'Зрители не видят, как голосуют другие, и не подстраиваются под большинство.', !!s.hide_results, (v) => set('hide_results', v)));
    if (['poll', 'scale'].includes(q.type)) {
      const ref = s.compare_with && questions.find((x) => x.id === s.compare_with);
      parts.push(ref
        ? h('div', { class: 'row' }, h('span', { class: 'hint grow', text: 'Сравнивается со слайдом ' + (questions.indexOf(ref) + 1) + ': на экране видны оба результата.' }), h('button', { class: 'btn small ghost', type: 'button', text: 'Не сравнивать', onclick: () => { set('compare_with', null); drawEditor(); } }))
        : h('button', { class: 'btn small ghost', type: 'button', style: { justifySelf: 'start' }, text: 'Добавить слайд «после» для сравнения', onclick: async () => {
          try { const r = await apiPost('question_duplicate', { id: q.id, compare: 1 }); questions.splice(questions.indexOf(q) + 1, 0, r.question); current = r.question; toast('Задайте этот же вопрос позже — экран покажет оба результата'); draw(); } catch (e) { oops(e); }
        } }));
    }
    editBox.replaceChildren(...parts);
  }

  // ----- Настройки сессии -----
  function settingsPanel() {
    const theme = session.theme;
    const saveTheme = () => { saveSession({ theme }); drawSide(); };
    const copy = (label, url) => h('div', { class: 'stack', style: { gap: '6px' } }, h('span', { class: 'hint', text: label }),
      h('div', { class: 'share-box row' }, h('span', { class: 'grow', text: url }), h('button', { class: 'btn small ghost', type: 'button', text: 'Копировать', onclick: () => navigator.clipboard.writeText(url).then(() => toast('Ссылка скопирована'), () => toast('Скопируйте ссылку вручную', true)) })));
    const screenUrl = joinUrl.replace('play.html', 'screen.html');
    return [
      h('div', { class: 'panel stack' }, h('h3', { text: 'Участники' }),
        switchField('Спрашивать имя', 'Имя видно ведущему и в таблице лидеров. Без этого ответы анонимны.', !!session.ask_names, (v) => saveSession({ ask_names: v ? 1 : 0 })),
        switchField('Проверять ответы до показа', 'Текстовые ответы попадают на экран после вашего одобрения на пульте.', !!session.premoderation, (v) => saveSession({ premoderation: v ? 1 : 0 })),
        switchField('Скрывать мат', 'Ответы со стоп-словами не показываются. Их можно вернуть на пульте.', !!session.filter_on, (v) => saveSession({ filter_on: v ? 1 : 0 })),
        switchField('Реакции', 'Эмодзи от зрителей пролетают по экрану.', !!session.reactions_on, (v) => saveSession({ reactions_on: v ? 1 : 0 })),
        switchField('Самостоятельное прохождение', 'Участник листает слайды сам, ведущий не нужен. Подходит для опроса по ссылке.', session.mode === 'self', (v) => saveSession({ mode: v ? 'self' : 'live' }))),
      h('div', { class: 'panel stack' }, h('h3', { text: 'Оформление экрана' }),
        switchField('Светлая тема', '', theme.mode === 'light', (v) => { theme.mode = v ? 'light' : 'dark'; saveTheme(); }),
        h('div', { class: 'theme-swatches', role: 'group', 'aria-label': 'Цвет акцента' }, ACCENTS.map((c) => h('button', { type: 'button', class: theme.accent === c ? 'on' : '', style: { background: c }, 'aria-label': 'Цвет ' + c, 'aria-pressed': theme.accent === c ? 'true' : 'false', onclick: () => { theme.accent = c; saveTheme(); } }))),
        imageField('Загрузить фон', theme.bg, (url) => { theme.bg = url; saveTheme(); }),
        imageField('Загрузить логотип', theme.logo, (url) => { theme.logo = url; saveTheme(); })),
      session.is_template ? null : h('div', { class: 'panel stack' }, h('h3', { text: 'Ссылки' }),
        copy('Для участников', joinUrl), copy('Большой экран', screenUrl + ''), copy('Для вставки в презентацию', screenUrl + '&embed=1'), copy('С прозрачным фоном, для OBS и Resolume', screenUrl + '&embed=1&transparent=1')),
    ];
  }
  const side = h('div');
  const drawSide = () => side.replaceChildren(...settingsPanel().filter(Boolean));

  function draw() { drawList(); drawEditor(); }

  const title = h('input', { class: 'input', maxlength: 120, value: session.title, style: { maxWidth: '420px', fontWeight: 600 }, 'aria-label': 'Название сессии', onchange: (e) => saveSession({ title: e.target.value }) });
  app.append(topbar(), h('main', { class: 'page', style: { maxWidth: '1320px' } },
    h('div', { class: 'page-head' },
      h('div', { class: 'row grow' }, title, session.is_template ? h('span', { class: 'tag', text: 'Шаблон' }) : h('span', { class: 'tag warn code-digits', text: formatCode(session.code) }), saved),
      h('div', { class: 'row' },
        session.is_template ? null : h('button', { class: 'btn ghost', text: 'Сохранить как шаблон', onclick: async () => { try { await apiPost('session_duplicate', { id, as_template: 1 }); toast('Шаблон сохранён в кабинете'); } catch (e) { oops(e); } } }),
        session.is_template ? null : h('a', { class: 'btn', href: 'host.html?id=' + id, text: 'Перейти к ведению' }))),
    h('div', { class: 'editor' },
      h('div', { class: 'stack' }, listBox, h('button', { class: 'btn block', text: 'Добавить слайд', onclick: addSlide }), h('button', { class: 'btn ghost block', text: 'Импорт из текста', onclick: importSlides }),
        h('p', { class: 'hint', text: 'Порядок слайдов меняется перетаскиванием.' })),
      editBox, side)));
  draw();
  drawSide();
})();
