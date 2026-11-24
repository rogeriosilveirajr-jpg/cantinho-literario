// Testes de unidade das regras de boas-vindas, descoberta e convites (lib/welcome.js).
// Rodam só com Node:  npm run test:unit
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const W = require('../../lib/welcome.js');

describe('gêneros favoritos', () => {
  test('a lista tem id, nome e termo de busca para cada gênero', () => {
    assert.ok(W.GENRES.length >= 8);
    W.GENRES.forEach(g => {
      assert.match(g.id, /^[a-z-]+$/);
      assert.ok(g.label && g.query);
    });
  });

  test('sanitizeGenres tira repetidos e ids desconhecidos, mantendo a ordem', () => {
    assert.deepEqual(W.sanitizeGenres(['fantasia', 'xyz', 'fantasia', 'romance']), ['fantasia', 'romance']);
  });

  test('sanitizeGenres guarda no máximo 5 (valor-limite)', () => {
    const ids = W.GENRES.map(g => g.id);
    assert.equal(W.sanitizeGenres(ids.slice(0, 5)).length, 5);
    assert.equal(W.sanitizeGenres(ids.slice(0, 6)).length, 5);
  });

  test('sanitizeGenres aceita entrada inválida sem quebrar e não altera a original', () => {
    assert.deepEqual(W.sanitizeGenres(null), []);
    assert.deepEqual(W.sanitizeGenres('fantasia'), []);
    const original = ['romance', 'romance'];
    W.sanitizeGenres(original);
    assert.deepEqual(original, ['romance', 'romance']);
  });

  test('genreLabel devolve o nome, ou texto vazio para id desconhecido', () => {
    assert.equal(W.genreLabel('fantasia'), 'Fantasia');
    assert.equal(W.genreLabel('nada'), '');
  });
});

describe('quem vê as boas-vindas', () => {
  const launch = W.WELCOME_LAUNCH_MS;

  test('conta criada a partir do lançamento, sem onboardedAt, vê; quem já passou não vê', () => {
    assert.equal(W.needsWelcome({ uid: 'a', createdAt: launch }), true);
    assert.equal(W.needsWelcome({ uid: 'a', createdAt: new Date(launch + 1000) }), true);
    assert.equal(W.needsWelcome({ uid: 'a', createdAt: launch, onboardedAt: { seconds: 1 } }), false);
  });

  test('contas antigas (antes do lançamento ou sem data de cadastro) não veem (regressão)', () => {
    assert.equal(W.needsWelcome({ uid: 'a', createdAt: launch - 1 }), false);
    assert.equal(W.needsWelcome({ uid: 'a' }), false);
  });

  test('sem usuário ou conta excluída não vê', () => {
    assert.equal(W.needsWelcome(null), false);
    assert.equal(W.needsWelcome({ uid: 'a', isDeleted: true }), false);
  });
});

describe('conteúdo do dia', () => {
  const day1 = new Date(2026, 10, 24);
  const day2 = new Date(2026, 10, 25);

  test('a pergunta do dia é a mesma o dia todo e muda no dia seguinte', () => {
    const morning = W.dailyPrompt(new Date(2026, 10, 24, 8));
    assert.equal(W.dailyPrompt(new Date(2026, 10, 24, 23)), morning);
    assert.notEqual(W.dailyPrompt(day2), W.dailyPrompt(day1));
    assert.ok(W.PROMPTS.includes(morning));
  });

  test('a citação do dia tem texto, autor e obra, e também muda de um dia para o outro', () => {
    const q = W.dailyQuote(day1);
    assert.ok(q.text && q.author && q.work);
    assert.notDeepEqual(W.dailyQuote(day2), q);
  });

  test('a citação devolvida é uma cópia (alterar não estraga a lista)', () => {
    const q = W.dailyQuote(day1);
    q.text = 'alterado';
    assert.notEqual(W.dailyQuote(day1).text, 'alterado');
  });

  test('a busca de livros usa um dos gêneros favoritos, e sem favoritos usa literatura brasileira', () => {
    const q = W.discoveryGenre(['fantasia', 'romance'], day1);
    assert.ok(['fantasia', 'romance'].includes(q.id));
    assert.equal(W.discoveryGenre([], day1).id, 'brasileira');
    assert.equal(W.discoveryGenre(['inexistente'], day1).id, 'brasileira');
  });

  test('a seção Descobrir aparece com menos de 5 posts no feed (valor-limite)', () => {
    assert.equal(W.shouldShowDiscovery(0), true);
    assert.equal(W.shouldShowDiscovery(4), true);
    assert.equal(W.shouldShowDiscovery(5), false);
  });
});

describe('convites', () => {
  test('o link de convite leva o id de quem convidou', () => {
    assert.equal(W.inviteLink('https://site.dev', 'abc123'), 'https://site.dev/?convite=abc123');
  });

  test('lê o convite do endereço só quando o id é seguro', () => {
    assert.equal(W.parseInvite('?convite=abc_123-X'), 'abc_123-X');
    assert.equal(W.parseInvite('?emulador&convite=abc'), 'abc');
    assert.equal(W.parseInvite('?convite=<script>'), null);
    assert.equal(W.parseInvite('?convite='), null);
    assert.equal(W.parseInvite(''), null);
    assert.equal(W.parseInvite('?convite=' + 'a'.repeat(65)), null);
  });

  test('ninguém convida a si mesmo', () => {
    assert.equal(W.validInviter('abc', 'abc'), null);
    assert.equal(W.validInviter('abc', 'xyz'), 'abc');
    assert.equal(W.validInviter(null, 'xyz'), null);
  });

  test('texto de quantos leitores a pessoa trouxe', () => {
    assert.equal(W.invitedLabel(0), 'Ninguém entrou pelo seu convite ainda.');
    assert.equal(W.invitedLabel(1), '1 leitor entrou pelo seu convite 🎉');
    assert.equal(W.invitedLabel(3), '3 leitores entraram pelo seu convite 🎉');
  });
});

describe('selo Fundador', () => {
  test('quem entrou antes do prazo é fundador; no prazo ou depois, não (valor-limite)', () => {
    const deadline = W.FOUNDER_DEADLINE_MS;
    assert.equal(W.isFounder(deadline - 1), true);
    assert.equal(W.isFounder(deadline), false);
    assert.equal(W.isFounder({ seconds: (deadline / 1000) - 60 }), true);
  });

  test('sem data de cadastro não é fundador', () => {
    assert.equal(W.isFounder(null), false);
    assert.equal(W.isFounder(undefined), false);
  });
});

describe('endereço do Google Books', () => {
  test('monta a busca com os parâmetros codificados e a chave no fim', () => {
    const url = W.booksUrl({ q: 'literatura brasileira', maxResults: 8 }, 'CHAVE');
    assert.equal(url, 'https://www.googleapis.com/books/v1/volumes?q=literatura+brasileira&maxResults=8&key=CHAVE');
  });

  test('sem chave, não manda o parâmetro key', () => {
    assert.equal(W.booksUrl({ q: 'duna' }, ''), 'https://www.googleapis.com/books/v1/volumes?q=duna');
    assert.equal(W.booksUrl({ q: 'duna' }), 'https://www.googleapis.com/books/v1/volumes?q=duna');
  });
});
