// Itens 2 a 5, ponta a ponta: sequência de leitura e retrospectiva em imagem, clubes com
// cronograma/votação/encontro, reputação nas trocas e pontos de leitura, listas e "Para você".
import { test, expect } from '@playwright/test';
import { resetEmulators, listDocs, loginNewUser, publish, goTo } from './helpers.mjs';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ request }) => {
  await resetEmulators(request);
});

const uidOf = page => page.evaluate(() => APP_USER.uid);

async function chooseBook(page, title) {
  await page.locator('#book-search-input').fill(title);
  await page.locator('.sr-item', { hasText: title }).first().click();
}

async function newPage(browser, name) {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await loginNewUser(page, name);
  return { ctx, page };
}

async function createClub(page, name = 'Clube de Fantasia') {
  await goTo(page, 'clubs');
  await page.getByRole('button', { name: '+ Criar clube' }).click();
  await page.locator('#club-name').fill(name);
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(page.locator('#sh-club')).toBeVisible();
}

// ---------- item 2 ----------
test('registrar a leitura do dia atualiza a página do livro, a sequência e as páginas da semana', async ({ page, request }) => {
  await loginNewUser(page, 'Ana');
  await page.evaluate(() => saveBookToLibrary({ id: 'duna', title: 'Duna', author: 'Frank Herbert', coverUrl: '', totalPages: 600 }, 'reading'));
  await goTo(page, 'profile');
  await expect(page.locator('#streak-label')).toHaveText('Comece sua sequência hoje 📖');

  await page.getByRole('button', { name: /Registrar leitura de hoje/ }).click();
  await page.getByLabel('Página atual de Duna').fill('40');
  await page.getByRole('button', { name: 'Salvar leitura' }).click();

  await expect(page.locator('#streak-label')).toHaveText('🔥 1 dia seguido');
  await expect(page.locator('#streak-pages')).toContainText('40 páginas');
  const uid = await uidOf(page);
  const logs = await listDocs(request, `users/${uid}/readingLog`);
  expect(logs.map(l => Number(l.fields.pages.integerValue))).toEqual([40]);
  const lib = await listDocs(request, `users/${uid}/library`);
  expect(Number(lib[0].fields.currentPage.integerValue)).toBe(40);

  // ler mais no mesmo dia soma só a diferença
  await page.getByRole('button', { name: /Registrar leitura de hoje/ }).click();
  await page.getByLabel('Página atual de Duna').fill('55');
  await page.getByRole('button', { name: 'Salvar leitura' }).click();
  await expect(page.locator('#streak-pages')).toContainText('55 páginas');
});

test('a retrospectiva baixa uma imagem PNG pronta para postar', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await goTo(page, 'profile');
  await page.getByRole('button', { name: /Minha retrospectiva do ano/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Baixar imagem/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^retrospectiva-\d{4}\.png$/);
});

// ---------- item 3 ----------
test('clube: o dono monta o cronograma e a conversa fica separada por etapa', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await createClub(page);
  const club = page.locator('#sh-club');
  await club.getByRole('button', { name: 'Editar cronograma' }).click();
  const sheet = page.locator('#sh-schedule');
  await sheet.getByLabel('Nome da etapa 1').fill('Capítulos 1 a 5');
  await sheet.getByLabel('Data da etapa 1').fill('2030-01-10');
  await sheet.getByRole('button', { name: '+ Etapa' }).click();
  await sheet.getByLabel('Nome da etapa 2').fill('Capítulos 6 a 10');
  await sheet.getByLabel('Data da etapa 2').fill('2030-01-20');
  await sheet.getByRole('button', { name: 'Salvar cronograma' }).click();
  await expect(sheet).toBeHidden();

  await expect(club.locator('.club-sched li')).toHaveCount(2);
  await expect(club.locator('.club-sched li.current')).toContainText('Capítulos 1 a 5');

  await club.getByRole('tab', { name: 'Etapa 1' }).click();
  await club.locator('#club-msg-input').fill('Que começo!');
  await club.getByRole('button', { name: 'Enviar' }).click();
  await expect(club.locator('#club-msgs')).toContainText('Que começo!');
  await club.getByRole('tab', { name: 'Geral' }).click();
  await expect(club.locator('#club-msgs')).not.toContainText('Que começo!');
  await club.getByRole('tab', { name: 'Etapa 1' }).click();
  await expect(club.locator('#club-msgs')).toContainText('Que começo!');
});

test('clube: votação do próximo livro e o vencedor vira o livro do mês', async ({ page, browser }) => {
  await loginNewUser(page, 'Ana');
  await createClub(page);
  const club = page.locator('#sh-club');
  await club.getByRole('button', { name: 'Nova votação' }).click();
  const poll = page.locator('#sh-poll');
  await poll.getByRole('button', { name: /Adicionar livro/ }).click();
  await chooseBook(page, 'Duna');
  await poll.getByRole('button', { name: /Adicionar livro/ }).click();
  await chooseBook(page, 'Fundação');
  await expect(poll.locator('.poll-pick')).toHaveCount(2);
  await poll.getByRole('button', { name: 'Começar votação' }).click();
  await expect(club.locator('.poll-option')).toHaveCount(2);

  const { ctx, page: bia } = await newPage(browser, 'Bia');
  await goTo(bia, 'clubs');
  await bia.locator('.club-card', { hasText: 'Clube de Fantasia' }).click();
  await bia.getByRole('button', { name: 'Entrar no clube' }).click();
  await bia.locator('.poll-option', { hasText: 'Fundação' }).getByRole('button', { name: 'Votar' }).click();
  await expect(bia.locator('.poll-option', { hasText: 'Fundação' })).toContainText('1 voto');
  await ctx.close();

  await page.evaluate(() => openClub(CURRENT_CLUB.id));
  await expect(club.locator('.poll-option', { hasText: 'Fundação' })).toContainText('1 voto');
  await club.getByRole('button', { name: 'Encerrar votação' }).click();
  await expect(club.locator('.club-book-box')).toContainText('Fundação');
  await expect(club.locator('.poll-result')).toContainText('Fundação');
});

test('clube: encontro marcado aparece para todos e baixa o arquivo da agenda', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await createClub(page);
  const club = page.locator('#sh-club');
  await club.getByRole('button', { name: 'Marcar encontro' }).click();
  const sheet = page.locator('#sh-meeting');
  await sheet.locator('#meet-when').fill('2030-02-01T19:30');
  await sheet.locator('#meet-place').fill('Biblioteca Central');
  await sheet.getByRole('button', { name: 'Salvar encontro' }).click();
  await expect(club.locator('.club-meeting')).toContainText('Biblioteca Central');
  await expect(club.locator('.club-meeting')).toContainText('01/02/2030');
  const download = page.waitForEvent('download');
  await club.getByRole('button', { name: /Adicionar à agenda/ }).click();
  expect((await download).suggestedFilename()).toBe('encontro-clube.ics');
});

// ---------- item 4 ----------
test('troca concluída vira reputação no perfil; cidades com trocas abertas viram atalhos', async ({ page, browser }) => {
  await loginNewUser(page, 'Ana');
  await publish(page, { text: 'Doando Duna', type: 'trade', location: 'Joinville - SC' });
  await publish(page, { text: 'Troco Fundação', type: 'trade', location: 'Curitiba' });
  const posts = await page.evaluate(() => db.collection('posts').where('authorId', '==', APP_USER.uid).get()
    .then(s => s.docs.map(d => ({ id: d.id, text: d.data().text }))));
  const duna = posts.find(p => p.text === 'Doando Duna').id;
  await page.evaluate(id => updateTradeStatus(id, 'DONE'), duna);

  await goTo(page, 'profile');
  await expect(page.locator('#my-reputation')).toHaveText('🔄 1 troca concluída');

  const { ctx, page: bia } = await newPage(browser, 'Bia');
  const anaUid = await uidOf(page);
  await bia.evaluate(uid => openUserProfile(uid), anaUid);
  await expect(bia.locator('#up-reputation')).toHaveText('🔄 1 troca concluída');
  await bia.evaluate(() => closeSheet('sh-user-profile'));
  await bia.locator('#ftab-trade').click();
  const chips = bia.locator('#trade-cities');
  await expect(chips.getByRole('button', { name: /Curitiba/ })).toBeVisible();
  await expect(chips.getByRole('button', { name: /Joinville/ })).toHaveCount(0);   // a de Joinville já foi concluída
  await chips.getByRole('button', { name: /Curitiba/ }).click();
  await expect(bia.locator('#view-feed .post-card')).toHaveCount(1);
  await expect(bia.locator('#view-feed .post-card')).toContainText('Troco Fundação');
  await ctx.close();
});

test('pontos de leitura: sugerir um sebo, ver na lista da cidade e abrir no mapa', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await goTo(page, 'search');
  await page.getByRole('button', { name: /Sugerir lugar/ }).click();
  const sheet = page.locator('#sh-new-spot');
  await sheet.locator('#spot-name').fill('Sebo do Zé');
  await sheet.locator('#spot-kind').selectOption('sebo');
  await sheet.locator('#spot-city').fill('Joinville');
  await sheet.locator('#spot-address').fill('Rua das Flores, 10');
  await sheet.getByRole('button', { name: 'Salvar lugar' }).click();
  await expect(sheet).toBeHidden();

  await page.locator('#spots-city').fill('joinville');
  await page.locator('#spots-city').press('Enter');
  const card = page.locator('.spot-card', { hasText: 'Sebo do Zé' });
  await expect(card).toContainText('📚 Sebo');
  await expect(card.getByRole('link', { name: /Ver no mapa/ }))
    .toHaveAttribute('href', /openstreetmap\.org\/search\?query=Sebo%20do%20Z%C3%A9/);
});

// ---------- item 5 ----------
test('listas: criar, adicionar livro, outra leitora curte e põe na estante', async ({ page, browser, request }) => {
  await loginNewUser(page, 'Ana');
  await goTo(page, 'search');
  await page.getByRole('button', { name: /Criar lista/ }).click();
  await page.locator('#list-title').fill('Para ler numa tarde');
  await page.locator('#sh-new-list').getByRole('button', { name: 'Criar lista' }).click();
  const sheet = page.locator('#sh-list');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: /Adicionar livro/ }).click();
  await chooseBook(page, 'O Hobbit');
  await expect(sheet.locator('.list-book')).toContainText('O Hobbit');

  const { ctx, page: bia } = await newPage(browser, 'Bia');
  await goTo(bia, 'search');
  await bia.locator('.list-card', { hasText: 'Para ler numa tarde' }).click();
  await bia.getByRole('button', { name: /Curtir/ }).click();
  await expect(bia.getByRole('button', { name: /Curtida/ })).toContainText('1');
  await bia.locator('.list-book', { hasText: 'O Hobbit' }).getByRole('button', { name: /Quero ler/ }).click();
  await expect(bia.locator('#toast')).toContainText('Estante atualizada');
  const biaUid = await uidOf(bia);
  expect((await listDocs(request, `users/${biaUid}/library`))[0].fields.status.stringValue).toBe('tbr');
  await ctx.close();
});

test('Para você: recomenda o que quem amou o meu favorito também amou', async ({ page, browser }) => {
  const { ctx, page: bia } = await newPage(browser, 'Bia');
  await publish(bia, { text: 'Obra-prima', book: 'Duna', rating: 5 });
  await publish(bia, { text: 'Amei também', book: 'Fundação', rating: 5 });
  await ctx.close();

  await loginNewUser(page, 'Ana');
  await page.evaluate(() => saveBookToLibrary({ id: 'duna', title: 'Duna', author: 'Frank Herbert', coverUrl: '', rating: 5 }, 'read'));
  await expect.poll(() => page.evaluate(() => Boolean(MY_LIBRARY.duna))).toBe(true);
  await goTo(page, 'search');
  const forYou = page.locator('#explore-for-you');
  await expect(forYou.locator('.fy-book', { hasText: 'Fundação' })).toBeVisible();
  await expect(forYou).toContainText('Porque você gostou de Duna');
});
