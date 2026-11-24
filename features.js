'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — recursos de leitor
//  Página do livro (notas e recomendações), spoiler, citações, compartilhar,
//  status das trocas, progresso de leitura, conquistas, retrospectiva e clubes.
//  As regras de negócio ficam em lib/logic.js (window.CL), testadas sem navegador.
// ============================================================

const BOOK_PAGE_LIMIT = 50;          // resenhas lidas para calcular a média do livro
const RECOMMEND_FANS_LIMIT = 10;     // o Firestore aceita até 10 valores num filtro "in"
const CLUB_MESSAGES_LIMIT = 50;
const CLUB_MESSAGE_MAX = 1000;

const POST_CACHE = {};               // dados dos posts já desenhados, por id (para compartilhar e trocar status)
let MY_POSTS_CACHE = [];             // meus posts carregados no perfil (conquistas e retrospectiva)
let MY_POSTS_LOADED = false;
window.BOOK_PICK_MODE = null;        // 'post' | 'club' quando a busca de livros escolhe um livro em vez de ir para a estante
let COMPOSE_BOOK = null;             // livro marcado na nova publicação
let COMPOSE_RATING = 0;

function rememberPost(postId, data) { POST_CACHE[postId] = data; }

// ════════════════════════════════════════════════════════════
//  PEDAÇOS DO CARD DE POST (usados por buildPostCard em db.js)
// ════════════════════════════════════════════════════════════

function postBookChipHtml(d) {
  if (!d.book || !d.bookId) return '';
  const rating = CL.clampRating(d.rating);
  return `
    <button class="pc-book" data-id="${escHtml(d.bookId)}" onclick="openBookPage(this.dataset.id)" aria-label="Ver página do livro ${escHtml(d.book.title)}">
      <span class="pc-book-title">📖 ${escHtml(d.book.title)}</span>
      <span class="pc-book-author">${escHtml(d.book.author)}</span>
      ${rating ? `<span class="pc-stars" aria-label="Nota ${rating} de 5">${CL.starsText(rating)}</span>` : ''}
    </button>`;
}

function postTradeHtml(postId, d) {
  if (CL.postKind(d) !== 'trade') return '';
  const status = d.tradeStatus || 'AVAILABLE';
  return `
    <div class="pc-trade">
      ${d.location ? `<span class="pc-trade-city">📍 ${escHtml(d.location)}</span>` : ''}
      <span class="trade-badge st-${escHtml(status)}" id="trade-st-${postId}">${CL.tradeStatusLabel(status)}</span>
    </div>`;
}

/** Texto do post: citação, texto com spoiler escondido ou texto comum com "ver mais". */
function postBodyHtml(postId, d, text) {
  if (CL.postKind(d) === 'quote') {
    return `
      <blockquote class="pc-quote">“${text}”</blockquote>
      ${d.book ? `<cite class="pc-quote-cite">— ${escHtml(d.book.title)}, ${escHtml(d.book.author)}</cite>` : ''}`;
  }
  const short = `${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`;
  const more = text.length > 200
    ? `<button class="pc-see-more" data-target="pctxt-${postId}" onclick="toggleSeeMore(this)">Ver mais...</button>` : '';
  if (d.hasSpoiler) {
    return `
      <div class="pc-spoiler" data-hidden="true">
        <p class="pc-text" id="pctxt-${postId}" data-full="${text}">${short}</p>${more}
        <button class="pc-spoiler-btn" onclick="revealSpoiler(this)">⚠️ Contém spoiler · toque para ver</button>
      </div>`;
  }
  return `<p class="pc-text" id="pctxt-${postId}" data-full="${text}">${short}</p>${more}`;
}

function revealSpoiler(btn) {
  const box = btn.closest('.pc-spoiler');
  if (box) box.dataset.hidden = 'false';
  btn.remove();
}

async function sharePost(postId) {
  const data = POST_CACHE[postId];
  if (!data) return;
  const text = CL.buildShareText(data, location.origin);
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Cantinho Literário', text });
      return;
    }
    await navigator.clipboard.writeText(text);
    showToast('Texto copiado! Cole onde quiser 📋');
  } catch (err) {
    if (err && err.name === 'AbortError') return;   // a pessoa fechou a janela de compartilhar
    console.error('Erro ao compartilhar:', err);
    showToast('Não deu para compartilhar 😕');
  }
}

// ════════════════════════════════════════════════════════════
//  NOVA PUBLICAÇÃO: livro, estrelas, spoiler e citação
// ════════════════════════════════════════════════════════════

function openBookPicker(mode) {
  window.BOOK_PICK_MODE = mode;
  document.getElementById('sh-add-book-ttl').textContent = 'Escolher livro';
  document.getElementById('book-search-input').value = '';
  document.getElementById('book-search-results').innerHTML = '';
  openSheet('sh-add-book');
}

/** Chamado por selectBookFromSearch (app.js) quando a busca está no modo de escolher livro. */
function onBookPicked(book, mode) {
  const picked = { id: book.id, title: book.title, author: book.author, coverUrl: book.coverUrl || '' };
  if (mode === 'post') setComposeBook(picked);
  if (mode === 'club') setClubBook(picked);
  if (mode === 'welcome') setWelcomeReading(picked);   // welcome.js
  if (mode === 'poll') addPollPick(picked);            // clubs-plus.js
  if (mode === 'list') addBookToCurrentList(picked);   // lists.js
}

function setComposeBook(book) {
  COMPOSE_BOOK = book;
  const box = document.getElementById('post-book-box');
  if (!box) return;
  if (!book) {
    box.innerHTML = '<button class="ct-btn" onclick="openBookPicker(\'post\')">📖 Marcar livro</button>';
    setComposeRating(0);
    return;
  }
  box.innerHTML = `
    <div class="post-book-picked">
      <span>📖 <strong>${escHtml(book.title)}</strong> · ${escHtml(book.author)}</span>
      <button class="post-book-clear" onclick="setComposeBook(null)" aria-label="Tirar livro">×</button>
    </div>
    <div class="post-stars" role="radiogroup" aria-label="Sua nota para o livro">
      ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="post-star" data-val="${n}" role="radio" aria-checked="false"
        aria-label="${n} estrela${n > 1 ? 's' : ''}" onclick="setComposeRating(${n})">★</button>`).join('')}
    </div>`;
  setComposeRating(COMPOSE_RATING);
}

function setComposeRating(n) {
  COMPOSE_RATING = CL.clampRating(n);
  document.querySelectorAll('.post-star').forEach(star => {
    const on = Number(star.dataset.val) <= COMPOSE_RATING;
    star.classList.toggle('on', on);
    star.setAttribute('aria-checked', String(Number(star.dataset.val) === COMPOSE_RATING));
  });
}

/** Extras da nova publicação, lidos por publishPost (app.js). */
function getComposeExtras() {
  const spoiler = document.getElementById('post-spoiler');
  return {
    book: COMPOSE_BOOK,
    rating: COMPOSE_BOOK ? COMPOSE_RATING : 0,
    hasSpoiler: Boolean(spoiler && spoiler.checked),
  };
}

function resetComposeExtras() {
  COMPOSE_RATING = 0;
  setComposeBook(null);
  const spoiler = document.getElementById('post-spoiler');
  if (spoiler) spoiler.checked = false;
}

function composeReviewFor(book) {
  closeSheet('sh-book-page');
  openSheet('sh-new-post');
  setComposeBook(book);
}

// ════════════════════════════════════════════════════════════
//  PÁGINA DO LIVRO: média, resenhas e recomendações
// ════════════════════════════════════════════════════════════

async function openBookPage(bookId) {
  const body = document.getElementById('book-page-body');
  if (!body || !FIREBASE_CONFIGURED) return;
  if (!document.getElementById('sh-club').classList.contains('hidden')) { stopClubMessages(); closeSheet('sh-club'); }
  body.innerHTML = '<p class="muted-center">Carregando livro...</p>';
  openSheet('sh-book-page');

  try {
    const snap = await db.collection('posts')
      .where('bookId', '==', bookId)
      .where('isPrivate', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(BOOK_PAGE_LIMIT)
      .get();
    const posts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => !APP_BLOCKED.includes(p.authorId));
    const known = Object.values(POST_CACHE).find(p => p.bookId === bookId);
    const book = (posts[0] && posts[0].book) || (known && known.book) || (MY_LIBRARY[bookId] && { id: bookId, ...MY_LIBRARY[bookId] });
    if (!book) { body.innerHTML = '<p class="muted-center">Ainda não há nada sobre este livro.</p>'; return; }

    body.innerHTML = bookPageHtml({ ...book, id: bookId }, posts);
    const list = document.getElementById('book-page-reviews');
    posts.filter(p => CL.clampRating(p.rating)).forEach(p => {
      list.insertAdjacentHTML('beforeend', buildPostCard(p.id, p));
    });
    loadRecommendations(bookId, posts);
  } catch (err) {
    console.error('Erro ao abrir livro:', err);
    body.innerHTML = '<p class="muted-center">Erro ao carregar o livro 😕</p>';
  }
}

function bookPageHtml(book, posts) {
  const summary = CL.ratingSummary(posts.map(p => p.rating));
  const bars = [5, 4, 3, 2, 1].map(star => {
    const pct = summary.count ? Math.round((summary.distribution[star] / summary.count) * 100) : 0;
    return `<div class="bp-bar"><span>${star}★</span><div class="bp-track"><div class="bp-fill" style="width:${pct}%"></div></div><span>${summary.distribution[star]}</span></div>`;
  }).join('');
  const bookJson = escHtml(JSON.stringify({ id: book.id, title: book.title, author: book.author, coverUrl: book.coverUrl || '' }));
  return `
    <div class="bp-head">
      ${book.coverUrl ? `<img class="bp-cover" src="${escHtml(book.coverUrl)}" alt="Capa de ${escHtml(book.title)}"/>` : '<div class="bp-cover bp-cover-empty">📖</div>'}
      <div>
        <h3 class="bp-title">${escHtml(book.title)}</h3>
        <p class="bp-author">${escHtml(book.author)}</p>
        <p class="bp-avg" id="book-page-avg">${summary.count
          ? `<strong>${summary.average.toFixed(1)}</strong> ${CL.starsText(summary.average)} · ${summary.count} ${summary.count === 1 ? 'nota' : 'notas'}`
          : 'Ainda sem notas'}</p>
      </div>
    </div>
    ${summary.count ? `<div class="bp-bars">${bars}</div>` : ''}
    <div class="bp-actions">
      <button class="bp-btn" data-book="${bookJson}" onclick="composeReviewFor(JSON.parse(this.dataset.book))">✍️ Escrever resenha</button>
      <button class="bp-btn bp-btn-ghost" data-book="${bookJson}" onclick="wantToRead(JSON.parse(this.dataset.book))">+ Quero ler</button>
    </div>
    <h4 class="bp-section">Quem gostou também gostou de</h4>
    <div class="bp-recs" id="book-page-recs"><p class="muted-small">Procurando...</p></div>
    <h4 class="bp-section">Resenhas da comunidade</h4>
    <div id="book-page-reviews" class="bp-reviews"></div>`;
}

const SHELF_NAMES = { tbr: 'Quero ler', reading: 'Lendo', read: 'Lidos', wishlist: 'Wishlist' };

function wantToRead(book) {
  const existing = MY_LIBRARY[book.id];
  if (existing) { showToast(`Este livro já está na sua estante (${SHELF_NAMES[existing.status] || existing.status}) 📚`); return; }
  saveBookToLibrary(book, 'tbr');
}

async function loadRecommendations(bookId, posts) {
  const box = document.getElementById('book-page-recs');
  if (!box) return;
  const fans = [...new Set(posts.filter(p => CL.clampRating(p.rating) >= 4).map(p => p.authorId))]
    .slice(0, RECOMMEND_FANS_LIMIT);
  if (!fans.length) { box.innerHTML = '<p class="muted-small">Ainda não há leitores suficientes para recomendar.</p>'; return; }

  try {
    const snap = await db.collection('posts')
      .where('authorId', 'in', fans)
      .where('isPrivate', '==', false)
      .limit(200)
      .get();
    const recs = CL.recommendBooks(snap.docs.map(d => d.data()), bookId);
    box.innerHTML = recs.length
      ? recs.map(r => `
          <button class="bp-rec" data-id="${escHtml(r.book.id)}" onclick="openBookPage(this.dataset.id)">
            <strong>${escHtml(r.book.title)}</strong><span>${r.readers} ${r.readers === 1 ? 'leitor' : 'leitores'}</span>
          </button>`).join('')
      : '<p class="muted-small">Ainda não há leitores suficientes para recomendar.</p>';
  } catch (err) {
    console.error('Erro nas recomendações:', err);
    box.innerHTML = '<p class="muted-small">Não deu para carregar as recomendações.</p>';
  }
}

// ════════════════════════════════════════════════════════════
//  TROCAS: status e filtro "perto de mim"
// ════════════════════════════════════════════════════════════

let TRADE_NEAR_ONLY = false;

function toggleTradeNear(input) {
  if (input.checked && !(APP_USER && APP_USER.city)) {
    input.checked = false;
    showToast('Coloque sua cidade em Editar Perfil para usar este filtro 📍');
    return;
  }
  TRADE_NEAR_ONLY = input.checked;
  loadFeed(true);
}

/** Usado pelo feed: o post de troca passa no filtro de cidade? */
function passesTradeFilter(d) {
  if (typeof passesTradeCity === 'function' && !passesTradeCity(d)) return false;   // local.js — atalho de cidade
  if (!TRADE_NEAR_ONLY || !APP_USER) return true;
  return CL.sameCity(d.location, APP_USER.city);
}

function tradeMenuHtml(postId) {
  const d = POST_CACHE[postId];
  if (!d || CL.postKind(d) !== 'trade') return '';
  return CL.nextTradeStatuses(d.tradeStatus).map(st => `
    <button class="menu-btn" data-id="${escHtml(postId)}" data-status="${st}" onclick="updateTradeStatus(this.dataset.id, this.dataset.status)">Marcar como ${CL.tradeStatusLabel(st).toLowerCase()}</button>`).join('');
}

async function updateTradeStatus(postId, status) {
  const d = POST_CACHE[postId];
  if (!d || !CL.canChangeTradeStatus(d.tradeStatus || 'AVAILABLE', status)) return;
  try {
    await db.collection('posts').doc(postId).update({ tradeStatus: status });
    POST_CACHE[postId] = { ...d, tradeStatus: status };
    document.querySelectorAll(`#trade-st-${postId}`).forEach(el => {
      el.textContent = CL.tradeStatusLabel(status);
      el.className = `trade-badge st-${status}`;
    });
    closeSheet('sh-post-menu');
    showToast(status === 'DONE' ? 'Troca concluída! 🎉' : 'Status atualizado ✓');
  } catch (err) {
    console.error('Erro ao mudar status da troca:', err);
    showToast('Erro ao mudar o status 😕');
  }
}

// ════════════════════════════════════════════════════════════
//  PROGRESSO DE LEITURA
// ════════════════════════════════════════════════════════════

function progressBarHtml(book) {
  const p = CL.readingProgress(book.currentPage, book.totalPages);
  if (!p.total) return '';
  return `<div class="shelf-progress" aria-label="${p.percent}% lido"><div class="shelf-progress-fill" style="width:${p.percent}%"></div></div>
          <span class="shelf-progress-txt">pág. ${p.current}/${p.total}</span>`;
}

function showProgressSection(book) {
  const box = document.getElementById('bo-progress-section');
  if (!box) return;
  box.style.display = book.status === 'reading' ? 'block' : 'none';
  document.getElementById('bo-page').value = book.currentPage || '';
  document.getElementById('bo-total').value = book.totalPages || '';
}

async function saveReadingProgress() {
  if (!currentBookOptions) return;
  const p = CL.readingProgress(document.getElementById('bo-page').value, document.getElementById('bo-total').value);
  if (!p.total) { showToast('Informe o total de páginas 📄'); return; }
  try {
    await db.collection('users').doc(APP_USER.uid).collection('library').doc(currentBookOptions.id)
      .update({ currentPage: p.current, totalPages: p.total });
    if (typeof logPagesToday === 'function') logPagesToday(CLC.pagesDelta(currentBookOptions.currentPage, p.current));   // daily.js
    currentBookOptions = { ...currentBookOptions, currentPage: p.current, totalPages: p.total };
    showToast(p.percent === 100 ? 'Terminou! Mova para Lidos 🎉' : `Progresso salvo: ${p.percent}% 📖`);
    closeSheet('sh-book-options');
  } catch (err) {
    console.error('Erro ao salvar progresso:', err);
    showToast('Erro ao salvar o progresso 😕');
  }
}

// ════════════════════════════════════════════════════════════
//  CONQUISTAS E RETROSPECTIVA
// ════════════════════════════════════════════════════════════

function myStats(posts) {
  const books = Object.values(MY_LIBRARY);
  return {
    booksRead: books.filter(b => b.status === 'read').length,
    readingGoal: APP_USER && APP_USER.readingGoal,
    reviews: posts.filter(p => CL.postKind(p) === 'review').length,
    tradesDone: posts.filter(p => CL.postKind(p) === 'trade' && p.tradeStatus === 'DONE').length,
    quotes: posts.filter(p => CL.postKind(p) === 'quote').length,
    clubs: (APP_USER && Array.isArray(APP_USER.clubIds)) ? APP_USER.clubIds.length : 0,
  };
}

function renderAchievements(posts) {
  MY_POSTS_CACHE = posts;
  MY_POSTS_LOADED = true;
  const box = document.getElementById('achievements');
  if (!box) return;
  const list = CL.achievements(myStats(posts));
  const earned = list.filter(a => a.earned).length;
  box.innerHTML = `
    <div class="ach-head"><span>🏅 Conquistas</span><span>${earned}/${list.length}</span></div>
    <div class="ach-grid">${list.map(a => `
      <div class="ach ${a.earned ? 'ach-on' : ''}" title="${escHtml(a.title)}${a.earned ? '' : ` · ${a.progress}%`}">
        <span class="ach-icon">${a.icon}</span><span class="ach-title">${escHtml(a.title)}</span>
      </div>`).join('')}</div>`;
}

async function openWrapped() {
  if (!MY_POSTS_LOADED) await loadMyPosts();
  const year = new Date().getFullYear();
  const r = CL.yearInReview({ books: Object.values(MY_LIBRARY), posts: MY_POSTS_CACHE, year });
  const line = (icon, label, value) => `<div class="wr-item"><span class="wr-icon">${icon}</span><span class="wr-value">${value}</span><span class="wr-label">${label}</span></div>`;
  document.getElementById('wrapped-body').innerHTML = `
    <div class="wr-card" id="wrapped-card">
      <p class="wr-kicker">Sua retrospectiva</p>
      <h3 class="wr-year">${year}</h3>
      <div class="wr-grid">
        ${line('📚', 'livros lidos', r.booksRead)}
        ${line('📄', 'páginas', r.pagesRead)}
        ${line('⭐', 'nota média', r.averageRating ? r.averageRating.toFixed(1) : '–')}
        ${line('✍️', 'resenhas', r.reviewsWritten)}
        ${line('💬', 'citações', r.quotesShared)}
        ${line('🔄', 'trocas', r.tradesDone)}
      </div>
      ${r.bestBook ? `<p class="wr-line">Melhor leitura: <strong>${escHtml(r.bestBook)}</strong></p>` : ''}
      ${r.topAuthor ? `<p class="wr-line">Autor do ano: <strong>${escHtml(r.topAuthor)}</strong></p>` : ''}
      ${r.busiestMonth ? `<p class="wr-line">Mês mais lido: <strong>${r.busiestMonth}</strong></p>` : ''}
      ${r.booksRead === 0 ? '<p class="wr-line">Marque livros como Lidos para montar sua retrospectiva 📖</p>' : ''}
    </div>
    <div class="club-row-btns">
      <button class="bp-btn" onclick="shareWrapped()">Compartilhar</button>
      <button class="bp-btn bp-btn-ghost" onclick="downloadWrappedImage()">🖼️ Baixar imagem</button>
    </div>`;
  openSheet('sh-wrapped');
  return r;
}

async function shareWrapped() {
  const r = CL.yearInReview({ books: Object.values(MY_LIBRARY), posts: MY_POSTS_CACHE, year: new Date().getFullYear() });
  const text = `Minha retrospectiva ${r.year} no Cantinho Literário 📚\n${r.booksRead} livros · ${r.pagesRead} páginas`
    + `${r.bestBook ? `\nMelhor leitura: ${r.bestBook}` : ''}\n${location.origin}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Minha retrospectiva', text });
    else { await navigator.clipboard.writeText(text); showToast('Retrospectiva copiada! 📋'); }
  } catch (err) {
    if (!err || err.name !== 'AbortError') showToast('Não deu para compartilhar 😕');
  }
}

// ════════════════════════════════════════════════════════════
//  CLUBES DO LIVRO
// ════════════════════════════════════════════════════════════

let CURRENT_CLUB = null;             // { id, ...dados }
let CLUB_MSGS_UNSUB = null;

function membersLabel(n) {
  const count = n || 0;
  return `${count} ${count === 1 ? 'membro' : 'membros'}`;
}

function isClubMember(clubId) {
  return Boolean(APP_USER && Array.isArray(APP_USER.clubIds) && APP_USER.clubIds.includes(clubId));
}

async function loadClubs() {
  const list = document.getElementById('clubs-list');
  if (!list || !FIREBASE_CONFIGURED) return;
  list.innerHTML = '<p class="muted-center">Carregando clubes...</p>';
  try {
    const snap = await db.collection('clubs').orderBy('createdAt', 'desc').limit(30).get();
    if (snap.empty) {
      list.innerHTML = '<p class="muted-center">Nenhum clube ainda. Que tal criar o primeiro? 📚</p>';
      return;
    }
    list.innerHTML = snap.docs.map(doc => clubCardHtml(doc.id, doc.data())).join('');
  } catch (err) {
    console.error('Erro ao carregar clubes:', err);
    list.innerHTML = '<p class="muted-center">Erro ao carregar clubes 😕</p>';
  }
}

function clubCardHtml(id, c) {
  return `
    <button class="club-card" data-id="${escHtml(id)}" onclick="openClub(this.dataset.id)">
      <div class="club-card-top">
        <strong class="club-name">${escHtml(c.name)}</strong>
        ${isClubMember(id) ? '<span class="club-member-tag">Participando</span>' : ''}
      </div>
      <span class="club-meta">${c.city ? `📍 ${escHtml(c.city)} · ` : ''}${membersLabel(c.membersCount)}</span>
      ${c.bookOfMonth ? `<span class="club-book">📖 Livro do mês: ${escHtml(c.bookOfMonth.title)}</span>` : ''}
    </button>`;
}

async function createClub() {
  const input = {
    name: document.getElementById('club-name').value,
    description: document.getElementById('club-desc').value,
    city: document.getElementById('club-city').value,
  };
  const check = CL.validateClub(input);
  if (!check.ok) { showToast(check.errors[0]); return; }
  try {
    const ref = db.collection('clubs').doc();
    const batch = db.batch();
    batch.set(ref, {
      name: input.name.trim(), description: input.description.trim(), city: input.city.trim(),
      cityKey: CL.cityKey(input.city), ownerId: APP_USER.uid, ownerName: APP_USER.displayName || '',
      membersCount: 1, bookOfMonth: null, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(ref.collection('members').doc(APP_USER.uid), memberDoc());
    batch.update(db.collection('users').doc(APP_USER.uid), { clubIds: firebase.firestore.FieldValue.arrayUnion(ref.id) });
    await batch.commit();
    APP_USER = { ...APP_USER, clubIds: [...(APP_USER.clubIds || []), ref.id] };
    ['club-name', 'club-desc', 'club-city'].forEach(id => { document.getElementById(id).value = ''; });
    closeSheet('sh-new-club');
    showToast('Clube criado! 🎉');
    loadClubs();
    openClub(ref.id);
  } catch (err) {
    console.error('Erro ao criar clube:', err);
    showToast('Erro ao criar o clube 😕');
  }
}

function memberDoc() {
  return { uid: APP_USER.uid, name: APP_USER.displayName || '', joinedAt: firebase.firestore.FieldValue.serverTimestamp() };
}

async function openClub(clubId) {
  const body = document.getElementById('club-body');
  if (!body) return;
  body.innerHTML = '<p class="muted-center">Abrindo clube...</p>';
  openSheet('sh-club');
  try {
    const doc = await db.collection('clubs').doc(clubId).get();
    if (!doc.exists) { body.innerHTML = '<p class="muted-center">Este clube não existe mais.</p>'; return; }
    CURRENT_CLUB = { id: doc.id, ...doc.data() };
    renderClub();
  } catch (err) {
    console.error('Erro ao abrir clube:', err);
    body.innerHTML = '<p class="muted-center">Erro ao abrir o clube 😕</p>';
  }
}

function renderClub() {
  const c = CURRENT_CLUB;
  const member = isClubMember(c.id);
  const owner = APP_USER && c.ownerId === APP_USER.uid;
  document.getElementById('sh-club-ttl').textContent = c.name;
  document.getElementById('club-body').innerHTML = `
    <p class="club-desc">${escHtml(c.description || '')}</p>
    <p class="club-meta">${c.city ? `📍 ${escHtml(c.city)} · ` : ''}${membersLabel(c.membersCount)} · criado por ${escHtml(c.ownerName || 'leitor')}</p>
    <div class="club-book-box">
      ${c.bookOfMonth
        ? `<button class="pc-book" data-id="${escHtml(c.bookOfMonth.id)}" onclick="openBookPage(this.dataset.id)"><span class="pc-book-title">📖 Livro do mês: ${escHtml(c.bookOfMonth.title)}</span><span class="pc-book-author">${escHtml(c.bookOfMonth.author)}</span></button>`
        : '<p class="muted-small">Ainda sem livro do mês.</p>'}
      ${owner ? '<button class="bp-btn bp-btn-ghost" onclick="openBookPicker(\'club\')">Escolher livro do mês</button>' : ''}
    </div>
    ${owner ? '' : `<button class="bp-btn ${member ? 'bp-btn-ghost' : ''}" id="club-join-btn" onclick="${member ? 'leaveClub()' : 'joinClub()'}">${member ? 'Sair do clube' : 'Entrar no clube'}</button>`}
    <div id="club-extras"></div>
    <h4 class="bp-section">Conversa do clube</h4>
    <div id="club-chat-tabs" class="club-chat-tabs" role="tablist" aria-label="Etapas da conversa"></div>
    <div class="club-msgs" id="club-msgs">${member ? '' : '<p class="muted-small">Entre no clube para ver e participar da conversa.</p>'}</div>
    ${member ? `<div class="club-send">
      <input id="club-msg-input" maxlength="${CLUB_MESSAGE_MAX}" placeholder="Escreva para o clube..." onkeydown="if(event.key==='Enter') sendClubMessage()"/>
      <button class="bp-btn" onclick="sendClubMessage()">Enviar</button></div>` : ''}`;
  if (typeof renderClubExtras === 'function') renderClubExtras(c);   // clubs-plus.js — cronograma, votação, encontro
  stopClubMessages();
  if (member) listenClubMessages(c.id);
}

async function joinClub() {
  await changeMembership(true);
}

async function leaveClub() {
  await changeMembership(false);
}

/** Entra ou sai de um clube (o aberto na tela, ou outro, como nas boas-vindas). @returns {Promise<boolean>} */
async function changeMembership(join, club = CURRENT_CLUB) {
  const c = club;
  if (!c || !APP_USER) return false;
  const ref = db.collection('clubs').doc(c.id);
  const inc = firebase.firestore.FieldValue.increment(join ? 1 : -1);
  try {
    const batch = db.batch();
    if (join) batch.set(ref.collection('members').doc(APP_USER.uid), memberDoc());
    else {
      batch.delete(ref.collection('members').doc(APP_USER.uid));
      batch.delete(ref.collection('votes').doc(APP_USER.uid));   // quem sai não conta mais na votação
    }
    batch.update(ref, { membersCount: inc });
    batch.update(db.collection('users').doc(APP_USER.uid), {
      clubIds: join ? firebase.firestore.FieldValue.arrayUnion(c.id) : firebase.firestore.FieldValue.arrayRemove(c.id),
    });
    await batch.commit();
    const ids = (APP_USER.clubIds || []).filter(id => id !== c.id);
    APP_USER = { ...APP_USER, clubIds: join ? [...ids, c.id] : ids };
    if (CURRENT_CLUB && CURRENT_CLUB.id === c.id) {
      CURRENT_CLUB = { ...c, membersCount: Math.max(0, (c.membersCount || 0) + (join ? 1 : -1)) };
      renderClub();
    }
    loadClubs();
    showToast(join ? 'Bem-vindo ao clube! 📚' : 'Você saiu do clube.');
    return true;
  } catch (err) {
    console.error('Erro ao mudar participação no clube:', err);
    showToast('Erro ao atualizar o clube 😕');
    return false;
  }
}

async function setClubBook(book) {
  const c = CURRENT_CLUB;
  if (!c) return;
  try {
    await db.collection('clubs').doc(c.id).update({ bookOfMonth: book });
    CURRENT_CLUB = { ...c, bookOfMonth: book };
    renderClub();
    showToast('Livro do mês definido! 📖');
  } catch (err) {
    console.error('Erro ao definir livro do mês:', err);
    showToast('Erro ao definir o livro 😕');
  }
}

function listenClubMessages(clubId) {
  const messages = db.collection('clubs').doc(clubId).collection('messages');
  const q = typeof clubMessagesQuery === 'function'   // clubs-plus.js — conversa por etapa
    ? clubMessagesQuery(messages) : messages.orderBy('createdAt', 'desc').limit(CLUB_MESSAGES_LIMIT);
  CLUB_MSGS_UNSUB = q
    .onSnapshot(snap => {
      const box = document.getElementById('club-msgs');
      if (!box) return;
      // Conversa por etapa do cronograma (clubs-plus.js): só as mensagens da etapa aberta.
      // Mensagem recém-enviada ainda sem hora do servidor fica por último.
      const at = m => CL.toMillis(m.createdAt) || Number.MAX_SAFE_INTEGER;
      const msgs = snap.docs.map(d => d.data())
        .filter(m => typeof clubMessageVisible !== 'function' || clubMessageVisible(m))
        .sort((a, b) => at(a) - at(b))
        .slice(-CLUB_MESSAGES_LIMIT);
      box.innerHTML = msgs.length
        ? msgs.map(m => `<div class="club-msg ${APP_USER && m.senderId === APP_USER.uid ? 'mine' : ''}">
            <span class="club-msg-name">${escHtml(m.senderName || 'Leitor')}</span>${escHtml(m.text)}</div>`).join('')
        : '<p class="muted-small">Nenhuma mensagem ainda. Comece a conversa! 💬</p>';
      box.scrollTop = box.scrollHeight;
    }, err => console.error('Erro nas mensagens do clube:', err));
}

function stopClubMessages() {
  if (CLUB_MSGS_UNSUB) { CLUB_MSGS_UNSUB(); CLUB_MSGS_UNSUB = null; }
}

async function sendClubMessage() {
  const input = document.getElementById('club-msg-input');
  const text = input ? input.value.trim() : '';
  if (!text || !CURRENT_CLUB) return;
  input.value = '';
  try {
    await db.collection('clubs').doc(CURRENT_CLUB.id).collection('messages').add({
      senderId: APP_USER.uid, senderName: APP_USER.displayName || '', text: text.slice(0, CLUB_MESSAGE_MAX),
      ...(typeof clubMessageExtras === 'function' ? clubMessageExtras() : {}),   // clubs-plus.js — etapa
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Erro ao enviar mensagem no clube:', err);
    input.value = text;
    showToast('Erro ao enviar 😕');
  }
}
