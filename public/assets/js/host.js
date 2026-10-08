// Пульт ведущего: переключение слайдов, приём ответов, модерация.
'use strict';

(async () => {
  await requireUser();
  const id = +new URLSearchParams(location.search).get('id');
  const app = $('#app');
  let session, last = null, busy = false, viewQid = null;

  try {
    session = (await apiGet('session_get', { id })).session;
  } catch (e) {
    app.append(topbar(), h('main', { class: 'page' }, h('div', { class: 'empty' }, h('h2', { text: 'Сессия не найдена' }), h('a', { class: 'btn', href: 'dashboard.html', text: 'К списку сессий' }))));
    return;
  }
  const code = session.code;
  const self = session.mode === 'self';

  const slides = h('div', { class: 'slide-list' });
  const stage = h('div', { class: 'stage host-stage' });
  const qText = h('div', { class: 'q-text' });
  const viz = h('div', { class: 'viz', 'data-cap': 12 });
  const controls = h('div', { class: 'controls' });
  const counters = h('div', { class: 'row' });
  const feed = h('div', { class: 'feed' });
  const feedTitle = h('h3', { text: 'Ответы' });
  stage.append(qText, viz);

  // Пульт обновляется раз в секунду; блок перерисовывается, только если его данные изменились,
  // иначе кнопка могла бы исчезнуть из-под пальца.
  const sigs = {};
  const changed = (key, value) => {
    const sig = JSON.stringify(value);
    if (sigs[key] === sig) return false;
    sigs[key] = sig;
    return true;
  };

  async function act(action, data) {
    try { await apiPost(action, { session_id: id, ...data }); await poll(); } catch (e) { oops(e); }
  }
  const moderate = async (data) => { try { await apiPost('moderate', data); await poll(); } catch (e) { oops(e); } };

  function drawControls(r) {
    const btn = (label, fn, cls) => h('button', { class: 'btn ' + (cls || ''), type: 'button', text: label, onclick: fn });
    const q = r.q, parts = [];
    if (!changed('controls', [r.phase, q && q.id, q && q.type, r.hide_results, r.hide_join, r.index, r.total])) return;
    if (self) {
      parts.push(h('span', { class: 'hint', text: 'Участники проходят слайды сами. Выберите слайд слева, чтобы посмотреть ответы.' }));
    } else if (r.phase === 'lobby') {
      parts.push(btn(r.total ? 'Начать: показать первый слайд' : 'Сначала добавьте слайды', () => act('goto', { dir: 'next' }), 'big'));
    } else if (r.phase === 'finished') {
      parts.push(btn('Вернуться к последнему слайду', () => act('goto', { dir: 'prev' }), 'ghost'), h('a', { class: 'btn', href: 'report.html?id=' + id, text: 'Открыть отчёт' }));
    } else if (q) {
      const scored = ['quiz', 'number'].includes(q.type);
      if (q.type !== 'info') {
        if (r.phase === 'open') parts.push(btn('Закрыть приём ответов', () => act('phase', { phase: 'closed' }), 'ghost'));
        else parts.push(btn('Открыть приём снова', () => act('phase', { phase: 'open' }), 'ghost'));
        if (scored && r.phase !== 'reveal') parts.push(btn('Показать верный ответ', () => act('phase', { phase: 'reveal' }), 'sun'));
        if (r.phase === 'open') parts.push(btn(r.hide_results ? 'Показать результаты залу' : 'Скрыть результаты от зала', () => act('toggle', { hide_results: r.hide_results ? 0 : 1 }), 'ghost'));
      }
      parts.push(btn(r.hide_join ? 'Показать код и QR на экране' : 'Скрыть код и QR на экране', () => act('toggle', { hide_join: r.hide_join ? 0 : 1 }), 'ghost'));
      parts.push(h('div', { class: 'grow' }), btn('Назад', () => act('goto', { dir: 'prev' }), 'ghost'),
        btn(r.index === r.total ? 'Завершить сессию' : 'Следующий слайд', () => act('goto', { dir: 'next' })));
    }
    controls.replaceChildren(...parts);
  }

  function drawFeed(r) {
    const q = r.q, items = (r.data && r.data.items) || [];
    const textual = q && ['open', 'qa', 'cloud', 'nps'].includes(q.type);
    if (!changed('feed', [q && q.id, items, r.spotlight && r.spotlight.id])) return;
    feedTitle.textContent = textual ? 'Ответы: ' + items.length : 'Ответы';
    if (!textual) { feed.replaceChildren(h('p', { class: 'hint', text: q ? 'На этом слайде нет текстовых ответов для проверки.' : 'Здесь появятся текстовые ответы для проверки.' })); return; }
    if (!items.length) { feed.replaceChildren(h('p', { class: 'hint', text: 'Пока никто не ответил.' })); return; }
    const order = { pending: 0, visible: 1, hidden: 2 };
    const sorted = items.slice().sort((a, b) => order[a.status] - order[b.status] || b.id - a.id);
    const sp = r.spotlight ? r.spotlight.id : 0;
    const b = (label, fn) => h('button', { type: 'button', text: label, onclick: fn });
    feed.replaceChildren(...sorted.slice(0, 150).map((it) => h('div', { class: 'feed-item ' + it.status },
      h('div', { text: it.text }),
      h('div', { class: 'who', text: (it.name || 'Без имени') + (it.status === 'pending' ? ' — ждёт проверки' : it.status === 'hidden' ? ' — скрыт' : '') + (q.type === 'qa' ? ' — лайков: ' + it.likes : '') }),
      h('div', { class: 'acts' },
        it.status !== 'visible' ? b('Показать', () => moderate({ answer_id: it.id, status: 'visible' })) : b('Скрыть', () => moderate({ answer_id: it.id, status: 'hidden' })),
        it.status === 'visible' && q.type !== 'cloud' ? b(sp === it.id ? 'Убрать с экрана' : 'На весь экран', () => act('toggle', { spotlight: sp === it.id ? 0 : it.id })) : null,
        q.type === 'qa' ? b(it.answered ? 'Вернуть в список' : 'Отвечено', () => moderate({ answer_id: it.id, answered: it.answered ? 0 : 1 })) : null,
        b('Удалить', () => moderate({ answer_id: it.id, delete: 1 }))))));
  }

  function render(r) {
    last = r;
    applyTheme(stage, r.theme);
    if (changed('slides', [r.slides, r.q && r.q.id])) slides.replaceChildren(...(r.slides || []).map((s, i) => h('button', {
      type: 'button', class: 'slide-item' + (r.q && r.q.id === s.id ? ' on live' : ''),
      onclick: () => { if (self) { viewQid = s.id; poll(); } else act('goto', { question_id: s.id }); },
    }, h('span', { class: 'n', text: i + 1 }), h('span', {}, h('span', { class: 't', style: { display: 'block' }, text: s.text || 'Без текста' }), h('span', { class: 'k', text: TYPE_NAMES[s.type] })))));
    counters.replaceChildren(
      h('span', { class: 'counter' }, r.online, h('small', { text: 'в сети' })),
      h('span', { class: 'counter' }, r.joined, h('small', { text: 'всего вошло' })),
      r.data ? h('span', { class: 'counter' }, r.data.answered, h('small', { text: plural(r.data.answered, 'ответил', 'ответили', 'ответили') })) : '',
      r.q && r.q.time_limit && r.phase === 'open' && !self ? h('span', { class: 'tag warn', text: 'Осталось ' + Math.max(0, Math.ceil((r.q.opened_at + r.q.time_limit * 1000 - r.now) / 1000)) + ' с' }) : '',
      !self && r.phase !== 'lobby' && r.phase !== 'finished' ? h('span', { class: 'tag ' + (r.phase === 'open' ? 'live' : 'off'), text: { open: 'Приём открыт', closed: 'Приём закрыт', reveal: 'Ответ показан' }[r.phase] }) : '',
      r.hide_results ? h('span', { class: 'tag warn', text: 'Результаты скрыты от зала' }) : '',
      r.hide_join ? h('span', { class: 'tag off', text: 'Код и QR скрыты' }) : '');
    if (r.q) {
      qText.textContent = r.q.text;
      Viz.render(viz, r.q, r.data, { reveal: true });
    } else {
      qText.textContent = r.phase === 'finished' ? 'Сессия завершена' : 'Зал видит QR-код и код ' + formatCode(code);
      viz._vizKey = null;
      viz.replaceChildren(r.phase === 'finished' && r.leaders && r.leaders.length ? Viz.leaders(r.leaders) : h('div', { class: 'viz-empty', text: r.phase === 'finished' ? 'Спасибо!' : r.joined ? 'Вошло участников: ' + r.joined : 'Откройте большой экран, чтобы зрители могли подключиться' }));
    }
    drawControls(r);
    drawFeed(r);
  }

  async function poll() {
    if (busy) return;
    busy = true;
    try { render(await apiGet('results', { code, host: 1, qid: self ? viewQid : undefined })); } catch (e) { /* следующая попытка через секунду */ }
    busy = false;
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select, button') || e.metaKey || e.ctrlKey || e.altKey || self || !last) return;
    if (e.key === 'ArrowRight') act('goto', { dir: 'next' });
    if (e.key === 'ArrowLeft') act('goto', { dir: 'prev' });
  });

  const screenUrl = 'screen.html?c=' + code;
  app.append(topbar(), h('main', { class: 'page', style: { maxWidth: '1400px' } },
    h('div', { class: 'page-head' },
      h('div', { class: 'row' }, h('h2', { text: session.title }), h('span', { class: 'tag warn code-digits', text: formatCode(code) })),
      h('div', { class: 'row' },
        h('a', { class: 'btn sun', href: screenUrl, target: '_blank', rel: 'noopener', text: 'Открыть большой экран' }),
        h('a', { class: 'btn ghost', href: 'editor.html?id=' + id, text: 'Слайды' }),
        h('a', { class: 'btn ghost', href: 'report.html?id=' + id, text: 'Отчёт' }),
        h('a', { class: 'btn ghost', href: 'api.php?a=export&id=' + id, text: 'Скачать CSV' }),
        h('button', { class: 'btn danger', type: 'button', text: 'Начать заново', onclick: () => confirmBox('Начать сессию заново?', 'Все ответы, участники и очки удалятся. Слайды и код сессии останутся.', 'Удалить ответы и начать заново', () => apiPost('session_reset', { id }).then(poll), true) }))),
    h('div', { class: 'host' },
      h('div', { class: 'stack' }, h('h3', { text: 'Слайды' }), slides),
      h('div', { class: 'stack' }, counters, stage, controls,
        h('p', { class: 'hint' }, 'Слайды переключаются и стрелками ', h('span', { class: 'kbd', text: '←' }), ' ', h('span', { class: 'kbd', text: '→' }), '. На большом экране: ', h('span', { class: 'kbd', text: 'H' }), ' скрывает результаты, ', h('span', { class: 'kbd', text: 'Q' }), ' скрывает код и QR, ', h('span', { class: 'kbd', text: 'F' }), ' включает полный экран.')),
      h('div', { class: 'panel stack' }, feedTitle, feed))));
  poll();
  setInterval(poll, 1000);
})();
