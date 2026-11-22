// Painel de moderação (admin.html) contra os emuladores locais.
import { test, expect } from '@playwright/test';
import { resetEmulators, loginNewUser, listDocs } from './helpers.mjs';

const DOCS = 'http://127.0.0.1:8080/v1/projects/demo-cantinho/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' };
const ADMIN_URL = '/admin.html?emulador';
const OTHER_UID = 'leitorTeste';
const OTHER_POST = 'AbCdEfGhIjKlMnOpQrSt';

/** Grava um documento direto no emulador, sem regras (como o console do Firebase faria). */
async function seed(request, path, fields) {
  const res = await request.patch(`${DOCS}/${path}`, { headers: OWNER, data: { fields } });
  expect(res.ok()).toBeTruthy();
}

async function seedOtherReader(request) {
  const now = new Date().toISOString();
  await seed(request, `users/${OTHER_UID}`, {
    displayName: { stringValue: 'Bruno Teste' }, handle: { stringValue: 'brunoteste' },
    createdAt: { timestampValue: now }, postsCount: { integerValue: '1' },
    authProviders: { mapValue: { fields: { google: { stringValue: OTHER_UID } } } },
  });
  await seed(request, `posts/${OTHER_POST}`, {
    authorId: { stringValue: OTHER_UID }, isPrivate: { booleanValue: false },
    text: { stringValue: 'Post que precisa de moderação' }, createdAt: { timestampValue: now },
    authorSnap: { mapValue: { fields: { displayName: { stringValue: 'Bruno Teste' } } } },
  });
}

test.beforeEach(async ({ request }) => { await resetEmulators(request); });

test('usuário comum que abre o painel vê "Acesso negado"', async ({ page }) => {
  await loginNewUser(page, 'Comum');
  await page.goto(ADMIN_URL);
  await expect(page.getByRole('heading', { name: /403/ })).toBeVisible();
  await expect(page.locator('#adm-panel')).toBeHidden();
});

test('sem login, o painel pede para entrar primeiro', async ({ page }) => {
  await page.goto(ADMIN_URL);
  await expect(page.getByRole('heading', { name: 'Faça login primeiro' })).toBeVisible();
});

test('moderadora vê usuários e publicações, oculta, restaura e bloqueia', async ({ page, request }) => {
  await loginNewUser(page, 'Moderadora');
  const myUid = await page.evaluate(() => APP_USER.uid);
  await seed(request, `admins/${myUid}`, { since: { integerValue: '1' } });
  await seedOtherReader(request);

  await page.goto(ADMIN_URL);
  const rows = page.locator('#user-rows');
  const bruno = rows.locator('tr', { hasText: 'Bruno Teste' });
  await expect(bruno).toContainText('Google');
  await expect(rows.locator('tr', { hasText: 'Moderadora' })).toContainText('E-mail');
  await expect(rows.locator('tr', { hasText: 'Moderadora' })).toContainText('você');

  // Publicações: ocultar tira do ar e manda para "Ocultadas"
  await page.getByRole('tab', { name: 'Publicações' }).click();
  const card = page.locator('#post-list .card', { hasText: 'Post que precisa de moderação' });
  await card.getByRole('button', { name: 'Ocultar' }).click();
  await expect(card).toHaveCount(0);
  expect((await listDocs(request, 'posts')).length).toBe(0);

  await page.getByRole('tab', { name: 'Ocultadas' }).click();
  const hidden = page.locator('#hidden-list .card', { hasText: 'Post que precisa de moderação' });
  await hidden.getByRole('button', { name: 'Restaurar' }).click();
  await expect(hidden).toHaveCount(0);
  expect((await listDocs(request, 'posts')).length).toBe(1);

  // Bloquear e desbloquear
  await page.getByRole('tab', { name: 'Usuários' }).click();
  await bruno.getByRole('button', { name: 'Bloquear' }).click();
  await expect(bruno).toContainText('Bloqueado');
  expect((await listDocs(request, 'bannedUsers')).length).toBe(1);
  await bruno.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(bruno).not.toContainText('Bloqueado');
  expect((await listDocs(request, 'bannedUsers')).length).toBe(0);
});
