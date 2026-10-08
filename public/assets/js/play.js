// Телефон участника. Состояние сессии читается из статического файла state/<код>.json,
// PHP вызывается только при входе, отправке ответа, лайке и реакции.
'use strict';

(() => {
  const code = (new URLSearchParams(location.search).get('c') || '').replace(/\D/g, '');
  const root = $('#root'), main = $('#main');
  const storeKey = 'otklik:' + code;
  const me = { token: '', name: '', answers: {}, likes: new Set(), feedback: {} };
  let st = null, offset = 0, viewKey = '', selfIdx = 0, joined = false, qa = null, timeUp = 0, lastReact = 0, result = null;

  const saved = (() => { try { return JSON.parse(localStorage.getItem(storeKey) || '{}'); } catch (e) { return {}; } })();
  me.token = saved.token || '';
  me.name = saved.name || '';
  const persist = () => { try { localStorage.setItem(storeKey, JSON.stringify({ token: me.token, name: me.name })); } catch (e) { /* приватный режим */ } };

  const maxAnswers = (q) => (q.type === 'open' ? Math.max(1, Math.min(10, q.s.max_answers || 3)) : q.type === 'cloud' ? 3 : q.type === 'qa' ? 10 : 1);
  const mine = (q) => me.answers[q.id] || [];
  const now = () => Date.now() + offset;

  function show(center, ...nodes) {
    main.className = 'play-main' + (center ? ' center' : '');
    main.replaceChildren(...nodes.flat().filter(Boolean));
  }
  const state = (badge, title, text, kind) => h('div', { class: 'big-state' },
    badge === 'pulse' ? h('div', { class: 'pulse' }) : badge ? h('div', { class: 'badge ' + (kind || ''), text: badge }) : null,
    h('b', { text: title }), text ? h('p', { text }) : null);

  async function loadState() {
    const res = await fetch('state/' + code + '.json', { cache: 'no-cache' });
    if (res.status === 404) throw Object.assign(new Error('Сессия с кодом ' + formatCode(code) + ' не найдена. Проверьте код на экране.'), { status: 404 });
    if (!res.ok) throw new Error('Нет связи');
    return res.json();
  }

  async function join(name) {
    const r = await apiPost('join', { code, token: me.token, name: name || me.name });
    me.token = r.token;
    me.name = r.name;
    me.answers = r.answers || {};
    me.likes = new Set(r.likes || []);
    offset = r.now - Date.now();
    joined = true;
    persist();
  }

  function askName() {
    const input = h('input', { class: 'input', maxlength: 40, placeholder: 'Имя', autocomplete: 'given-name', value: me.name });
    const form = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      try { await join(name); viewKey = ''; render(); } catch (err) { oops(err); }
    } }, h('div', { class: 'play-q', text: 'Как вас зовут?' }), h('p', { class: 'hint', text: 'Имя увидит ведущий рядом с вашими ответами.' }), input, h('button', { class: 'btn big block', text: 'Войти в сессию' }));
    show(false, form);
    input.focus();
  }

  async function send(q, value) {
    try {
      const r = await apiPost('answer', { code, token: me.token, qid: q.id, value });
      (me.answers[q.id] = me.answers[q.id] || []).push(value);
      if (r.is_correct !== undefined) me.feedback[q.id] = r;
      if (r.status === 'pending') toast('Ответ отправлен ведущему на проверку');
      render();
      return true;
    } catch (e) {
      if (e.status === 401) { me.token = ''; await join().catch(() => {}); }
      oops(e);
      render(true);
      return false;
    }
  }

  // ----- Формы по типам слайдов -----

  function sendButton(label, getValue, q) {
    const btn = h('button', { class: 'btn big block', type: 'submit', text: label });
    return { btn, submit: async (e) => {
      if (e) e.preventDefault();
      const v = getValue();
      if (v === null || v === undefined || v === '') return;
      btn.disabled = true;
      await send(q, v);
      btn.disabled = false;
    } };
  }

  function textForm(q, placeholder, label, short) {
    const left = maxAnswers(q) - mine(q).length;
    const input = short
      ? h('input', { class: 'input', maxlength: 30, placeholder })
      : h('textarea', { class: 'input', maxlength: 300, rows: 3, placeholder });
    const s = sendButton(label, () => input.value.trim(), q);
    const sent = mine(q).length ? h('div', { class: 'sent-chips' }, mine(q).map((t) => h('span', { text: t }))) : null;
    return h('form', { class: 'stack', onsubmit: s.submit }, input, s.btn,
      maxAnswers(q) > 1 ? h('p', { class: 'hint', text: q.type === 'qa' ? 'Можно задать ещё ' + left + ' ' + plural(left, 'вопрос', 'вопроса', 'вопросов') : 'Можно отправить ещё ' + left + ' ' + plural(left, 'ответ', 'ответа', 'ответов') }) : null,
      q.type === 'qa' ? null : sent);
  }

  function pollForm(q) {
    const multi = !!q.s.multi;
    const limit = multi ? Math.max(1, Math.min(q.options.length, q.s.max_choices || q.options.length)) : 1;
    const picked = new Set();
    const s = sendButton('Отправить', () => (picked.size ? [...picked] : null), q);
    s.btn.disabled = true;
    const buttons = q.options.map((opt, i) => h('button', { class: 'opt', type: 'button', onclick: () => {
      if (multi) {
        if (picked.has(i)) picked.delete(i); else if (picked.size < limit) picked.add(i); else toast('Можно выбрать не больше ' + limit);
      } else { picked.clear(); picked.add(i); }
      buttons.forEach((b, j) => b.classList.toggle('on', picked.has(j)));
      s.btn.disabled = !picked.size;
    } }, h('span', { class: 'dot' }), opt.img ? h('img', { src: opt.img, alt: '' }) : null, h('span', { text: opt.text || 'Вариант ' + (i + 1) })));
    return h('form', { class: 'stack', onsubmit: s.submit },
      multi ? h('p', { class: 'hint', text: limit < q.options.length ? 'Выберите до ' + limit + ' ' + plural(limit, 'варианта', 'вариантов', 'вариантов') : 'Можно выбрать несколько' }) : null,
      h('div', { class: 'opts' }, buttons), s.btn);
  }

  function quizForm(q) {
    let locked = false;
    return h('div', { class: 'opts quiz' }, q.options.map((opt, i) => h('button', { class: 'opt', type: 'button', style: { '--c': COLORS[i % 4] }, text: opt.text || 'Вариант ' + (i + 1), onclick: async (e) => {
      if (locked) return;
      locked = true;
      e.currentTarget.classList.add('on');
      if (!(await send(q, i))) locked = false;
    } })));
  }

  function scaleForm(q, min, max, withComment) {
    let value = null;
    const comment = withComment ? h('textarea', { class: 'input', maxlength: 300, rows: 2, placeholder: 'Что повлияло на оценку? Необязательно' }) : null;
    const s = sendButton('Отправить', () => (value === null ? null : withComment ? { score: value, comment: comment.value.trim() } : value), q);
    s.btn.disabled = true;
    const buttons = [];
    for (let v = min; v <= max; v++) {
      buttons.push(h('button', { type: 'button', text: v, onclick: (e) => {
        value = v;
        buttons.forEach((b) => b.classList.toggle('on', b === e.currentTarget));
        s.btn.disabled = false;
      } }));
    }
    const lo = withComment ? 'Точно нет' : q.s.label_min, hi = withComment ? 'Обязательно' : q.s.label_max;
    return h('form', { class: 'stack', onsubmit: s.submit }, h('div', { class: 'nums' }, buttons),
      lo || hi ? h('div', { class: 'axis-labels' }, h('span', { text: lo || '' }), h('span', { text: hi || '' })) : null, comment, s.btn);
  }

  function rankForm(q) {
    const order = q.options.map((_, i) => i);
    const list = h('div', { class: 'rank-edit' });
    const draw = () => list.replaceChildren(...order.map((i, pos) => h('div', {},
      h('i', { text: pos + 1 }), h('span', { text: q.options[i].text || 'Вариант ' + (i + 1) }),
      h('button', { type: 'button', 'aria-label': 'Выше', text: '↑', disabled: pos === 0, onclick: () => { [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]]; draw(); } }),
      h('button', { type: 'button', 'aria-label': 'Ниже', text: '↓', disabled: pos === order.length - 1, onclick: () => { [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]]; draw(); } }))));
    draw();
    const s = sendButton('Отправить порядок', () => order.slice(), q);
    return h('form', { class: 'stack', onsubmit: s.submit }, h('p', { class: 'hint', text: 'Самое важное — наверху. Двигайте стрелками.' }), list, s.btn);
  }

  function numberForm(q) {
    const input = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Ваше число', autocomplete: 'off' });
    const s = sendButton('Отправить', () => input.value.trim(), q);
    return h('form', { class: 'stack', onsubmit: s.submit }, input, s.btn);
  }

  function pinForm(q) {
    let point = null;
    const s = sendButton('Отправить отметку', () => point, q);
    s.btn.disabled = true;
    if (!q.s.image) return h('p', { class: 'hint', text: 'Ведущий ещё не добавил картинку.' });
    const dot = h('div', { class: 'pin-dot', hidden: true });
    const box = h('div', { class: 'pin-pick', onclick: (e) => {
      const r = box.getBoundingClientRect();
      point = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
      dot.hidden = false;
      dot.style.left = point.x * 100 + '%';
      dot.style.top = point.y * 100 + '%';
      s.btn.disabled = false;
    } }, h('img', { src: q.s.image, alt: 'Изображение для отметки' }), dot);
    return h('form', { class: 'stack', onsubmit: s.submit }, h('p', { class: 'hint', text: 'Коснитесь нужного места на картинке.' }), box, s.btn);
  }

  function form(q) {
    switch (q.type) {
      case 'open': return textForm(q, 'Ваш ответ', 'Отправить');
      case 'qa': return textForm(q, 'Ваш вопрос спикеру', 'Задать вопрос');
      case 'cloud': return textForm(q, 'Одно-два слова', 'Отправить', true);
      case 'poll': return pollForm(q);
      case 'quiz': return quizForm(q);
      case 'scale': return scaleForm(q, q.min, q.max, false);
      case 'nps': return scaleForm(q, 0, 10, true);
      case 'rank': return rankForm(q);
      case 'number': return numberForm(q);
      case 'pin': return pinForm(q);
    }
    return null;
  }

  function infoView(q) {
    return [h('div', { class: 'play-q', text: q.text }), q.s.body ? h('p', { text: q.s.body, style: { whiteSpace: 'pre-wrap', color: 'var(--dim)' } }) : null,
      q.s.image ? h('img', { src: q.s.image, alt: '', style: { borderRadius: '14px' } }) : null];
  }

  function timeBar(q) {
    if (!q.time_limit || st.mode !== 'live') return null;
    const total = q.time_limit * 1000, left = q.opened_at + total - now();
    if (left <= 0) return null;
    const bar = h('i');
    requestAnimationFrame(() => {
      bar.animate([{ transform: 'scaleX(' + left / total + ')' }, { transform: 'scaleX(0)' }], { duration: left, fill: 'forwards' });
    });
    clearTimeout(timeUp);
    timeUp = setTimeout(() => render(true), left + 50);
    return h('div', { class: 'time-bar' }, bar);
  }

  // ----- Вопросы спикеру: общий список с лайками -----

  function qaList() {
    const box = h('div', { class: 'qa-mine', id: 'qa-box' });
    drawQa(box);
    return box;
  }
  function drawQa(box) {
    if (!box || !qa) return;
    const items = qa.items.slice().sort((a, b) => a.answered - b.answered || b.likes - a.likes || a.id - b.id);
    box.replaceChildren(items.length ? h('p', { class: 'hint', text: 'Поддержите вопросы, на которые хотите услышать ответ' }) : '', ...items.map((it) => {
      const on = me.likes.has(it.id);
      return h('div', { class: 'q' + (it.answered ? ' done' : '') }, h('span', { text: it.text }),
        h('button', { class: 'like' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': 'Поддержать вопрос', text: '▲ ' + it.likes, onclick: async () => {
          try {
            const r = await apiPost('vote', { code, token: me.token, answer_id: it.id });
            if (r.liked) { me.likes.add(it.id); it.likes++; } else { me.likes.delete(it.id); it.likes--; }
            drawQa(box);
          } catch (e) { oops(e); }
        } }));
    }));
  }
  async function pollQa() {
    const q = st && st.mode === 'live' ? st.q : null;
    if (!q || q.type !== 'qa' || !joined) return;
    try {
      const res = await fetch('state/' + code + '-qa.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.q === q.id) { qa = data; drawQa($('#qa-box')); }
    } catch (e) { /* следующая попытка через 3 секунды */ }
  }

  // ----- Итог викторины для участника -----

  function quizResult(q) {
    const my = mine(q);
    const box = h('div', { class: 'big-state' });
    const fill = (r) => {
      const correct = q.type === 'quiz' ? (q.correct || []).map((i) => q.options[i] && q.options[i].text).join(', ') : q.correct;
      if (!my.length) {
        box.replaceChildren(h('div', { class: 'badge', text: '–' }), h('b', { text: 'Вы не успели ответить' }), correct !== undefined && correct !== '' ? h('p', { text: 'Верный ответ: ' + correct }) : null);
        return;
      }
      const last = r && r.last;
      if (q.type === 'quiz') {
        const ok = (q.correct || []).includes(my[0]);
        box.replaceChildren(h('div', { class: 'badge ' + (ok ? 'ok' : 'bad'), text: ok ? '✓' : '✕' }), h('b', { text: ok ? 'Верно!' : 'Неверно' }),
          ok ? null : h('p', { text: 'Верный ответ: ' + correct }));
      } else {
        box.replaceChildren(h('div', { class: 'badge', text: '≈' }), h('b', { text: correct !== undefined ? 'Верный ответ: ' + correct : 'Ответ принят' }), h('p', { text: 'Ваш ответ: ' + my[0] }));
      }
      if (r) box.append(h('p', { text: (last && last.points ? '+' + last.points + ' ' + plural(last.points, 'очко', 'очка', 'очков') + '. ' : '') + 'Всего ' + r.score + ', место ' + r.place + ' из ' + Math.max(r.players, r.place) }));
    };
    fill(result && result.qid === q.id ? result.r : null);
    if (!result || result.qid !== q.id) {
      // Небольшой разброс, чтобы 300 телефонов не обратились к серверу в одну и ту же секунду.
      setTimeout(async () => {
        try { const r = await apiGet('me', { code, token: me.token, qid: q.id }); result = { qid: q.id, r }; fill(r); } catch (e) { /* итог останется без очков */ }
      }, Math.random() * 1500);
    }
    return box;
  }

  // ----- Выбор того, что показать -----

  function renderLive() {
    const q = st.q, phase = st.phase;
    if (phase === 'finished') {
      const box = state('★', 'Сессия завершена', 'Спасибо, что участвовали!');
      if (st.has_quiz) apiGet('me', { code, token: me.token }).then((r) => { if (r.score) box.append(h('p', { text: 'Ваш результат: ' + r.score + ' ' + plural(r.score, 'очко', 'очка', 'очков') + ', место ' + r.place })); }).catch(() => {});
      return show(true, box);
    }
    if (phase === 'lobby' || !q) return show(true, state('pulse', 'Вы в сессии', 'Ждём, когда ведущий покажет первый вопрос.'));
    if (q.type === 'info') return show(false, infoView(q));
    const head = h('div', { class: 'play-q', text: q.text });
    const done = mine(q).length >= maxAnswers(q);
    const late = q.time_limit && now() > q.opened_at + q.time_limit * 1000;
    if (phase === 'reveal' && (q.type === 'quiz' || q.type === 'number')) return show(true, head, quizResult(q));
    if (phase === 'open' && !done && !late) return show(false, head, timeBar(q), form(q), q.type === 'qa' ? qaList() : null);
    if (q.type === 'qa') return show(false, head, h('p', { class: 'hint', text: phase === 'open' ? 'Вы задали максимум вопросов. Можно поддержать чужие.' : 'Приём вопросов закрыт.' }), qaList());
    if (done) return show(true, head, state('✓', 'Ответ принят', phase === 'open' ? 'Смотрите на экран — результаты появляются там.' : 'Результаты на экране.', 'ok'));
    return show(true, head, state('', late && phase === 'open' ? 'Время вышло' : 'Приём ответов закрыт', 'Ждём следующий вопрос.'));
  }

  function renderSelf() {
    const list = st.questions || [];
    if (!list.length) return show(true, state('pulse', 'Опрос ещё не готов', 'Загляните позже.'));
    if (selfIdx >= list.length) return show(true, state('✓', 'Готово, спасибо!', 'Ваши ответы сохранены.', 'ok'));
    const q = list[selfIdx];
    const next = h('button', { class: 'btn big', type: 'button', text: selfIdx === list.length - 1 ? 'Завершить' : 'Дальше', onclick: () => { selfIdx++; render(true); } });
    const nav = h('div', { class: 'self-nav' }, h('span', { class: 'hint', text: (selfIdx + 1) + ' из ' + list.length }), next);
    if (q.type === 'info') return show(false, infoView(q), nav);
    const head = h('div', { class: 'play-q', text: q.text });
    if (mine(q).length >= maxAnswers(q)) {
      const fb = me.feedback[q.id];
      let note = state('✓', 'Ответ принят', '', 'ok');
      if (fb) {
        const correct = Array.isArray(fb.correct) ? fb.correct.map((i) => q.options[i] && q.options[i].text).join(', ') : fb.correct;
        note = fb.is_correct ? state('✓', 'Верно!', '+' + fb.points, 'ok') : state(q.type === 'quiz' ? '✕' : '≈', q.type === 'quiz' ? 'Неверно' : 'Ответ принят', 'Верный ответ: ' + correct, q.type === 'quiz' ? 'bad' : '');
      }
      return show(false, head, note, nav);
    }
    next.className = 'btn ghost';
    next.textContent = 'Пропустить';
    show(false, head, form(q), q.type === 'open' || q.type === 'cloud' ? nav : h('div', { class: 'self-nav' }, h('span', { class: 'hint', text: (selfIdx + 1) + ' из ' + list.length }), next));
  }

  function render(force) {
    if (!st) return;
    applyTheme(root, st.theme);
    $('#brand').textContent = st.title || 'Отклик';
    $('#who').textContent = me.name || '';
    document.title = st.title || 'Отклик';
    if (!joined) return;
    const self = st.mode === 'self';
    const q = self ? (st.questions || [])[selfIdx] : st.q;
    const key = [st.mode, self ? selfIdx : st.phase, q ? q.id : 0, q ? mine(q).length : 0, q ? q.opened_at : 0].join(':');
    if (key !== viewKey || force) {
      viewKey = key;
      if (self) renderSelf(); else renderLive();
    }
    $('#react').hidden = !(st.reactions && !self && st.phase !== 'lobby' && st.phase !== 'finished');
  }

  async function tick() {
    try {
      const next = await loadState();
      if (!st || next.v !== st.v) { st = next; render(); }
    } catch (e) {
      if (e.status === 404 && !st) show(true, state('?', 'Сессия не найдена', e.message), h('a', { class: 'btn', href: 'index.html', text: 'Ввести код заново' }));
    }
  }

  async function start() {
    if (code.length !== 6) { location.replace('index.html'); return; }
    show(true, state('pulse', 'Подключаемся…'));
    $('#react').replaceChildren(...['👍', '❤️', '😂', '👏', '🔥', '🤔'].map((emoji) => h('button', { type: 'button', text: emoji, 'aria-label': 'Реакция ' + emoji, onclick: () => {
      if (Date.now() - lastReact < 1000) return;
      lastReact = Date.now();
      apiPost('react', { code, token: me.token, emoji }).catch(() => {});
    } })));
    try {
      st = await loadState();
    } catch (e) {
      show(true, state('?', 'Сессия не найдена', e.message), h('a', { class: 'btn', href: 'index.html', text: 'Ввести код заново' }));
      return;
    }
    applyTheme(root, st.theme);
    if (st.ask_names && !me.name) { render(); askName(); } else {
      try { await join(); } catch (e) { show(true, state('!', 'Не получилось подключиться', e.message, 'bad')); return; }
      if (st.mode === 'self') {
        const list = st.questions || [];
        selfIdx = list.findIndex((q) => q.type !== 'info' && !mine(q).length);
        if (selfIdx < 0) selfIdx = list.length;
        if (selfIdx > 0 && list[selfIdx - 1] && list[selfIdx - 1].type === 'info' && selfIdx === 1) selfIdx = 0;
      }
      render();
    }
    setInterval(tick, 2000);
    setInterval(pollQa, 3000);
    setInterval(() => { if (joined && !document.hidden) apiPost('ping', { code, token: me.token }).then((r) => { offset = r.now - Date.now(); }).catch(() => {}); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }

  start();
})();
