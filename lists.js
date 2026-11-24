'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — descobrir livros: listas de leitura feitas pelos
//  leitores e "Para você" (recomendações a partir dos seus favoritos).
//  Também monta a aba Explorar. Regras puras em lib/community.js (CLC).
// ============================================================

const LISTS_SHOWN = 12;
const FIRESTORE_IN_LIMIT = 10;         // o Firestore aceita até 10 valores num filtro "in"
const FOR_YOU_POSTS_LIMIT = 200;

let CURRENT_LIST = null;               // { id, ...dados, liked }

/** Chamado por goTo('search') (app.js). */
function loadExplore() {
  if (!FIREBASE_CONFIGURED || !APP_USER) return;
  loadForYou();
  loadLists();
  const city = document.getElementById('spots-city');
  if (city && !city.value && APP_USER.city) city.value = APP_USER.city;
  loadSpots(city ? city.value : '');   // local.js
}

// ════════════════════════════════════════════════════════════
//  PARA VOCÊ
// ════════════════════════════════════════════════════════════

async function loadForYou() {
  const box = document.getElementById('for-you-list');
  if (!box) return;
  const seeds = CLC.favoriteBookIds(Object.values(MY_LIBRARY)).slice(0, FIRESTORE_IN_LIMIT);   // db.js
  if (!seeds.length) {
    box.innerHTML = '<p class="muted-small">Dê 4 ou 5 estrelas aos livros que você leu e receba sugestões de quem tem gosto parecido ⭐</p>';
    return;
  }
  box.innerHTML = '<p class="muted-small">Procurando sugestões...</p>';
  try {
    const posts = await forYouPosts(seeds);
    const recs = CLC.recommendForMe(posts, seeds, Object.keys(MY_LIBRARY));
    box.innerHTML = recs.length
      ? recs.map(forYouHtml).join('')
      : '<p class="muted-small">Ainda não há leitores suficientes com o seu gosto. Volte em breve! 📚</p>';
  } catch (err) {
    console.error('Erro nas sugestões Para você:', err);
    box.innerHTML = '<p class="muted-small">Não deu para carregar as sugestões agora.</p>';
  }
}

/** Resenhas públicas dos meus favoritos → quem os amou → o que essas pessoas também avaliaram. */
async function forYouPosts(seeds) {
  const seedSnap = await db.collection('posts').where('bookId', 'in', seeds).where('isPrivate', '==', false)
    .limit(FOR_YOU_POSTS_LIMIT).get();
  const seedPosts = seedSnap.docs.map(d => d.data());
  const fans = [...new Set(seedPosts
    .filter(p => CL.clampRating(p.rating) >= 4 && p.authorId !== APP_USER.uid && !APP_BLOCKED.includes(p.authorId))
    .map(p => p.authorId))].slice(0, FIRESTORE_IN_LIMIT);
  if (!fans.length) return seedPosts;
  const fanSnap = await db.collection('posts').where('authorId', 'in', fans).where('isPrivate', '==', false)
    .limit(FOR_YOU_POSTS_LIMIT).get();
  return [...seedPosts, ...fanSnap.docs.map(d => d.data())];
}

function forYouHtml(r) {
  const seed = MY_LIBRARY[r.because];
  const book = { id: r.book.id, title: r.book.title || 'Livro', author: r.book.author || '', coverUrl: r.book.coverUrl || '' };
  return `
    <div class="fy-book">
      <button class="fy-open" data-id="${escHtml(book.id)}" onclick="openBookPage(this.dataset.id)">
        <strong>${escHtml(book.title)}</strong>
        <small>${seed ? `Porque você gostou de ${escHtml(seed.title)}` : ''} · ${r.readers} ${r.readers === 1 ? 'leitor amou' : 'leitores amaram'}</small>
      </button>
      <button class="wl-action" data-book="${escHtml(JSON.stringify(book))}" aria-label="Adicionar ${escHtml(book.title)} à lista Quero ler"
        onclick="wantToRead(JSON.parse(this.dataset.book))">+ Quero ler</button>
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  LISTAS DE LEITURA
// ════════════════════════════════════════════════════════════

async function loadLists() {
  const box = document.getElementById('lists-list');
  if (!box) return;
  try {
    const snap = await db.collection('lists').orderBy('likesCount', 'desc').limit(LISTS_SHOWN).get();
    box.innerHTML = snap.empty
      ? '<p class="muted-small">Nenhuma lista ainda. Crie a primeira: "Livros para ler numa tarde", "Fantasia brasileira"... 📚</p>'
      : snap.docs.map(d => listCardHtml(d.id, d.data())).join('');
  } catch (err) {
    console.error('Erro ao carregar as listas:', err);
    box.innerHTML = '<p class="muted-small">Não deu para carregar as listas agora.</p>';
  }
}

function listCardHtml(id, l) {
  const n = Array.isArray(l.books) ? l.books.length : 0;
  return `
    <button class="list-card" data-id="${escHtml(id)}" onclick="openList(this.dataset.id)">
      <strong>${escHtml(l.title)}</strong>
      <small>por ${escHtml(l.ownerName || 'leitor')} · ${n} ${n === 1 ? 'livro' : 'livros'} · ♥ ${l.likesCount || 0}</small>
    </button>`;
}

function openNewList() {
  document.getElementById('list-title').value = '';
  document.getElementById('list-desc').value = '';
  openSheet('sh-new-list');
}

async function createList() {
  const r = CLC.validateList({ title: document.getElementById('list-title').value, description: document.getElementById('list-desc').value });
  if (!r.ok) { showToast(r.errors[0]); return; }
  try {
    const ref = await db.collection('lists').add({
      title: r.list.title, description: r.list.description, books: [],
      ownerId: APP_USER.uid, ownerName: APP_USER.displayName || '', likesCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    closeSheet('sh-new-list');
    loadLists();
    await openList(ref.id);
  } catch (err) {
    console.error('Erro ao criar lista:', err);
    showToast('Não deu para criar a lista 😕');
  }
}

async function openList(id) {
  try {
    const ref = db.collection('lists').doc(id);
    const [snap, like] = await Promise.all([ref.get(), ref.collection('likes').doc(APP_USER.uid).get()]);
    if (!snap.exists) { showToast('Esta lista não existe mais.'); return; }
    CURRENT_LIST = { id: snap.id, ...snap.data(), liked: like.exists };
    renderList();
    openSheet('sh-list');
  } catch (err) {
    console.error('Erro ao abrir lista:', err);
    showToast('Não deu para abrir a lista 😕');
  }
}

function renderList() {
  const l = CURRENT_LIST;
  const owner = l.ownerId === APP_USER.uid;
  const books = listBooksOf(l);
  document.getElementById('sh-list-ttl').textContent = l.title;
  document.getElementById('list-body').innerHTML = `
    <p class="muted-small">por ${escHtml(l.ownerName || 'leitor')}</p>
    ${l.description ? `<p class="club-desc">${escHtml(l.description)}</p>` : ''}
    <button class="bp-btn ${l.liked ? '' : 'bp-btn-ghost'}" onclick="toggleListLike()" aria-pressed="${l.liked}">
      ${l.liked ? '♥ Curtida' : '♡ Curtir'} (${l.likesCount || 0})</button>
    <div class="list-books">${books.length ? books.map((b, i) => listBookHtml(b, i, owner)).join('') : '<p class="muted-small">Lista vazia por enquanto.</p>'}</div>
    ${owner ? `<div class="club-row-btns">
      <button class="bp-btn" onclick="openBookPicker('list')">＋ Adicionar livro</button>
      <button class="bp-btn bp-btn-ghost" onclick="deleteList()">Excluir lista</button></div>` : ''}`;
}

/** Livros da lista, ignorando itens malformados. */
function listBooksOf(l) {
  return Array.isArray(l.books) ? l.books.filter(b => b && typeof b === 'object' && b.id) : [];
}

function listBookHtml(b, index, owner) {
  const book = { id: b.id, title: b.title, author: b.author || '', coverUrl: b.coverUrl || '' };
  return `
    <div class="list-book">
      <span class="wl-name"><strong>${escHtml(b.title)}</strong><small>${escHtml(b.author || '')}</small></span>
      <button class="wl-action" data-book="${escHtml(JSON.stringify(book))}" aria-label="Adicionar ${escHtml(b.title)} à lista Quero ler"
        onclick="wantToRead(JSON.parse(this.dataset.book))">+ Quero ler</button>
      ${owner ? `<button class="sched-remove" aria-label="Tirar ${escHtml(b.title)} da lista" onclick="removeListBook(${index})">✕</button>` : ''}
    </div>`;
}

async function saveListBooks(books, okMessage) {
  const r = CLC.validateList({ ...CURRENT_LIST, books });
  if (!r.ok) { showToast(r.errors[0]); return; }
  try {
    await db.collection('lists').doc(CURRENT_LIST.id).update({ books, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    CURRENT_LIST = { ...CURRENT_LIST, books };
    renderList();
    loadLists();
    if (okMessage) showToast(okMessage);
  } catch (err) {
    console.error('Erro ao salvar a lista:', err);
    showToast('Não deu para salvar a lista 😕');
  }
}

/** Chamado por onBookPicked (features.js) no modo 'list'. */
async function addBookToCurrentList(book) {
  const current = listBooksOf(CURRENT_LIST);
  const next = CLC.addBookToList(current, book);
  if (next === current) { showToast('Este livro já está na lista 📚'); return; }
  await saveListBooks(next, 'Livro adicionado à lista! 📚');
}

async function removeListBook(index) {
  await saveListBooks(listBooksOf(CURRENT_LIST).filter((_, i) => i !== index));
}

async function toggleListLike() {
  const l = CURRENT_LIST;
  const listRef = db.collection('lists').doc(l.id);
  const like = !l.liked;
  try {
    const batch = db.batch();
    if (like) batch.set(listRef.collection('likes').doc(APP_USER.uid), { uid: APP_USER.uid });
    else batch.delete(listRef.collection('likes').doc(APP_USER.uid));
    batch.update(listRef, { likesCount: firebase.firestore.FieldValue.increment(like ? 1 : -1) });
    await batch.commit();
    CURRENT_LIST = { ...l, liked: like, likesCount: Math.max(0, (l.likesCount || 0) + (like ? 1 : -1)) };
    renderList();
    loadLists();
  } catch (err) {
    console.error('Erro ao curtir lista:', err);
    showToast('Não deu para curtir agora 😕');
  }
}

async function deleteList() {
  if (!window.confirm(`Excluir a lista "${CURRENT_LIST.title}"? Isso não pode ser desfeito.`)) return;
  try {
    await db.collection('lists').doc(CURRENT_LIST.id).delete();
    closeSheet('sh-list');
    CURRENT_LIST = null;
    loadLists();
    showToast('Lista excluída.');
  } catch (err) {
    console.error('Erro ao excluir lista:', err);
    showToast('Não deu para excluir a lista 😕');
  }
}
