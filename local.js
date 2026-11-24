'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — o lado local: reputação nas trocas, atalhos das
//  cidades com trocas abertas e pontos de leitura (sebos, bibliotecas...).
//  Regras puras em lib/community.js (CLC).
// ============================================================

const REPUTATION_POSTS_LIMIT = 300;
const TRADE_CITIES_SCAN = 60;
const TRADE_CITIES_SHOWN = 8;
const SPOTS_LIMIT = 30;

let TRADE_CITY = '';                   // cidade escolhida nos atalhos da aba Trocas

// ════════════════════════════════════════════════════════════
//  REPUTAÇÃO NAS TROCAS
// ════════════════════════════════════════════════════════════

/** "🔄 N trocas concluídas" no perfil. Conta só os posts públicos, para o número ser o mesmo para todos. */
async function loadReputation(userId, elementId) {
  const el = document.getElementById(elementId);
  if (!el || !userId || !FIREBASE_CONFIGURED) return;
  el.hidden = true;
  try {
    const snap = await db.collection('posts').where('authorId', '==', userId).where('isPrivate', '==', false)
      .limit(REPUTATION_POSTS_LIMIT).get();
    const label = CLC.reputationLabel(CLC.tradesDone(snap.docs.map(d => d.data())));
    el.textContent = label;
    el.hidden = !label;
  } catch (err) {
    console.error('Erro ao calcular a reputação nas trocas:', err);
  }
}

// ════════════════════════════════════════════════════════════
//  CIDADES COM TROCAS ABERTAS (aba Trocas & Doações)
// ════════════════════════════════════════════════════════════

/** Chamado por switchFeedTab (app.js). */
async function loadTradeCities() {
  const box = document.getElementById('trade-cities');
  if (!box) return;
  box.hidden = CURRENT_FEED_TAB !== 'trade';
  if (box.hidden || !FIREBASE_CONFIGURED) return;
  try {
    const snap = await db.collection('posts').where('isPrivate', '==', false).where('postType', '==', 'trade')
      .orderBy('createdAt', 'desc').limit(TRADE_CITIES_SCAN).get();
    const cities = CLC.tradeCities(snap.docs.map(d => d.data()).filter(d => !APP_BLOCKED.includes(d.authorId)))
      .slice(0, TRADE_CITIES_SHOWN);
    box.innerHTML = cities.map(c => `
      <button class="city-chip" data-city="${escHtml(c.city)}" aria-pressed="${CL.sameCity(c.city, TRADE_CITY)}"
        onclick="setTradeCity(this.dataset.city)">📍 ${escHtml(c.city)} (${c.count})</button>`).join('');
  } catch (err) {
    console.error('Erro ao carregar as cidades com trocas:', err);
    box.innerHTML = '';
  }
}

function setTradeCity(city) {
  TRADE_CITY = CL.sameCity(city, TRADE_CITY) ? '' : city;
  document.querySelectorAll('#trade-cities .city-chip').forEach(b => {
    b.setAttribute('aria-pressed', String(CL.sameCity(b.dataset.city, TRADE_CITY)));
  });
  loadFeed(true);   // db.js
}

/** Usado por passesTradeFilter (features.js). */
function passesTradeCity(d) {
  return !TRADE_CITY || CL.sameCity(d.location, TRADE_CITY);
}

// ════════════════════════════════════════════════════════════
//  PONTOS DE LEITURA
// ════════════════════════════════════════════════════════════

async function loadSpots(cityText) {
  const box = document.getElementById('spots-list');
  if (!box || !FIREBASE_CONFIGURED) return;
  const key = CL.cityKey(cityText);
  box.innerHTML = '<p class="muted-small">Procurando lugares...</p>';
  try {
    const base = db.collection('readingSpots');
    const q = key ? base.where('cityKey', '==', key).limit(SPOTS_LIMIT) : base.orderBy('createdAt', 'desc').limit(SPOTS_LIMIT);
    const snap = await q.get();
    box.innerHTML = snap.empty
      ? `<p class="muted-small">${key ? 'Nenhum lugar nesta cidade ainda.' : 'Nenhum lugar sugerido ainda.'} Que tal sugerir o primeiro? 📍</p>`
      : snap.docs.map(d => spotCardHtml(d.id, d.data())).join('');
  } catch (err) {
    console.error('Erro ao carregar os pontos de leitura:', err);
    box.innerHTML = '<p class="muted-small">Não deu para carregar os lugares agora.</p>';
  }
}

function spotCardHtml(id, s) {
  const canDelete = APP_USER && (s.authorId === APP_USER.uid || APP_IS_ADMIN);   // db.js
  return `
    <article class="spot-card">
      <span class="spot-kind">${escHtml(CLC.spotKindLabel(s.kind))}</span>
      <strong class="spot-name">${escHtml(s.name)}</strong>
      <span class="spot-where">${escHtml([s.address, s.city].filter(Boolean).join(' · '))}</span>
      <div class="spot-actions">
        <a class="spot-map" href="${escHtml(CLC.mapLink(s))}" target="_blank" rel="noopener noreferrer">🗺️ Ver no mapa</a>
        ${canDelete ? `<button class="spot-remove" data-id="${escHtml(id)}" onclick="deleteSpot(this.dataset.id)">Remover</button>` : ''}
      </div>
    </article>`;
}

function openNewSpot() {
  ['spot-name', 'spot-address'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('spot-kind').value = 'sebo';
  document.getElementById('spot-city').value = (APP_USER && APP_USER.city) || '';
  openSheet('sh-new-spot');
}

async function saveSpot() {
  const r = CLC.validateSpot({
    name: document.getElementById('spot-name').value,
    kind: document.getElementById('spot-kind').value,
    city: document.getElementById('spot-city').value,
    address: document.getElementById('spot-address').value,
  });
  if (!r.ok) { showToast(r.errors[0]); return; }
  try {
    await db.collection('readingSpots').add({
      ...r.spot,
      authorId: APP_USER.uid,
      authorName: APP_USER.displayName || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    closeSheet('sh-new-spot');
    showToast('Lugar sugerido! Obrigado 📍');
    const filter = document.getElementById('spots-city');
    if (filter) filter.value = r.spot.city;
    loadSpots(r.spot.city);
  } catch (err) {
    console.error('Erro ao sugerir lugar:', err);
    showToast('Não deu para salvar o lugar 😕');
  }
}

async function deleteSpot(id) {
  if (!window.confirm('Remover este lugar da lista?')) return;
  try {
    await db.collection('readingSpots').doc(id).delete();
    loadSpots(document.getElementById('spots-city').value);
  } catch (err) {
    console.error('Erro ao remover lugar:', err);
    showToast('Não deu para remover 😕');
  }
}
