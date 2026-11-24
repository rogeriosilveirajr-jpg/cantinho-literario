// Testes de unidade dos recursos de comunidade (lib/community.js): sequência de leitura,
// cronograma, votação e encontros dos clubes, trocas e pontos de leitura, listas e "Para você".
// Rodam só com Node:  npm run test:unit
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../lib/community.js');

const day = (y, m, d) => new Date(y, m - 1, d, 12);

describe('sequência de leitura', () => {
  test('dayKey usa a data local no formato AAAA-MM-DD', () => {
    assert.equal(C.dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(C.isDayKey('2026-01-05'), true);
    assert.equal(C.isDayKey('2026-1-5'), false);
    assert.equal(C.isDayKey('../x'), false);
  });

  test('conta dias seguidos terminando hoje', () => {
    const r = C.readingStreak(['2026-11-22', '2026-11-23', '2026-11-24'], day(2026, 11, 24));
    assert.deepEqual(r, { current: 3, longest: 3, readToday: true });
  });

  test('se ainda não leu hoje, a sequência de ontem continua valendo', () => {
    const r = C.readingStreak(['2026-11-22', '2026-11-23'], day(2026, 11, 24));
    assert.equal(r.current, 2);
    assert.equal(r.readToday, false);
  });

  test('um dia sem leitura quebra a sequência; a maior fica guardada', () => {
    const r = C.readingStreak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-22'], day(2026, 11, 24));
    assert.equal(r.current, 0);
    assert.equal(r.longest, 4);
  });

  test('passa pela virada do mês e ignora repetidos e lixo', () => {
    const r = C.readingStreak(['2026-11-30', '2026-12-01', '2026-12-01', 'xx'], day(2026, 12, 1));
    assert.equal(r.current, 2);
    assert.deepEqual(C.readingStreak([], day(2026, 12, 1)), { current: 0, longest: 0, readToday: false });
    assert.deepEqual(C.readingStreak(null, day(2026, 12, 1)), { current: 0, longest: 0, readToday: false });
  });

  test('páginas dos últimos 7 dias (hoje incluído, o 8º dia fica de fora)', () => {
    const logs = [{ day: '2026-11-24', pages: 10 }, { day: '2026-11-18', pages: 5 }, { day: '2026-11-17', pages: 99 }];
    assert.equal(C.pagesInLastDays(logs, day(2026, 11, 24), 7), 15);
    assert.equal(C.pagesInLastDays(undefined, day(2026, 11, 24)), 0);
  });

  test('páginas lidas agora = diferença positiva entre a página nova e a antiga', () => {
    assert.equal(C.pagesDelta(10, 35), 25);
    assert.equal(C.pagesDelta(35, 10), 0);
    assert.equal(C.pagesDelta(undefined, 12), 12);
    assert.equal(C.pagesDelta('a', 'b'), 0);
  });

  test('texto da sequência', () => {
    assert.equal(C.streakLabel(0), 'Comece sua sequência hoje 📖');
    assert.equal(C.streakLabel(1), '🔥 1 dia seguido');
    assert.equal(C.streakLabel(5), '🔥 5 dias seguidos');
  });
});

describe('cronograma do clube', () => {
  test('limpa as etapas: tira as vazias e corta espaços', () => {
    const r = C.validateSchedule([{ label: ' Cap. 1–5 ', due: '2026-12-05' }, { label: '', due: '' }]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.items, [{ label: 'Cap. 1–5', due: '2026-12-05' }]);
  });

  test('recusa etapa sem data, data inválida, nome longo e mais de 12 etapas (valor-limite)', () => {
    assert.equal(C.validateSchedule([{ label: 'Cap. 1', due: '' }]).ok, false);
    assert.equal(C.validateSchedule([{ label: 'Cap. 1', due: '05/12/2026' }]).ok, false);
    assert.equal(C.validateSchedule([{ label: 'x'.repeat(81), due: '2026-12-05' }]).ok, false);
    assert.equal(C.validateSchedule([{ label: 'x'.repeat(80), due: '2026-12-05' }]).ok, true);
    const many = n => Array.from({ length: n }, (_, i) => ({ label: `E${i}`, due: '2026-12-05' }));
    assert.equal(C.validateSchedule(many(12)).ok, true);
    assert.equal(C.validateSchedule(many(13)).ok, false);
  });

  test('ordena as etapas pela data', () => {
    const r = C.validateSchedule([{ label: 'B', due: '2026-12-20' }, { label: 'A', due: '2026-12-05' }]);
    assert.deepEqual(r.items.map(i => i.label), ['A', 'B']);
  });

  test('etapa atual: a primeira que ainda não venceu; depois do fim, a última', () => {
    const s = [{ label: 'A', due: '2026-12-05' }, { label: 'B', due: '2026-12-20' }];
    assert.equal(C.currentMilestone(s, day(2026, 12, 1)), 0);
    assert.equal(C.currentMilestone(s, day(2026, 12, 5)), 0);
    assert.equal(C.currentMilestone(s, day(2026, 12, 6)), 1);
    assert.equal(C.currentMilestone(s, day(2027, 1, 1)), 1);
    assert.equal(C.currentMilestone([], day(2027, 1, 1)), -1);
  });
});

describe('votação do próximo livro', () => {
  test('conta os votos por opção e acha a vencedora', () => {
    const r = C.tallyVotes([{ option: 1 }, { option: 1 }, { option: 0 }], 3);
    assert.deepEqual(r.counts, [1, 2, 0]);
    assert.equal(r.winner, 1);
    assert.equal(r.total, 3);
  });

  test('empate fica com a primeira opção; sem votos não há vencedora', () => {
    assert.equal(C.tallyVotes([{ option: 2 }, { option: 0 }], 3).winner, 0);
    assert.equal(C.tallyVotes([], 3).winner, -1);
  });

  test('votos fora das opções são ignorados', () => {
    assert.deepEqual(C.tallyVotes([{ option: 9 }, { option: -1 }, { option: 'a' }], 2).counts, [0, 0]);
  });

  test('a votação precisa de 2 a 4 livros diferentes (valor-limite)', () => {
    const b = id => ({ id, title: id, author: 'A' });
    assert.equal(C.validatePoll([b('a')]).ok, false);
    assert.equal(C.validatePoll([b('a'), b('b')]).ok, true);
    assert.equal(C.validatePoll([b('a'), b('b'), b('c'), b('d')]).ok, true);
    assert.equal(C.validatePoll([b('a'), b('b'), b('c'), b('d'), b('e')]).ok, false);
    assert.equal(C.validatePoll([b('a'), b('a')]).ok, false);
  });
});

describe('encontro do clube', () => {
  const now = day(2026, 11, 24);

  test('aceita data futura, lugar e link https', () => {
    const r = C.validateMeeting({ when: '2026-12-01T19:30', place: 'Biblioteca Central', link: 'https://meet.example/abc' }, now);
    assert.equal(r.ok, true);
    assert.equal(r.meeting.place, 'Biblioteca Central');
    assert.ok(r.meeting.when instanceof Date);
  });

  test('recusa data passada, sem lugar nem link, link que não é https e lugar longo', () => {
    assert.equal(C.validateMeeting({ when: '2026-11-01T19:30', place: 'X' }, now).ok, false);
    assert.equal(C.validateMeeting({ when: '2026-12-01T19:30', place: '', link: '' }, now).ok, false);
    assert.equal(C.validateMeeting({ when: '2026-12-01T19:30', link: 'javascript:alert(1)' }, now).ok, false);
    assert.equal(C.validateMeeting({ when: '2026-12-01T19:30', place: 'x'.repeat(121) }, now).ok, false);
    assert.equal(C.validateMeeting({ when: 'amanhã', place: 'X' }, now).ok, false);
  });

  test('arquivo de agenda (.ics) com início, fim 1 h depois e texto escapado', () => {
    const ics = C.meetingIcs({ title: 'Clube; de, Fantasia', when: new Date(Date.UTC(2026, 11, 1, 22, 30)), place: 'Sala 2', link: '' }, 'abc');
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /DTSTART:20261201T223000Z/);
    assert.match(ics, /DTEND:20261201T233000Z/);
    assert.match(ics, /SUMMARY:Clube\\; de\\, Fantasia/);
    assert.match(ics, /LOCATION:Sala 2/);
    assert.match(ics, /UID:abc@cantinho-literario/);
  });
});

describe('trocas e pontos de leitura', () => {
  test('reputação conta só as trocas concluídas', () => {
    const posts = [
      { postType: 'trade', tradeStatus: 'DONE' }, { postType: 'trade', tradeStatus: 'DONE' },
      { postType: 'trade', tradeStatus: 'AVAILABLE' }, { postType: 'normal', tradeStatus: 'DONE' },
    ];
    assert.equal(C.tradesDone(posts), 2);
    assert.equal(C.tradesDone(null), 0);
    assert.equal(C.reputationLabel(0), '');
    assert.equal(C.reputationLabel(1), '🔄 1 troca concluída');
    assert.equal(C.reputationLabel(4), '🔄 4 trocas concluídas');
  });

  test('cidades com trocas disponíveis, da que tem mais para a que tem menos', () => {
    const posts = [
      { postType: 'trade', location: 'Joinville - SC', tradeStatus: 'AVAILABLE' },
      { postType: 'trade', location: 'joinville', tradeStatus: 'RESERVED' },
      { postType: 'trade', location: 'Curitiba', tradeStatus: 'AVAILABLE' },
      { postType: 'trade', location: 'Curitiba', tradeStatus: 'DONE' },
      { postType: 'normal', location: 'Blumenau' },
    ];
    assert.deepEqual(C.tradeCities(posts), [{ city: 'Joinville', count: 2 }, { city: 'Curitiba', count: 1 }]);
  });

  test('ponto de leitura: valida nome, tipo, cidade e endereço', () => {
    const ok = C.validateSpot({ name: 'Sebo do Zé', kind: 'sebo', city: 'Joinville', address: 'Rua A, 10' });
    assert.equal(ok.ok, true);
    assert.equal(ok.spot.cityKey, 'joinville');
    assert.equal(C.validateSpot({ name: 'ab', kind: 'sebo', city: 'J' }).ok, false);
    assert.equal(C.validateSpot({ name: 'Sebo', kind: 'boate', city: 'J' }).ok, false);
    assert.equal(C.validateSpot({ name: 'Sebo', kind: 'sebo', city: '' }).ok, false);
    assert.equal(C.validateSpot({ name: 'Sebo', kind: 'sebo', city: 'J', address: 'x'.repeat(151) }).ok, false);
  });

  test('link do mapa procura nome, endereço e cidade no OpenStreetMap', () => {
    assert.equal(C.mapLink({ name: 'Sebo do Zé', address: 'Rua A, 10', city: 'Joinville' }),
      'https://www.openstreetmap.org/search?query=Sebo%20do%20Z%C3%A9%2C%20Rua%20A%2C%2010%2C%20Joinville');
    assert.equal(C.mapLink({ name: 'Biblioteca', city: 'Joinville' }),
      'https://www.openstreetmap.org/search?query=Biblioteca%2C%20Joinville');
  });

  test('tipos de ponto têm nome e ícone', () => {
    assert.equal(C.spotKindLabel('geladeirinha'), '🧊 Geladeirinha de livros');
    assert.equal(C.spotKindLabel('xyz'), '📍 Lugar');
  });
});

describe('listas de leitura e "Para você"', () => {
  test('lista: título de 3 a 80 letras, descrição até 300, até 50 livros (valor-limite)', () => {
    const b = i => ({ id: `b${i}`, title: 'T', author: 'A' });
    assert.equal(C.validateList({ title: 'Ler numa tarde', books: [] }).ok, true);
    assert.equal(C.validateList({ title: 'ab' }).ok, false);
    assert.equal(C.validateList({ title: 'x'.repeat(81) }).ok, false);
    assert.equal(C.validateList({ title: 'Boa', description: 'x'.repeat(301) }).ok, false);
    assert.equal(C.validateList({ title: 'Boa', books: Array.from({ length: 50 }, (_, i) => b(i)) }).ok, true);
    assert.equal(C.validateList({ title: 'Boa', books: Array.from({ length: 51 }, (_, i) => b(i)) }).ok, false);
  });

  test('adicionar livro à lista devolve lista nova e não repete', () => {
    const books = [{ id: 'a' }];
    const next = C.addBookToList(books, { id: 'b', title: 'B', author: 'X', coverUrl: '' });
    assert.deepEqual(next.map(x => x.id), ['a', 'b']);
    assert.deepEqual(books.map(x => x.id), ['a'], 'não altera a original');
    assert.equal(C.addBookToList(next, { id: 'b' }), next, 'repetido devolve a mesma lista');
  });

  test('Para você: livros que fãs dos meus favoritos amaram, sem os que já tenho', () => {
    const posts = [
      { authorId: 'u1', bookId: 'duna', rating: 5 },
      { authorId: 'u1', bookId: 'fundacao', rating: 5, book: { id: 'fundacao', title: 'Fundação' } },
      { authorId: 'u1', bookId: 'hobbit', rating: 4, book: { id: 'hobbit', title: 'O Hobbit' } },
      { authorId: 'u2', bookId: 'duna', rating: 4 },
      { authorId: 'u2', bookId: 'fundacao', rating: 4, book: { id: 'fundacao', title: 'Fundação' } },
      { authorId: 'u3', bookId: 'crepusculo', rating: 5 },   // não é fã de Duna
      { authorId: 'u2', bookId: 'ruim', rating: 2 },          // nota baixa não recomenda
    ];
    const recs = C.recommendForMe(posts, ['duna'], ['hobbit']);
    assert.deepEqual(recs.map(r => r.book.id), ['fundacao']);
    assert.equal(recs[0].readers, 2);
    assert.equal(recs[0].because, 'duna');
  });

  test('Para você sem favoritos ou sem dados devolve lista vazia', () => {
    assert.deepEqual(C.recommendForMe([], ['duna'], []), []);
    assert.deepEqual(C.recommendForMe(null, [], []), []);
  });

  test('favoritos da estante: livros lidos com nota 4 ou mais, melhores primeiro', () => {
    const lib = [
      { id: 'a', status: 'read', rating: 4 }, { id: 'b', status: 'read', rating: 5 },
      { id: 'c', status: 'read', rating: 3 }, { id: 'd', status: 'reading', rating: 5 },
    ];
    assert.deepEqual(C.favoriteBookIds(lib), ['b', 'a']);
  });
});
