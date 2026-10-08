// Отрисовка результатов слайда. Используется на экране, пульте и в отчёте.
// Viz.render вызывается раз в секунду с новыми данными: строит разметку один раз на слайд,
// потом только обновляет значения, чтобы столбцы и слова двигались плавно.
'use strict';

const Viz = (() => {
  const pct = (n, total) => (total ? Math.round((n * 100) / total) : 0);
  // Облако слов меряет ширину слов; когда догружается шрифт, раскладку надо пересчитать.
  let fontEpoch = 0;
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fontEpoch++; });
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => { fontEpoch++; });

  function setup(el, key, build) {
    if (el._vizKey !== key) {
      el._vizKey = key;
      el._viz = {};
      el.replaceChildren();
      build(el._viz);
    }
    return el._viz;
  }

  function empty(el, text) {
    el._vizKey = null;
    el.replaceChildren(h('div', { class: 'viz-empty', text }));
  }

  function hidden(el, n) {
    el._vizKey = null;
    el.replaceChildren(h('div', { class: 'viz-hidden' },
      h('b', { text: n }),
      h('span', { text: plural(n, 'человек ответил', 'человека ответили', 'человек ответили') + '. Результаты откроются после закрытия приёма' })));
  }

  // ----- Опрос и викторина -----
  function bars(el, q, d, o) {
    const withImg = q.options.some((x) => x.img);
    const st = setup(el, 'bars' + q.id + (d.compare ? 'c' : '') + (d.segments ? 's' : '') + (d.leaders ? 'l' : ''), (st) => {
      st.rows = q.options.map((opt, i) => {
        const fill = h('div', { class: 'fill', style: { '--c': COLORS[i % COLORS.length] } });
        const ghost = d.compare ? h('div', { class: 'ghost' }) : null;
        const num = h('div', { class: 'num' });
        const row = h('div', { class: 'bar-row' + (withImg ? ' with-img' : '') },
          withImg ? (opt.img ? h('img', { src: opt.img, alt: '' }) : h('span')) : null,
          h('div', { class: 'lab', text: opt.text || 'Вариант ' + (i + 1) }),
          h('div', { class: 'track' }, fill, ghost), num);
        return { row, fill, ghost, num };
      });
      st.bars = h('div', { class: 'bars' }, st.rows.map((r) => r.row));
      if (d.compare) st.bars.append(h('div', { class: 'legend' }, h('span', {}, h('i'), 'Сейчас'), h('span', {}, h('i', { class: 'was' }), 'В прошлый раз')));
      st.side = h('div');
      st.seg = h('div', { class: 'segments' });
      el.append(h('div', { class: 'viz-stack' }, d.leaders ? h('div', { class: 'split' }, st.bars, st.side) : st.bars, st.seg));
    });
    const total = Math.max(1, d.answered);
    const max = Math.max(1, ...d.counts);
    const cTotal = d.compare ? Math.max(1, d.compare.answered) : 1;
    st.rows.forEach((r, i) => {
      const n = d.counts[i] || 0;
      r.fill.style.width = (n * 100) / (o.relative ? max : total) + '%';
      r.num.replaceChildren(pct(n, total) + '%', h('small', { text: n + ' ' + plural(n, 'голос', 'голоса', 'голосов') }));
      if (r.ghost) r.ghost.style.width = ((d.compare.counts[i] || 0) * 100) / cTotal + '%';
      r.row.classList.toggle('ok', !!(d.correct && o.reveal && d.correct.includes(i)));
    });
    st.bars.classList.toggle('revealed', !!(d.correct && o.reveal));
    if (d.leaders) st.side.replaceChildren(leaders(d.leaders));
    if (d.segments) {
      const head = h('tr', {}, h('th', { text: d.segment_title || '' }), q.options.map((x, i) => h('th', { text: x.text || 'Вариант ' + (i + 1) })));
      const body = d.segments.filter((s) => s.n).map((s) => h('tr', {},
        h('th', { text: s.label + ' (' + s.n + ')' }),
        s.counts.map((c, i) => {
          const p = pct(c, s.n);
          return h('td', { text: p + '%', style: { background: 'color-mix(in srgb, ' + COLORS[i % COLORS.length] + ' ' + Math.max(8, p) + '%, transparent)' } });
        })));
      st.seg.replaceChildren(body.length ? h('table', {}, head, body) : '');
    }
  }

  function leaders(list) {
    if (!list || !list.length) return h('div', { class: 'viz-empty', text: 'Пока никто не набрал очков' });
    return h('div', { class: 'leaders' }, list.map((l, i) => h('div', {}, h('i', { text: i + 1 }), h('span', { text: l.name }), h('b', { text: l.score }))));
  }

  // ----- Открытые ответы -----
  function cards(el, q, d) {
    const st = setup(el, 'cards' + q.id, (st) => {
      st.seen = new Map();
      st.box = h('div', { class: 'cards' });
      el.append(st.box);
    });
    const items = d.items.filter((x) => x.status === 'visible');
    if (!items.length) return empty(el, 'Ответы появятся здесь');
    const ids = new Set(items.map((x) => x.id));
    for (const [id, node] of st.seen) if (!ids.has(id)) { node.remove(); st.seen.delete(id); }
    for (const it of items) {
      if (st.seen.has(it.id)) continue;
      const node = h('div', { class: 'card-a' }, it.text, it.name ? h('small', { text: it.name }) : null);
      st.seen.set(it.id, node);
      st.box.prepend(node);
    }
    // На экране держим последние ответы, которые помещаются; старые уходят.
    const cap = el.dataset.cap ? +el.dataset.cap : 40;
    while (st.box.children.length > cap) {
      const last = st.box.lastElementChild;
      for (const [id, node] of st.seen) if (node === last) st.seen.delete(id);
      last.remove();
    }
  }

  function qa(el, q, d) {
    const items = d.items.filter((x) => x.status === 'visible').sort((a, b) => a.answered - b.answered || b.likes - a.likes || a.id - b.id);
    if (!items.length) return empty(el, 'Задайте вопрос с телефона — он появится здесь');
    el._vizKey = 'qa' + q.id;
    el.replaceChildren(h('div', { class: 'qa-list' }, items.slice(0, +el.dataset.cap || 8).map((it) => h('div', { class: 'qa-item' + (it.answered ? ' done' : '') },
      h('div', { class: 'likes' }, it.likes, h('small', { text: plural(it.likes, 'лайк', 'лайка', 'лайков') })),
      h('div', {}, it.text, it.name ? h('small', { text: ' — ' + it.name, style: { opacity: .6 } }) : null)))));
  }

  // ----- Облако слов: раскладка по спирали от центра -----
  function cloud(el, q, d) {
    if (!d.words.length) return empty(el, 'Слова появятся здесь');
    const st = setup(el, 'cloud' + q.id, (st) => {
      st.nodes = new Map();
      st.box = h('div', { class: 'cloud' });
      st.sig = '';
      el.append(st.box);
    });
    const W = st.box.clientWidth, H = st.box.clientHeight;
    const sig = fontEpoch + ':' + W + 'x' + H + d.words.map((w) => w.w + w.n).join('|');
    if (sig === st.sig || !W || !H) return;
    st.sig = sig;
    const maxN = d.words[0].n;
    const base = Math.max(14, Math.min(W, H * 1.6) / 22);
    const present = new Set(d.words.map((w) => w.w));
    for (const [w, node] of st.nodes) if (!present.has(w)) { node.remove(); st.nodes.delete(w); }
    const placed = [];
    d.words.forEach((word, i) => {
      let node = st.nodes.get(word.w);
      if (!node) {
        node = h('span', { text: word.w, style: { color: COLORS[i % 6], transform: `translate(${W / 2}px, ${H / 2}px)`, opacity: 0 } });
        st.nodes.set(word.w, node);
        st.box.append(node);
      }
      const size = base * (0.75 + 1.9 * Math.sqrt(word.n / maxN) * (d.words.length > 25 ? 0.8 : 1));
      node.style.fontSize = size + 'px';
      const w = node.offsetWidth + 14, hh = node.offsetHeight + 8;
      let x = 0, y = 0, ok = false;
      for (let t = 0; t < 900 && !ok; t += 0.35) {
        x = W / 2 + 4.2 * t * Math.cos(t) * (W / H > 1.4 ? 1.7 : 1) - w / 2;
        y = H / 2 + 4.2 * t * Math.sin(t) - hh / 2;
        ok = x >= 0 && y >= 0 && x + w <= W && y + hh <= H && !placed.some((p) => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + hh > p.y);
      }
      node.style.opacity = ok ? 1 : 0;
      if (ok) {
        placed.push({ x, y, w, h: hh });
        node.style.transform = `translate(${x + 7}px, ${y + 4}px)`;
      }
    });
  }

  // ----- Столбцы: шкала, число, NPS -----
  function columns(values, labels, opts = {}) {
    const max = Math.max(1, ...values);
    return h('div', { class: 'cols' }, values.map((v, i) => h('div', { class: 'col' + (opts.mark === i ? ' mark' : '') },
      h('b', { text: v || '' }),
      h('i', { style: { height: (v * 100) / max + '%', '--c': opts.color ? opts.color(i) : 'var(--c1)' } }),
      h('span', { text: labels[i] }))));
  }

  function scale(el, q, d) {
    el._vizKey = 'scale' + q.id;
    const labels = d.dist.map((_, i) => d.min + i);
    const s = q.s || {};
    el.replaceChildren(h('div', { class: 'scale-viz' },
      h('div', { class: 'big-num' }, h('b', { text: d.avg === null ? '–' : String(d.avg).replace('.', ',') }), h('span', { text: 'средняя оценка' }),
        d.compare && d.compare.avg !== null ? h('span', { text: 'в прошлый раз ' + String(d.compare.avg).replace('.', ',') }) : null),
      h('div', {}, columns(d.dist, labels),
        (s.label_min || s.label_max) ? h('div', { class: 'axis-labels' }, h('span', { text: s.label_min || '' }), h('span', { text: s.label_max || '' })) : null)));
  }

  function nps(el, q, d) {
    el._vizKey = 'nps' + q.id;
    const color = (i) => (i <= 6 ? 'var(--coral)' : i <= 8 ? 'var(--sun)' : 'var(--mint)');
    el.replaceChildren(h('div', { class: 'scale-viz' },
      h('div', { class: 'big-num' }, h('b', { text: d.nps === null ? '–' : d.nps }), h('span', { text: 'индекс NPS' })),
      h('div', { class: 'stack' }, columns(d.dist, d.dist.map((_, i) => i), { color }),
        d.items.length ? h('div', { class: 'comments' }, d.items.filter((x) => x.status === 'visible').slice(-4).map((x) => h('div', { text: x.text }))) : null)));
  }

  function number(el, q, d, o) {
    el._vizKey = 'number' + q.id;
    if (!d.values.length) return empty(el, 'Ответы появятся здесь');
    const lo = d.values[0], hi = d.values[d.values.length - 1];
    const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('ru') : String(Math.round(v * 100) / 100).replace('.', ','));
    let values, labels, mark = -1;
    if (lo === hi) {
      values = [d.values.length]; labels = [fmt(lo)];
    } else {
      const bins = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(d.values.length))));
      const step = (hi - lo) / bins;
      values = new Array(bins).fill(0);
      const at = (v) => Math.min(bins - 1, Math.floor((v - lo) / step));
      d.values.forEach((v) => values[at(v)]++);
      labels = values.map((_, i) => fmt(lo + step * i) + '–' + fmt(lo + step * (i + 1)));
      if (o.reveal && d.correct !== undefined && d.correct >= lo && d.correct <= hi) mark = at(d.correct);
    }
    const side = o.reveal && d.correct !== undefined
      ? h('div', { class: 'big-num' }, h('b', { text: fmt(d.correct) }), h('span', { text: 'верный ответ' }),
        d.closest && d.closest.length ? h('div', { class: 'leaders' }, d.closest.map((c, i) => h('div', {}, h('i', { text: i + 1 }), h('span', { text: c.name }), h('b', { text: fmt(c.value) })))) : null)
      : h('div', { class: 'big-num' }, h('b', { text: d.values.length }), h('span', { text: plural(d.values.length, 'ответ', 'ответа', 'ответов') }));
    el.replaceChildren(h('div', { class: 'scale-viz' }, side, columns(values, labels, { mark })));
  }

  function rank(el, q, d) {
    el._vizKey = 'rank' + q.id;
    if (!d.answered) return empty(el, 'Ответы появятся здесь');
    const n = q.options.length;
    const order = q.options.map((opt, i) => ({ opt, i, avg: d.avg[i] })).sort((a, b) => a.avg - b.avg);
    el.replaceChildren(h('div', { class: 'rank-list' }, order.map((r, pos) => h('div', { class: 'rank-row bar-row' },
      h('div', { class: 'pos', text: pos + 1 }),
      h('div', { class: 'lab', text: r.opt.text || 'Вариант ' + (r.i + 1) }),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: { '--c': COLORS[r.i % COLORS.length], width: ((n - r.avg + 1) * 100) / n + '%' } })),
      h('div', { class: 'num' }, String(r.avg).replace('.', ','), h('small', { text: 'среднее место' }))))));
  }

  function pin(el, q, d) {
    const st = setup(el, 'pin' + q.id + (q.s.image || ''), (st) => {
      st.wrap = h('div', { class: 'pin-wrap' }, q.s.image ? h('img', { src: q.s.image, alt: '' }) : h('div', { class: 'viz-empty', text: 'Картинка не загружена' }));
      st.n = 0;
      el.append(h('div', { class: 'pin-center' }, st.wrap));
    });
    if (d.points.length < st.n) { $$('.pin-dot', st.wrap).forEach((x) => x.remove()); st.n = 0; }
    d.points.slice(st.n).forEach(([x, y]) => st.wrap.append(h('div', { class: 'pin-dot', style: { left: x * 100 + '%', top: y * 100 + '%' } })));
    st.n = d.points.length;
  }

  function info(el, q) {
    el._vizKey = 'info' + q.id;
    el.replaceChildren(h('div', { class: 'info-wrap' + (q.s.image ? ' with-img' : '') }, q.s.body ? h('div', { class: 'info-body', text: q.s.body }) : null, q.s.image ? h('img', { class: 'info-img', src: q.s.image, alt: '' }) : null));
  }

  /** o: { reveal, hidden } */
  function render(el, q, d, o = {}) {
    if (!q || !d) return empty(el, '');
    if (o.hidden && !['info', 'qa'].includes(q.type)) return hidden(el, d.answered);
    switch (q.type) {
      case 'poll': case 'quiz': return bars(el, q, d, o);
      case 'open': return cards(el, q, d);
      case 'qa': return qa(el, q, d);
      case 'cloud': return cloud(el, q, d);
      case 'scale': return scale(el, q, d);
      case 'nps': return nps(el, q, d);
      case 'number': return number(el, q, d, o);
      case 'rank': return rank(el, q, d);
      case 'pin': return pin(el, q, d);
      case 'info': return info(el, q);
    }
  }

  return { render, leaders };
})();
