'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — clubes: cronograma de leitura conjunta,
//  conversa por etapa (sem spoiler), votação do próximo livro e encontros.
//  Regras puras em lib/community.js (CLC). O resto do clube fica em features.js.
// ============================================================

const SCHEDULE_ROWS_MAX = 12;
const STAGE_MESSAGES_LIMIT = 200;     // conversa de uma etapa (busca só a etapa)
const GENERAL_MESSAGES_SCAN = 150;    // conversa geral (as recentes, sem as das etapas)
const POLL_OPTIONS_MAX = 4;
const GENERAL_CHAT = -1;

let CLUB_CHAT_MILESTONE = GENERAL_CHAT;   // etapa da conversa aberta (-1 = geral)
let CLUB_EXTRAS_FOR = null;               // id do clube desenhado por último
let CLUB_VOTES = [];                      // votos da votação atual
let SCHEDULE_DRAFT = [];
let POLL_PICKS = [];

const isClubOwner = c => Boolean(APP_USER && c && c.ownerId === APP_USER.uid);
const isItem = x => Boolean(x) && typeof x === 'object';   // ignora itens malformados gravados no clube

/** Chamado por renderClub (features.js) depois de desenhar o clube. */
function renderClubExtras(c) {
  if (CLUB_EXTRAS_FOR !== c.id) { CLUB_CHAT_MILESTONE = GENERAL_CHAT; CLUB_VOTES = []; CLUB_EXTRAS_FOR = c.id; }
  const box = document.getElementById('club-extras');
  if (box) box.innerHTML = scheduleHtml(c) + '<div id="club-poll"></div>' + meetingHtml(c);
  renderClubPoll(c);
  renderChatTabs(c);
  if (c.pollId && isClubMember(c.id)) loadClubVotes(c);   // features.js
}

// ─── cronograma ─────────────────────────────────────────────
function scheduleOf(c) {
  return Array.isArray(c.schedule) ? c.schedule.filter(isItem) : [];
}

function pollOptionsOf(c) {
  return Array.isArray(c.pollOptions) ? c.pollOptions.filter(isItem) : [];
}

function scheduleHtml(c) {
  const items = scheduleOf(c);
  const cur = CLC.currentMilestone(items, new Date());
  const list = items.length
    ? `<ol class="club-sched">${items.map((it, i) => `
        <li class="${i === cur ? 'current' : ''}"><span>${escHtml(it.label)}</span><small>até ${escHtml(dueLabel(it.due))}</small></li>`).join('')}</ol>`
    : (isClubOwner(c) ? '<p class="muted-small">Monte as etapas da leitura conjunta (ex.: "Capítulos 1 a 5 até sexta").</p>' : '');
  if (!items.length && !isClubOwner(c)) return '';
  return `<h4 class="bp-section">🗓️ Cronograma</h4>${list}
    ${isClubOwner(c) ? '<button class="bp-btn bp-btn-ghost" onclick="openScheduleEditor()">Editar cronograma</button>' : ''}`;
}

function dueLabel(due) {
  const [y, m, d] = String(due).split('-');
  return d ? `${d}/${m}/${y}` : due;
}

function openScheduleEditor() {
  const items = scheduleOf(CURRENT_CLUB);
  SCHEDULE_DRAFT = items.length ? items.map(i => ({ ...i })) : [{ label: '', due: '' }];
  renderScheduleRows();
  openSheet('sh-schedule');
}

function renderScheduleRows() {
  document.getElementById('schedule-rows').innerHTML = SCHEDULE_DRAFT.map((it, i) => `
    <div class="sched-row">
      <input class="ep-input" maxlength="80" value="${escHtml(it.label)}" placeholder="Ex.: Capítulos 1 a 5"
        aria-label="Nome da etapa ${i + 1}" oninput="SCHEDULE_DRAFT[${i}] = { ...SCHEDULE_DRAFT[${i}], label: this.value }"/>
      <input class="ep-input" type="date" value="${escHtml(it.due)}" aria-label="Data da etapa ${i + 1}"
        oninput="SCHEDULE_DRAFT[${i}] = { ...SCHEDULE_DRAFT[${i}], due: this.value }"/>
      <button class="sched-remove" aria-label="Remover etapa ${i + 1}" onclick="removeScheduleRow(${i})">✕</button>
    </div>`).join('');
}

function addScheduleRow() {
  if (SCHEDULE_DRAFT.length >= SCHEDULE_ROWS_MAX) { showToast(`Até ${SCHEDULE_ROWS_MAX} etapas 🙂`); return; }
  SCHEDULE_DRAFT = [...SCHEDULE_DRAFT, { label: '', due: '' }];
  renderScheduleRows();
}

function removeScheduleRow(index) {
  SCHEDULE_DRAFT = SCHEDULE_DRAFT.filter((_, i) => i !== index);
  renderScheduleRows();
}

async function saveSchedule() {
  const r = CLC.validateSchedule(SCHEDULE_DRAFT);
  if (!r.ok) { showToast(r.errors[0]); return; }
  await updateCurrentClub({ schedule: r.items }, 'Cronograma salvo! 🗓️');
  closeSheet('sh-schedule');
}

/** Grava campos do clube aberto (só o dono) e redesenha. */
async function updateCurrentClub(fields, okMessage) {
  try {
    await db.collection('clubs').doc(CURRENT_CLUB.id).update(fields);
    CURRENT_CLUB = { ...CURRENT_CLUB, ...fields };
    renderClub();   // features.js
    if (okMessage) showToast(okMessage);
    return true;
  } catch (err) {
    console.error('Erro ao atualizar o clube:', err);
    showToast('Erro ao salvar no clube 😕');
    return false;
  }
}

// ─── conversa por etapa ─────────────────────────────────────
function renderChatTabs(c) {
  const box = document.getElementById('club-chat-tabs');
  if (!box) return;
  const items = scheduleOf(c);
  if (!items.length) { box.innerHTML = ''; return; }
  const tab = (value, label, title) => `<button role="tab" class="chat-tab" aria-selected="${CLUB_CHAT_MILESTONE === value}"
    ${title ? `title="${escHtml(title)}"` : ''} onclick="setClubChatMilestone(${value})">${label}</button>`;
  box.innerHTML = tab(GENERAL_CHAT, 'Geral') + items.map((it, i) => tab(i, `Etapa ${i + 1}`, it.label)).join('');
}

function setClubChatMilestone(value) {
  CLUB_CHAT_MILESTONE = value;
  renderChatTabs(CURRENT_CLUB);
  stopClubMessages();                     // features.js
  if (isClubMember(CURRENT_CLUB.id)) listenClubMessages(CURRENT_CLUB.id);
}

/** Usado por listenClubMessages: numa etapa, busca só as mensagens dela (não depende das 50 mais recentes do clube). */
function clubMessagesQuery(messages) {
  return CLUB_CHAT_MILESTONE >= 0
    ? messages.where('milestone', '==', CLUB_CHAT_MILESTONE).limit(STAGE_MESSAGES_LIMIT)
    : messages.orderBy('createdAt', 'desc').limit(GENERAL_MESSAGES_SCAN);
}

/** Usado por listenClubMessages: mostra só as mensagens da etapa aberta. */
function clubMessageVisible(m) {
  const stage = Number.isInteger(m.milestone) ? m.milestone : GENERAL_CHAT;
  return stage === CLUB_CHAT_MILESTONE;
}

/** Usado por sendClubMessage: campos extras da mensagem nova. */
function clubMessageExtras() {
  return CLUB_CHAT_MILESTONE >= 0 ? { milestone: CLUB_CHAT_MILESTONE } : {};
}

// ─── votação do próximo livro ───────────────────────────────
async function loadClubVotes(c) {
  try {
    const snap = await db.collection('clubs').doc(c.id).collection('votes').get();
    CLUB_VOTES = snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(v => v.pollId === c.pollId);
  } catch (err) {
    console.error('Erro ao carregar os votos:', err);
  }
  if (CURRENT_CLUB && CURRENT_CLUB.id === c.id) renderClubPoll(CURRENT_CLUB);
}

function renderClubPoll(c) {
  const box = document.getElementById('club-poll');
  if (!box) return;
  const options = pollOptionsOf(c);
  const owner = isClubOwner(c);
  const newBtn = owner ? '<button class="bp-btn bp-btn-ghost" onclick="openPollEditor()">Nova votação</button>' : '';
  if (!options.length) { box.innerHTML = owner ? `<h4 class="bp-section">🗳️ Próximo livro</h4>${newBtn}` : ''; return; }
  const t = CLC.tallyVotes(CLUB_VOTES, options.length);
  const head = '<h4 class="bp-section">🗳️ Votação do próximo livro</h4>';
  if (!c.pollOpen) {
    const win = options[t.winner];
    box.innerHTML = `${head}<p class="poll-result">${win ? `Vencedor: <strong>${escHtml(win.title)}</strong>` : 'Votação encerrada.'}</p>${newBtn}`;
    return;
  }
  box.innerHTML = head + options.map((b, i) => pollOptionHtml(c, b, i, t.counts[i])).join('')
    + (isClubMember(c.id) ? '' : '<p class="muted-small">Entre no clube para votar.</p>')
    + (owner ? '<button class="bp-btn" onclick="closePoll()">Encerrar votação</button>' : '');
}

function pollOptionHtml(c, book, index, count) {
  const mine = CLUB_VOTES.find(v => APP_USER && v.uid === APP_USER.uid);
  const chosen = mine && mine.option === index;
  const action = isClubMember(c.id)
    ? `<button class="wl-action" ${chosen ? 'disabled' : ''} onclick="voteInPoll(${index})">${chosen ? 'Seu voto ✓' : 'Votar'}</button>` : '';
  return `<div class="poll-option ${chosen ? 'chosen' : ''}">
      <span class="wl-name"><strong>${escHtml(book.title)}</strong><small>${escHtml(book.author || '')}</small></span>
      <span class="poll-count">${count} ${count === 1 ? 'voto' : 'votos'}</span>${action}
    </div>`;
}

async function voteInPoll(option) {
  const c = CURRENT_CLUB;
  try {
    await db.collection('clubs').doc(c.id).collection('votes').doc(APP_USER.uid).set({ option, pollId: c.pollId });
    showToast('Voto registrado! 🗳️');
    await loadClubVotes(c);
  } catch (err) {
    console.error('Erro ao votar:', err);
    showToast('Não deu para votar 😕');
  }
}

function openPollEditor() {
  POLL_PICKS = [];
  renderPollPicks();
  openSheet('sh-poll');
}

function renderPollPicks() {
  document.getElementById('poll-picks').innerHTML = POLL_PICKS.length
    ? POLL_PICKS.map((b, i) => `<div class="poll-pick"><span>📖 <strong>${escHtml(b.title)}</strong> · ${escHtml(b.author)}</span>
        <button class="sched-remove" aria-label="Tirar ${escHtml(b.title)}" onclick="removePollPick(${i})">✕</button></div>`).join('')
    : '<p class="muted-small">Escolha de 2 a 4 livros.</p>';
}

/** Chamado por onBookPicked (features.js) no modo 'poll'. */
function addPollPick(book) {
  if (POLL_PICKS.length >= POLL_OPTIONS_MAX) { showToast(`Até ${POLL_OPTIONS_MAX} livros 🙂`); return; }
  POLL_PICKS = CLC.addBookToList(POLL_PICKS, book);
  renderPollPicks();
}

function removePollPick(index) {
  POLL_PICKS = POLL_PICKS.filter((_, i) => i !== index);
  renderPollPicks();
}

async function startPoll() {
  const r = CLC.validatePoll(POLL_PICKS);
  if (!r.ok) { showToast(r.errors[0]); return; }
  const pollId = `p${Date.now().toString(36)}`;
  CLUB_VOTES = [];
  const ok = await updateCurrentClub({ pollId, pollOpen: true, pollOptions: POLL_PICKS }, 'Votação aberta! 🗳️');
  if (ok) closeSheet('sh-poll');
}

async function closePoll() {
  const c = CURRENT_CLUB;
  await loadClubVotes(c);   // conta os votos mais recentes, não os da hora em que a tela abriu
  const options = pollOptionsOf(c);
  const t = CLC.tallyVotes(CLUB_VOTES, options.length);
  if (t.winner < 0) { showToast('Ninguém votou ainda.'); return; }
  const winner = options[t.winner];
  const book = { id: winner.id, title: winner.title, author: winner.author || '', coverUrl: winner.coverUrl || '' };
  await updateCurrentClub({ pollOpen: false, bookOfMonth: book }, `Próximo livro: ${winner.title} 📖`);
}

// ─── encontro ───────────────────────────────────────────────
function meetingDate(m) {
  if (!m || !m.when) return null;
  const d = typeof m.when.toDate === 'function' ? m.when.toDate() : new Date(m.when);
  return Number.isNaN(d.getTime()) ? null : d;
}

function meetingWhenLabel(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${CL.formatDateBR(d)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function meetingHtml(c) {
  const when = meetingDate(c.nextMeeting);
  const owner = isClubOwner(c);
  const upcoming = when && when.getTime() > Date.now();
  const ownerBtns = owner ? `<div class="club-row-btns">
      <button class="bp-btn bp-btn-ghost" onclick="openMeetingEditor()">${upcoming ? 'Mudar encontro' : 'Marcar encontro'}</button>
      ${upcoming ? '<button class="bp-btn bp-btn-ghost" onclick="cancelMeeting()">Cancelar encontro</button>' : ''}</div>` : '';
  if (!upcoming) return owner ? `<h4 class="bp-section">📅 Encontro</h4>${ownerBtns}` : '';
  const m = c.nextMeeting;
  const link = /^https:\/\/\S+$/.test(m.link || '')
    ? ` · <a href="${escHtml(m.link)}" target="_blank" rel="noopener noreferrer">entrar online</a>` : '';
  return `<h4 class="bp-section">📅 Próximo encontro</h4>
    <p class="club-meeting">${escHtml(meetingWhenLabel(when))}${m.place ? ` · ${escHtml(m.place)}` : ''}${link}</p>
    <button class="bp-btn bp-btn-ghost" onclick="downloadMeetingIcs()">🗓️ Adicionar à agenda</button>${ownerBtns}`;
}

function openMeetingEditor() {
  const m = CURRENT_CLUB.nextMeeting || {};
  const when = meetingDate(m);
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('meet-when').value = when
    ? `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}` : '';
  document.getElementById('meet-place').value = m.place || '';
  document.getElementById('meet-link').value = m.link || '';
  openSheet('sh-meeting');
}

async function saveMeeting() {
  const r = CLC.validateMeeting({
    when: document.getElementById('meet-when').value,
    place: document.getElementById('meet-place').value,
    link: document.getElementById('meet-link').value,
  }, new Date());
  if (!r.ok) { showToast(r.errors[0]); return; }
  const nextMeeting = { when: firebase.firestore.Timestamp.fromDate(r.meeting.when), place: r.meeting.place, link: r.meeting.link };
  const ok = await updateCurrentClub({ nextMeeting }, 'Encontro marcado! 📅');
  if (ok) closeSheet('sh-meeting');
}

async function cancelMeeting() {
  if (!window.confirm('Cancelar o encontro marcado?')) return;
  await updateCurrentClub({ nextMeeting: null }, 'Encontro cancelado.');
}

function downloadMeetingIcs() {
  const c = CURRENT_CLUB;
  const when = meetingDate(c.nextMeeting);
  if (!when) return;
  const ics = CLC.meetingIcs({ title: `Encontro: ${c.name}`, when, place: c.nextMeeting.place, link: c.nextMeeting.link }, c.id);
  saveFile(new Blob([ics], { type: 'text/calendar' }), 'encontro-clube.ics');   // daily.js
}
