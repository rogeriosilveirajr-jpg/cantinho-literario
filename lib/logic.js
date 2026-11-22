// ============================================================
//  CANTINHO LITERÁRIO — regras puras (sem DOM e sem Firebase)
//  No navegador ficam em window.CL; nos testes, via require().
//  Tudo aqui recebe dados e devolve dados novos, sem alterar a entrada.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_RATING = 1;
  const MAX_RATING = 5;
  const LIKED_RATING = 4;          // nota a partir da qual alguém "gostou" do livro
  const SHARE_TEXT_LIMIT = 280;
  const CLUB_NAME_MIN = 3;
  const CLUB_NAME_MAX = 60;
  const CLUB_DESCRIPTION_MAX = 300;
  const CLUB_CITY_MAX = 60;
  const DEFAULT_READING_GOAL = 24;
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const TRADE_LABELS = { AVAILABLE: 'Disponível', RESERVED: 'Combinado', DONE: 'Trocado' };
  // Uma troca concluída não volta atrás; as outras podem avançar ou ser desfeitas.
  const TRADE_NEXT = { AVAILABLE: ['RESERVED', 'DONE'], RESERVED: ['AVAILABLE', 'DONE'], DONE: [] };

  /** @param {unknown} s @returns {string} minúsculo, sem acentos e com espaços simples */
  function normalizeText(s) {
    if (s === null || s === undefined) return '';
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** "Joinville - SC" → "joinville" */
  function cityKey(s) {
    return normalizeText(String(s ?? '').split(/[-,/]/)[0]);
  }

  /** @returns {boolean} true quando as duas cidades são a mesma (sem contar estado, acento e caixa) */
  function sameCity(a, b) {
    const ka = cityKey(a);
    return ka !== '' && ka === cityKey(b);
  }

  /** @returns {number} nota inteira de 1 a 5, ou 0 quando inválida */
  function clampRating(value) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return Number.isInteger(n) && n >= MIN_RATING && n <= MAX_RATING ? n : 0;
  }

  /** @param {unknown[]} ratings @returns {{count:number, average:number, distribution:Object<number,number>}} */
  function ratingSummary(ratings) {
    const valid = (Array.isArray(ratings) ? ratings : []).map(clampRating).filter(Boolean);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    valid.forEach(r => { distribution[r] += 1; });
    const sum = valid.reduce((acc, r) => acc + r, 0);
    const average = valid.length ? Math.round((sum / valid.length) * 10) / 10 : 0;
    return { count: valid.length, average, distribution };
  }

  /** @returns {string} cinco estrelas, cheias até a nota arredondada */
  function starsText(rating) {
    const full = Math.max(0, Math.min(MAX_RATING, Math.round(Number(rating) || 0)));
    return '★'.repeat(full) + '☆'.repeat(MAX_RATING - full);
  }

  /** @returns {{current:number, total:number, percent:number}} */
  function readingProgress(current, total) {
    const t = Number(total);
    const safeTotal = Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
    const c = Number(current);
    const safeCurrent = Number.isFinite(c) ? Math.min(Math.max(0, Math.floor(c)), safeTotal) : 0;
    const percent = safeTotal ? Math.floor((safeCurrent / safeTotal) * 100) : 0;
    return { current: safeCurrent, total: safeTotal, percent };
  }

  function nextTradeStatuses(status) {
    return [...(TRADE_NEXT[status || 'AVAILABLE'] || [])];
  }

  function canChangeTradeStatus(from, to) {
    return nextTradeStatuses(from).includes(to) && (from in TRADE_NEXT || from === undefined);
  }

  function tradeStatusLabel(status) {
    return TRADE_LABELS[status] || TRADE_LABELS.AVAILABLE;
  }

  /** @returns {'trade'|'quote'|'review'|'normal'} */
  function postKind(post) {
    if (!post) return 'normal';
    if (post.postType === 'trade') return 'trade';
    if (post.postType === 'quote') return 'quote';
    if (post.bookId && clampRating(post.rating)) return 'review';
    return 'normal';
  }

  /** Converte Timestamp do Firestore, Date ou número em milissegundos (0 quando não dá). */
  function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return 0;
  }

  const ACHIEVEMENTS = [
    { id: 'first-book', icon: '📗', title: 'Primeiro livro lido', stat: 'booksRead', target: 1 },
    { id: 'five-books', icon: '📚', title: 'Leitor dedicado: 5 livros', stat: 'booksRead', target: 5 },
    { id: 'goal', icon: '🏆', title: 'Meta do ano cumprida', stat: 'booksRead', target: null },
    { id: 'first-review', icon: '✍️', title: 'Primeira resenha', stat: 'reviews', target: 1 },
    { id: 'critic', icon: '🎖️', title: 'Crítico: 10 resenhas', stat: 'reviews', target: 10 },
    { id: 'first-trade', icon: '🔄', title: 'Primeira troca concluída', stat: 'tradesDone', target: 1 },
    { id: 'quotes', icon: '💬', title: 'Colecionador de citações: 3', stat: 'quotes', target: 3 },
    { id: 'club', icon: '🫂', title: 'Membro de um clube', stat: 'clubs', target: 1 },
  ];

  /** @returns {{id:string, icon:string, title:string, earned:boolean, progress:number}[]} */
  function achievements(stats) {
    const s = stats || {};
    const goal = Number(s.readingGoal) > 0 ? Number(s.readingGoal) : DEFAULT_READING_GOAL;
    return ACHIEVEMENTS.map(a => {
      const target = a.target ?? goal;
      const value = Math.max(0, Number(s[a.stat]) || 0);
      return {
        id: a.id, icon: a.icon, title: a.target === null ? `Meta do ano: ${goal} livros` : a.title,
        earned: value >= target,
        progress: Math.min(100, Math.floor((value / target) * 100)),
      };
    });
  }

  function mostFrequent(values) {
    const counts = new Map();
    values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    let best = null;
    let bestCount = 0;
    counts.forEach((count, value) => { if (count > bestCount) { best = value; bestCount = count; } });
    return best;
  }

  /** Retrospectiva do ano a partir da estante e dos posts da pessoa. */
  function yearInReview({ books = [], posts = [], year }) {
    const inYear = ms => ms > 0 && new Date(ms).getUTCFullYear() === year;
    const read = (books || []).filter(b => b && b.status === 'read'
      && inYear(toMillis(b.finishedAt) || toMillis(b.addedAt)));
    const mine = (posts || []).filter(p => p && inYear(toMillis(p.createdAt)));

    const rated = read.filter(b => clampRating(b.rating));
    const bestBook = rated.length
      ? rated.reduce((best, b) => (clampRating(b.rating) > clampRating(best.rating) ? b : best)).title
      : null;
    const months = read.map(b => new Date(toMillis(b.finishedAt) || toMillis(b.addedAt)).getUTCMonth());
    const busiest = mostFrequent(months);

    return {
      year,
      booksRead: read.length,
      pagesRead: read.reduce((sum, b) => sum + (Number(b.totalPages) > 0 ? Number(b.totalPages) : 0), 0),
      averageRating: ratingSummary(read.map(b => b.rating)).average,
      topAuthor: mostFrequent(read.map(b => b.author).filter(Boolean)),
      bestBook,
      reviewsWritten: mine.filter(p => postKind(p) === 'review').length,
      quotesShared: mine.filter(p => postKind(p) === 'quote').length,
      tradesDone: mine.filter(p => postKind(p) === 'trade' && p.tradeStatus === 'DONE').length,
      busiestMonth: busiest === null ? null : MONTHS[busiest],
    };
  }

  /**
   * "Quem gostou deste livro também gostou de…": olha as pessoas que deram 4+ ao livro
   * e soma os outros livros que elas também avaliaram com 4+.
   */
  function recommendBooks(posts, bookId, limit = 5) {
    const list = Array.isArray(posts) ? posts : [];
    const liked = p => p && p.bookId && clampRating(p.rating) >= LIKED_RATING;
    const fans = new Set(list.filter(p => liked(p) && p.bookId === bookId).map(p => p.authorId));

    const scores = new Map();
    list.filter(p => liked(p) && p.bookId !== bookId && fans.has(p.authorId)).forEach(p => {
      const cur = scores.get(p.bookId) || { book: p.book || { id: p.bookId }, readers: new Set(), sum: 0 };
      cur.readers.add(p.authorId);
      cur.sum += clampRating(p.rating);
      scores.set(p.bookId, cur);
    });

    return [...scores.values()]
      .map(s => ({ book: s.book, readers: s.readers.size, score: s.readers.size + s.sum / (10 * s.readers.size) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** @returns {{ok:boolean, errors:string[]}} */
  function validateClub(input) {
    const c = input || {};
    const name = String(c.name ?? '').trim();
    const errors = [];
    if (name.length < CLUB_NAME_MIN || name.length > CLUB_NAME_MAX) {
      errors.push(`O nome precisa ter de ${CLUB_NAME_MIN} a ${CLUB_NAME_MAX} letras.`);
    }
    if (String(c.description ?? '').length > CLUB_DESCRIPTION_MAX) {
      errors.push(`A descrição pode ter até ${CLUB_DESCRIPTION_MAX} letras.`);
    }
    if (String(c.city ?? '').length > CLUB_CITY_MAX) errors.push(`A cidade pode ter até ${CLUB_CITY_MAX} letras.`);
    return { ok: errors.length === 0, errors };
  }

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
  }

  /** Texto pronto para colar no WhatsApp/Instagram ao compartilhar um post. */
  function buildShareText(post, url) {
    const p = post || {};
    const text = String(p.text || '').slice(0, SHARE_TEXT_LIMIT);
    const book = p.book || null;
    const footer = `\n\nvia Cantinho Literário · ${url}`;
    if (postKind(p) === 'quote' && book) return `“${text}”\n— ${book.title}, ${book.author}${footer}`;
    if (postKind(p) === 'review' && book) return `${book.title} ${starsText(p.rating)}\n${text}${footer}`;
    return `${text}${footer}`;
  }

  // ---------- painel do moderador ----------
  const LOGIN_METHODS = [['apple', 'Apple'], ['google', 'Google'], ['email', 'E-mail']];

  /** authProviders do perfil ({ apple, google, email }) → nomes dos métodos usados para entrar. */
  function loginMethods(authProviders) {
    const p = authProviders || {};
    return LOGIN_METHODS.filter(([key]) => Boolean(p[key])).map(([, label]) => label);
  }

  /** Timestamp do Firestore, Date ou milissegundos → "dd/mm/aaaa" (ou "—" sem data). */
  function formatDateBR(value) {
    const ms = toMillis(value);
    if (!ms) return '—';
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  /** Filtra usuários pelo nome ou @ (sem acento, sem diferenciar maiúsculas). Devolve lista nova. */
  function filterUsers(users, query) {
    const q = normalizeText(query).replace(/^@/, '');
    const list = Array.isArray(users) ? users : [];
    if (!q) return list.slice();
    return list.filter(u => normalizeText(u && u.displayName).includes(q)
      || normalizeText(u && u.handle).includes(q));
  }

  return {
    normalizeText, cityKey, sameCity,
    clampRating, ratingSummary, starsText,
    readingProgress,
    nextTradeStatuses, canChangeTradeStatus, tradeStatusLabel,
    postKind, toMillis,
    achievements, yearInReview, recommendBooks,
    validateClub, escapeHtml, buildShareText,
    loginMethods, formatDateBR, filterUsers,
  };
});
