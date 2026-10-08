// Кабинет спикера: сессии, архив, шаблоны, профиль.
'use strict';

(async () => {
  await requireUser();
  const app = $('#app');
  let sessions = [], tab = 'active';
  const list = h('div', { class: 'session-list' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  const phaseTag = (s) => {
    if (s.mode === 'self') return h('span', { class: 'tag', text: 'Самостоятельная' });
    if (s.phase === 'lobby') return s.answers ? h('span', { class: 'tag warn', text: 'На паузе' }) : h('span', { class: 'tag off', text: 'Не начата' });
    if (s.phase === 'finished') return h('span', { class: 'tag off', text: 'Завершена' });
    return h('span', { class: 'tag live', text: 'Идёт' });
  };

  function item(s) {
    const acts = [];
    const more = (label, fn, cls) => h('button', { class: 'btn small ' + (cls || 'ghost'), text: label, onclick: fn });
    if (tab === 'templates') {
      acts.push(h('a', { class: 'btn small ghost', href: 'editor.html?id=' + s.id, text: 'Изменить' }),
        more('Создать сессию', async () => { try { const r = await apiPost('session_create', { template: String(s.id) }); location.href = 'editor.html?id=' + r.id; } catch (e) { oops(e); } }, ''));
    } else {
      acts.push(h('a', { class: 'btn small', href: 'host.html?id=' + s.id, text: 'Вести' }),
        h('a', { class: 'btn small ghost', href: 'editor.html?id=' + s.id, text: 'Слайды' }),
        h('a', { class: 'btn small ghost', href: 'report.html?id=' + s.id, text: 'Отчёт' }),
        more('Копия', async () => { try { await apiPost('session_duplicate', { id: s.id }); load(); } catch (e) { oops(e); } }),
        more(s.archived ? 'Вернуть из архива' : 'В архив', async () => { try { await apiPost('session_archive', { id: s.id, archived: s.archived ? 0 : 1 }); load(); } catch (e) { oops(e); } }));
    }
    acts.push(more('Удалить', () => confirmBox('Удалить «' + s.title + '»?', 'Слайды и все ответы удалятся без возможности восстановления.', 'Удалить', async () => { await apiPost('session_delete', { id: s.id }); load(); }, true), 'danger'));
    return h('div', { class: 'session-item' },
      tab === 'templates' ? h('div', { class: 'code-chip', text: 'Шаблон' }) : h('div', { class: 'code-chip', text: formatCode(s.code) }),
      h('div', {}, h('h3', { text: s.title }), h('div', { class: 'meta' },
        s.slides + ' ' + plural(s.slides, 'слайд', 'слайда', 'слайдов'),
        tab !== 'templates' ? ', ' + s.people + ' ' + plural(s.people, 'участник', 'участника', 'участников') + ', ' + s.answers + ' ' + plural(s.answers, 'ответ', 'ответа', 'ответов') + ' ' : '',
        tab !== 'templates' ? phaseTag(s) : '')),
      h('div', { class: 'row' }, acts));
  }

  function draw() {
    const groups = {
      active: sessions.filter((s) => !s.archived && !s.is_template),
      archive: sessions.filter((s) => s.archived && !s.is_template),
      templates: sessions.filter((s) => s.is_template),
    };
    tabs.replaceChildren(...[['active', 'Сессии'], ['archive', 'Архив'], ['templates', 'Мои шаблоны']].map(([k, name]) =>
      h('button', { class: tab === k ? 'on' : '', role: 'tab', 'aria-selected': tab === k ? 'true' : 'false', text: name + ' ' + groups[k].length, onclick: () => { tab = k; draw(); } })));
    const rows = groups[tab];
    if (rows.length) { list.replaceChildren(...rows.map(item)); return; }
    const empty = {
      active: ['Здесь появятся ваши сессии', 'Соберите слайды с вопросами и покажите залу QR-код.'],
      archive: ['Архив пуст', 'Отправляйте сюда прошедшие сессии, чтобы они не мешали текущим.'],
      templates: ['Своих шаблонов пока нет', 'Откройте сессию в редакторе и нажмите «Сохранить как шаблон».'],
    }[tab];
    list.replaceChildren(h('div', { class: 'empty' }, h('h2', { text: empty[0] }), h('p', { text: empty[1] }),
      tab === 'active' ? h('button', { class: 'btn', text: 'Создать сессию', onclick: create }) : ''));
  }

  async function load() {
    try { sessions = (await apiGet('sessions_list')).sessions; draw(); } catch (e) { oops(e); }
  }

  async function create() {
    let chosen = '';
    const title = h('input', { class: 'input', maxlength: 120, placeholder: 'Например: Лекция о данных, 12 октября' });
    const text = h('textarea', { class: 'input', rows: 5, hidden: true, placeholder: 'опрос; Любимый сезон?; Зима; Весна; Лето; Осень\nвикторина; Столица Австралии?; Сидней; *Канберра; Мельбурн\nоблако; Одно слово о сегодняшнем дне' });
    const hint = h('p', { class: 'hint', hidden: true, text: 'Одна строка — один слайд: тип; вопрос; варианты через точку с запятой. Можно вставить строки из таблицы. Верный ответ викторины отметьте звёздочкой. Строка без типа станет открытым вопросом.' });
    const builtin = (await apiGet('templates_list')).templates;
    const options = [{ key: '', title: 'Пустая сессия', about: 'Добавите слайды в редакторе' }, { key: 'import', title: 'Из текста или таблицы', about: 'Вставьте список вопросов' },
      ...builtin.map((t) => ({ key: t.key, title: t.title, about: t.about })),
      ...sessions.filter((s) => s.is_template).map((s) => ({ key: String(s.id), title: s.title, about: 'Мой шаблон, ' + s.slides + ' ' + plural(s.slides, 'слайд', 'слайда', 'слайдов') }))];
    const grid = h('div', { class: 'choice-grid' });
    const paint = () => grid.replaceChildren(...options.map((o) => h('button', { type: 'button', class: 'choice' + (chosen === o.key ? ' on' : ''), 'aria-pressed': chosen === o.key ? 'true' : 'false', onclick: () => {
      chosen = o.key; text.hidden = hint.hidden = chosen !== 'import'; paint();
    } }, h('b', { text: o.title }), h('small', { text: o.about }))));
    paint();
    modal('Новая сессия', h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', { text: 'Название' }), title), grid, text, hint), [(close) => h('button', { class: 'btn', text: 'Создать сессию', onclick: async () => {
      try {
        const r = await apiPost('session_create', { title: title.value, template: chosen === 'import' ? '' : chosen, import: chosen === 'import' ? text.value : '' });
        location.href = 'editor.html?id=' + r.id;
      } catch (e) { oops(e); }
    } })]);
  }

  function profile() {
    const name = h('input', { class: 'input', maxlength: 80, value: App.user.name });
    const oldP = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const newP = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: 8 });
    modal('Профиль', h('div', { class: 'stack' },
      h('p', { class: 'hint', text: App.user.email }),
      h('label', { class: 'field' }, h('span', { text: 'Имя' }), name),
      h('h3', { text: 'Смена пароля' }),
      h('label', { class: 'field' }, h('span', { text: 'Текущий пароль' }), oldP),
      h('label', { class: 'field' }, h('span', { text: 'Новый пароль, не короче 8 символов' }), newP)),
    [(close) => h('button', { class: 'btn', text: 'Сохранить', onclick: async () => {
      try {
        App.user = (await apiPost('profile_update', { name: name.value })).user;
        if (newP.value) await apiPost('password_change', { old: oldP.value, new: newP.value });
        toast('Сохранено');
        close();
      } catch (e) { oops(e); }
    } })]);
  }

  app.append(topbar('dashboard.html'), h('main', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { text: 'Сессии' }),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', text: 'Профиль', onclick: profile }), h('button', { class: 'btn', text: 'Создать сессию', onclick: create }))),
    tabs, list));
  load();
})();
