'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — boas-vindas guiadas, seção Descobrir do feed,
//  convites e selo Fundador. As regras puras ficam em lib/welcome.js (CLW).
// ============================================================

const WELCOME_SUGGESTIONS_LIMIT = 5;
const WELCOME_USERS_SCAN = 20;        // perfis lidos para achar até 5 sugestões
const DISCOVERY_BOOKS_LIMIT = 8;
const INVITE_COUNT_LIMIT = 500;
const INVITE_STORAGE_KEY = 'cantinho:convite';
const WELCOME_STEPS = 3;

let WELCOME_OPEN = false;
let WELCOME_DONE = false;   // já terminou nesta sessão (o login de conta nova chama enterApp duas vezes)
let WELCOME_GENRES = [];
let WELCOME_READING = null;

// ════════════════════════════════════════════════════════════
//  CONVITES
// ════════════════════════════════════════════════════════════

// Guarda o ?convite= assim que a página abre: a pessoa pode demorar para criar a conta.
(function rememberInvite() {
  const inviter = CLW.parseInvite(location.search);
  if (!inviter) return;
  try { localStorage.setItem(INVITE_STORAGE_KEY, inviter); }
  catch (err) { console.warn('Não deu para guardar o convite:', err); }
})();

/** Quem convidou esta conta nova, se o perfil dessa pessoa existir. */
async function resolvePendingInviter(myUid) {
  let stored = null;
  try { stored = localStorage.getItem(INVITE_STORAGE_KEY); }
  catch (err) { console.warn('Não deu para ler o convite:', err); }
  clearPendingInvite();   // o convite vale só para esta conta nova, nunca para a próxima
  const inviter = CLW.validInviter(stored, myUid);
  if (!inviter) return null;
  try {
    const snap = await db.collection('users').doc(inviter).get();
    return snap.exists ? inviter : null;
  } catch (err) {
    console.warn('Não deu para conferir quem convidou:', err);
    return null;
  }
}

function clearPendingInvite() {
  try { localStorage.removeItem(INVITE_STORAGE_KEY); }
  catch (err) { console.warn('Não deu para apagar o convite guardado:', err); }
}

function notifyInviter(inviterId) {
  const name = (APP_USER && APP_USER.displayName) || 'Um leitor';
  createNotification(inviterId, 'invite', `💌 <b>${name}</b> entrou no Cantinho pelo seu convite!`);
}

function myInviteLink() {
  return CLW.inviteLink(location.origin, APP_USER.uid);
}

async function openInvite() {
  if (!APP_USER) return;
  document.getElementById('invite-link').value = myInviteLink();
  const count = document.getElementById('invite-count');
  count.textContent = 'Contando...';
  openSheet('sh-invite');
  try {
    const snap = await db.collection('users').where('invitedBy', '==', APP_USER.uid).limit(INVITE_COUNT_LIMIT).get();
    count.textContent = CLW.invitedLabel(snap.size);
  } catch (err) {
    console.error('Erro ao contar convites:', err);
    count.textContent = 'Não deu para contar agora.';
  }
}

async function copyInviteLink() {
  try {
    await navigator.clipboard.writeText(myInviteLink());
    showToast('Link copiado! 📋');
  } catch (err) {
    console.error('Erro ao copiar o convite:', err);
    showToast('Não deu para copiar. Selecione o link e copie 😕');
  }
}

async function shareInvite() {
  if (!navigator.share) { await copyInviteLink(); return; }
  try {
    await navigator.share({ title: 'Cantinho Literário', text: 'Vem trocar ideias sobre livros comigo no Cantinho Literário 📚', url: myInviteLink() });
  } catch (err) {
    if (!err || err.name !== 'AbortError') showToast('Não deu para compartilhar 😕');
  }
}

// ════════════════════════════════════════════════════════════
//  SELO FUNDADOR
// ════════════════════════════════════════════════════════════

function setFounderBadge(elementId, createdAt) {
  const el = document.getElementById(elementId);
  if (el) el.hidden = !CLW.isFounder(createdAt);
}

// ════════════════════════════════════════════════════════════
//  BOAS-VINDAS GUIADAS (3 passos)
// ════════════════════════════════════════════════════════════

function maybeOpenWelcome() {
  if (WELCOME_OPEN || WELCOME_DONE || !FIREBASE_CONFIGURED || !CLW.needsWelcome(APP_USER)) return;
  WELCOME_OPEN = true;
  WELCOME_GENRES = CLW.sanitizeGenres(APP_USER.favoriteGenres);
  WELCOME_READING = null;
  showWelcomeStep(1);
  openSheet('sh-welcome');
}

function showWelcomeStep(step) {
  document.getElementById('welcome-progress').textContent = `${step} de ${WELCOME_STEPS}`;
  const body = document.getElementById('welcome-body');
  if (step === 1) body.innerHTML = welcomeGenresHtml();
  if (step === 2) body.innerHTML = welcomeReadingHtml();
  if (step === 3) {
    body.innerHTML = welcomeSuggestionsShellHtml();
    loadWelcomeSuggestions();
  }
  body.scrollTop = 0;
}

function welcomeGenresHtml() {
  const chips = CLW.GENRES.map(g => `
    <button class="wl-chip" data-id="${g.id}" aria-pressed="${WELCOME_GENRES.includes(g.id)}"
      onclick="toggleWelcomeGenre(this)">${escHtml(g.label)}</button>`).join('');
  return `
    <h3 class="wl-title">Que tipo de livro você curte?</h3>
    <p class="muted-small">Escolha até 5. O seu feed já começa com sugestões do seu gosto.</p>
    <div class="wl-chips">${chips}</div>
    <button class="bp-btn wl-next" onclick="showWelcomeStep(2)">Continuar</button>`;
}

function toggleWelcomeGenre(btn) {
  const id = btn.dataset.id;
  const selected = WELCOME_GENRES.includes(id);
  const next = selected ? WELCOME_GENRES.filter(g => g !== id) : [...WELCOME_GENRES, id];
  if (CLW.sanitizeGenres(next).length < next.length) { showToast('Escolha até 5 gêneros 🙂'); return; }
  WELCOME_GENRES = next;
  btn.setAttribute('aria-pressed', String(!selected));
}

function welcomeReadingHtml() {
  return `
    <h3 class="wl-title">O que você está lendo agora?</h3>
    <p class="muted-small">O livro vai para a sua estante "Lendo". Se não estiver lendo nada, é só continuar.</p>
    <div id="welcome-reading" class="wl-reading">${WELCOME_READING ? welcomeBookHtml(WELCOME_READING) : ''}</div>
    <button class="bp-btn bp-btn-ghost" onclick="openBookPicker('welcome')">📖 Escolher livro</button>
    <button class="bp-btn wl-next" onclick="showWelcomeStep(3)">Continuar</button>`;
}

function welcomeBookHtml(book) {
  return `<span class="wl-book">📖 <strong>${escHtml(book.title)}</strong> · ${escHtml(book.author)}</span>`;
}

/** Chamado por onBookPicked (features.js) quando o livro foi escolhido nas boas-vindas. */
async function setWelcomeReading(book) {
  WELCOME_READING = book;
  const box = document.getElementById('welcome-reading');
  if (box) box.innerHTML = welcomeBookHtml(book);
  await saveBookToLibrary(book, 'reading');   // db.js
}

function welcomeSuggestionsShellHtml() {
  return `
    <h3 class="wl-title">Encontre a sua turma</h3>
    <p class="muted-small">Siga leitores e entre em clubes para o seu feed ganhar vida.</p>
    <h4 class="bp-section">Leitores</h4>
    <div id="welcome-people" class="wl-list"><p class="muted-small">Procurando leitores...</p></div>
    <h4 class="bp-section">Clubes do livro</h4>
    <div id="welcome-clubs" class="wl-list"><p class="muted-small">Procurando clubes...</p></div>
    <button class="bp-btn wl-next" onclick="finishWelcome()">Começar a explorar</button>`;
}

async function loadWelcomeSuggestions() {
  await Promise.all([loadWelcomePeople(), loadWelcomeClubs()]);
}

async function loadWelcomePeople() {
  const box = document.getElementById('welcome-people');
  try {
    const snap = await db.collection('users').orderBy('createdAt', 'desc').limit(WELCOME_USERS_SCAN).get();
    const people = snap.docs
      .filter(d => d.id !== APP_USER.uid && !APP_BLOCKED.includes(d.id) && !d.data().isDeleted)
      .slice(0, WELCOME_SUGGESTIONS_LIMIT);
    box.innerHTML = people.length
      ? people.map(d => welcomePersonHtml(d.id, d.data())).join('')
      : '<p class="muted-small">Você é um dos primeiros por aqui! Convide amigos depois 💌</p>';
  } catch (err) {
    console.error('Erro ao sugerir leitores:', err);
    box.innerHTML = '<p class="muted-small">Não deu para carregar leitores agora.</p>';
  }
}

function welcomePersonHtml(id, u) {
  const avatar = escHtml(u.avatarUrl || 'avatar-placeholder.svg');
  return `
    <div class="wl-person">
      <img src="${avatar}" alt="" class="wl-avatar" onerror="this.src='avatar-placeholder.svg'"/>
      <span class="wl-name"><strong>${escHtml(u.displayName || 'Leitor')}</strong><small>@${escHtml(u.handle || 'leitor')}</small></span>
      <button class="wl-action" data-id="${escHtml(id)}" data-following="false"
        onclick="toggleFollow(this, this.dataset.id)">Seguir</button>
    </div>`;
}

async function loadWelcomeClubs() {
  const box = document.getElementById('welcome-clubs');
  try {
    const snap = await db.collection('clubs').orderBy('membersCount', 'desc').limit(WELCOME_SUGGESTIONS_LIMIT).get();
    box.innerHTML = snap.empty
      ? '<p class="muted-small">Ainda não há clubes. Você pode criar o primeiro na aba Clubes!</p>'
      : snap.docs.map(d => welcomeClubHtml(d.id, d.data())).join('');
  } catch (err) {
    console.error('Erro ao sugerir clubes:', err);
    box.innerHTML = '<p class="muted-small">Não deu para carregar clubes agora.</p>';
  }
}

function welcomeClubHtml(id, c) {
  const member = isClubMember(id);   // features.js
  return `
    <div class="wl-club">
      <span class="wl-name"><strong>${escHtml(c.name)}</strong><small>${membersLabel(c.membersCount)}${c.city ? ` · 📍 ${escHtml(c.city)}` : ''}</small></span>
      <button class="wl-action" data-id="${escHtml(id)}" ${member ? 'disabled' : ''}
        onclick="joinClubFromWelcome(this)">${member ? 'Participando' : 'Entrar'}</button>
    </div>`;
}

async function joinClubFromWelcome(btn) {
  btn.disabled = true;
  try {
    const snap = await db.collection('clubs').doc(btn.dataset.id).get();
    if (!snap.exists) { showToast('Este clube não existe mais.'); return; }
    const ok = await changeMembership(true, { id: snap.id, ...snap.data() });   // features.js
    btn.textContent = ok ? 'Participando' : 'Entrar';
    btn.disabled = ok;
  } catch (err) {
    console.error('Erro ao entrar no clube:', err);
    showToast('Erro ao entrar no clube 😕');
    btn.disabled = false;
  }
}

/** Pular, terminar, tocar fora da janela ou apertar Esc: grava as escolhas e não mostra de novo. */
async function finishWelcome() {
  if (!WELCOME_OPEN) return;
  WELCOME_OPEN = false;
  WELCOME_DONE = true;
  closeSheet('sh-welcome');
  const genres = CLW.sanitizeGenres(WELCOME_GENRES);
  const updates = { favoriteGenres: genres, onboardedAt: firebase.firestore.FieldValue.serverTimestamp() };
  // O perfil já mostra "gêneros" (texto livre): preenche com os escolhidos se estiver vazio.
  const hasProfileGenres = Array.isArray(APP_USER.genres) && APP_USER.genres.length > 0;
  if (!hasProfileGenres && genres.length) updates.genres = genres.map(CLW.genreLabel);
  try {
    await db.collection('users').doc(APP_USER.uid).update(updates);
    APP_USER = { ...APP_USER, ...updates, onboardedAt: new Date() };
    renderMyProfile();   // db.js
  } catch (err) {
    console.error('Erro ao salvar as boas-vindas:', err);
    showToast('Não deu para salvar suas escolhas 😕');
  }
  loadFeed(true);   // db.js — a seção Descobrir passa a usar os gêneros escolhidos
}

// ════════════════════════════════════════════════════════════
//  SEÇÃO DESCOBRIR (feed com poucos posts)
// ════════════════════════════════════════════════════════════

/** Chamado por loadFeed (db.js) depois de desenhar a primeira página do feed. */
function renderDiscovery(container, postCount) {
  container.querySelector('#feed-discovery')?.remove();
  if (CURRENT_FEED_TAB !== 'normal' || !CLW.shouldShowDiscovery(postCount)) return;
  const today = new Date();
  const genre = CLW.discoveryGenre(APP_USER && APP_USER.favoriteGenres, today);
  container.insertAdjacentHTML('beforeend', discoveryHtml(CLW.dailyPrompt(today), CLW.dailyQuote(today), genre));
  loadDiscoveryBooks(genre);
}

function discoveryHtml(prompt, quote, genre) {
  return `
    <section id="feed-discovery" class="discovery" aria-label="Descobrir">
      <h3 class="disc-head">✨ Descobrir</h3>
      <div class="disc-card disc-prompt">
        <span class="disc-kicker">Pergunta do dia</span>
        <p class="disc-prompt-text">${escHtml(prompt)}</p>
        <button class="bp-btn" onclick="answerDailyPrompt()">Responder</button>
      </div>
      <figure class="disc-card disc-quote-card">
        <span class="disc-kicker">Citação do dia</span>
        <blockquote class="disc-quote">“${escHtml(quote.text)}”</blockquote>
        <figcaption class="disc-cite">— ${escHtml(quote.author)}, <em>${escHtml(quote.work)}</em></figcaption>
      </figure>
      <div class="disc-card">
        <span class="disc-kicker">Sugestões em ${escHtml(genre.label)}</span>
        <div id="disc-books" class="disc-books"><p class="muted-small">Buscando livros...</p></div>
      </div>
      <div class="disc-actions">
        <button class="bp-btn bp-btn-ghost" onclick="goTo('search')">🔎 Descobrir leitores</button>
        <button class="bp-btn bp-btn-ghost" onclick="openInvite()">💌 Convidar amigos</button>
      </div>
    </section>`;
}

function answerDailyPrompt() {
  openSheet('sh-new-post');
  const ta = document.getElementById('post-ta');
  if (!ta) return;
  ta.value = `${CLW.dailyPrompt(new Date())}\n\n`;
  ta.dispatchEvent(new Event('input'));   // atualiza o contador de caracteres
  ta.focus();
}

async function loadDiscoveryBooks(genre) {
  const box = document.getElementById('disc-books');
  if (!box) return;
  try {
    const res = await fetchGoogleBooks({ q: genre.query, langRestrict: 'pt', printType: 'books', maxResults: DISCOVERY_BOOKS_LIMIT });   // app.js
    if (!res.ok) throw new Error(`Google Books respondeu ${res.status}`);
    const data = await res.json();
    const books = (data.items || []).map(bookFromVolume).filter(b => /^[A-Za-z0-9_-]{1,64}$/.test(b.id));
    box.replaceChildren(...books.map(discoveryBookEl));
    if (!books.length) box.innerHTML = '<p class="muted-small">Nenhuma sugestão agora.</p>';
  } catch (err) {
    console.error('Erro ao buscar sugestões de livros:', err);
    box.innerHTML = '<p class="muted-small">Não deu para carregar sugestões agora.</p>';
  }
}

function bookFromVolume(item) {
  const info = item.volumeInfo || {};
  const thumb = info.imageLinks && info.imageLinks.thumbnail;
  return {
    id: String(item.id || ''),
    title: info.title || 'Sem título',
    author: info.authors ? info.authors.join(', ') : 'Autor desconhecido',
    coverUrl: thumb ? thumb.replace('http:', 'https:') : '',
    totalPages: info.pageCount || 0,
  };
}

/** Monta o cartão com DOM (sem HTML em texto), então título e autor nunca viram código. */
function discoveryBookEl(book) {
  const el = document.createElement('div');
  el.className = 'disc-book';
  const cover = document.createElement('div');
  cover.className = 'disc-cover';
  if (book.coverUrl) {
    const img = document.createElement('img');
    img.src = book.coverUrl;
    img.alt = '';
    img.loading = 'lazy';
    cover.appendChild(img);
  }
  const title = document.createElement('strong');
  title.className = 'disc-title';
  title.textContent = book.title;
  const author = document.createElement('small');
  author.className = 'disc-author';
  author.textContent = book.author;
  const btn = document.createElement('button');
  btn.className = 'wl-action';
  btn.textContent = '+ Quero ler';
  btn.setAttribute('aria-label', `Adicionar ${book.title} à lista Quero ler`);   // vários botões iguais na tela
  btn.addEventListener('click', () => wantToRead(book));   // features.js
  el.append(cover, title, author, btn);
  return el;
}
