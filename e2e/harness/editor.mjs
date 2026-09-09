import { CREDENTIALS } from './instance.mjs'

/** Log in through the real form, so the session cookies are the real ones. */
export async function login(page, baseURL) {
  await page.goto(`${baseURL}/login`)
  await page.fill('input[type=email]', CREDENTIALS.email)
  await page.fill('input[type=password]', CREDENTIALS.password)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 20_000 })
}

/**
 * The MentionEditor under a given field label.
 *
 * Every prose field on the page renders the same `.mention-editor` element, so
 * the label is the only thing that tells them apart — indexes shift the moment
 * a field is added.
 */
export function proseField(page, label) {
  return page
    .locator(`p:has-text("${label}"), h3:has-text("${label}")`)
    .locator('xpath=../following-sibling::*[1]//div[contains(@class,"mention-editor")]')
    .first()
}

/** Replace a prose field's whole content by typing it. */
export async function typeInto(field, page, text) {
  await field.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(text, { delay: 10 })
}

/**
 * A real paste — a `paste` event carrying a DataTransfer, which is what the
 * browser dispatches and what TipTap's paste handling actually reads. Typing
 * the text instead would exercise a completely different code path.
 */
export async function pasteInto(field, { text, html } = {}) {
  await field.click()
  await field.evaluate((el, { text, html }) => {
    const dt = new DataTransfer()
    if (html) dt.setData('text/html', html)
    dt.setData('text/plain', text ?? '')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, { text, html })
}

/**
 * Leave the window and come back, the way copying text from another app does.
 *
 * React Query's focus manager listens for `visibilitychange`, and this used to
 * fire a refetch whose late response re-seated the cache with pre-edit data —
 * so the next full-record PUT saved that stale copy back over the author's
 * paste. Keep this in the suite even though focus refetching is now off: it is
 * the guard that stops it being switched back on.
 */
export async function altTabAway(page) {
  await page.evaluate(() => {
    const set = v => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
    set('hidden')
    window.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    set('visible')
    window.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
}

/** Open the scene detail panel from the left-hand scene list. */
export async function openScene(page, title) {
  await page.getByRole('button', { name: title }).first().click()
  await page.locator('p:has-text("Ce qui se passe")').first().waitFor({ timeout: 10_000 })
}
