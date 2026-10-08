// Админка: статистика, пользователи, все сессии, настройки сервиса.
'use strict';

(async () => {
  await requireUser(true);
  const app = $('#app');
  const box = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  let tab = 'stats';
  const day = (ts) => new Date(ts * 1000).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' });
  const table = (head, rows) => h('div', { class: 'panel table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, head.map((t) => h('th', { text: t })))), h('tbody', {}, rows)));

  async function stats() {
    const r = await apiGet('admin_stats');
    const t = r.totals;
    const chart = (title, key) => {
      const max = Math.max(1, ...Object.values(r.days).map((d) => d[key]));
      return h('div', { class: 'panel' }, h('h3', { text: title }), h('div', { class: 'daybars' }, Object.entries(r.days).map(([date, d]) =>
        h('div', { title: date + ': ' + d[key] }, h('span', { text: d[key] || '' }), h('i', { style: { height: (d[key] * 100) / max + '%' } }), h('span', { text: date.slice(8) })))));
    };
    box.replaceChildren(
      h('div', { class: 'stat-row' }, [['users', 'пользователей'], ['sessions', 'сессий'], ['participants', 'участников'], ['answers', 'ответов']].map(([k, name]) =>
        h('div', { class: 'stat' }, h('b', { text: t[k].toLocaleString('ru') }), h('span', { text: name })))),
      chart('Ответы за 14 дней', 'answers'), chart('Новые сессии за 14 дней', 'sessions'), chart('Новые пользователи за 14 дней', 'users'));
  }

  async function users(query) {
    const r = await apiGet('admin_users', { q: query || '' });
    const upd = async (data) => { try { await apiPost('admin_user_update', data); users(query); } catch (e) { oops(e); } };
    const search = h('input', { class: 'input', placeholder: 'Поиск по почте или имени', value: query || '', style: { maxWidth: '340px' }, onchange: (e) => users(e.target.value) });
    box.replaceChildren(h('div', { class: 'row', style: { marginBottom: '14px' } }, search,
      h('button', { class: 'btn ghost', text: 'Пригласить', onclick: invite })),
    table(['Почта', 'Имя', 'Роль', 'Статус', 'Сессий', 'Регистрация', ''], r.users.map((u) => h('tr', {},
      h('td', { text: u.email }), h('td', { text: u.name }),
      h('td', {}, h('span', { class: 'tag' + (u.role === 'admin' ? '' : ' off'), text: u.role === 'admin' ? 'Администратор' : 'Спикер' })),
      h('td', {}, u.status === 'blocked' ? h('span', { class: 'tag warn', text: 'Заблокирован' }) : u.email_verified ? h('span', { class: 'tag live', text: 'Активен' }) : h('span', { class: 'tag off', text: 'Почта не подтверждена' })),
      h('td', { text: u.sessions }), h('td', { text: day(u.created_at) }),
      h('td', {}, h('div', { class: 'row' },
        !u.email_verified ? h('button', { class: 'btn small ghost', text: 'Подтвердить почту', onclick: () => upd({ id: u.id, verify: 1 }) }) : null,
        u.id !== App.user.id ? h('button', { class: 'btn small ghost', text: u.role === 'admin' ? 'Сделать спикером' : 'Сделать администратором', onclick: () => upd({ id: u.id, role: u.role === 'admin' ? 'user' : 'admin' }) }) : null,
        u.id !== App.user.id ? h('button', { class: 'btn small ghost', text: u.status === 'blocked' ? 'Разблокировать' : 'Заблокировать', onclick: () => upd({ id: u.id, status: u.status === 'blocked' ? 'active' : 'blocked' }) }) : null,
        u.id !== App.user.id ? h('button', { class: 'btn small danger', text: 'Удалить', onclick: () => confirmBox('Удалить ' + u.email + '?', 'Аккаунт, все его сессии и ответы удалятся без возможности восстановления.', 'Удалить аккаунт', async () => { await apiPost('admin_user_delete', { id: u.id }); users(query); }, true) }) : h('span', { class: 'hint', text: 'Это вы' })))))));
  }

  function invite() {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'Почта, необязательно' });
    const out = h('div', { class: 'share-box', hidden: true });
    modal('Приглашение', h('div', { class: 'stack' }, h('p', { class: 'hint', text: 'Ссылка действует 14 дней. Если указать почту, приглашение уйдёт письмом и подойдёт только этому адресу.' }), email, out),
      [() => h('button', { class: 'btn', text: 'Создать ссылку', onclick: async () => {
        try { const r = await apiPost('admin_invite', { email: email.value }); out.textContent = r.link; out.hidden = false; } catch (e) { oops(e); }
      } })]);
  }

  async function sessions() {
    const r = await apiGet('admin_sessions');
    const phase = { lobby: 'Не начата', open: 'Идёт', closed: 'Идёт', reveal: 'Идёт', finished: 'Завершена' };
    box.replaceChildren(r.sessions.length ? table(['Код', 'Название', 'Владелец', 'Состояние', 'Слайдов', 'Участников', 'Ответов', 'Создана', ''], r.sessions.map((s) => h('tr', {},
      h('td', { class: 'code-digits', text: formatCode(s.code) }), h('td', { text: s.title }), h('td', { text: s.email }),
      h('td', { text: s.mode === 'self' ? 'Самостоятельная' : phase[s.phase] }), h('td', { text: s.slides }), h('td', { text: s.people }), h('td', { text: s.answers }), h('td', { text: day(s.created_at) }),
      h('td', {}, h('a', { class: 'btn small ghost', href: 'report.html?id=' + s.id, text: 'Отчёт' })))))
      : h('div', { class: 'empty' }, h('h2', { text: 'Сессий пока нет' })));
  }

  async function settings() {
    const r = await apiGet('admin_settings');
    const reg = h('select', { class: 'input' }, [['open', 'Открытая — зарегистрироваться может любой'], ['invite', 'По приглашению — нужна ссылка от администратора'], ['closed', 'Закрытая — новых аккаунтов нет']].map(([v, t]) => h('option', { value: v, text: t })));
    reg.value = r.registration;
    const len = h('input', { class: 'input', type: 'number', min: 20, max: 1000, value: r.max_answer_len });
    const mb = h('input', { class: 'input', type: 'number', min: 1, max: 10, value: r.max_upload_mb });
    const words = h('textarea', { class: 'input', rows: 5, value: r.stopwords, placeholder: 'слово1, слово2' });
    box.replaceChildren(h('form', { class: 'panel stack', style: { maxWidth: '640px' }, onsubmit: async (e) => {
      e.preventDefault();
      try { await apiPost('admin_settings_save', { registration: reg.value, max_answer_len: len.value, max_upload_mb: mb.value, stopwords: words.value }); toast('Настройки сохранены'); } catch (ex) { oops(ex); }
    } },
    h('label', { class: 'field' }, h('span', { text: 'Регистрация спикеров' }), reg),
    h('label', { class: 'field' }, h('span', { text: 'Наибольшая длина текстового ответа, символов' }), len),
    h('label', { class: 'field' }, h('span', { text: 'Наибольший размер картинки, МБ' }), mb),
    h('label', { class: 'field' }, h('span', { text: 'Дополнительные стоп-слова' }), words,
      h('span', { class: 'hint', text: 'Через запятую или с новой строки. Ответ скрывается, если слово в нём начинается с одного из этих. Встроенный список уже содержит основ: ' + r.builtin_stopwords + '.' })),
    h('button', { class: 'btn', type: 'submit', style: { justifySelf: 'start' }, text: 'Сохранить настройки' })));
  }

  const views = { stats: ['Статистика', stats], users: ['Пользователи', users], sessions: ['Сессии', sessions], settings: ['Настройки', settings] };
  function open(key) {
    tab = key;
    tabs.replaceChildren(...Object.entries(views).map(([k, [name]]) => h('button', { class: k === tab ? 'on' : '', role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', text: name, onclick: () => open(k) })));
    box.replaceChildren(h('p', { class: 'hint', text: 'Загрузка…' }));
    views[key][1]().catch(oops);
  }

  app.append(topbar('admin.html'), h('main', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', { text: 'Админка' })), tabs, box));
  open('stats');
})();
