// Layout de celular: precisa continuar igual depois do modo computador.
import { test, expect } from '@playwright/test';
import { resetEmulators, loginNewUser } from './helpers.mjs';

test.beforeEach(async ({ request }) => {
  await resetEmulators(request);
});

test('no celular a barra fica no topo, só com ícones, e nada passa da largura da tela', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  const nav = await page.locator('.top-nav').boundingBox();
  expect(nav.width).toBeGreaterThan(nav.height);                  // barra deitada no topo
  expect(nav.y).toBeLessThan(5);
  await expect(page.locator('.tnav-label').first()).toBeHidden();
  await expect(page.locator('.tnav-brand')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('no celular os botões principais têm pelo menos 44px (acessibilidade de toque)', async ({ page }) => {
  await loginNewUser(page, 'Ana');
  for (const id of ['#tnav-home', '#tnav-search', '#tnav-chat', '#tnav-clubs', '#tnav-notif', '#tnav-profile']) {
    const box = await page.locator(id).boundingBox();
    expect(box.height, id).toBeGreaterThanOrEqual(44);
  }
});
