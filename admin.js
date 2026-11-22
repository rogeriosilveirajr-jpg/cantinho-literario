'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — Painel de moderação (admin.html)
//  Quem é moderador: documento admins/{uid}, criado à mão no console do Firebase.
//  A tela só esconde botões; a proteção de verdade está no firestore.rules
//  (quem não é moderador recebe "permission-denied" em todas estas leituras e gravações).
// ============================================================

const USERS_LIMIT = 500;
const POSTS_PAGE = 30;
const REPORTS_LIMIT = 50;
const PREVIEW_CHARS = 600;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TS = () => firebase.firestore.FieldValue.serverTimestamp();

const state = {
  me: null,
  users: [],
  usersById: new Map(),
  bannedIds: new Set(),
  lastPost: null,
};

const $ = id => document.getElementById(id);
const esc = s => CL.escapeHtml(s);

// ─── utilidades de tela ─────────────────────────────────────
function show(id) {
  ['adm-loading', 'adm-login', 'adm-denied', 'adm-panel'].forEach(x => $(x).classList.toggle('hidden', x !== id));
}

let toastTimer;
function toast(msg) {
  const t = $('adm-toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function explainError(err, fallback) {
  console.error(err);
  if (err && err.code === 'permission-denied') return 'Sem permissão para isso.';
  return fallback;
}

/** Mantém o ?emulador nos links, para os testes locais não saírem do emulador. */
function keepQuery(href) {
  return location.search ? href + location.search : href;
}

function authorName(post) {
  const known = state.usersById.get(post.authorId);
  return post.authorSnap?.displayName || known?.displayName || 'Leitor';
}

function safeImage(post) {
  const url = Array.isArray(post.imageUrls) ? post.imageUrls[0] : null;
  return typeof url === 'string' && /^(https:\/\/|data:image\/(png|jpe?g|webp|gif);)/.test(url) ? url : null;
}

// ─── acesso ─────────────────────────────────────────────────
async function isModerator(uid) {
  try {
    return (await db.collection('admins').doc(uid).get()).exists;
  } catch (err) {
    console.error('Erro ao verificar moderador:', err);
    return false;
  }
}

function start() {
  $('adm-back').href = keepQuery('index.html');
  $('adm-login-link').href = keepQuery('index.html');
  if (!FIREBASE_CONFIGURED) { show('adm-denied'); return; }
  auth.onAuthStateChanged(async user => {
    if (!user) { show('adm-login'); return; }
    if (!(await isModerator(user.uid))) { show('adm-denied'); return; }
    state.me = user.uid;
    $('adm-who').textContent = user.email || '';
    show('adm-panel');
    bindEvents();
    await loadUsers();
  });
}

// ─── abas ───────────────────────────────────────────────────
const TAB_LOADERS = { users: () => loadUsers(), posts: () => loadPosts(true), hidden: () => loadHidden(), reports: () => loadReports() };

function openTab(name) {
  document.querySelectorAll('.adm-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.adm-tab').forEach(s => s.classList.toggle('hidden', s.id !== `tab-${name}`));
  TAB_LOADERS[name]();
}

let eventsBound = false;
function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.querySelector('.adm-tabs').addEventListener('click', e => {
    const tab = e.target.closest('button[data-tab]');
    if (tab) openTab(tab.dataset.tab);
  });
  $('user-search').addEventListener('input', renderUsers);
  $('post-more').addEventListener('click', () => loadPosts(false));
  $('adm-panel').addEventListener('click', onAction);
}

const ACTIONS = {
  ban: btn => banUser(btn.dataset.id),
  unban: btn => unbanUser(btn.dataset.id),
  hide: btn => hidePost(btn.dataset.id, btn.dataset.report),
  delete: btn => deletePost(btn.dataset.id),
  restore: btn => restorePost(btn.dataset.id),
  purge: btn => purgeHidden(btn.dataset.id),
  dismiss: btn => closeReport(btn.dataset.report, 'DISMISSED'),
};

async function onAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !ACTIONS[btn.dataset.action] || !SAFE_ID.test(btn.dataset.id || btn.dataset.report || '')) return;
  btn.disabled = true;
  try { await ACTIONS[btn.dataset.action](btn); } finally { btn.disabled = false; }
}

// ─── usuários ───────────────────────────────────────────────
async function loadUsers() {
  $('user-rows').innerHTML = '<tr><td colspan="6">Carregando…</td></tr>';
  try {
    const [usersSnap, bannedSnap] = await Promise.all([
      db.collection('users').orderBy('createdAt', 'desc').limit(USERS_LIMIT).get(),
      db.collection('bannedUsers').get(),
    ]);
    state.users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
    state.usersById = new Map(state.users.map(u => [u.uid, u]));
    state.bannedIds = new Set(bannedSnap.docs.map(d => d.id));
    renderUsers();
  } catch (err) {
    $('user-rows').innerHTML = `<tr><td colspan="6">${esc(explainError(err, 'Não foi possível carregar os usuários.'))}</td></tr>`;
  }
}

function userRow(u) {
  const banned = state.bannedIds.has(u.uid);
  const methods = CL.loginMethods(u.authProviders).map(m => `<span class="tag">${esc(m)}</span>`).join('') || '—';
  const status = [
    u.isDeleted ? '<span class="tag">Conta excluída</span>' : '',
    u.isPrivate ? '<span class="tag">Privado</span>' : '',
    banned ? '<span class="tag tag-danger">Bloqueado</span>' : '',
  ].join('') || '<span class="tag">Ativo</span>';
  const action = u.uid === state.me ? '<span class="adm-count">você</span>'
    : `<button class="btn ${banned ? 'btn-light' : 'btn-danger'}" data-action="${banned ? 'unban' : 'ban'}" data-id="${esc(u.uid)}">${banned ? 'Desbloquear' : 'Bloquear'}</button>`;
  return `<tr data-user="${esc(u.uid)}">
    <td><div class="u-name">${esc(u.displayName || 'Leitor')}</div><div class="u-handle">@${esc(u.handle || '')}</div></td>
    <td>${esc(CL.formatDateBR(u.createdAt))}</td>
    <td>${methods}</td>
    <td>${Number(u.postsCount) || 0}</td>
    <td>${status}</td>
    <td>${action}</td>
  </tr>`;
}

function renderUsers() {
  const list = CL.filterUsers(state.users, $('user-search').value);
  $('user-count').textContent = `${list.length} de ${state.users.length} cadastrados`;
  $('user-rows').innerHTML = list.length ? list.map(userRow).join('') : '<tr><td colspan="6">Nenhum usuário encontrado.</td></tr>';
}

async function banUser(uid) {
  const name = state.usersById.get(uid)?.displayName || 'este usuário';
  const reason = prompt(`Bloquear ${name}? A pessoa continua lendo, mas não publica, comenta, curte, segue nem conversa.\n\nMotivo (opcional):`, '');
  if (reason === null) return;
  try {
    await db.collection('bannedUsers').doc(uid).set({ reason: reason.trim().slice(0, 300), bannedBy: state.me, bannedAt: TS() });
    state.bannedIds = new Set([...state.bannedIds, uid]);
    renderUsers();
    toast(`${name} foi bloqueado.`);
  } catch (err) {
    toast(explainError(err, 'Não foi possível bloquear.') + ' (Moderadores não podem ser bloqueados.)');
  }
}

async function unbanUser(uid) {
  try {
    await db.collection('bannedUsers').doc(uid).delete();
    state.bannedIds = new Set([...state.bannedIds].filter(id => id !== uid));
    renderUsers();
    toast('Bloqueio removido.');
  } catch (err) {
    toast(explainError(err, 'Não foi possível desbloquear.'));
  }
}

// ─── publicações ────────────────────────────────────────────
function postCard(id, post, { actions, extraMeta = '' }) {
  const img = safeImage(post);
  const text = String(post.text || '').slice(0, PREVIEW_CHARS);
  return `<div class="card" data-post="${esc(id)}">
    <div class="card-meta"><b>${esc(authorName(post))}</b> · ${esc(CL.formatDateBR(post.createdAt))}
      ${post.isPrivate ? ' · <span class="tag">Privado</span>' : ''}
      ${post.book?.title ? ` · 📖 ${esc(post.book.title)}` : ''}${extraMeta}</div>
    <div class="card-text">${esc(text) || '<i>(sem texto)</i>'}</div>
    ${img ? `<img class="card-img" src="${esc(img)}" alt="Imagem da publicação"/>` : ''}
    <div class="card-actions">${actions}</div>
  </div>`;
}

const postActions = id => `
  <button class="btn btn-light" data-action="hide" data-id="${esc(id)}">Ocultar</button>
  <button class="btn btn-danger" data-action="delete" data-id="${esc(id)}">Excluir</button>`;

async function loadPosts(reset) {
  const box = $('post-list');
  if (reset) { state.lastPost = null; box.innerHTML = '<p class="adm-hint">Carregando…</p>'; }
  try {
    let q = db.collection('posts').orderBy('createdAt', 'desc').limit(POSTS_PAGE);
    if (state.lastPost) q = q.startAfter(state.lastPost);
    const snap = await q.get();
    const html = snap.docs.map(d => postCard(d.id, d.data(), { actions: postActions(d.id) })).join('');
    if (reset) box.innerHTML = html || '<p class="adm-hint">Nenhuma publicação ainda.</p>';
    else box.insertAdjacentHTML('beforeend', html);
    state.lastPost = snap.docs[snap.docs.length - 1] || state.lastPost;
    $('post-more').classList.toggle('hidden', snap.size < POSTS_PAGE);
  } catch (err) {
    box.innerHTML = `<p class="adm-hint">${esc(explainError(err, 'Não foi possível carregar as publicações.'))}</p>`;
  }
}

function removeCards(postId) {
  document.querySelectorAll(`[data-post="${postId}"]`).forEach(el => el.remove());
}

/** Ocultar = copiar o post, sem mudar nada, para moderatedPosts e apagar o original, numa só gravação. */
async function hidePost(postId, reportId) {
  const reason = prompt('Ocultar esta publicação? Ela some para todos, mas dá para restaurar depois.\n\nMotivo (opcional):', '');
  if (reason === null) return;
  try {
    const ref = db.collection('posts').doc(postId);
    const snap = await ref.get();
    if (!snap.exists) { toast('A publicação já não existe.'); removeCards(postId); return; }
    const batch = db.batch();
    batch.set(db.collection('moderatedPosts').doc(postId), { post: snap.data(), hiddenBy: state.me, hiddenAt: TS(), reason: reason.trim().slice(0, 300) });
    batch.delete(ref);
    if (reportId) batch.update(db.collection('contentReports').doc(reportId), reportClosed('HIDDEN'));
    await batch.commit();
    removeCards(postId);
    if (reportId) document.querySelector(`[data-report-card="${reportId}"]`)?.remove();
    toast('Publicação ocultada.');
  } catch (err) {
    toast(explainError(err, 'Não foi possível ocultar.'));
  }
}

async function deletePost(postId) {
  if (!confirm('Excluir esta publicação de vez? Não dá para desfazer.')) return;
  try {
    await db.collection('posts').doc(postId).delete();
    removeCards(postId);
    toast('Publicação excluída.');
  } catch (err) {
    toast(explainError(err, 'Não foi possível excluir.'));
  }
}

// ─── ocultadas ──────────────────────────────────────────────
async function loadHidden() {
  const box = $('hidden-list');
  box.innerHTML = '<p class="adm-hint">Carregando…</p>';
  try {
    const snap = await db.collection('moderatedPosts').orderBy('hiddenAt', 'desc').limit(POSTS_PAGE).get();
    box.innerHTML = snap.docs.map(d => {
      const m = d.data();
      const meta = ` · ocultada em ${esc(CL.formatDateBR(m.hiddenAt))}${m.reason ? ` · motivo: ${esc(m.reason)}` : ''}`;
      const actions = `
        <button class="btn" data-action="restore" data-id="${esc(d.id)}">Restaurar</button>
        <button class="btn btn-danger" data-action="purge" data-id="${esc(d.id)}">Excluir de vez</button>`;
      return postCard(d.id, m.post || {}, { actions, extraMeta: meta });
    }).join('') || '<p class="adm-hint">Nenhuma publicação ocultada.</p>';
  } catch (err) {
    box.innerHTML = `<p class="adm-hint">${esc(explainError(err, 'Não foi possível carregar as ocultadas.'))}</p>`;
  }
}

async function restorePost(postId) {
  try {
    const ref = db.collection('moderatedPosts').doc(postId);
    const snap = await ref.get();
    if (!snap.exists) { removeCards(postId); return; }
    const batch = db.batch();
    batch.set(db.collection('posts').doc(postId), snap.data().post);
    batch.delete(ref);
    await batch.commit();
    removeCards(postId);
    toast('Publicação restaurada.');
  } catch (err) {
    toast(explainError(err, 'Não foi possível restaurar.'));
  }
}

async function purgeHidden(postId) {
  if (!confirm('Excluir de vez esta publicação ocultada? Não dá para desfazer.')) return;
  try {
    await db.collection('moderatedPosts').doc(postId).delete();
    removeCards(postId);
    toast('Publicação excluída.');
  } catch (err) {
    toast(explainError(err, 'Não foi possível excluir.'));
  }
}

// ─── denúncias ──────────────────────────────────────────────
const reportClosed = status => ({ status, reviewedBy: state.me, reviewedAt: TS() });

async function loadReports() {
  const box = $('report-list');
  box.innerHTML = '<p class="adm-hint">Carregando…</p>';
  try {
    const snap = await db.collection('contentReports').where('status', '==', 'PENDING').limit(REPORTS_LIMIT).get();
    const cards = await Promise.all(snap.docs.map(reportCard));
    box.innerHTML = cards.join('') || '<p class="adm-hint">Nenhuma denúncia pendente 🎉</p>';
  } catch (err) {
    box.innerHTML = `<p class="adm-hint">${esc(explainError(err, 'Não foi possível carregar as denúncias.'))}</p>`;
  }
}

async function reportCard(r) {
  const rep = r.data();
  const target = SAFE_ID.test(rep.targetId || '') ? rep.targetId : null;
  const p = target ? await db.collection('posts').doc(target).get().catch(() => null) : null;
  const post = p && p.exists ? p.data() : null;
  const dismiss = `<button class="btn btn-light" data-action="dismiss" data-report="${esc(r.id)}">Dispensar</button>`;
  const hide = post ? `<button class="btn btn-danger" data-action="hide" data-id="${esc(target)}" data-report="${esc(r.id)}">Ocultar publicação</button>` : '';
  const body = post
    ? postCard(target, post, { actions: hide + dismiss })
    : `<div class="card"><div class="card-text"><i>A publicação já foi removida.</i></div><div class="card-actions">${dismiss}</div></div>`;
  return `<div data-report-card="${esc(r.id)}"><div class="card-meta" style="color:var(--danger);font-weight:700">Motivo: ${esc(rep.reason || '—')} · ${esc(CL.formatDateBR(rep.createdAt))}</div>${body}</div>`;
}

async function closeReport(reportId, status) {
  try {
    await db.collection('contentReports').doc(reportId).update(reportClosed(status));
    document.querySelector(`[data-report-card="${reportId}"]`)?.remove();
    toast('Denúncia dispensada.');
  } catch (err) {
    toast(explainError(err, 'Não foi possível dispensar.'));
  }
}

start();
