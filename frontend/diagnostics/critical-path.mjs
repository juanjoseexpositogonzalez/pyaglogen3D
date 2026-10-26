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
const API = process.env.DIAG_API ?? 'http://localhost:8000'
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

// 2. Signing out: the real button, and the server's side of it.
//    The earlier version of this check cleared storage by hand, so it proved
//    only that a browser without credentials stays out. It therefore missed a
//    regression where sign-out stopped revoking the token server-side: the
//    request went out unauthenticated, the server answered 401, and the
//    refresh token stayed usable for its full seven-day lifetime.
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page)

  const stolen = await page.evaluate(() => localStorage.getItem('pyaglogen3d_refresh_token'))

  let logoutStatus = 0
  page.on('response', (res) => {
    if (res.url().includes('/auth/logout/')) logoutStatus = res.status()
  })

  // Targeted by its label: the deprecated header exposes a control with the
  // same accessible name, and matching loosely picks the wrong one.
  const button = page.locator('button[aria-label=\'Sign out\']').first()
  const visible = await button.isVisible().catch(() => false)
  check('cierre: el botón de salir está disponible', visible)
  if (visible) {
    await button.click()
    await page.waitForTimeout(3000)
  }

  check('cierre: aterriza en login', path(page).includes('/auth/login'), path(page))
  check('cierre: el servidor acepta la revocación', logoutStatus === 200, `HTTP ${logoutStatus}`)

  // The point of revocation: the credential must be dead for everyone, not
  // just forgotten by this browser.
  if (stolen) {
    const reused = await fetch(`${API}/api/v1/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: stolen }),
    }).then((r) => r.status)
    check(
      'cierre: el token previo ya no sirve',
      reused === 401,
      `refresh devuelve HTTP ${reused}`,
    )
  }
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
