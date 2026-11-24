// ============================================================
//  CANTINHO LITERÁRIO — boas-vindas, descoberta e convites (regras puras)
//  Sem DOM e sem Firebase. No navegador fica em window.CLW; nos testes, via require().
//  Tudo aqui recebe dados e devolve dados novos, sem alterar a entrada.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CLW = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_GENRES = 5;
  const DISCOVERY_MIN_POSTS = 5;      // com menos posts que isso, o feed ganha a seção Descobrir
  const DEFAULT_GENRE = 'brasileira';
  const MS_PER_DAY = 86400000;
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;   // mesmo formato do safeId() das regras do Firestore
  // Quem criou a conta antes de 01/03/2027 (meia-noite em Brasília) ganha o selo Fundador.
  const FOUNDER_DEADLINE_MS = Date.UTC(2027, 2, 1, 3);
  // As boas-vindas são só para contas criadas a partir do lançamento (24/11/2026, Brasília).
  const WELCOME_LAUNCH_MS = Date.UTC(2026, 10, 24, 3);

  // query: termo usado na busca do Google Books
  const GENRES = Object.freeze([
    { id: 'romance', label: 'Romance', query: 'subject:romance' },
    { id: 'fantasia', label: 'Fantasia', query: 'subject:fantasy' },
    { id: 'suspense', label: 'Suspense e mistério', query: 'subject:thriller' },
    { id: 'ficcao-cientifica', label: 'Ficção científica', query: 'subject:"science fiction"' },
    { id: 'classicos', label: 'Clássicos', query: 'subject:classics' },
    { id: 'brasileira', label: 'Literatura brasileira', query: 'literatura brasileira' },
    { id: 'jovem-adulto', label: 'Jovem adulto', query: 'subject:"young adult fiction"' },
    { id: 'terror', label: 'Terror', query: 'subject:horror' },
    { id: 'poesia', label: 'Poesia', query: 'subject:poetry' },
    { id: 'hq', label: 'HQ e mangá', query: 'subject:comics' },
    { id: 'biografia', label: 'Biografias', query: 'subject:biography' },
    { id: 'autoajuda', label: 'Desenvolvimento pessoal', query: 'subject:"self-help"' },
  ].map(Object.freeze));

  const PROMPTS = Object.freeze([
    'Qual livro você releria hoje mesmo?',
    'Qual personagem você gostaria de conhecer na vida real?',
    'Um livro que todo mundo ama e você não gostou. Qual é?',
    'Qual foi o último livro que te fez chorar?',
    'Que livro você daria de presente para alguém que não gosta de ler?',
    'Qual livro você leu numa sentada só?',
    'Qual final você reescreveria se pudesse?',
    'Qual autor brasileiro todo mundo deveria conhecer?',
    'Qual livro está parado na sua estante esperando a sua coragem?',
    'Qual capa de livro é a mais bonita que você já viu?',
    'Qual livro mudou a forma como você vê o mundo?',
    'Se a sua vida fosse um livro, qual seria o título?',
  ]);

  // Só obras em domínio público.
  const QUOTES = Object.freeze([
    { text: 'Amor é fogo que arde sem se ver.', author: 'Luís de Camões', work: 'Sonetos' },
    { text: 'Tudo vale a pena se a alma não é pequena.', author: 'Fernando Pessoa', work: 'Mensagem' },
    { text: 'Minha terra tem palmeiras, onde canta o Sabiá.', author: 'Gonçalves Dias', work: 'Canção do Exílio' },
    { text: 'Não tive filhos, não transmiti a nenhuma criatura o legado da nossa miséria.', author: 'Machado de Assis', work: 'Memórias Póstumas de Brás Cubas' },
    { text: 'Olhos de cigana oblíqua e dissimulada.', author: 'Machado de Assis', work: 'Dom Casmurro' },
    { text: 'Ao vencedor, as batatas!', author: 'Machado de Assis', work: 'Quincas Borba' },
    { text: 'Ora (direis) ouvir estrelas!', author: 'Olavo Bilac', work: 'Via Láctea' },
    { text: 'O sertanejo é, antes de tudo, um forte.', author: 'Euclides da Cunha', work: 'Os Sertões' },
    { text: 'Pouca saúde e muita saúva, os males do Brasil são.', author: 'Mário de Andrade', work: 'Macunaíma' },
  ].map(Object.freeze));

  const GENRE_BY_ID = Object.freeze(Object.fromEntries(GENRES.map(g => [g.id, g])));

  /** Lista de ids → só ids conhecidos, sem repetir, no máximo 5. Devolve lista nova. */
  function sanitizeGenres(list) {
    if (!Array.isArray(list)) return [];
    const valid = list.filter(id => Object.prototype.hasOwnProperty.call(GENRE_BY_ID, id));
    return [...new Set(valid)].slice(0, MAX_GENRES);
  }

  function genreLabel(id) {
    return Object.prototype.hasOwnProperty.call(GENRE_BY_ID, id) ? GENRE_BY_ID[id].label : '';
  }

  /** Conta nova (criada depois do lançamento), ainda sem passar pelas boas-vindas. */
  function needsWelcome(user) {
    return Boolean(user && !user.isDeleted && !user.onboardedAt
      && toMillis(user.createdAt) >= WELCOME_LAUNCH_MS);
  }

  /** Número do dia (o mesmo das 0h às 23h59 no fuso de quem está usando). */
  function dayNumber(date) {
    const d = date instanceof Date ? date : new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
  }

  function pickForDay(list, date) {
    return list[dayNumber(date) % list.length];
  }

  function dailyPrompt(date) {
    return pickForDay(PROMPTS, date);
  }

  /** @returns {{text:string, author:string, work:string}} cópia da citação do dia */
  function dailyQuote(date) {
    return { ...pickForDay(QUOTES, date) };
  }

  /** Gênero usado para sugerir livros: um dos favoritos (muda a cada dia) ou literatura brasileira. */
  function discoveryGenre(favoriteGenres, date) {
    const favs = sanitizeGenres(favoriteGenres);
    if (favs.length === 0) return GENRE_BY_ID[DEFAULT_GENRE];
    return GENRE_BY_ID[pickForDay(favs, date)];
  }

  function shouldShowDiscovery(postCount) {
    return (Number(postCount) || 0) < DISCOVERY_MIN_POSTS;
  }

  // ---------- convites ----------
  function inviteLink(origin, uid) {
    return `${origin}/?convite=${encodeURIComponent(uid)}`;
  }

  /** "?convite=abc" → "abc"; id ausente ou fora do formato seguro → null. */
  function parseInvite(search) {
    const value = new URLSearchParams(search || '').get('convite');
    return value && SAFE_ID.test(value) ? value : null;
  }

  /** Quem convidou, desde que não seja a própria pessoa. */
  function validInviter(inviterId, myUid) {
    return inviterId && SAFE_ID.test(inviterId) && inviterId !== myUid ? inviterId : null;
  }

  function invitedLabel(count) {
    const n = Number(count) || 0;
    if (n === 0) return 'Ninguém entrou pelo seu convite ainda.';
    return n === 1 ? '1 leitor entrou pelo seu convite 🎉' : `${n} leitores entraram pelo seu convite 🎉`;
  }

  // ---------- Google Books ----------
  const BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';

  /** { q, maxResults, ... } + chave → endereço da busca (sem chave, sem o parâmetro key). */
  function booksUrl(params, key) {
    const query = new URLSearchParams(params);
    if (key) query.set('key', key);
    return `${BOOKS_API}?${query}`;
  }

  // ---------- selo Fundador ----------
  function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return 0;
  }

  function isFounder(createdAt) {
    const ms = toMillis(createdAt);
    return ms > 0 && ms < FOUNDER_DEADLINE_MS;
  }

  return {
    GENRES, PROMPTS, QUOTES, FOUNDER_DEADLINE_MS, WELCOME_LAUNCH_MS,
    sanitizeGenres, genreLabel, needsWelcome,
    dailyPrompt, dailyQuote, discoveryGenre, shouldShowDiscovery,
    inviteLink, parseInvite, validInviter, invitedLabel,
    isFounder, booksUrl,
  };
});
