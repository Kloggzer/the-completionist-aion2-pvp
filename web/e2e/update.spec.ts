// Update notice: the host reports a newer release ('update', Updater.cs); the header shows a button that asks the host
// to update ('updateNow'), with a busy state while the portable exe downloads; a failure ('updateFailed') ends it.
import { expect, test } from '@playwright/test'
import { hasCache, openApp } from './host'

test.skip(!hasCache(), 'needs the app data cache in %LOCALAPPDATA%\\TheCompletionist\\cache (start the app once)')

test('update notice: header button, update request, busy until it fails', async ({ page }) => {
  const app = await openApp(page)
  await expect(page.locator('[data-update]')).toHaveCount(0)
  await app.send({ type: 'update', version: '1.2.0', page: 'https://github.com/Kloggzer/the-completionist-aion2-pvp/releases/tag/v1.2.0-pvp', auto: true })
  const btn = page.locator('[data-update]')
  await expect(btn).toContainText('1.2.0')
  await btn.click()
  await expect.poll(async () => (await app.posted('updateNow')).length).toBe(1)
  await expect(btn).toBeDisabled()
  await app.send({ type: 'updateFailed' })
  await expect(btn).toBeEnabled()
})
