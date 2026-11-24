// ============================================================
//  CANTINHO LITERÁRIO — comunidade (regras puras): sequência de leitura,
//  cronograma/votação/encontro dos clubes, trocas e pontos de leitura,
//  listas de leitura e "Para você".
//  Sem DOM e sem Firebase. No navegador fica em window.CLC; nos testes, via require().
//  Tudo aqui recebe dados e devolve dados novos, sem alterar a entrada.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.CLC = factory(root.CL);
})(typeof self !== 'undefined' ? self : this, function (CL) {
  'use strict';

  const MS_PER_DAY = 86400000;
  const MS_PER_HOUR = 3600000;
  const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
  const LIKED_RATING = 4;
  const SCHEDULE_MAX = 12;
  const MILESTONE_LABEL_MAX = 80;
  const POLL_MIN = 2;
  const POLL_MAX = 4;
  const PLACE_MAX = 120;
  const LINK_MAX = 300;
  const SPOT_NAME_MIN = 3;
  const SPOT_NAME_MAX = 80;
  const SPOT_CITY_MAX = 60;
  const SPOT_ADDRESS_MAX = 150;
  const LIST_TITLE_MIN = 3;
  const LIST_TITLE_MAX = 80;
  const LIST_DESCRIPTION_MAX = 300;
  const LIST_BOOKS_MAX = 50;
  const RECOMMEND_LIMIT = 6;

  const SPOT_KINDS = Object.freeze({
    sebo: '📚 Sebo',
    biblioteca: '🏛️ Biblioteca',
    geladeirinha: '🧊 Geladeirinha de livros',
    livraria: '🛍️ Livraria',
    cafe: '☕ Café literário',
  });

  const str = v => String(v ?? '').trim();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ---------- datas ----------
  function dayKey(date) {
    const d = date instanceof Date ? date : new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** "AAAA-MM-DD" → número do dia, ou NaN quando inválido. */
  function dayNumberOf(key) {
    const m = DAY_KEY.exec(String(key ?? ''));
    if (!m) return NaN;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const ms = Date.UTC(y, mo - 1, d);
    const back = new Date(ms);
    return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms / MS_PER_DAY : NaN;
  }

  function isDayKey(key) {
    return !Number.isNaN(dayNumberOf(key));
  }

  // ---------- sequência de leitura ----------
  /** @returns {{current:number, longest:number, readToday:boolean}} */
  function readingStreak(dayKeys, today) {
    const days = [...new Set((Array.isArray(dayKeys) ? dayKeys : []).map(dayNumberOf))]
      .filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
    let longest = 0;
    let run = 0;
    days.forEach((n, i) => {
      run = i > 0 && n === days[i - 1] + 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
    });
    const set = new Set(days);
    const todayNum = dayNumberOf(dayKey(today));
    const readToday = set.has(todayNum);
    let cursor = readToday ? todayNum : todayNum - 1;
    let current = 0;
    while (set.has(cursor)) { current += 1; cursor -= 1; }
    return { current, longest, readToday };
  }

  function pagesInLastDays(logs, today, days = 7) {
    const todayNum = dayNumberOf(dayKey(today));
    return (Array.isArray(logs) ? logs : [])
      .filter(l => { const n = dayNumberOf(l && l.day); return n <= todayNum && n > todayNum - days; })
      .reduce((sum, l) => sum + (Number(l.pages) || 0), 0);
  }

  function pagesDelta(previousPage, newPage) {
    const before = Number(previousPage) || 0;
    const after = Number(newPage);
    return Number.isFinite(after) ? Math.max(0, Math.floor(after - before)) : 0;
  }

  function streakLabel(days) {
    const n = Number(days) || 0;
    return n === 0 ? 'Comece sua sequência hoje 📖' : `🔥 ${plural(n, 'dia seguido', 'dias seguidos')}`;
  }

  // ---------- cronograma do clube ----------
  function validateSchedule(items) {
    const cleaned = (Array.isArray(items) ? items : [])
      .map(i => ({ label: str(i && i.label), due: str(i && i.due) }))
      .filter(i => i.label || i.due);
    const errors = [];
    if (cleaned.length > SCHEDULE_MAX) errors.push(`O cronograma pode ter até ${SCHEDULE_MAX} etapas.`);
    if (cleaned.some(i => !i.label || i.label.length > MILESTONE_LABEL_MAX)) {
      errors.push(`Cada etapa precisa de um nome com até ${MILESTONE_LABEL_MAX} letras.`);
    }
    if (cleaned.some(i => !isDayKey(i.due))) errors.push('Cada etapa precisa de uma data.');
    const sorted = [...cleaned].sort((a, b) => a.due.localeCompare(b.due));
    return { ok: errors.length === 0, errors, items: sorted };
  }

  /** Índice da etapa atual: a primeira que vence hoje ou depois; passado o fim, a última. */
  function currentMilestone(schedule, today) {
    const list = Array.isArray(schedule) ? schedule : [];
    if (!list.length) return -1;
    const key = dayKey(today);
    const idx = list.findIndex(i => i && i.due >= key);
    return idx < 0 ? list.length - 1 : idx;
  }

  // ---------- votação ----------
  function tallyVotes(votes, optionsCount) {
    const counts = Array.from({ length: Math.max(0, optionsCount | 0) }, () => 0);
    (Array.isArray(votes) ? votes : []).forEach(v => {
      const o = v && v.option;
      if (Number.isInteger(o) && o >= 0 && o < counts.length) counts[o] += 1;
    });
    const total = counts.reduce((a, b) => a + b, 0);
    const winner = total ? counts.indexOf(Math.max(...counts)) : -1;
    return { counts, total, winner };
  }

  function validatePoll(books) {
    const list = Array.isArray(books) ? books : [];
    const ids = new Set(list.map(b => b && b.id));
    const errors = [];
    if (list.length < POLL_MIN || list.length > POLL_MAX) errors.push(`Escolha de ${POLL_MIN} a ${POLL_MAX} livros.`);
    if (ids.size !== list.length) errors.push('Cada livro só pode aparecer uma vez.');
    return { ok: errors.length === 0, errors };
  }

  // ---------- encontro ----------
  function validateMeeting(input, now) {
    const m = input || {};
    const when = m.when instanceof Date ? m.when : new Date(str(m.when));
    const place = str(m.place);
    const link = str(m.link);
    const errors = [];
    if (Number.isNaN(when.getTime())) errors.push('Escolha a data e a hora do encontro.');
    else if (when.getTime() <= (now instanceof Date ? now : new Date()).getTime()) errors.push('O encontro precisa ser no futuro.');
    if (!place && !link) errors.push('Informe o lugar ou o link do encontro.');
    if (place.length > PLACE_MAX) errors.push(`O lugar pode ter até ${PLACE_MAX} letras.`);
    if (link && (!/^https:\/\/\S+$/.test(link) || link.length > LINK_MAX)) errors.push('O link precisa começar com https://');
    return { ok: errors.length === 0, errors, meeting: { when, place, link } };
  }

  function icsText(s) {
    return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  function icsDate(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  /** Arquivo .ics de 1 hora para "Adicionar à agenda". */
  function meetingIcs(meeting, uid) {
    const start = meeting.when instanceof Date ? meeting.when : new Date(meeting.when);
    const end = new Date(start.getTime() + MS_PER_HOUR);
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cantinho Literario//Clubes//PT', 'BEGIN:VEVENT',
      `UID:${uid}@cantinho-literario`, `DTSTAMP:${icsDate(start)}`,
      `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(meeting.title)}`,
      meeting.place ? `LOCATION:${icsText(meeting.place)}` : null,
      meeting.link ? `URL:${icsText(meeting.link)}` : null,
      meeting.link ? `DESCRIPTION:${icsText(meeting.link)}` : null,
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean);
    return lines.join('\r\n') + '\r\n';
  }

  // ---------- trocas ----------
  const isTrade = p => p && p.postType === 'trade';

  function tradesDone(posts) {
    return (Array.isArray(posts) ? posts : []).filter(p => isTrade(p) && p.tradeStatus === 'DONE').length;
  }

  function reputationLabel(count) {
    const n = Number(count) || 0;
    return n ? `🔄 ${plural(n, 'troca concluída', 'trocas concluídas')}` : '';
  }

  /** Cidades com trocas ainda abertas, da que tem mais para a que tem menos. */
  function tradeCities(posts) {
    const byKey = new Map();
    (Array.isArray(posts) ? posts : [])
      .filter(p => isTrade(p) && p.tradeStatus !== 'DONE' && CL.cityKey(p.location))
      .forEach(p => {
        const key = CL.cityKey(p.location);
        const cur = byKey.get(key) || { city: str(String(p.location).split(/[-,/]/)[0]), count: 0 };
        byKey.set(key, { ...cur, count: cur.count + 1 });
      });
    return [...byKey.values()].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  }

  // ---------- pontos de leitura ----------
  function spotKindLabel(kind) {
    return Object.prototype.hasOwnProperty.call(SPOT_KINDS, kind) ? SPOT_KINDS[kind] : '📍 Lugar';
  }

  function validateSpot(input) {
    const s = input || {};
    const spot = { name: str(s.name), kind: str(s.kind), city: str(s.city), address: str(s.address) };
    const errors = [];
    if (spot.name.length < SPOT_NAME_MIN || spot.name.length > SPOT_NAME_MAX) {
      errors.push(`O nome precisa ter de ${SPOT_NAME_MIN} a ${SPOT_NAME_MAX} letras.`);
    }
    if (!Object.prototype.hasOwnProperty.call(SPOT_KINDS, spot.kind)) errors.push('Escolha o tipo de lugar.');
    if (!spot.city || spot.city.length > SPOT_CITY_MAX) errors.push('Informe a cidade.');
    if (spot.address.length > SPOT_ADDRESS_MAX) errors.push(`O endereço pode ter até ${SPOT_ADDRESS_MAX} letras.`);
    return { ok: errors.length === 0, errors, spot: { ...spot, cityKey: CL.cityKey(spot.city) } };
  }

  function mapLink(spot) {
    const s = spot || {};
    const query = [s.name, s.address, s.city].map(str).filter(Boolean).join(', ');
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
  }

  // ---------- listas de leitura ----------
  function validateList(input) {
    const l = input || {};
    const list = { title: str(l.title), description: str(l.description), books: Array.isArray(l.books) ? l.books : [] };
    const errors = [];
    if (list.title.length < LIST_TITLE_MIN || list.title.length > LIST_TITLE_MAX) {
      errors.push(`O título precisa ter de ${LIST_TITLE_MIN} a ${LIST_TITLE_MAX} letras.`);
    }
    if (list.description.length > LIST_DESCRIPTION_MAX) errors.push(`A descrição pode ter até ${LIST_DESCRIPTION_MAX} letras.`);
    if (list.books.length > LIST_BOOKS_MAX) errors.push(`Uma lista pode ter até ${LIST_BOOKS_MAX} livros.`);
    return { ok: errors.length === 0, errors, list };
  }

  /** Lista nova com o livro no fim; se ele já estiver lá, devolve a mesma lista. */
  function addBookToList(books, book) {
    const list = Array.isArray(books) ? books : [];
    if (!book || list.some(b => b.id === book.id)) return list;
    return [...list, { id: book.id, title: book.title || '', author: book.author || '', coverUrl: book.coverUrl || '' }];
  }

  // ---------- Para você ----------
  const liked = p => p && p.bookId && CL.clampRating(p.rating) >= LIKED_RATING;

  /** Livros lidos com nota 4 ou mais, os mais bem avaliados primeiro. */
  function favoriteBookIds(library) {
    return (Array.isArray(library) ? library : [])
      .filter(b => b && b.status === 'read' && CL.clampRating(b.rating) >= LIKED_RATING)
      .sort((a, b) => CL.clampRating(b.rating) - CL.clampRating(a.rating))
      .map(b => b.id);
  }

  /** Livros que quem amou os meus favoritos também amou, sem os que já tenho. */
  function recommendForMe(posts, seedIds, ownedIds, limit = RECOMMEND_LIMIT) {
    const list = Array.isArray(posts) ? posts : [];
    const seeds = new Set(Array.isArray(seedIds) ? seedIds : []);
    const skip = new Set([...seeds, ...(Array.isArray(ownedIds) ? ownedIds : [])]);
    const fanOf = new Map();
    list.filter(p => liked(p) && seeds.has(p.bookId))
      .forEach(p => { if (!fanOf.has(p.authorId)) fanOf.set(p.authorId, p.bookId); });

    const scores = new Map();
    list.filter(p => liked(p) && !skip.has(p.bookId) && fanOf.has(p.authorId)).forEach(p => {
      const cur = scores.get(p.bookId)
        || { book: p.book || { id: p.bookId }, readers: new Set(), sum: 0, because: fanOf.get(p.authorId) };
      scores.set(p.bookId, { ...cur, readers: new Set([...cur.readers, p.authorId]), sum: cur.sum + CL.clampRating(p.rating) });
    });
    return [...scores.values()]
      .map(s => ({ book: s.book, readers: s.readers.size, because: s.because, score: s.readers.size + s.sum / (10 * s.readers.size) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ book, readers, because }) => ({ book, readers, because }));
  }

  return {
    SPOT_KINDS,
    dayKey, isDayKey, readingStreak, pagesInLastDays, pagesDelta, streakLabel,
    validateSchedule, currentMilestone,
    tallyVotes, validatePoll,
    validateMeeting, meetingIcs,
    tradesDone, reputationLabel, tradeCities,
    spotKindLabel, validateSpot, mapLink,
    validateList, addBookToList,
    favoriteBookIds, recommendForMe,
  };
});
