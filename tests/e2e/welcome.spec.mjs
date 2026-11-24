// Boas-vindas guiadas, seção Descobrir do feed, convites e selo Fundador — ponta a ponta.
import { test, expect } from '@playwright/test';
import { resetEmulators, listDocs, loginNewUser, goTo } from './helpers.mjs';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ request }) => {
  await resetEmulators(request);
});

const field = (docJson, name) => docJson.fields[name];
const myDoc = async (page, request) => {
  const uid = await page.evaluate(() => APP_USER.uid);
  return (await listDocs(request, 'users')).find(d => d.name.endsWith(`/users/${uid}`));
};

/** Ana cria um clube; devolve o contexto dela para fechar no fim. */
async function anaWithClub(browser) {
  const ctx = await browser.newContext();
  const ana = await ctx.newPage();
  await loginNewUser(ana, 'Ana');
  await goTo(ana, 'clubs');
  await ana.getByRole('button', { name: '+ Criar clube' }).click();
  await ana.locator('#club-name').fill('Clube de Fantasia');
  await ana.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(ana.locator('#sh-club')).toBeVisible();
  return { ctx, ana };
}

test('conta nova passa pelas boas-vindas: gêneros, livro do momento, segue leitora e entra em clube', async ({ page, browser, request }) => {
  const { ctx } = await anaWithClub(browser);

  await loginNewUser(page, 'Bia', { welcome: true });
  const sheet = page.locator('#sh-welcome');
  await expect(sheet).toBeVisible();

  // 1. gêneros
  await sheet.getByRole('button', { name: 'Fantasia' }).click();
  await sheet.getByRole('button', { name: 'Romance' }).click();
  await expect(sheet.getByRole('button', { name: 'Fantasia' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Continuar' }).click();

  // 2. o que está lendo
  await sheet.getByRole('button', { name: /Escolher livro/ }).click();
  await page.locator('#book-search-input').fill('Duna');
  await page.locator('.sr-item', { hasText: 'Duna' }).first().click();
  await expect(sheet.locator('#welcome-reading')).toContainText('Duna');
  await sheet.getByRole('button', { name: 'Continuar' }).click();

  // 3. leitores e clubes sugeridos
  const reader = sheet.locator('.wl-person', { hasText: 'Ana' });
  await reader.getByRole('button', { name: 'Seguir' }).click();
  await expect(reader.getByRole('button')).toHaveText('Seguindo');
  const club = sheet.locator('.wl-club', { hasText: 'Clube de Fantasia' });
  await club.getByRole('button', { name: 'Entrar' }).click();
  await expect(club.getByRole('button')).toHaveText('Participando');

  await sheet.getByRole('button', { name: 'Começar a explorar' }).click();
  await expect(sheet).toBeHidden();

  const bia = await myDoc(page, request);
  expect(field(bia, 'favoriteGenres').arrayValue.values.map(v => v.stringValue)).toEqual(['fantasia', 'romance']);
  expect(field(bia, 'onboardedAt').timestampValue).toBeTruthy();
  const uid = await page.evaluate(() => APP_USER.uid);
  const reading = await listDocs(request, `users/${uid}/library`);
  expect(reading.map(d => d.fields.status.stringValue)).toEqual(['reading']);
  expect((await listDocs(request, 'followGraph')).length).toBe(1);

  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#sh-welcome')).toBeHidden();
  await ctx.close();
});

test('pular as boas-vindas grava que a pessoa já passou por elas', async ({ page, request }) => {
  await loginNewUser(page, 'Caio', { welcome: true });
  await page.locator('#sh-welcome').getByRole('button', { name: 'Pular' }).click();
  await expect(page.locator('#sh-welcome')).toBeHidden();
  const caio = await myDoc(page, request);
  expect(field(caio, 'onboardedAt').timestampValue).toBeTruthy();
});

test('fechar as boas-vindas tocando fora da janela também conta como pular (regressão)', async ({ page, request }) => {
  await loginNewUser(page, 'Duda', { welcome: true });
  await expect(page.locator('#screen-login')).toBeHidden();
  await page.mouse.click(10, 10);   // fundo escuro, fora da janela
  await expect(page.locator('#sh-welcome')).toBeHidden();
  await expect.poll(async () => Boolean(field(await myDoc(page, request), 'onboardedAt'))).toBe(true);
});

test('feed com poucos posts mostra Descobrir: pergunta do dia, citação e livros para adicionar', async ({ page, request }) => {
  await loginNewUser(page, 'Ana');

  const disc = page.locator('#feed-discovery');
  await expect(disc).toBeVisible();
  await expect(disc.locator('.disc-quote')).not.toBeEmpty();
  await expect(disc.locator('.disc-book', { hasText: 'Duna' })).toBeVisible();

  await disc.locator('.disc-book', { hasText: 'Duna' }).getByRole('button', { name: /Quero ler/ }).click();
  await expect(page.locator('#toast')).toContainText('Estante atualizada');
  const uid = await page.evaluate(() => APP_USER.uid);
  expect((await listDocs(request, `users/${uid}/library`))[0].fields.status.stringValue).toBe('tbr');

  const prompt = await disc.locator('.disc-prompt-text').textContent();
  await disc.getByRole('button', { name: 'Responder' }).click();
  await expect(page.locator('#sh-new-post')).toBeVisible();
  await expect(page.locator('#post-ta')).toHaveValue(new RegExp(prompt.replace(/[?.]/g, '\\$&')));

  await page.locator('#sh-new-post .sh-cancel').click();
  await page.locator('#ftab-trade').click();
  await expect(page.locator('#feed-discovery')).toHaveCount(0);
});

test('convite: o link leva o id de quem convidou, a nova conta fica ligada a ele e ele é avisado', async ({ page, browser, request }) => {
  await loginNewUser(page, 'Ana');
  const anaUid = await page.evaluate(() => APP_USER.uid);
  await goTo(page, 'profile');
  await page.getByRole('button', { name: /Convidar amigos/ }).click();
  await expect(page.locator('#invite-link')).toHaveValue(new RegExp(`convite=${anaUid}$`));
  await expect(page.locator('#invite-count')).toHaveText('Ninguém entrou pelo seu convite ainda.');
  await page.getByRole('button', { name: 'Copiar link' }).click();
  await expect(page.locator('#toast')).toContainText('Link copiado');

  const other = await browser.newContext();
  const bia = await other.newPage();
  await loginNewUser(bia, 'Bia', { query: `&convite=${anaUid}` });
  const biaDoc = await myDoc(bia, request);
  expect(field(biaDoc, 'invitedBy').stringValue).toBe(anaUid);
  await other.close();

  const notifs = await listDocs(request, `users/${anaUid}/notifications`);
  expect(notifs.map(n => n.fields.type.stringValue)).toContain('invite');
  await page.locator('#sh-invite .sh-cancel').click();
  await page.getByRole('button', { name: /Convidar amigos/ }).click();
  await expect(page.locator('#invite-count')).toHaveText('1 leitor entrou pelo seu convite 🎉');
});

test('quem entra antes do prazo ganha o selo Fundador no perfil, visível para os outros também', async ({ page, browser }) => {
  await loginNewUser(page, 'Ana');
  await goTo(page, 'profile');
  await expect(page.locator('#my-founder-badge')).toBeVisible();
  const anaUid = await page.evaluate(() => APP_USER.uid);

  const other = await browser.newContext();
  const bia = await other.newPage();
  await loginNewUser(bia, 'Bia');
  await bia.evaluate(uid => openUserProfile(uid), anaUid);
  await expect(bia.locator('#up-founder-badge')).toBeVisible();
  await other.close();
});
