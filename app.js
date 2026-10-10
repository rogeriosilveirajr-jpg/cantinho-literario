'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — App Coordinator
//  Wires: auth.js + db.js + UI navigation + sheets + toast
// ============================================================

// ─── Inicialização ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAuth();        // firebase/demo login listener (auth.js)
  initCompose();     // contador de caracteres no compose
  initOverlayClose();// fechar sheets ao clicar fora
  initScrollFab();   // esconder FAB ao rolar
});

// ─── Entrar no app (chamado por auth.js após login) ─────────
function enterApp() {
  const login = document.getElementById('screen-login');
  const app   = document.getElementById('app');
  if (login) { login.style.transition = 'opacity .3s'; login.style.opacity = '0'; setTimeout(() => login.classList.add('hidden'), 300); }
  if (app) app.classList.remove('hidden');

  // Carrega dados iniciais
  loadFeed(true);       // db.js
  if (typeof subscribeNewPosts === 'function') subscribeNewPosts();  // db.js — listener de novos posts
  if (typeof renderMyProfile === 'function') renderMyProfile();    // db.js — foto, nome, contadores
  if (typeof listenMyLibrary === 'function') listenMyLibrary(); // db.js - listener de estantes de livros
  if (typeof loadChats === 'function') loadChats();             // db.js — carregar lista de conversas
}

// ─── Navegação entre telas ──────────────────────────────────
const SCREENS = { home: 's-home', search: 's-search', notif: 's-notif', profile: 's-profile', settings: 's-settings', chats: 's-chats', 'chat-room': 's-chat-room' };
const NAV_IDS = { home: 'tnav-home', search: 'tnav-search', notif: 'tnav-notif', profile: 'tnav-profile', chats: 'tnav-chat' };
let   CUR_SCREEN = 'home';

function goTo(name) {
  if (CUR_SCREEN === name && name !== 'settings') return;
  CUR_SCREEN = name;

  Object.values(SCREENS).forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('active'); });
  const targetEl = document.getElementById(SCREENS[name]);
  if (targetEl) { targetEl.classList.add('active'); targetEl.scrollTo({ top:0, behavior:'smooth' }); }

  document.querySelectorAll('.tnav-btn').forEach(b => b.classList.remove('on'));
  const nb = document.getElementById(NAV_IDS[name]);
  if (nb) nb.classList.add('on');

const fab = document.getElementById('fab');
  if (fab) fab.style.display = (name === 'home') ? 'flex' : 'none';

  if (name === 'profile') renderMyProfile();
  if (name === 'notif') loadNotifications();
  if (name === 'chats' && typeof loadChats === 'function') loadChats();

  const titles = { home:'Cantinho Literário', search:'Explorar', notif:'Notificações', profile:'Meu Perfil', settings:'Configurações' };
  document.title = (titles[name] || 'Cantinho') + ' — Cantinho Literário';
}

// ─── Chip filter (Feed / Doações) ───────────────────────────
let CUR_CHIP = 'feed';

function ytswitchChip(btn, mode) {
  if (CUR_CHIP === mode) return;
  CUR_CHIP = mode;

  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active-chip'));
  btn.classList.add('active-chip');

  const feedView = document.getElementById('view-feed');
  const donateView = document.getElementById('view-doacoes');
  if (mode === 'feed') {
    if (feedView)   feedView.style.display = 'flex';
    if (donateView) donateView.classList.add('hidden');
  } else {
    if (feedView)   feedView.style.display = 'none';
    if (donateView) { donateView.classList.remove('hidden'); loadDonationsFeed(); }
  }
}

// ─── Segmented control ──────────────────────────────────────
function segSelect(btn) {
  btn.closest('.seg-ctrl').querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active-seg'));
  btn.classList.add('active-seg');
}

// ─── Like (wired to db.js) ──────────────────────────────────
function tapLike(btn, postId) {
  if (postId) {
    toggleLikeDB(postId, btn);  // db.js
  } else {
    // Fallback para cards estáticos (demo)
    const isLiked = btn.getAttribute('data-liked') === 'true';
    setLikeUI(btn, !isLiked);
    btn.setAttribute('data-liked', String(!isLiked));
    if (!isLiked) { spawnHeart(btn); showToast('Você curtiu! ❤️'); }
    else showToast('Like removido');
  }
  btn.style.transform = 'scale(1.18)';
  setTimeout(() => { btn.style.transform = ''; }, 180);
}

// ─── Heart particle ─────────────────────────────────────────
function spawnHeart(btn) {
  // A animação @keyframes _floatUp agora está no styles.css
  const h = document.createElement('span');
  h.textContent = '❤️';
  h.style.cssText = 'position:fixed;font-size:1.4rem;pointer-events:none;z-index:9999;animation:_floatUp .75s ease-out forwards;';
  const r = btn.getBoundingClientRect();
  h.style.left = (r.left + r.width/2 - 11) + 'px';
  h.style.top  = (r.top - 6) + 'px';
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 780);
}

// ─── See More / See Less ────────────────────────────────────
function toggleSeeMore(btn) {
  const el = document.getElementById(btn.dataset.target);
  if (!el) return;
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  if (expanded) {
    el.classList.remove('expanded');
    btn.textContent = 'Ver mais...';
    btn.setAttribute('aria-expanded', 'false');
  } else {
    el.classList.add('expanded');
    const full = el.getAttribute('data-full');
    if (full) el.textContent = full;
    btn.textContent = 'Ver menos';
    btn.setAttribute('aria-expanded', 'true');
  }
}

// ─── Post Menu (3-dot) ──────────────────────────────────────
let MENU_POST_ID   = null;
let MENU_AUTHOR_ID = null;

function openPostMenuFor(postId, authorId) {
  MENU_POST_ID   = postId   || null;
  MENU_AUTHOR_ID = authorId || null;
  // Esconde opção "Excluir" se não for o autor
  const delBtn = document.getElementById('menu-delete-post');
  if (delBtn) delBtn.style.display = (APP_USER && authorId === APP_USER.uid) ? 'flex' : 'none';
  openSheet('sh-post-menu');
}

// ─── Profile Tabs ────────────────────────────────────────────
function switchPtab(btn, tab) {
  document.querySelectorAll('.ptab-btn').forEach(b => { b.classList.remove('apt'); b.setAttribute('aria-selected','false'); });
  btn.classList.add('apt'); btn.setAttribute('aria-selected','true');
  document.querySelectorAll('.ptab-panel').forEach(p => p.classList.remove('show'));
  const panel = document.getElementById('pt-' + tab);
  if (panel) panel.classList.add('show');
}

// ─── New Post Compose ────────────────────────────────────────
function initCompose() {
  const ta    = document.getElementById('post-ta');
  const chars = document.getElementById('ct-chars');
  if (!ta || !chars) return;
  ta.addEventListener('input', () => {
    const n = ta.value.length;
    chars.textContent = `${n}/500`;
    chars.style.color = n > 450 ? '#DC2626' : '';
  });
}

let POST_IMG_B64 = null;

function handlePostImage(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
      POST_IMG_B64 = e.target.result;
      document.getElementById('post-img-preview-container').style.display = 'block';
      document.getElementById('post-img-preview').src = POST_IMG_B64;
    };
    reader.readAsDataURL(file);
  }
}

function clearPostImage() {
  POST_IMG_B64 = null;
  const input = document.getElementById('post-img-input');
  if (input) input.value = '';
  const container = document.getElementById('post-img-preview-container');
  if (container) container.style.display = 'none';
  const img = document.getElementById('post-img-preview');
  if (img) img.src = '';
}

async function publishPost() {
  const ta = document.getElementById('post-ta');
  if (!ta || !ta.value.trim()) { showToast('Escreva algo primeiro! ✍️'); return; }

  const btn = document.querySelector('#sh-new-post .sh-action');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  const select = document.getElementById('post-type-select');
  const locInput = document.getElementById('post-location');
  const postType = select ? select.value : 'normal';
  const location = locInput ? locInput.value.trim() : '';

  if (postType === 'trade' && !location) {
    showToast('Por favor, informe sua localização.');
    if (btn) { btn.disabled = false; btn.textContent = 'Publicar'; }
    return;
  }

  const ok = await submitPost(ta.value, POST_IMG_B64, postType, location);  // db.js

  if (btn) { btn.disabled = false; btn.textContent = 'Publicar'; }

  if (ok) {
    closeSheet('sh-new-post');
    ta.value = '';
    clearPostImage();
    const chars = document.getElementById('ct-chars');
    if (chars) chars.textContent = '0/500';
    if (postType === 'trade') {
      showToast('Troca/Doação publicada! 📚📍');
    } else {
      showToast('Publicação enviada! 🎉');
    }
    goTo('home');
  }
}

// ─── Comments (UI side) ─────────────────────────────────────
function sendCommentUI() {
  const input = document.querySelector('.cmt-input');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';
  submitComment(text).then(() => showToast('Comentário enviado! 💬'));  // db.js
}

// ─── Privacy ─────────────────────────────────────────────────
let PRIV_MODE = 'private';

function pickPrivacy(mode) {
  PRIV_MODE = mode;
  const ck = `<svg width="20" height="20" fill="#C8714A" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`;
  document.getElementById('priv-pub').classList.toggle('priv-sel', mode === 'public');
  document.getElementById('priv-priv').classList.toggle('priv-sel', mode === 'private');
  document.getElementById('pck-pub').innerHTML  = mode === 'public'  ? ck : '';
  document.getElementById('pck-priv').innerHTML = mode === 'private' ? ck : '';
  document.getElementById('priv-pub').setAttribute('aria-pressed',  String(mode === 'public'));
  document.getElementById('priv-priv').setAttribute('aria-pressed', String(mode === 'private'));
}

function savePrivacy() { savePrivacyDB(PRIV_MODE); }  // db.js

// ─── Report & Block ──────────────────────────────────────────
function sendReport(reason) { sendReportDB(reason); }  // db.js
function confirmBlock()     { blockUserDB(MENU_AUTHOR_ID); }  // db.js

// ─── Delete Account ──────────────────────────────────────────
function confirmDelete() {
  const input = document.getElementById('del-confirm');
  if (!input || input.value.trim() !== 'EXCLUIR') {
    showToast('Digite "EXCLUIR" para confirmar');
    if (input) input.focus();
    return;
  }
  closeSheet('sh-delete-account');
  deleteMyAccount();  // auth.js
}

// ─── Edit Profile ────────────────────────────────────────────
function saveProfileUI() { saveProfileEdits(); }  // db.js

// ─── Sign Out ────────────────────────────────────────────────
// chamado pelo botão de Configurações
// function doSignOut() → auth.js

// ─── Bottom Sheets ───────────────────────────────────────────
function openSheet(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const f = el.querySelector('button,input,textarea,select'); if (f) f.focus(); }, 70);
}

function closeSheet(id) {
  const ep = document.getElementById("emoji-popup"); if(ep) ep.classList.add("hidden");
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  document.body.style.overflow = '';
}

function initOverlayClose() {
  document.querySelectorAll('.sheet-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) closeSheet(o.id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = document.querySelector('.sheet-overlay:not(.hidden)');
      if (open) closeSheet(open.id);
    }
  });
  document.querySelectorAll('.priv-option').forEach(opt => {
    opt.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickPrivacy(opt.id === 'priv-pub' ? 'public' : 'private'); }
    });
  });
}

// ─── Toast ───────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(_toastTimer);
  t.textContent = msg;
  t.classList.remove('hidden', 'out');
  void t.offsetWidth;
  _toastTimer = setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.classList.add('hidden'), 220);
  }, 2600);
}

// ─── FAB scroll-hide ─────────────────────────────────────────
function initScrollFab() {
  const homeScreen = document.getElementById('s-home');
  const fab = document.getElementById('fab');
  if (!homeScreen || !fab) return;
  let lastY = 0;
  fab.style.transition = 'transform .2s cubic-bezier(.34,1.56,.64,1),opacity .2s ease,background .15s';
  homeScreen.addEventListener('scroll', () => {
    const y = homeScreen.scrollTop;
    const hide = y > lastY && y > 60;
    fab.style.transform = hide ? 'scale(0)' : 'scale(1)';
    fab.style.opacity   = hide ? '0'        : '1';
    lastY = y;
  }, { passive: true });
}

// ─── Infinite scroll (carrega mais posts ao chegar no fim) ───
(function() {
  const homeScreen = document.getElementById('s-home');
  if (!homeScreen) return;
  homeScreen.addEventListener('scroll', () => {
    if (CUR_CHIP !== 'feed') return;
    const { scrollTop, scrollHeight, clientHeight } = homeScreen;
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadFeed();  // db.js — carrega próxima página
    }
  }, { passive: true });
})();

// ─── Cover & Avatar Photo ─────────────────────────────────────
function changeCoverPhoto() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Imagem muito grande (máx. 10MB)'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const epImg = document.getElementById('ep-cover-img');
      if (epImg) { epImg.src = ev.target.result; epImg.style.display = 'block'; epImg.setAttribute('data-updated', 'true'); }
      const img = document.getElementById('profile-cover-img');
      if (img) { img.src = ev.target.result; img.style.display = 'block'; }
      // A UI atualiza, mas APP_USER.coverUrl só muda no db.js após salvar
      showToast('Capa alterada! Clique em Salvar. 📸');
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function changeAvatarPhoto() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Imagem muito grande (máx. 5MB)'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      ['profile-av-img', '.tnav-avatar-img', '.cmp-av', '.cmt-input-av', '.ep-av-img'].forEach(sel => {
        const el = sel.startsWith('.') ? document.querySelector(sel) : document.getElementById(sel);
        if (el) {
          el.src = ev.target.result;
          if (sel === '.ep-av-img' || sel === '#ep-av-img') {
             el.setAttribute('data-updated', 'true');
          }
        }
      });
      // Apenas a UI é atualizada aqui. O APP_USER.avatarUrl só deve ser alterado no db.js após o processamento/compressão.
      showToast('Foto de perfil alterada! Clique em Salvar. 📸');
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// Restore cover and avatar from APP_USER data when entering profile
function restoreProfileMedia() {
  if (!APP_USER) return;
  const coverImg = document.getElementById('profile-cover-img');
  if (coverImg && APP_USER.coverUrl) {
    coverImg.src = APP_USER.coverUrl;
    coverImg.style.display = 'block';
  }
  const avImg = document.getElementById('profile-av-img');
  if (avImg && APP_USER.avatarUrl) avImg.src = APP_USER.avatarUrl;
  const navAv = document.querySelector('.tnav-avatar-img');
  if (navAv && APP_USER.avatarUrl) navAv.src = APP_USER.avatarUrl;
}

// ============================================================================
//  BOOK SEARCH & SHELVES UI
// ============================================================================

let bookSearchTimeout;
let currentShelfTarget = 'tbr';
let currentBookOptions = null; // Stores the currently opened book in options modal

function openBookSearch(targetShelf) {
  currentShelfTarget = targetShelf;
  const ttl = document.getElementById('sh-add-book-ttl');
  if (targetShelf === 'tbr') ttl.textContent = 'Adicionar à TBR';
  else if (targetShelf === 'read') ttl.textContent = 'Adicionar aos Lidos';
  else ttl.textContent = 'Adicionar à Wishlist';
  
  document.getElementById('book-search-input').value = '';
  document.getElementById('book-search-results').innerHTML = '';
  openSheet('sh-add-book');
}

function debounceBookSearch(query) {
  clearTimeout(bookSearchTimeout);
  if (!query || query.trim().length < 3) {
    document.getElementById('book-search-results').innerHTML = '';
    return;
  }
  bookSearchTimeout = setTimeout(() => searchGoogleBooks(query), 600);
}

async function searchGoogleBooks(query) {
  const loading = document.getElementById('book-search-loading');
  const resultsDiv = document.getElementById('book-search-results');
  
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';
  
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=15`);
    const data = await res.json();
    loading.style.display = 'none';
    
    if (!data.items || data.items.length === 0) {
      resultsDiv.innerHTML = '<p style="text-align:center; color:#8A7060;">Nenhum livro encontrado.</p>';
      return;
    }
    
    data.items.forEach(item => {
      const info = item.volumeInfo;
      const title = info.title || 'Sem título';
      const author = info.authors ? info.authors.join(', ') : 'Autor desconhecido';
      let cover = '';
      if (info.imageLinks && info.imageLinks.thumbnail) {
        cover = info.imageLinks.thumbnail.replace('http:', 'https:');
      }
      const id = item.id;
      
      const itemEl = document.createElement('div');
      itemEl.className = 'sr-item';
      itemEl.onclick = () => selectBookFromSearch(id, title, author, cover);
      
      itemEl.innerHTML = `
        <img src="${cover || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}" class="sr-cover" onerror="this.onerror=null; this.src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';"/>
        <div class="sr-info">
          <h4 class="sr-title">${escHtml(title)}</h4>
          <p class="sr-author">${escHtml(author)}</p>
        </div>
      `;
      resultsDiv.appendChild(itemEl);
    });
  } catch (err) {
    loading.style.display = 'none';
    resultsDiv.innerHTML = '<p style="text-align:center; color:#d32f2f;">Erro na busca.</p>';
  }
}

function selectBookFromSearch(id, title, author, coverUrl) {
  const bookData = { id, title, author, coverUrl, rating: 0 };
  closeSheet('sh-add-book');
  
  // Se for "read", abre a tela de opções para dar nota. Se não, salva direto.
  if (currentShelfTarget === 'read') {
     bookData.status = 'read';
     openBookOptions(id, bookData);
  } else {
     saveBookToLibrary(bookData, currentShelfTarget); // db.js
  }
}

function openBookOptions(bookId, optionalBookData = null) {
  const book = optionalBookData || (typeof MY_LIBRARY !== 'undefined' ? MY_LIBRARY[bookId] : null);
  if (!book) return;
  
  currentBookOptions = book;
  
  document.getElementById('bo-book-cover').src = book.coverUrl || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  document.getElementById('bo-book-title').textContent = book.title;
  document.getElementById('bo-book-author').textContent = book.author;
  
  document.querySelectorAll('.bo-shelf-btn').forEach(b => b.classList.remove('active'));
  if (book.status === 'tbr') document.getElementById('bo-btn-tbr').classList.add('active');
  else if (book.status === 'read') document.getElementById('bo-btn-read').classList.add('active');
  else if (book.status === 'wishlist') document.getElementById('bo-btn-wishlist').classList.add('active');
  
  const ratingSection = document.getElementById('bo-rating-section');
  if (book.status === 'read') {
    ratingSection.style.display = 'block';
    setStarsUI(book.rating || 0);
  } else {
    ratingSection.style.display = 'none';
  }
  
  openSheet('sh-book-options');
}

function changeBookShelf(newShelf) {
  if (!currentBookOptions) return;
  
  document.querySelectorAll('.bo-shelf-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`bo-btn-${newShelf}`).classList.add('active');
  
  const ratingSection = document.getElementById('bo-rating-section');
  if (newShelf === 'read') {
    ratingSection.style.display = 'block';
    if (!currentBookOptions.rating) setStarsUI(0);
  } else {
    ratingSection.style.display = 'none';
    currentBookOptions.rating = 0; // zera nota se sair dos lidos
  }
  
  currentBookOptions.status = newShelf;
  saveBookToLibrary(currentBookOptions, newShelf); // db.js
  if (newShelf !== 'read') {
      closeSheet('sh-book-options');
  }
}

function removeBook() {
  if (!currentBookOptions) return;
  removeBookFromLibrary(currentBookOptions.id); // db.js
  closeSheet('sh-book-options');
}

// Lógica das estrelas
document.querySelectorAll('#bo-stars span').forEach(star => {
  star.addEventListener('click', (e) => {
    if (!currentBookOptions) return;
    const val = parseInt(e.target.getAttribute('data-val'));
    currentBookOptions.rating = val;
    setStarsUI(val);
    saveBookToLibrary(currentBookOptions, 'read'); // db.js
    closeSheet('sh-book-options');
  });
});

function setStarsUI(rating) {
  document.querySelectorAll('#bo-stars span').forEach(star => {
    const val = parseInt(star.getAttribute('data-val'));
    if (val <= rating) star.classList.add('active');
    else star.classList.remove('active');
  });
}

// ============================================================================
//  POST MENU & DELETE
// ============================================================================

let currentPostMenuId = null;

window.openPostMenuFor = function(postId, authorId) {
  currentPostMenuId = postId;
  const actionsDiv = document.getElementById('post-menu-actions');
  
  let html = '';
  if (APP_USER && APP_USER.uid === authorId) {
    html += `<button style="padding:16px; background:#FFEBEB; color:#D32F2F; border:none; border-radius:12px; font-weight:bold; font-size:1rem; cursor:pointer;" onclick="deletePost('${postId}')">Excluir Publicação</button>`;
  } else {
    html += `<button style="padding:16px; background:#F0E8D6; color:#8A7060; border:none; border-radius:12px; font-weight:bold; font-size:1rem; cursor:pointer;" onclick="showToast('Post denunciado.'); closeSheet('sh-post-menu');">Denunciar Publicação</button>`;
  }
  
  actionsDiv.innerHTML = html;
  openSheet('sh-post-menu');
};

window.deletePost = async function(postId) {
  if (!APP_USER || !FIREBASE_CONFIGURED) return;
  const conf = confirm('Tem certeza que deseja excluir esta publicação?');
  if (!conf) return;
  
  try {
    await db.collection('posts').doc(postId).delete();
    
    if (APP_USER.postsCount > 0) {
      APP_USER.postsCount--;
      await db.collection('users').doc(APP_USER.uid).update({ postsCount: APP_USER.postsCount });
    }
    
    showToast('Publicação excluída.');
    closeSheet('sh-post-menu');
    
    document.querySelectorAll(`.post-card[data-post-id="${postId}"]`).forEach(el => el.remove());
    
  } catch (err) {
    console.error("Erro ao excluir post:", err);
    showToast('Erro ao excluir publicação.');
  }
};

// ─── Compose Bar Placeholder Animation ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const placeholders = [
    "O que você está pensando hoje?",
    "O que está lendo?",
    "Pegue um café e compartilhe...",
    "Qual a sua próxima leitura?"
  ];
  let currentPlaceholder = 0;
  
  setInterval(() => {
    const el = document.getElementById('compose-bar-text');
    if (el) {
      currentPlaceholder = (currentPlaceholder + 1) % placeholders.length;
      el.style.opacity = 0;
      setTimeout(() => {
        el.textContent = placeholders[currentPlaceholder];
        el.style.opacity = 1;
      }, 300);
    }
  }, 4000);
});

// ─── Feed Tabs & Post Types ────────────────────────────────────
function togglePostLocationField() {
  const select = document.getElementById('post-type-select');
  const locContainer = document.getElementById('post-location-container');
  if (select && locContainer) {
    if (select.value === 'trade') {
      locContainer.style.display = 'block';
    } else {
      locContainer.style.display = 'none';
      document.getElementById('post-location').value = '';
    }
  }
}

let CURRENT_FEED_TAB = 'normal'; // 'normal' or 'trade'

function switchFeedTab(tab) {
  CURRENT_FEED_TAB = tab;
  const normalTab = document.getElementById('ftab-normal');
  const tradeTab = document.getElementById('ftab-trade');
  if (normalTab) {
    normalTab.classList.toggle('apt', tab === 'normal');
    normalTab.setAttribute('aria-selected', String(tab === 'normal'));
  }
  if (tradeTab) {
    tradeTab.classList.toggle('apt', tab === 'trade');
    tradeTab.setAttribute('aria-selected', String(tab === 'trade'));
  }
  
  // Reload feed with new filter
  if (typeof loadFeed === 'function') {
    loadFeed(true);
  }
}

// ════════════════════════════════════════════════
// EMOJI PICKER LOGIC
// ════════════════════════════════════════════════
let currentEmojiTarget = null;

function toggleEmojiPicker(inputId, btnElement) {
  const popup = document.getElementById('emoji-popup');
  if (!popup) return;
  
  if (popup.classList.contains('hidden') || currentEmojiTarget !== inputId) {
    currentEmojiTarget = inputId;
    popup.classList.remove('hidden');
    
    // Posição dinâmica baseada no botão clicado
    const rect = btnElement.getBoundingClientRect();
    popup.style.position = 'fixed';
    
    // Tenta posicionar ACIMA do botão. Se não couber, posiciona ABAIXO.
    const popupHeight = 350; 
    if (rect.top > popupHeight) {
      popup.style.top = (rect.top - popupHeight - 10) + 'px';
      popup.style.bottom = 'auto';
    } else {
      popup.style.top = (rect.bottom + 10) + 'px';
      popup.style.bottom = 'auto';
    }
    
    // Centraliza horizontalmente em relação ao botão, mas mantém na tela
    let leftPos = rect.left + (rect.width / 2) - 150; // 300px width approx / 2 = 150
    if (leftPos < 10) leftPos = 10;
    if (leftPos + 320 > window.innerWidth) leftPos = window.innerWidth - 320;
    
    popup.style.left = leftPos + 'px';
    popup.style.transform = 'none';
    popup.style.zIndex = '99999';
    
    const picker = popup.querySelector('emoji-picker');
    if (picker) {
      picker.classList.add('light');
    }
  } else {
    popup.classList.add('hidden');
    currentEmojiTarget = null;
  }
}

// Bind emoji picker events once DOM is loaded or script runs
window.addEventListener('load', () => {
  const picker = document.querySelector('emoji-picker');
  if (picker) {
    picker.addEventListener('emoji-click', event => {
      if (currentEmojiTarget) {
        const input = document.getElementById(currentEmojiTarget);
        if (input) {
          // If it's a textarea or input, insert emoji at cursor position or end
          const start = input.selectionStart;
          const end = input.selectionEnd;
          const text = input.value;
          input.value = text.slice(0, start) + event.detail.unicode + text.slice(end);
          input.selectionStart = input.selectionEnd = start + event.detail.unicode.length;
          input.focus();
        }
      }
    });
  }
  
  // Hide on outside click
  document.addEventListener('click', e => {
    const popup = document.getElementById('emoji-popup');
    if (popup && !popup.classList.contains('hidden')) {
      if (!popup.contains(e.target) && !e.target.closest('button[onclick^="toggleEmojiPicker"]')) {
        popup.classList.add('hidden');
        currentEmojiTarget = null;
      }
    }
  });
});
