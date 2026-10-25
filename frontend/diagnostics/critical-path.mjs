/**
 * T5.6 — the authentication paths every user walks, checked end to end.
 *
 * The refresh change sits on the critical path: if signing in, signing out or
 * a genuinely expired session broke, nothing else would matter. The unit
 * tests cover the logic with `fetch` doubled; this drives the real browser
 * against the real backend, which is the only place the cookie, the route
 * middleware and the server's own verdict all participate.
 *
 * Usage:
 *   DIAG_EMAIL=... DIAG_PASSWORD=... node diagnostics/critical-path.mjs
 */
import { chromium } from 'playwright'

const APP = process.env.DIAG_APP ?? 'http://localhost:3000'
const EMAIL = process.env.DIAG_EMAIL ?? ''
const PASSWORD = process.env.DIAG_PASSWORD ?? ''

if (!EMAIL || !PASSWORD) {
  console.error('Faltan DIAG_EMAIL y DIAG_PASSWORD.')
  process.exit(2)
}

const results = []
const check = (name, passed, detail) => {
  results.push({ name, passed, detail })
  console.log(`  ${passed ? 'OK ' : 'MAL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const path = (page) => new URL(page.url()).pathname

async function signIn(page) {
  await page.goto(`${APP}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  const answered = page.waitForResponse((r) => r.url().includes('/auth/login/'), { timeout: 60000 })
  await page.click('button[type="submit"]')
  const res = await answered
  await page.waitForTimeout(2500)
  return res.status()
}

const browser = await chromium.launch()

// 1. Signing in still works, and leaves a usable session.
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const status = await signIn(page)
  check('acceso: la API responde 200', status === 200, `HTTP ${status}`)
  check('acceso: aterriza fuera de /auth/login', !path(page).includes('/auth/login'), path(page))

  const cookie = (await ctx.cookies()).find((c) => c.name === 'pyaglogen3d_auth')
  check('acceso: cookie marcadora presente', Boolean(cookie))

  await page.goto(`${APP}/dashboard`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  check('acceso: el dashboard carga con sesión', path(page) === '/dashboard', path(page))
  await ctx.close()
}

// 2. Signing out leaves, and stays left. The old code could put the user back
//    inside if a refresh answered during the round trip.
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page)

  await page.goto(`${APP}/dashboard`, { waitUntil: 'load' })
  await page.waitForTimeout(2000)
  // Drive sign-out the way the application does, then look at what is left.
  await page.evaluate(() => {
    document.cookie = 'pyaglogen3d_auth=; path=/; max-age=0'
    localStorage.removeItem('pyaglogen3d_refresh_token')
  })
  await page.goto(`${APP}/dashboard`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  check('cierre: sin credenciales, /dashboard manda a login', path(page).includes('/auth/login'), path(page))
  await ctx.close()
}

// 3. A genuinely dead credential still ends the session. This is the half of
//    the change that must NOT have been softened: recovering from collisions
//    cannot mean keeping a revoked token alive.
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page)

  await page.evaluate(() => {
    localStorage.setItem('pyaglogen3d_refresh_token', 'definitely-not-a-valid-token')
  })
  await page.goto(`${APP}/dashboard`, { waitUntil: 'load' })
  await page.waitForTimeout(4000)
  check(
    'caducada: un token inválido termina en login',
    path(page).includes('/auth/login'),
    path(page),
  )
  await ctx.close()
}

await browser.close()

const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
process.exit(failed.length === 0 ? 0 : 1)
