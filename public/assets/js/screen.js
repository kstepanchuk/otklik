// Большой экран: QR и код в лобби, живые результаты на слайдах.
'use strict';

(() => {
  const params = new URLSearchParams(location.search);
  const code = (params.get('c') || '').replace(/\D/g, '');
  const root = $('#root'), main = $('#main');
  const joinUrl = new URL('play.html?c=' + code, location.href).href;
  const site = (location.host + location.pathname.replace(/\/[^/]*$/, '')).replace(/\/$/, '');
  let last = null, offset = 0, view = '', busy = false, selfIdx = -1, reactSeen = null, beeped = 0, audio = null;

  if (params.get('embed')) root.classList.add('embed');
  if (!code) { main.append(h('div', { class: 'viz-empty', text: 'В адресе нет кода сессии. Откройте экран из кабинета.' })); return; }

  function buildMini() {
    $('#mini').replaceChildren(
      h('div', { class: 'where' }, h('b', { text: site }), 'код сессии'),
      h('div', { class: 'code-digits', text: formatCode(code) }),
      qrSvg(joinUrl));
  }

  function lobby(r) {
    if (view !== 'lobby') {
      view = 'lobby';
      main.replaceChildren(h('div', { class: 'lobby' }, h('div', { class: 'plate lobby-plate' },
        qrSvg(joinUrl),
        h('div', {},
          h('div', { class: 'step' }, 'Наведите камеру на QR-код', h('br'), 'или откройте ', h('b', { text: site }), ' и введите код'),
          h('div', { class: 'code-digits', text: formatCode(code) }),
          h('div', { class: 'joined', id: 'joined' })))));
    }
    $('#joined').textContent = r.joined
      ? 'Уже здесь: ' + r.joined + ' ' + plural(r.joined, 'участник', 'участника', 'участников')
      : 'Ждём первых участников';
  }

  function finished(r) {
    view = 'finished';
    main.replaceChildren(h('div', { class: 'finish' }, h('h1', { text: 'Спасибо!' }),
      r.leaders && r.leaders.length ? Viz.leaders(r.leaders) : h('p', { class: 'info-body', text: 'Сессия завершена' })));
  }

  function question(r) {
    const key = 'q' + r.q.id;
    if (view !== key) {
      view = key;
      main.replaceChildren(h('div', { class: 'q-text', id: 'qtext' }), h('div', { class: 'viz', id: 'viz' }));
    }
    $('#qtext').textContent = r.q.text;
    const reveal = r.phase === 'reveal' || r.phase === 'finished';
    Viz.render($('#viz'), r.q, r.data, { reveal, hidden: !!r.hide_results && r.phase === 'open' });
  }

  function render(r) {
    last = r;
    offset = r.now - Date.now();
    applyTheme(root, r.theme);
    $('#title').replaceChildren(r.theme.logo ? h('img', { src: r.theme.logo, alt: '' }) : '', r.title);
    document.title = r.title + ' — экран';

    const self = r.mode === 'self';
    const showLobby = self ? selfIdx < 0 : r.phase === 'lobby' || !r.q;
    if (r.phase === 'finished' && !self) finished(r);
    else if (showLobby) lobby(r);
    else question(r);
    $('#mini').hidden = view === 'lobby';

    $('#counts').replaceChildren(
      h('b', { text: r.online }), 'в сети',
      r.data && view.startsWith('q') && r.q.type !== 'info' ? h('span', {}, ' ', h('b', { text: r.data.answered }), plural(r.data.answered, 'ответил', 'ответили', 'ответили')) : '');
    $('#index').textContent = r.index ? r.index + ' из ' + r.total : '';
    if (r.owner && !$('#keys').childElementCount) {
      $('#keys').replaceChildren(h('span', { class: 'kbd', text: '→' }), ' дальше ', h('span', { class: 'kbd', text: 'H' }), ' скрыть результаты ', h('span', { class: 'kbd', text: 'F' }), ' во весь экран');
    }

    let sp = $('.spotlight');
    if (r.spotlight) {
      if (!sp) root.append(sp = h('div', { class: 'spotlight' }));
      sp.replaceChildren(h('blockquote', {}, r.spotlight.text, r.spotlight.name ? h('cite', { text: r.spotlight.name }) : null));
    } else if (sp) sp.remove();

    const counts = r.reactions || {};
    if (reactSeen) {
      let budget = 14;
      for (const [emoji, n] of Object.entries(counts)) {
        for (let i = Math.min(n - (reactSeen[emoji] || 0), budget); i > 0; i--, budget--) fly(emoji);
      }
    }
    reactSeen = counts;
  }

  function fly(emoji) {
    const el = h('div', { class: 'fly', text: emoji, style: { left: 8 + Math.random() * 84 + 'vw', '--dx': (Math.random() * 16 - 8) + 'vw', animationDelay: Math.random() * 0.6 + 's' } });
    root.append(el);
    setTimeout(() => el.remove(), 4200);
  }

  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.09);
    } catch (e) { /* звук недоступен до первого нажатия — не страшно */ }
  }

  function tickTimer() {
    const t = $('#timer'), r = last;
    if (!r || !r.q || !r.q.time_limit || r.phase !== 'open' || r.mode === 'self') { t.hidden = true; return; }
    const left = Math.max(0, Math.ceil((r.q.opened_at + r.q.time_limit * 1000 - (Date.now() + offset)) / 1000));
    t.hidden = false;
    t.textContent = left;
    t.classList.toggle('hot', left <= 5);
    if (left <= 5 && left > 0 && beeped !== left) { beeped = left; beep(); }
  }

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const q = {};
      if (last && last.mode === 'self' && selfIdx >= 0 && last.slides[selfIdx]) q.qid = last.slides[selfIdx].id;
      render(await apiGet('results', { code, ...q }));
    } catch (e) {
      if (e.status === 404) { view = ''; main.replaceChildren(h('div', { class: 'viz-empty', text: e.message })); }
    }
    busy = false;
  }

  async function act(action, data) {
    try { await apiPost(action, { session_id: last.id, ...data }); await poll(); } catch (e) { oops(e); }
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'f' || k === 'а') {
      if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen().catch(() => {});
      return;
    }
    if (!last) return;
    const fwd = e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown';
    const back = e.key === 'ArrowLeft' || e.key === 'PageUp';
    if (last.mode === 'self') {
      if (fwd) selfIdx = Math.min(selfIdx + 1, last.slides.length - 1);
      if (back) selfIdx = Math.max(selfIdx - 1, -1);
      if (fwd || back) { e.preventDefault(); poll(); }
      return;
    }
    if (!last.owner) return;
    if (fwd) {
      e.preventDefault();
      // Викторина и «угадай число» идут в два шага: сначала верный ответ, потом следующий слайд.
      if (last.phase !== 'reveal' && last.q && ['quiz', 'number'].includes(last.q.type) && ['open', 'closed'].includes(last.phase)) act('phase', { phase: 'reveal' });
      else act('goto', { dir: 'next' });
    } else if (back) {
      e.preventDefault();
      act('goto', { dir: 'prev' });
    } else if (k === 'h' || k === 'р') {
      act('toggle', { hide_results: last.hide_results ? 0 : 1 });
    }
  });

  buildMini();
  apiGet('whoami').then((me) => { App.csrf = me.csrf; }).catch(() => {});
  poll();
  setInterval(poll, 1000);
  setInterval(tickTimer, 250);
})();
