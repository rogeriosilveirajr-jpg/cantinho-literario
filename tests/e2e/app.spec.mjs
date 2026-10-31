// Fluxos principais do Cantinho Literário, ponta a ponta, no navegador e com os emuladores do Firebase.
import { test, expect } from '@playwright/test';
import { resetEmulators, listDocs, loginNewUser, publish, goTo, openCompose, pickBook } from './helpers.mjs';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ request }) => {
  await resetEmulators(request);
});

async function reloadFeed(page) {
  await page.evaluate(() => { CURRENT_FEED_TAB = 'normal'; return loadFeed(true); });
}

test('login por e-mail cria a conta nova e abre o app (regressão do auth/invalid-credential)', async ({ page, request }) => {
  await loginNewUser(page, 'Ana');
  await expect(page.locator('#screen-login')).toBeHidden();
  await expect(page.locator('#tnav-home')).toBeVisible();
  expect(await listDocs(request, 'users')).toHaveLength(1);
});

test('resenha com livro, 4 estrelas e spoiler aparece no feed com o texto escondido', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await publish(page, { text: 'O final me pegou de surpresa', book: 'Duna', rating: 4, spoiler: true });
  await reloadFeed(page);

  const card = page.locator('.post-card').first();
  await expect(card.locator('.pc-book-title')).toContainText('Duna');
  await expect(card.locator('.pc-stars')).toHaveText('★★★★☆');
  await expect(card.locator('.pc-spoiler')).toHaveAttribute('data-hidden', 'true');
  await card.getByRole('button', { name: /Contém spoiler/ }).click();
  await expect(card.locator('.pc-spoiler')).toHaveAttribute('data-hidden', 'false');
  await expect(card.locator('.pc-text')).toContainText('O final me pegou de surpresa');
});

test('texto com HTML é mostrado como texto e não executa script (XSS)', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  const ataque = '<img src=x onerror="window.__xss = 1">';
  await publish(page, { text: ataque });
  await reloadFeed(page);
  await expect(page.locator('.post-card .pc-text').first()).toHaveText(ataque);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('o contador de posts do perfil acompanha a lista ao publicar e excluir (regressão "1 posts")', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await publish(page, { text: 'Primeiro post' });
  await goTo(page, 'profile');
  await expect(page.locator('#my-posts-count')).toHaveText('1');
  await expect(page.locator('#pt-posts .post-card')).toHaveCount(1);

  await page.locator('#pt-posts .post-card .pc-dots').click();
  await page.getByRole('button', { name: 'Excluir Publicação' }).click();
  await expect(page.locator('#pt-posts .post-card')).toHaveCount(0);
  await goTo(page, 'home');
  await goTo(page, 'profile');
  await expect(page.locator('#my-posts-count')).toHaveText('0');
  await expect(page.locator('#pt-posts')).toContainText('Você ainda não publicou nada');
});

test('página do livro mostra a média, as resenhas e recomenda o que o mesmo leitor amou', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await publish(page, { text: 'Obra-prima', book: 'Duna', rating: 5 });
  await publish(page, { text: 'Muito bom', book: 'Fundação', rating: 4 });
  await reloadFeed(page);

  await page.locator('.post-card .pc-book', { hasText: 'Duna' }).first().click();
  const sheet = page.locator('#sh-book-page');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('#book-page-avg')).toContainText('5.0');
  await expect(sheet.locator('#book-page-avg')).toContainText('1 nota');
  await expect(sheet.locator('#book-page-reviews .post-card')).toHaveCount(1);
  await expect(sheet.locator('#book-page-recs .bp-rec')).toContainText('Fundação');
});

test('trocas: aparecem na aba própria, filtram pela cidade e mudam de status', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await publish(page, { type: 'trade', location: 'Joinville - SC', text: 'Troco Duna' });
  await publish(page, { type: 'trade', location: 'Blumenau', text: 'Doo O Hobbit' });
  await publish(page, { text: 'Post comum que não é troca' });

  await page.locator('#ftab-trade').click();
  await expect(page.locator('#view-feed .post-card')).toHaveCount(2);
  await expect(page.locator('#view-feed')).not.toContainText('Post comum');

  // o filtro pede a cidade do perfil
  await page.evaluate(() => db.collection('users').doc(APP_USER.uid).update({ city: 'joinville' }).then(() => { APP_USER.city = 'joinville'; }));
  await page.locator('#trade-near').check();
  await expect(page.locator('#view-feed .post-card')).toHaveCount(1);
  await expect(page.locator('#view-feed .post-card')).toContainText('Troco Duna');

  const card = page.locator('#view-feed .post-card').first();
  await expect(card.locator('.trade-badge')).toHaveText('Disponível');
  await card.locator('.pc-dots').click();
  await page.getByRole('button', { name: 'Marcar como combinado' }).click();
  await expect(card.locator('.trade-badge')).toHaveText('Combinado');
});

test('trocas: sem cidade no perfil o filtro avisa e não liga', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await page.locator('#ftab-trade').click();
  await page.locator('#trade-near').click();               // o app desmarca sozinho e avisa
  await expect(page.locator('#trade-near')).not.toBeChecked();
  await expect(page.locator('#toast')).toContainText('cidade');
});

test('citação exige livro, aparece em destaque e o compartilhar copia o texto', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await openCompose(page);
  await page.locator('#post-type-select').selectOption('quote');
  await page.locator('#post-ta').fill('Um começo é um momento delicado');
  await page.locator('#sh-new-post .sh-action').click();
  await expect(page.locator('#toast')).toContainText('Marque de qual livro');

  await pickBook(page, 'Duna');
  await page.locator('#sh-new-post .sh-action').click();
  await expect(page.locator('#sh-new-post')).toBeHidden();
  await reloadFeed(page);

  const card = page.locator('.post-card').first();
  await expect(card.locator('.pc-quote')).toContainText('Um começo é um momento delicado');
  await expect(card.locator('.pc-quote-cite')).toContainText('Duna, Frank Herbert');
  await card.getByRole('button', { name: 'Compartilhar' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('— Duna, Frank Herbert');
});

test('estante "Lendo" guarda o progresso; ao terminar, conquista e retrospectiva contam o livro', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await goTo(page, 'profile');
  await page.getByRole('tab', { name: 'Lendo' }).click();
  await page.getByRole('button', { name: '+ Começar a ler' }).click();
  await page.locator('#book-search-input').fill('Hobbit');
  await page.locator('.sr-item', { hasText: 'O Hobbit' }).click();

  const shelfBook = page.locator('#list-reading .shelf-book', { hasText: 'O Hobbit' });
  await expect(shelfBook).toBeVisible();
  await shelfBook.click();
  await expect(page.locator('#bo-progress-section')).toBeVisible();
  await expect(page.locator('#bo-total')).toHaveValue('300');      // veio do Google Books
  await page.locator('#bo-page').fill('150');
  await page.getByRole('button', { name: 'Salvar' }).last().click();
  await expect(shelfBook.locator('.shelf-progress-txt')).toHaveText('pág. 150/300');

  // valor-limite: página acima do total fica no total
  await shelfBook.click();
  await page.locator('#bo-page').fill('999');
  await page.getByRole('button', { name: 'Salvar' }).last().click();
  await expect(shelfBook.locator('.shelf-progress-txt')).toHaveText('pág. 300/300');

  await shelfBook.click();
  await page.locator('#bo-btn-read').click();
  await page.locator('#bo-stars span[data-val="5"]').click();
  await page.getByRole('tab', { name: 'Lidos' }).click();
  await expect(page.locator('#list-read .shelf-book', { hasText: 'O Hobbit' })).toBeVisible();

  await goTo(page, 'home');
  await goTo(page, 'profile');
  await expect(page.locator('#achievements .ach-on', { hasText: 'Primeiro livro lido' })).toBeVisible();
  await page.getByRole('button', { name: /retrospectiva/ }).click();
  const card = page.locator('#wrapped-card');
  await expect(card.locator('.wr-item', { hasText: 'livros lidos' })).toContainText('1');
  await expect(card).toContainText('Melhor leitura: O Hobbit');
});

test('clubes: nome curto é recusado, clube nasce com o dono, outro leitor entra e conversa', async ({ page, browser }) => {
  await loginNewUser(page, 'Ana');
  await goTo(page, 'clubs');
  await page.getByRole('button', { name: '+ Criar clube' }).click();
  await page.locator('#club-name').fill('ab');
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('de 3 a 60');

  await page.locator('#club-name').fill('Clube de Fantasia');
  await page.locator('#club-city').fill('Joinville - SC');
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  const club = page.locator('#sh-club');
  await expect(club).toBeVisible();
  await expect(club.locator('.club-meta')).toContainText('1 membro ');
  await club.locator('#club-msg-input').fill('Bem-vindos ao clube!');
  await club.getByRole('button', { name: 'Enviar' }).click();
  await expect(club.locator('.club-msg.mine')).toContainText('Bem-vindos ao clube!');

  const other = await browser.newContext({ permissions: [] });
  const bia = await other.newPage();
  await loginNewUser(bia, 'Bia');
  await goTo(bia, 'clubs');
  await bia.locator('.club-card', { hasText: 'Clube de Fantasia' }).click();
  await expect(bia.locator('#club-msgs')).toContainText('Entre no clube');
  await bia.getByRole('button', { name: 'Entrar no clube' }).click();
  await expect(bia.locator('#sh-club .club-meta')).toContainText('2 membros');
  await expect(bia.locator('#club-msgs')).toContainText('Bem-vindos ao clube!');
  await bia.locator('#club-msg-input').fill('Oi, gente!');
  await bia.getByRole('button', { name: 'Enviar' }).click();

  await expect(club.locator('#club-msgs')).toContainText('Oi, gente!');     // chega em tempo real para a Ana
  await bia.getByRole('button', { name: 'Sair do clube' }).click();
  await expect(bia.locator('#sh-club .club-meta')).toContainText('1 membro ');
  await other.close();
});

test('denunciar pelo menu do post registra a denúncia do post certo (regressão)', async ({ page, browser, request }) => {
  await loginNewUser(page, 'Ana');
  await publish(page, { text: 'Post da Ana' });
  const postId = (await listDocs(request, 'posts'))[0].name.split('/').pop();

  const other = await browser.newContext();
  const bia = await other.newPage();
  await loginNewUser(bia, 'Bia');
  await bia.evaluate(() => loadFeed(true));
  await bia.locator('.post-card', { hasText: 'Post da Ana' }).locator('.pc-dots').click();
  await bia.getByRole('button', { name: 'Denunciar Publicação' }).click();
  await expect(bia.locator('#sh-report')).toBeVisible();
  await bia.locator('#sh-report button').filter({ hasText: /spam|Spam|ofensivo|Ofensivo|Outro/ }).first().click();
  await expect(bia.locator('#toast')).toContainText('Denúncia enviada');

  const reports = await listDocs(request, 'contentReports');
  expect(reports).toHaveLength(1);
  expect(reports[0].fields.targetId.stringValue).toBe(postId);
  await other.close();
});

test('modo computador: menu lateral com textos e janelas no meio da tela', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await expect(page.locator('.tnav-label', { hasText: 'Clubes' })).toBeVisible();
  await expect(page.locator('.tnav-brand')).toBeVisible();
  const nav = await page.locator('.top-nav').boundingBox();
  expect(nav.height).toBeGreaterThan(nav.width);                 // menu em pé, à esquerda
  await page.evaluate(() => openSheet('sh-edit-profile'));
  const box = await page.locator('#sh-edit-profile .sheet-box').boundingBox();
  expect(box.y).toBeGreaterThan(0);                               // não encosta no rodapé como no celular
  await expect(page.locator('#sh-edit-profile .ep-cover-btn')).toHaveText('📷 Alterar capa');
});

test('"+ Quero ler" na página do livro não rebaixa um livro já lido nem apaga a nota (regressão)', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  await goTo(page, 'profile');
  await page.getByRole('tab', { name: 'Lidos' }).click();
  await page.getByRole('button', { name: '+ Adicionar aos Lidos' }).click();
  await page.locator('#book-search-input').fill('Duna');
  await page.locator('.sr-item', { hasText: 'Duna' }).click();
  await page.locator('#bo-stars span[data-val="5"]').click();
  await expect(page.locator('#list-read .shelf-book-rating')).toHaveText('★ 5');

  await publish(page, { text: 'Clássico', book: 'Duna', rating: 5 });
  await page.evaluate(() => openBookPage('duna'));
  await page.getByRole('button', { name: '+ Quero ler' }).click();
  await expect(page.locator('#toast')).toContainText('já está na sua estante (Lidos)');
  await page.evaluate(() => closeSheet('sh-book-page'));
  await expect(page.locator('#list-read .shelf-book-rating')).toHaveText('★ 5');
});
