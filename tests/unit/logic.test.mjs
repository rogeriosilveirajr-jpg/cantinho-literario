// Testes de unidade das regras puras do app (lib/logic.js).
// Rodam só com Node, sem navegador nem Firebase:  npm run test:unit
// Técnicas: partição de equivalência, valor-limite, tabela de decisão e suposição de erro.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CL = require('../../lib/logic.js');

describe('normalizeText e cidades', () => {
  test('remove acentos, caixa e espaços extras', () => {
    assert.equal(CL.normalizeText('  São   PAULO '), 'sao paulo');
  });

  test('valores ausentes viram texto vazio', () => {
    assert.equal(CL.normalizeText(null), '');
    assert.equal(CL.normalizeText(undefined), '');
    assert.equal(CL.normalizeText(42), '42');
  });

  test('cityKey ignora o estado depois de hífen, vírgula ou barra', () => {
    assert.equal(CL.cityKey('Joinville - SC'), 'joinville');
    assert.equal(CL.cityKey('Florianópolis, SC'), 'florianopolis');
    assert.equal(CL.cityKey('Blumenau/SC'), 'blumenau');
    assert.equal(CL.cityKey(''), '');
  });

  test('sameCity compara só a cidade, sem acento nem caixa', () => {
    assert.equal(CL.sameCity('JOINVILLE-SC', 'joinville'), true);
    assert.equal(CL.sameCity('São José', 'Sao Jose - SC'), true);
    assert.equal(CL.sameCity('Joinville', 'Blumenau'), false);
  });

  test('sameCity é falso quando uma das cidades está vazia', () => {
    assert.equal(CL.sameCity('', ''), false);
    assert.equal(CL.sameCity('Joinville', null), false);
  });
});

describe('clampRating (valor-limite)', () => {
  const casos = [
    [0, 0], [1, 1], [3, 3], [5, 5], [6, 0], [-1, 0],
    [2.7, 0], ['4', 4], ['abc', 0], [null, 0], [undefined, 0],
  ];
  for (const [entrada, esperado] of casos) {
    test(`nota ${JSON.stringify(entrada)} vira ${esperado}`, () => {
      assert.equal(CL.clampRating(entrada), esperado);
    });
  }
});

describe('ratingSummary', () => {
  test('lista vazia não tem média', () => {
    assert.deepEqual(CL.ratingSummary([]), {
      count: 0, average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  test('média com uma casa decimal e distribuição por estrela', () => {
    const r = CL.ratingSummary([5, 4, 4, 2]);
    assert.equal(r.count, 4);
    assert.equal(r.average, 3.8);
    assert.deepEqual(r.distribution, { 1: 0, 2: 1, 3: 0, 4: 2, 5: 1 });
  });

  test('ignora notas inválidas (0, fora da faixa, texto)', () => {
    const r = CL.ratingSummary([5, 0, 9, 'x', null, 3]);
    assert.equal(r.count, 2);
    assert.equal(r.average, 4);
  });

  test('aceita entrada que não é lista', () => {
    assert.equal(CL.ratingSummary(undefined).count, 0);
  });

  test('a média fica sempre entre 1 e 5 (propriedade)', () => {
    for (let i = 0; i < 200; i++) {
      const notas = Array.from({ length: 1 + (i % 17) }, (_, j) => 1 + ((i * 7 + j * 3) % 5));
      const { average } = CL.ratingSummary(notas);
      assert.ok(average >= 1 && average <= 5, `média ${average} fora da faixa`);
    }
  });
});

describe('starsText', () => {
  test('desenha estrelas cheias e vazias', () => {
    assert.equal(CL.starsText(3), '★★★☆☆');
    assert.equal(CL.starsText(0), '☆☆☆☆☆');
    assert.equal(CL.starsText(5), '★★★★★');
  });

  test('arredonda médias para a estrela mais próxima', () => {
    assert.equal(CL.starsText(3.6), '★★★★☆');
    assert.equal(CL.starsText(4.4), '★★★★☆');
  });
});

describe('readingProgress (valor-limite)', () => {
  test('progresso normal', () => {
    assert.deepEqual(CL.readingProgress(120, 300), { current: 120, total: 300, percent: 40 });
  });

  test('página zero e página igual ao total', () => {
    assert.equal(CL.readingProgress(0, 300).percent, 0);
    assert.equal(CL.readingProgress(300, 300).percent, 100);
  });

  test('página acima do total é limitada ao total', () => {
    assert.deepEqual(CL.readingProgress(350, 300), { current: 300, total: 300, percent: 100 });
  });

  test('total ausente ou inválido dá 0%', () => {
    assert.equal(CL.readingProgress(10, 0).percent, 0);
    assert.equal(CL.readingProgress(10, -5).percent, 0);
    assert.equal(CL.readingProgress('a', 'b').percent, 0);
  });

  test('página negativa vira zero e o percentual é inteiro', () => {
    assert.deepEqual(CL.readingProgress(-3, 7), { current: 0, total: 7, percent: 0 });
    assert.equal(CL.readingProgress(1, 3).percent, 33);
  });
});

describe('status da troca (tabela de decisão)', () => {
  const tabela = [
    ['AVAILABLE', 'RESERVED', true],
    ['AVAILABLE', 'DONE', true],
    ['AVAILABLE', 'AVAILABLE', false],
    ['RESERVED', 'AVAILABLE', true],
    ['RESERVED', 'DONE', true],
    ['RESERVED', 'RESERVED', false],
    ['DONE', 'AVAILABLE', false],
    ['DONE', 'RESERVED', false],
    ['DONE', 'DONE', false],
    ['XYZ', 'DONE', false],
    ['AVAILABLE', 'XYZ', false],
  ];
  for (const [de, para, pode] of tabela) {
    test(`${de} → ${para}: ${pode ? 'permitido' : 'recusado'}`, () => {
      assert.equal(CL.canChangeTradeStatus(de, para), pode);
    });
  }

  test('próximos status de cada estado', () => {
    assert.deepEqual(CL.nextTradeStatuses('AVAILABLE'), ['RESERVED', 'DONE']);
    assert.deepEqual(CL.nextTradeStatuses('RESERVED'), ['AVAILABLE', 'DONE']);
    assert.deepEqual(CL.nextTradeStatuses('DONE'), []);
    assert.deepEqual(CL.nextTradeStatuses(undefined), ['RESERVED', 'DONE']);
  });

  test('rótulos em português', () => {
    assert.equal(CL.tradeStatusLabel('AVAILABLE'), 'Disponível');
    assert.equal(CL.tradeStatusLabel('RESERVED'), 'Combinado');
    assert.equal(CL.tradeStatusLabel('DONE'), 'Trocado');
    assert.equal(CL.tradeStatusLabel(undefined), 'Disponível');
  });
});

describe('postKind', () => {
  test('classifica pelo tipo e pelo conteúdo', () => {
    assert.equal(CL.postKind({ postType: 'trade' }), 'trade');
    assert.equal(CL.postKind({ postType: 'quote' }), 'quote');
    assert.equal(CL.postKind({ postType: 'normal', bookId: 'b1', rating: 4 }), 'review');
    assert.equal(CL.postKind({ postType: 'normal', bookId: 'b1', rating: 0 }), 'normal');
    assert.equal(CL.postKind({}), 'normal');
    assert.equal(CL.postKind(null), 'normal');
  });
});

describe('toMillis', () => {
  test('aceita Timestamp do Firestore, Date, número e vazio', () => {
    assert.equal(CL.toMillis({ toMillis: () => 123 }), 123);
    assert.equal(CL.toMillis(new Date(1000)), 1000);
    assert.equal(CL.toMillis(2000), 2000);
    assert.equal(CL.toMillis({ seconds: 3 }), 3000);
    assert.equal(CL.toMillis(null), 0);
    assert.equal(CL.toMillis('ontem'), 0);
  });
});

describe('achievements', () => {
  test('sem atividade nenhuma conquista é ganha', () => {
    const lista = CL.achievements({});
    assert.ok(lista.length >= 8);
    assert.ok(lista.every(a => a.earned === false));
  });

  test('limites exatos liberam a conquista', () => {
    const lista = CL.achievements({ booksRead: 5, reviews: 1, tradesDone: 1, quotes: 3, clubs: 1 });
    const ganhou = id => lista.find(a => a.id === id).earned;
    assert.equal(ganhou('first-book'), true);
    assert.equal(ganhou('five-books'), true);
    assert.equal(ganhou('goal'), false);
    assert.equal(ganhou('first-review'), true);
    assert.equal(ganhou('critic'), false);
    assert.equal(ganhou('first-trade'), true);
    assert.equal(ganhou('quotes'), true);
    assert.equal(ganhou('club'), true);
  });

  test('a meta de leitura usa o objetivo do usuário', () => {
    const meta = id => CL.achievements({ booksRead: 10, readingGoal: 10 }).find(a => a.id === id);
    assert.equal(meta('goal').earned, true);
    assert.equal(CL.achievements({ booksRead: 9, readingGoal: 10 }).find(a => a.id === 'goal').earned, false);
  });

  test('progresso nunca passa de 100%', () => {
    for (const a of CL.achievements({ booksRead: 999, reviews: 999, tradesDone: 9, quotes: 9, clubs: 9 })) {
      assert.ok(a.progress >= 0 && a.progress <= 100, `${a.id}: ${a.progress}`);
    }
  });
});

describe('yearInReview', () => {
  const ano = 2026;
  const ms = (m, d) => Date.UTC(ano, m - 1, d, 12);
  const books = [
    { status: 'read', title: 'Duna', author: 'Frank Herbert', rating: 5, totalPages: 600, finishedAt: ms(3, 10) },
    { status: 'read', title: 'Filhos de Duna', author: 'Frank Herbert', rating: 4, totalPages: 400, finishedAt: ms(3, 20) },
    { status: 'read', title: 'Torto Arado', author: 'Itamar Vieira Junior', rating: 3, finishedAt: ms(8, 1) },
    { status: 'read', title: 'Antigo', author: 'X', rating: 5, finishedAt: Date.UTC(2025, 5, 1) },
    { status: 'tbr', title: 'Futuro', author: 'Y', addedAt: ms(5, 5) },
  ];
  const posts = [
    { postType: 'normal', bookId: 'a', rating: 5, createdAt: ms(3, 11) },
    { postType: 'quote', createdAt: ms(4, 1) },
    { postType: 'trade', tradeStatus: 'DONE', createdAt: ms(6, 1) },
    { postType: 'trade', tradeStatus: 'AVAILABLE', createdAt: ms(6, 2) },
    { postType: 'normal', bookId: 'b', rating: 4, createdAt: Date.UTC(2025, 1, 1) },
  ];

  test('conta só o que aconteceu no ano', () => {
    const r = CL.yearInReview({ books, posts, year: ano });
    assert.equal(r.year, ano);
    assert.equal(r.booksRead, 3);
    assert.equal(r.pagesRead, 1000);
    assert.equal(r.averageRating, 4);
    assert.equal(r.topAuthor, 'Frank Herbert');
    assert.equal(r.bestBook, 'Duna');
    assert.equal(r.reviewsWritten, 1);
    assert.equal(r.quotesShared, 1);
    assert.equal(r.tradesDone, 1);
    assert.equal(r.busiestMonth, 'março');
  });

  test('ano sem leitura devolve zeros e nulos', () => {
    const r = CL.yearInReview({ books: [], posts: [], year: ano });
    assert.equal(r.booksRead, 0);
    assert.equal(r.averageRating, 0);
    assert.equal(r.topAuthor, null);
    assert.equal(r.bestBook, null);
    assert.equal(r.busiestMonth, null);
  });

  test('sem finishedAt usa a data em que o livro entrou na estante', () => {
    const r = CL.yearInReview({ books: [{ status: 'read', title: 'Sem data', author: 'Z', addedAt: ms(1, 1) }], year: ano });
    assert.equal(r.booksRead, 1);
  });
});

describe('recommendBooks', () => {
  const livro = (id, title) => ({ id, title, author: 'A', coverUrl: '' });
  const posts = [
    { authorId: 'ana', bookId: 'duna', book: livro('duna', 'Duna'), rating: 5 },
    { authorId: 'ana', bookId: 'fundacao', book: livro('fundacao', 'Fundação'), rating: 5 },
    { authorId: 'ana', bookId: 'hobbit', book: livro('hobbit', 'O Hobbit'), rating: 4 },
    { authorId: 'bia', bookId: 'duna', book: livro('duna', 'Duna'), rating: 4 },
    { authorId: 'bia', bookId: 'fundacao', book: livro('fundacao', 'Fundação'), rating: 4 },
    { authorId: 'bia', bookId: 'ruim', book: livro('ruim', 'Ruim'), rating: 2 },
    { authorId: 'caio', bookId: 'duna', book: livro('duna', 'Duna'), rating: 2 },
    { authorId: 'caio', bookId: 'crepusculo', book: livro('crepusculo', 'Crepúsculo'), rating: 5 },
  ];

  test('recomenda o que quem gostou do livro também gostou', () => {
    const r = CL.recommendBooks(posts, 'duna');
    assert.deepEqual(r.map(x => x.book.id), ['fundacao', 'hobbit']);
    assert.equal(r[0].readers, 2);
  });

  test('não recomenda o próprio livro, notas baixas nem gosto de quem não gostou', () => {
    const ids = CL.recommendBooks(posts, 'duna').map(x => x.book.id);
    assert.ok(!ids.includes('duna'));
    assert.ok(!ids.includes('ruim'));
    assert.ok(!ids.includes('crepusculo'));
  });

  test('respeita o limite e listas vazias', () => {
    assert.equal(CL.recommendBooks(posts, 'duna', 1).length, 1);
    assert.deepEqual(CL.recommendBooks([], 'duna'), []);
    assert.deepEqual(CL.recommendBooks(null, 'duna'), []);
  });
});

describe('validateClub', () => {
  test('clube válido', () => {
    assert.deepEqual(CL.validateClub({ name: 'Clube de Fantasia', description: 'Livro do mês', city: 'Joinville' }),
      { ok: true, errors: [] });
  });

  test('limites do nome: 3 e 60 caracteres', () => {
    assert.equal(CL.validateClub({ name: 'ab' }).ok, false);
    assert.equal(CL.validateClub({ name: 'abc' }).ok, true);
    assert.equal(CL.validateClub({ name: 'x'.repeat(60) }).ok, true);
    assert.equal(CL.validateClub({ name: 'x'.repeat(61) }).ok, false);
  });

  test('nome só com espaços é inválido', () => {
    assert.equal(CL.validateClub({ name: '     ' }).ok, false);
  });

  test('descrição até 300 e cidade até 60 caracteres', () => {
    assert.equal(CL.validateClub({ name: 'Clube', description: 'd'.repeat(301) }).ok, false);
    assert.equal(CL.validateClub({ name: 'Clube', city: 'c'.repeat(61) }).ok, false);
    assert.equal(CL.validateClub({ name: 'Clube', description: 'd'.repeat(300), city: 'c'.repeat(60) }).ok, true);
  });

  test('entrada ausente é inválida', () => {
    assert.equal(CL.validateClub(undefined).ok, false);
  });
});

describe('escapeHtml (segurança contra XSS)', () => {
  test('escapa os caracteres perigosos', () => {
    assert.equal(CL.escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(CL.escapeHtml("a&b'c"), 'a&amp;b&#39;c');
  });

  test('valores ausentes viram texto vazio', () => {
    assert.equal(CL.escapeHtml(null), '');
    assert.equal(CL.escapeHtml(undefined), '');
    assert.equal(CL.escapeHtml(7), '7');
  });
});

describe('buildShareText', () => {
  test('citação vira texto com livro e endereço', () => {
    const t = CL.buildShareText({ postType: 'quote', text: 'Ser ou não ser', book: { title: 'Hamlet', author: 'Shakespeare' } }, 'https://x.dev');
    assert.equal(t, '“Ser ou não ser”\n— Hamlet, Shakespeare\n\nvia Cantinho Literário · https://x.dev');
  });

  test('resenha mostra as estrelas', () => {
    const t = CL.buildShareText({ text: 'Ótimo', rating: 4, bookId: 'h', book: { title: 'Hamlet', author: 'S' } }, 'https://x.dev');
    assert.ok(t.startsWith('Hamlet ★★★★☆\nÓtimo'));
  });

  test('post comum sem livro', () => {
    assert.equal(CL.buildShareText({ text: 'Oi' }, 'https://x.dev'), 'Oi\n\nvia Cantinho Literário · https://x.dev');
  });

  test('texto longo é cortado em 280 caracteres', () => {
    const t = CL.buildShareText({ text: 'a'.repeat(500) }, 'u');
    assert.ok(t.split('\n')[0].length <= 281);
  });
});
