'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — motivos para voltar todo dia:
//  registro de leitura do dia (sequência 🔥) e retrospectiva em imagem.
//  Regras puras em lib/community.js (CLC).
// ============================================================

const READING_LOG_DAYS = 120;          // dias lidos para calcular a sequência
const WEEK_DAYS = 7;
const MAX_PAGES_PER_DAY = 5000;        // mesmo limite das regras do Firestore
const WRAPPED_W = 1080;                // tamanho de post do Instagram (4:5)
const WRAPPED_H = 1350;

let READING_LOGS = [];                 // [{ day: 'AAAA-MM-DD', pages }]

// ════════════════════════════════════════════════════════════
//  SEQUÊNCIA DE LEITURA
// ════════════════════════════════════════════════════════════

function readingLogRef() {
  return db.collection('users').doc(APP_USER.uid).collection('readingLog');
}

async function loadReadingLog() {
  if (!APP_USER || !FIREBASE_CONFIGURED) return;
  try {
    const snap = await readingLogRef()
      .orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(READING_LOG_DAYS).get();
    READING_LOGS = snap.docs.map(d => ({ day: d.id, pages: Number(d.data().pages) || 0 }));
  } catch (err) {
    console.error('Erro ao carregar o registro de leitura:', err);
  }
  renderStreak();
}

function renderStreak() {
  const label = document.getElementById('streak-label');
  const pages = document.getElementById('streak-pages');
  if (!label || !pages) return;
  const today = new Date();
  const s = CLC.readingStreak(READING_LOGS.map(l => l.day), today);
  const week = CLC.pagesInLastDays(READING_LOGS, today, WEEK_DAYS);
  label.textContent = CLC.streakLabel(s.current);
  const record = s.longest > s.current ? ` · recorde: ${s.longest} dias` : '';
  pages.textContent = `${week} ${week === 1 ? 'página' : 'páginas'} nos últimos 7 dias${record}`;
}

/** Soma as páginas lidas agora ao registro de hoje (até 5000 por dia). @returns {Promise<boolean>} */
async function logPagesToday(pages) {
  const day = CLC.dayKey(new Date());
  const already = (READING_LOGS.find(l => l.day === day) || {}).pages || 0;
  const n = Math.min(Math.floor(Number(pages) || 0), MAX_PAGES_PER_DAY - already);
  if (n <= 0 || !APP_USER) return true;
  try {
    await readingLogRef().doc(day).set({
      pages: firebase.firestore.FieldValue.increment(n),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    const prev = READING_LOGS.find(l => l.day === day);
    READING_LOGS = prev
      ? READING_LOGS.map(l => (l.day === day ? { ...l, pages: l.pages + n } : l))
      : [{ day, pages: n }, ...READING_LOGS];
    renderStreak();
    return true;
  } catch (err) {
    console.error('Erro ao registrar a leitura do dia:', err);
    showToast('Não deu para registrar a leitura de hoje 😕');
    return false;
  }
}

function readingBooks() {
  return Object.values(MY_LIBRARY).filter(b => b.status === 'reading');   // db.js
}

function openReadingLog() {
  const body = document.getElementById('log-body');
  const books = readingBooks();
  body.innerHTML = books.length
    ? books.map(logRowHtml).join('') + '<button class="bp-btn log-save" onclick="saveReadingLog()">Salvar leitura</button>'
    : `<p class="muted-small">Você não tem livros na estante "Lendo". Adicione um pela aba Lendo do seu perfil.</p>`;
  openSheet('sh-log');
}

function logRowHtml(b) {
  const total = Number(b.totalPages) || 0;
  return `
    <div class="log-row">
      <span class="log-title"><strong>${escHtml(b.title)}</strong><small>${escHtml(b.author || '')}</small></span>
      <label class="log-page">pág.
        <input type="number" min="0" ${total ? `max="${total}"` : ''} inputmode="numeric" class="ep-input"
          data-id="${escHtml(b.id)}" value="${Number(b.currentPage) || ''}" aria-label="Página atual de ${escHtml(b.title)}"/>
        ${total ? `de ${total}` : ''}
      </label>
    </div>`;
}

/** Lê os campos da janela: só os livros cuja página mudou. */
function readingLogChanges() {
  return [...document.querySelectorAll('#log-body input[data-id]')]
    .map(input => ({ input, book: MY_LIBRARY[input.dataset.id] }))
    .filter(({ book }) => Boolean(book))
    .map(({ input, book }) => {
      const page = CL.readingProgress(input.value, book.totalPages || input.value).current;
      return { book, page, delta: CLC.pagesDelta(book.currentPage, page) };
    })
    .filter(c => c.page !== (Number(c.book.currentPage) || 0));
}

async function saveReadingLog() {
  const changes = readingLogChanges();
  if (!changes.length) { closeSheet('sh-log'); return; }
  try {
    const batch = db.batch();
    changes.forEach(c => batch.update(readingLogLibraryRef(c.book.id), { currentPage: c.page }));
    await batch.commit();
    const logged = await logPagesToday(changes.reduce((sum, c) => sum + c.delta, 0));
    closeSheet('sh-log');
    if (logged) showToast('Leitura registrada! 🔥');
  } catch (err) {
    console.error('Erro ao salvar a leitura:', err);
    showToast('Erro ao salvar a leitura 😕');
  }
}

function readingLogLibraryRef(bookId) {
  return db.collection('users').doc(APP_USER.uid).collection('library').doc(bookId);
}

// ════════════════════════════════════════════════════════════
//  RETROSPECTIVA EM IMAGEM
// ════════════════════════════════════════════════════════════

function wrappedSummary() {
  return CL.yearInReview({ books: Object.values(MY_LIBRARY), posts: MY_POSTS_CACHE, year: new Date().getFullYear() });   // features.js
}

/** Desenha o cartão 1080×1350 da retrospectiva. @returns {HTMLCanvasElement} */
function drawWrapped(r) {
  const canvas = document.createElement('canvas');
  canvas.width = WRAPPED_W;
  canvas.height = WRAPPED_H;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, WRAPPED_W, WRAPPED_H);
  bg.addColorStop(0, '#1B5E20');
  bg.addColorStop(0.6, '#2E7D32');
  bg.addColorStop(1, '#43A047');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WRAPPED_W, WRAPPED_H);

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.font = '600 44px Inter, sans-serif';
  ctx.fillText('Minha retrospectiva', WRAPPED_W / 2, 150);
  ctx.font = '700 150px Lora, Georgia, serif';
  ctx.fillText(String(r.year), WRAPPED_W / 2, 310);
  drawWrappedStats(ctx, r);

  ctx.font = '500 38px Inter, sans-serif';
  const lines = [
    r.bestBook ? `Melhor leitura: ${r.bestBook}` : '',
    r.topAuthor ? `Autor do ano: ${r.topAuthor}` : '',
    r.busiestMonth ? `Mês mais lido: ${r.busiestMonth}` : '',
  ].filter(Boolean);
  lines.forEach((line, i) => ctx.fillText(fitText(ctx, line, WRAPPED_W - 140), WRAPPED_W / 2, 1000 + i * 60));

  ctx.font = '700 40px Lora, Georgia, serif';
  ctx.fillText('Cantinho Literário', WRAPPED_W / 2, WRAPPED_H - 90);
  return canvas;
}

function drawWrappedStats(ctx, r) {
  const stats = [
    ['📚', r.booksRead, 'livros lidos'], ['📄', r.pagesRead, 'páginas'],
    ['⭐', r.averageRating ? r.averageRating.toFixed(1) : '–', 'nota média'], ['✍️', r.reviewsWritten, 'resenhas'],
  ];
  stats.forEach(([icon, value, label], i) => {
    const x = i % 2 === 0 ? WRAPPED_W * 0.3 : WRAPPED_W * 0.7;
    const y = 470 + Math.floor(i / 2) * 230;
    ctx.font = '64px sans-serif';
    ctx.fillText(icon, x, y);
    ctx.font = '700 86px Inter, sans-serif';
    ctx.fillText(String(value), x, y + 100);
    ctx.font = '500 36px Inter, sans-serif';
    ctx.fillText(label, x, y + 150);
  });
}

/** Corta o texto com "…" para caber na largura. */
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

async function downloadWrappedImage() {
  if (!MY_POSTS_LOADED) await loadMyPosts();   // db.js
  const r = wrappedSummary();
  const blob = await new Promise(resolve => drawWrapped(r).toBlob(resolve, 'image/png'));
  if (!blob) { showToast('Não deu para gerar a imagem 😕'); return; }
  const name = `retrospectiva-${r.year}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Minha retrospectiva' });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.warn('Compartilhar a imagem falhou; baixando:', err);
  }
  saveFile(blob, name);
}

/** Baixa um arquivo gerado na página. */
function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
