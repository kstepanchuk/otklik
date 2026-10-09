// Сохранение слайда картинкой: итог рисуется на холсте 1920×1080 и скачивается как PNG.
'use strict';

const Poster = (() => {
  const W = 1920, H = 1080, P = 90;
  const INK = '#1b1642', FG = '#ffffff', DIM = 'rgba(255,255,255,.66)', SOFT = 'rgba(255,255,255,.1)', SUN = '#ffc83d';
  const PALETTE = ['#4b3bff', '#ff7a59', '#12b886', '#ffc83d', '#e64fb5', '#2bb5e8', '#8a5cf6', '#f0484e', '#7bc74d', '#ff9f1c'];
  const SUPPORTED = ['open', 'qa', 'cloud', 'poll', 'quiz', 'scale', 'rank', 'nps'];

  function lines(ctx, text, maxW, maxLines) {
    const out = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
    }
    if (line) out.push(line);
    if (maxLines && out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/.{0,2}$/, '…'); }
    return out;
  }
  function box(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawCards(ctx, list, top) {
    const cols = 3, gap = 24, w = (W - 2 * P - gap * (cols - 1)) / cols, pad = 26;
    const ys = new Array(cols).fill(top);
    let shown = 0;
    for (const g of list) {
      ctx.font = '500 30px "Golos Text", sans-serif';
      const ls = lines(ctx, g.text, w - 2 * pad, 6);
      const meta = [g.n > 1 ? '×' + g.n : '', g.likes ? '♥ ' + g.likes : ''].filter(Boolean).join('   ');
      const h = pad * 2 + ls.length * 40 + (meta ? 34 : 0);
      const c = ys.indexOf(Math.min(...ys));
      if (ys[c] + h > H - 110) break;
      const x = P + c * (w + gap), accent = shown % 5 === 0;
      box(ctx, x, ys[c], w, h, 22, accent ? SUN : SOFT);
      ctx.fillStyle = accent ? INK : FG;
      ls.forEach((l, i) => ctx.fillText(l, x + pad, ys[c] + pad + 30 + i * 40));
      if (meta) { ctx.font = '500 22px "Golos Text", sans-serif'; ctx.globalAlpha = .7; ctx.fillText(meta, x + pad, ys[c] + h - pad + 2); ctx.globalAlpha = 1; }
      ys[c] += h + gap;
      shown++;
    }
    return list.length - shown;
  }

  function drawBars(ctx, rows, top) {
    const rowH = Math.min(110, (H - top - 120) / Math.max(1, rows.length)), labelW = 520, numW = 170, barX = P + labelW + 30, barW = W - P - numW - barX;
    const max = Math.max(1, ...rows.map((r) => r.share));
    rows.forEach((r, i) => {
      const y = top + i * rowH, bh = Math.min(64, rowH - 22);
      ctx.fillStyle = r.dim ? DIM : FG;
      ctx.font = '600 32px "Golos Text", sans-serif';
      ctx.fillText(lines(ctx, r.label, labelW, 1)[0] || '', P, y + bh / 2 + 11);
      box(ctx, barX, y, barW, bh, 16, 'rgba(255,255,255,.06)');
      if (r.share > 0) box(ctx, barX, y, Math.max(16, barW * (r.relative ? r.share / max : r.share)), bh, 16, r.color);
      ctx.fillStyle = r.dim ? DIM : FG;
      ctx.font = '700 36px "Unbounded", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(r.value, W - P, y + bh / 2 + 13);
      ctx.textAlign = 'left';
    });
  }

  function drawCloud(ctx, words, top) {
    const maxN = words[0].n, area = H - top - 120;
    let size = 120, placed;
    // Подбираем размер, при котором все слова помещаются по высоте.
    for (; size >= 36; size -= 8) {
      placed = [];
      let x = 0, y = 0, lineH = 0, row = [];
      for (const w of words) {
        const fs = Math.round(size * (0.42 + 0.58 * Math.sqrt(w.n / maxN)));
        ctx.font = '700 ' + fs + 'px "Unbounded", sans-serif';
        const ww = ctx.measureText(w.w).width + fs * 0.5;
        if (x + ww > W - 2 * P && row.length) { placed.push({ row, width: x, h: lineH }); row = []; x = 0; y += lineH; lineH = 0; }
        row.push({ w: w.w, fs, ww });
        x += ww;
        lineH = Math.max(lineH, fs * 1.25);
      }
      placed.push({ row, width: x, h: lineH });
      if (y + lineH <= area) break;
    }
    let y = top + (area - placed.reduce((a, r) => a + r.h, 0)) / 2, k = 0;
    for (const r of placed) {
      let x = (W - r.width) / 2;
      for (const it of r.row) {
        ctx.font = '700 ' + it.fs + 'px "Unbounded", sans-serif';
        ctx.fillStyle = PALETTE[k++ % 6];
        ctx.fillText(it.w, x, y + r.h * 0.78);
        x += it.ww;
      }
      y += r.h;
    }
  }

  async function save(q, d, title) {
    if (!q || !d || !SUPPORTED.includes(q.type)) { toast('Для этого типа слайда откройте отчёт и сохраните его в PDF', true); return; }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    box(ctx, 0, 0, W, H, 0, INK);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = DIM;
    ctx.font = '500 28px "Unbounded", sans-serif';
    ctx.fillText(lines(ctx, title || '', W - 2 * P, 1)[0] || '', P, 96);
    ctx.fillStyle = FG;
    ctx.font = '700 60px "Unbounded", sans-serif';
    const head = lines(ctx, q.text || '', W - 2 * P, 3);
    head.forEach((l, i) => ctx.fillText(l, P, 190 + i * 72));
    const top = 190 + head.length * 72 + 10;
    const opt = (i) => (q.options[i] && q.options[i].text) || 'Вариант ' + (i + 1);
    const total = Math.max(1, d.answered);
    let more = 0;

    if (q.type === 'open') more = drawCards(ctx, Viz.cardList(q, d), top);
    if (q.type === 'qa') more = drawCards(ctx, d.items.filter((x) => x.status === 'visible').sort((a, b) => b.likes - a.likes).map((x) => ({ text: x.text, n: 1, likes: x.likes })), top);
    if (q.type === 'cloud') { if (d.words.length) drawCloud(ctx, d.words, top); }
    if (q.type === 'poll' || q.type === 'quiz') {
      drawBars(ctx, d.counts.map((n, i) => ({ label: opt(i), share: n / total, value: Math.round((n * 100) / total) + '%', color: PALETTE[i % 10], dim: !!(d.correct && !d.correct.includes(i)) })), top + 30);
    }
    if (q.type === 'scale' || q.type === 'nps') {
      const first = q.type === 'nps' ? 0 : d.min;
      ctx.fillStyle = SUN;
      ctx.font = '700 150px "Unbounded", sans-serif';
      const big = q.type === 'nps' ? (d.nps === null ? '–' : String(d.nps)) : (d.avg === null ? '–' : String(d.avg).replace('.', ','));
      ctx.fillText(big, P, top + 150);
      ctx.fillStyle = DIM;
      ctx.font = '500 30px "Golos Text", sans-serif';
      ctx.fillText(q.type === 'nps' ? 'индекс NPS' : 'средняя оценка', P + ctx.measureText('').width, top + 200);
      drawBars(ctx, d.dist.map((n, i) => ({ label: String(first + i), share: n, relative: true, value: String(n), color: q.type === 'nps' ? (first + i <= 6 ? '#f0484e' : first + i <= 8 ? SUN : '#12b886') : PALETTE[0] })).map((r) => r), top + 240);
    }
    if (q.type === 'rank') {
      const n = q.options.length;
      const order = q.options.map((_, i) => ({ i, avg: d.avg[i] })).filter((r) => r.avg !== null).sort((a, b) => a.avg - b.avg);
      drawBars(ctx, order.map((r, pos) => ({ label: (pos + 1) + '. ' + opt(r.i), share: (n - r.avg + 1) / n, value: String(r.avg).replace('.', ','), color: PALETTE[r.i % 10] })), top + 30);
    }

    ctx.fillStyle = DIM;
    ctx.font = '500 26px "Golos Text", sans-serif';
    ctx.fillText('Ответили: ' + d.answered + (more > 0 ? '. Ещё ответов не поместилось: ' + more : ''), P, H - 60);
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }), W - P, H - 60);
    ctx.textAlign = 'left';

    c.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (q.text || 'слайд').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) + '.png';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  return { save, SUPPORTED };
})();
