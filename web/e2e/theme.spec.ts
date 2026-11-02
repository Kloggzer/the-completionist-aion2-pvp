// Colour themes (light "Aion Ember", dark "Night Indigo", system) and the sidebar in both: screenshots for a visual check.
import { expect, test } from '@playwright/test'
import { goPage, hasCache, openApp } from './host'

test.skip(!hasCache(), 'needs the app data cache in %LOCALAPPDATA%\TheCompletionist\cache (start the app once)')

for (const theme of ['light', 'dark'] as const) test('theme ' + theme, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page, { ui: { theme } })
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
  for (const p of ['Übersicht', 'Ziele', 'Daevanion']) {
    await goPage(page, p)
    await page.screenshot({ path: `e2e/.out/shots/theme-${theme}-${p}.png` })
  }
  await page.setViewportSize({ width: 360, height: 700 })
  await goPage(page, 'Übersicht')
  await page.screenshot({ path: `e2e/.out/shots/theme-${theme}-narrow.png` })
})

test('the theme setting switches at once', async ({ page }) => {
  await openApp(page, { ui: { theme: 'dark' } })
  await page.locator('[data-tip="Einstellungen"]').click()
  await page.locator('[data-theme="light"]').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.locator('[data-theme="dark"]').click()
  await expect(page.locator('html')).toHaveClass(/dark/)
})
