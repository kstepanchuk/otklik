// Кликер: пульт с крупными кнопками для телефона ведущего.
'use strict';

(async () => {
  await requireUser();
  const id = +new URLSearchParams(location.search).get('id');
  const app = $('#app');
  let session, last = null, busy = false;
  try { session = (await apiGet('session_get', { id })).session; } catch (e) {
    app.append(h('main', { class: 'remote' }, h('p', { text: 'Сессия не найдена.' }), h('a', { class: 'btn', href: 'dashboard.html', text: 'К списку сессий' })));
    return;
  }
  const status = h('div', { class: 'remote-status' }), slide = h('div', { class: 'remote-slide' }), extra = h('div', { class: 'row' });
  const act = async (action, data) => {
    try { await apiPost(action, { session_id: id, ...data }); if (navigator.vibrate) navigator.vibrate(30); await poll(); } catch (e) { oops(e); }
  };
  // «Дальше» ведёт себя как стрелка на экране: в викторине сначала показывает верный ответ.
  const forward = () => {
    const r = last;
    if (r && r.q && ['quiz', 'number'].includes(r.q.type) && ['open', 'closed'].includes(r.phase)) return act('phase', { phase: 'reveal' });
    return act('goto', { dir: 'next' });
  };
  const next = h('button', { class: 'btn big remote-next', type: 'button', onclick: forward });
  const prev = h('button', { class: 'btn big ghost', type: 'button', text: 'Назад', onclick: () => act('goto', { dir: 'prev' }) });

  function render(r) {
    last = r;
    const phase = { lobby: 'Зал видит QR-код', open: 'Приём ответов открыт', closed: 'Приём закрыт', reveal: 'Ответ показан', finished: 'Сессия завершена' }[r.phase];
    status.replaceChildren(h('b', { text: r.index ? r.index + ' из ' + r.total : session.title }), h('span', { text: phase + (r.data ? ' — ответили ' + r.data.answered + ' из ' + r.joined : r.joined ? ' — вошло ' + r.joined : '') }));
    const coming = r.slides && r.phase !== 'finished' ? r.slides[r.index] : null;
    slide.replaceChildren(h('div', { class: 'now', text: r.q ? (r.q.text || TYPE_NAMES[r.q.type]) : phase }),
      coming ? h('div', { class: 'hint', text: 'Дальше: ' + TYPE_NAMES[coming.type] + (coming.text ? ' — ' + coming.text : '') }) : null);
    const scored = r.q && ['quiz', 'number'].includes(r.q.type) && ['open', 'closed'].includes(r.phase);
    next.textContent = r.phase === 'lobby' ? 'Начать' : scored ? 'Показать ответ' : r.phase === 'finished' ? 'Сессия завершена' : r.index === r.total ? 'Завершить' : 'Дальше';
    next.disabled = r.phase === 'finished' || !r.total;
    prev.disabled = r.phase === 'lobby';
    const b = (label, fn) => h('button', { class: 'btn ghost', type: 'button', text: label, onclick: fn });
    extra.replaceChildren(...(r.q && r.q.type !== 'info' && r.phase !== 'finished' ? [
      r.phase === 'open' ? b('Закрыть приём', () => act('phase', { phase: 'closed' })) : b('Открыть приём', () => act('phase', { phase: 'open' })),
      b(r.hide_results ? 'Показать результаты' : 'Скрыть результаты', () => act('toggle', { hide_results: r.hide_results ? 0 : 1 })),
    ] : []));
  }
  async function poll() {
    if (busy) return;
    busy = true;
    try { render(await apiGet('results', { code: session.code, host: 1 })); } catch (e) { /* следующая попытка через секунду */ }
    busy = false;
  }
  app.append(h('main', { class: 'remote' }, status, slide, extra, h('div', { class: 'remote-buttons' }, prev, next),
    h('a', { class: 'hint', href: 'host.html?id=' + id, text: 'Открыть полный пульт' })));
  poll();
  setInterval(poll, 1000);
})();
