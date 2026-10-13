// Итоговый отчёт по сессии: все слайды с результатами, удобно печатать в PDF.
'use strict';

(async () => {
  await requireUser();
  const id = +new URLSearchParams(location.search).get('id');
  const run = +new URLSearchParams(location.search).get('run') || 0;
  const app = $('#app');
  let r;
  try {
    r = await apiGet('report', { id, run: run || undefined });
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
        h('a', { class: 'btn ghost', href: 'api.php?a=export&id=' + id + (run ? '&run=' + run : ''), text: 'Скачать CSV' }),
        h('a', { class: 'btn ghost', href: 'host.html?id=' + id, text: 'К пульту' }))),
    // Запуски: текущий и сохранённые при каждом «Начать заново».
    r.runs && r.runs.length ? h('div', { class: 'tabs no-print', role: 'tablist' },
      h('a', { class: 'btn small ' + (run ? 'ghost' : ''), href: 'report.html?id=' + id, text: 'Текущий запуск' }),
      r.runs.map((x) => h('a', { class: 'btn small ' + (run === x.id ? '' : 'ghost'), href: 'report.html?id=' + id + '&run=' + x.id,
        text: new Date(x.created_at * 1000).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' — ' + x.people + ' чел., ' + x.answers + ' отв.' }))) : null,
    run ? h('p', { class: 'hint', style: { marginBottom: '14px' }, text: 'Это сохранённый прошлый запуск: ответы группы, которая была до нажатия «Начать заново».' }) : null,
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('b', { text: r.joined }), h('span', { text: plural(r.joined, 'участник', 'участника', 'участников') })),
      h('div', { class: 'stat' }, h('b', { text: r.answers }), h('span', { text: plural(r.answers, 'ответ', 'ответа', 'ответов') })),
      h('div', { class: 'stat' }, h('b', { text: r.slides.length }), h('span', { text: plural(r.slides.length, 'слайд', 'слайда', 'слайдов') }))));

  if (r.teams && r.teams.length) body.append(h('section', { class: 'report-slide' }, h('h2', { text: 'Командный зачёт' }), h('div', { class: 'viz' }, Viz.teams(r.teams))));
  if (r.leaders.length) {
    const box = h('div', { class: 'viz' }, Viz.leaders(r.leaders));
    body.append(h('section', { class: 'report-slide' }, h('h2', { text: 'Таблица лидеров' }), box));
  }
  app.append(topbar(), body);

  r.slides.forEach((s, i) => {
    const viz = h('div', { class: 'viz', 'data-cap': 500 });
    const section = h('section', { class: 'report-slide' },
      h('div', { class: 'row' }, h('span', { class: 'tag', text: (i + 1) + '. ' + TYPE_NAMES[s.q.type] }),
        s.q.type !== 'info' ? h('span', { class: 'hint grow', text: 'Ответили: ' + s.data.answered }) : '',
        Poster.SUPPORTED.includes(s.q.type) ? h('button', { class: 'btn small ghost no-print', type: 'button', text: 'Сохранить картинкой', onclick: () => Poster.save(s.q, s.data, r.session.title) }) : ''),
      h('h2', { text: s.q.text || 'Без текста', style: { marginTop: '10px' } }), viz);
    body.append(section);
    // Облаку слов нужны размеры блока, поэтому рисуем после вставки в страницу.
    Viz.render(viz, s.q, s.data, { reveal: true });
  });
  if (!r.slides.length) body.append(h('div', { class: 'empty' }, h('h2', { text: 'В сессии нет слайдов' })));
})();
