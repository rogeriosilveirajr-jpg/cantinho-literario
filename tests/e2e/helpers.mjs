// Ajudantes dos testes E2E: limpar os emuladores, entrar com um usuário novo e simular o Google Books.
import { expect } from '@playwright/test';

const PROJECT = 'demo-cantinho';
const FIRESTORE = `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`;

export const APP_URL = '/index.html?emulador';

export const BOOKS = {
  duna: { id: 'duna', volumeInfo: { title: 'Duna', authors: ['Frank Herbert'], pageCount: 600 } },
  fundacao: { id: 'fundacao', volumeInfo: { title: 'Fundação', authors: ['Isaac Asimov'], pageCount: 320 } },
  hobbit: { id: 'hobbit', volumeInfo: { title: 'O Hobbit', authors: ['J. R. R. Tolkien'], pageCount: 300 } },
};

export async function resetEmulators(request) {
  await request.delete(FIRESTORE);
  await request.delete(AUTH);
}

/** Lista documentos direto no emulador, sem as regras de segurança (cabeçalho "Bearer owner"). */
export async function listDocs(request, path) {
  const url = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
  const res = await request.get(url, { headers: { Authorization: 'Bearer owner' } });
  const body = await res.json();
  return body.documents || [];
}

/** A busca de livros devolve os livros acima cujo título contém o que foi digitado.
 *  As sugestões por gênero da seção Descobrir (com langRestrict) recebem todos. */
export async function mockGoogleBooks(page) {
  await page.route('https://www.googleapis.com/books/v1/volumes**', route => {
    const params = new URL(route.request().url()).searchParams;
    const q = params.get('q').toLowerCase();
    const items = Object.values(BOOKS)
      .filter(b => params.has('langRestrict') || b.volumeInfo.title.toLowerCase().includes(q));
    route.fulfill({ json: { items } });
  });
}

let counter = 0;

/** Entra pelo botão "Continuar com E-mail" (respondendo os prompts), criando uma conta nova.
 *  welcome: true deixa a janela de boas-vindas aberta; senão ela é pulada.
 *  query: texto somado ao endereço (ex.: "&convite=uid"). */
export async function loginNewUser(page, name = 'Leitora', { welcome = false, query = '' } = {}) {
  counter += 1;
  const email = `${name.toLowerCase()}${Date.now()}${counter}@teste.dev`;
  await mockGoogleBooks(page);
  await page.addInitScript(() => { delete Navigator.prototype.share; });   // força o caminho "copiar texto"
  const answers = [email, 'senha-de-teste-123'];
  page.on('dialog', dialog => {
    if (dialog.type() === 'prompt') dialog.accept(answers.shift() ?? '');
    else dialog.accept();
  });
  await page.goto(APP_URL + query);
  await page.getByRole('button', { name: 'Continuar com e-mail' }).click();
  await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(newName => db.collection('users').doc(APP_USER.uid).update({ displayName: newName })
    .then(() => { APP_USER.displayName = newName; }), name);
  if (!welcome) {
    await page.locator('#sh-welcome').getByRole('button', { name: 'Pular' }).click();
    await expect(page.locator('#sh-welcome')).toBeHidden();
  }
  return email;
}

export async function openCompose(page) {
  await page.evaluate(() => openSheet('sh-new-post'));
  await expect(page.locator('#sh-new-post')).toBeVisible();
}

export async function pickBook(page, title) {
  await page.locator('#post-book-box').getByRole('button', { name: /Marcar livro/ }).click();
  await page.locator('#book-search-input').fill(title);
  await page.locator('.sr-item', { hasText: title }).first().click();
}

export async function publish(page, { text, type = 'normal', location, book, rating, spoiler } = {}) {
  await openCompose(page);
  await page.locator('#post-type-select').selectOption(type);
  if (location) await page.locator('#post-location').fill(location);
  if (book) await pickBook(page, book);
  if (rating) await page.getByRole('radio', { name: `${rating} estrela${rating > 1 ? 's' : ''}` }).click();
  if (spoiler) await page.locator('#post-spoiler').check();
  await page.locator('#post-ta').fill(text);
  await page.locator('#sh-new-post .sh-action').click();
  await expect(page.locator('#sh-new-post')).toBeHidden();
}

export async function goTo(page, screen) {
  await page.evaluate(name => goTo(name), screen);
}
