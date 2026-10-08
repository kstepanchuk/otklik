// Итоговый отчёт по сессии: все слайды с результатами, удобно печатать в PDF.
'use strict';

(async () => {
  await requireUser();
  const id = +new URLSearchParams(location.search).get('id');
  const app = $('#app');
  let r;
  try {
    r = await apiGet('report', { id });
  } catch (e) {
    app.append(topbar(), h('main', { class: 'page' }, h('div', { class: 'empty' }, h('h2', { text: 'Отчёт недоступен' }), h('p', { text: e.message }), h('a', { class: 'btn', href: 'dashboard.html', text: 'К списку сессий' }))));
    return;
  }
  document.title = r.session.title + ' — отчёт';
  const date = new Date(r.session.created_at * 1000).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
  const body = h('main', { class: 'report' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { text: r.session.title }), h('p', { class: 'hint', text: 'Создана ' + date + ', код ' + formatCode(r.session.code) })),
      h('div', { class: 'row no-print' },
        h('button', { class: 'btn', text: 'Печать или PDF', onclick: () => window.print() }),
        h('a', { class: 'btn ghost', href: 'api.php?a=export&id=' + id, text: 'Скачать CSV' }),
        h('a', { class: 'btn ghost', href: 'host.html?id=' + id, text: 'К пульту' }))),
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('b', { text: r.joined }), h('span', { text: plural(r.joined, 'участник', 'участника', 'участников') })),
      h('div', { class: 'stat' }, h('b', { text: r.answers }), h('span', { text: plural(r.answers, 'ответ', 'ответа', 'ответов') })),
      h('div', { class: 'stat' }, h('b', { text: r.slides.length }), h('span', { text: plural(r.slides.length, 'слайд', 'слайда', 'слайдов') }))));

  if (r.leaders.length) {
    const box = h('div', { class: 'viz' }, Viz.leaders(r.leaders));
    body.append(h('section', { class: 'report-slide' }, h('h2', { text: 'Таблица лидеров' }), box));
  }
  app.append(topbar(), body);

  r.slides.forEach((s, i) => {
    const viz = h('div', { class: 'viz', 'data-cap': 500 });
    const section = h('section', { class: 'report-slide' },
      h('div', { class: 'row' }, h('span', { class: 'tag', text: (i + 1) + '. ' + TYPE_NAMES[s.q.type] }),
        s.q.type !== 'info' ? h('span', { class: 'hint', text: 'Ответили: ' + s.data.answered }) : ''),
      h('h2', { text: s.q.text || 'Без текста', style: { marginTop: '10px' } }), viz);
    body.append(section);
    // Облаку слов нужны размеры блока, поэтому рисуем после вставки в страницу.
    Viz.render(viz, s.q, s.data, { reveal: true });
  });
  if (!r.slides.length) body.append(h('div', { class: 'empty' }, h('h2', { text: 'В сессии нет слайдов' })));
})();
