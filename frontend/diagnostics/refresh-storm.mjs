/**
 * Diagnostic for #122 — does the session survive ordinary navigation?
 *
 * The access token lives in memory (`src/lib/token-storage.ts`), so every full
 * page load starts without one: data requests go out unauthorized, receive 401
 * together, and each asks for its own refresh (`src/lib/api.ts`). The server
 * rotates and blacklists, so latecomers are rejected.
 *
 * This measures three things a console eyeball cannot:
 *
 *   1. How many refreshes a screen issues, and how many of them genuinely
 *      OVERLAP in flight. "Five requests seen in four seconds" is not the same
 *      claim as "five concurrent refreshes", and only the second one matters.
 *   2. Whether a tab died from its OWN rejected refresh (a collision) or from
 *      another tab having wiped the shared refresh token (a cascade). These
 *      have different fixes and an instrument that conflates them argues for
 *      the wrong one.
 *   3. All of the above over N runs, because the failure is probabilistic.
 *
 * Usage:
 *   node diagnostics/refresh-storm.mjs --runs 10
 *   node diagnostics/refresh-storm.mjs --runs 3 --json > before.json
 *
 * Requires Playwright and a browser channel. Neither is a runtime dependency
 * of the application; install with `npm i -D playwright` or run via npx.
 */
import { chromium } from 'playwright'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const FLAG = (name) => process.argv.includes(`--${name}`)

const CONFIG = {
  app: arg('app', process.env.DIAG_APP ?? 'http://localhost:3000'),
  email: arg('email', process.env.DIAG_EMAIL ?? 'demo@pyaglogen3d.dev'),
  password: arg('password', process.env.DIAG_PASSWORD ?? 'demo-visual-2026'),
  project: arg('project', process.env.DIAG_PROJECT ?? ''),
  simulation: arg('simulation', process.env.DIAG_SIMULATION ?? ''),
  runs: Number.parseInt(arg('runs', '3'), 10),
  json: FLAG('json'),
  channel: arg('channel', process.env.DIAG_CHANNEL ?? 'chrome'),
}

if (!Number.isInteger(CONFIG.runs) || CONFIG.runs < 1) {
  console.error('--runs debe ser un entero >= 1. Con 0 el informe saldría verde sin medir nada.')
  process.exit(2)
}

if (!CONFIG.project) {
  console.error(
    'Falta --project <uuid>. Un proyecto con varias simulaciones es lo que\n' +
      'hace que la pantalla de detalle dispare varias peticiones a la vez.\n' +
      'Opcional: --simulation <uuid>.',
  )
  process.exit(2)
}

const REFRESH = '/auth/token/refresh/'
const log = (...a) => { if (!CONFIG.json) console.log(...a) }

/**
 * Records each refresh by request identity, never FIFO. With five concurrent
 * refreshes — the screen every figure comes from — matching by order lets one
 * response carry another request's status, corrupting both the overlap and
 * the collision/cascade split at once.
 */
function instrument(page, calls) {
  const byRequest = new Map()
  page.on('request', (req) => {
    if (!req.url().includes(REFRESH)) return
    const call = { start: Date.now(), end: null, status: null, failed: false }
    byRequest.set(req, call)
    calls.push(call)
  })
  page.on('response', (res) => {
    const call = byRequest.get(res.request())
    if (!call) return
    call.end = Date.now()
    call.status = res.status()
  })
  // A refresh that dies at transport level never gets a response. Left
  // unclosed it would count as neither rejected nor in flight, and the tab it
  // killed would be misfiled as a cascade — the very axis the design argues on.
  page.on('requestfailed', (req) => {
    const call = byRequest.get(req)
    if (!call) return
    call.end = Date.now()
    call.failed = true
  })
}

/**
 * Instants where both tabs had a refresh in flight at once. Grouped
 * concurrency is not the same claim: a peak of five can come entirely from
 * one tab, and reporting that as "overlap between tabs" would dress a
 * single-tab measurement up as a cross-tab one.
 */
function crossTabOverlap(a, b) {
  const windows = (calls) => calls.filter((c) => c.end !== null).map((c) => [c.start, c.end])
  let found = 0
  for (const [aStart, aEnd] of windows(a)) {
    for (const [bStart, bEnd] of windows(b)) {
      if (aStart < bEnd && bStart < aEnd) found++
    }
  }
  return found
}

/** The largest number of refreshes in flight at the same instant. */
function peakOverlap(calls) {
  const edges = []
  for (const c of calls) {
    if (c.end === null) continue
    edges.push({ t: c.start, d: 1 }, { t: c.end, d: -1 })
  }
  edges.sort((a, b) => a.t - b.t || a.d - b.d)
  let cur = 0
  let peak = 0
  for (const e of edges) {
    cur += e.d
    peak = Math.max(peak, cur)
  }
  return peak
}

async function signIn(page) {
  await page.goto(`${CONFIG.app}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', CONFIG.email)
  await page.fill('input[type="password"]', CONFIG.password)
  const answered = page.waitForResponse((r) => r.url().includes('/auth/login/'), { timeout: 60000 })
  await page.click('button[type="submit"]')
  const res = await answered
  if (res.status() !== 200) throw new Error(`La API rechazó el acceso: HTTP ${res.status()}`)
  await page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 60000 })
}

const atLogin = (page) => new URL(page.url()).pathname.includes('/auth/login')

/** A dead tab that never had a refresh rejected was killed by another tab. */
function classify(calls, dead) {
  if (!dead) return 'alive'
  return calls.some((c) => (c.status && c.status !== 200) || c.failed) ? 'collision' : 'cascade'
}

async function screenRun(browser, route) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const seed = await ctx.newPage()
    await signIn(seed)
    await seed.close()

    const page = await ctx.newPage()
    const calls = []
    instrument(page, calls)
    await page.goto(`${CONFIG.app}${route}`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForTimeout(4000)
    const dead = atLogin(page)
    return {
      refreshes: calls.length,
      overlap: peakOverlap(calls),
      rejected: calls.filter((c) => c.status && c.status !== 200).length,
      dead,
      cause: classify(calls, dead),
    }
  } finally {
    await ctx.close()
  }
}

async function twoTabRun(browser, routeA, routeB) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const seed = await ctx.newPage()
    await signIn(seed)
    await seed.close()

    const p1 = await ctx.newPage()
    const p2 = await ctx.newPage()
    const c1 = []
    const c2 = []
    instrument(p1, c1)
    instrument(p2, c2)
    await Promise.all([
      p1.goto(`${CONFIG.app}${routeA}`, { waitUntil: 'load', timeout: 60000 }),
      p2.goto(`${CONFIG.app}${routeB}`, { waitUntil: 'load', timeout: 60000 }),
    ])
    // Wait on both: measuring one while the other is mid-flight reports a
    // tab that had not finished as if it had survived.
    await Promise.all([p1.waitForTimeout(5000), p2.waitForTimeout(5000)])
    const d1 = atLogin(p1)
    const d2 = atLogin(p2)
    return {
      tab1: { refreshes: c1.length, rejected: c1.filter((c) => c.status && c.status !== 200).length, dead: d1, cause: classify(c1, d1) },
      tab2: { refreshes: c2.length, rejected: c2.filter((c) => c.status && c.status !== 200).length, dead: d2, cause: classify(c2, d2) },
      crossOverlap: crossTabOverlap(c1, c2),
      groupedPeak: peakOverlap([...c1, ...c2]),
    }
  } finally {
    await ctx.close()
  }
}

const SCREENS = [
  ['dashboard', '/dashboard'],
  ['projects', '/projects'],
  ['project-detail', `/projects/${CONFIG.project}`],
  ['compare', `/projects/${CONFIG.project}/compare`],
  ['batch', `/projects/${CONFIG.project}/batch`],
]
if (CONFIG.simulation) {
  SCREENS.push(['simulation-detail', `/projects/${CONFIG.project}/simulations/${CONFIG.simulation}`])
}

const browser = await chromium.launch({ channel: CONFIG.channel })
const report = { config: { runs: CONFIG.runs, app: CONFIG.app }, screens: {}, twoTabs: [] }

log(`Diagnóstico de #122 — ${CONFIG.runs} corrida(s) por escenario\n`)

for (const [name, route] of SCREENS) {
  const runs = []
  for (let i = 0; i < CONFIG.runs; i++) runs.push(await screenRun(browser, route))
  const expulsions = runs.filter((r) => r.dead)
  report.screens[name] = {
    runs,
    refreshesMax: Math.max(...runs.map((r) => r.refreshes)),
    overlapMax: Math.max(...runs.map((r) => r.overlap)),
    expulsions: expulsions.length,
    byCollision: expulsions.filter((r) => r.cause === 'collision').length,
    byCascade: expulsions.filter((r) => r.cause === 'cascade').length,
  }
  const s = report.screens[name]
  log(
    `  ${name.padEnd(18)} refrescos≤${s.refreshesMax}  solapamiento≤${s.overlapMax}  ` +
      `expulsiones ${s.expulsions}/${CONFIG.runs}` +
      (s.expulsions ? ` (colisión ${s.byCollision}, cascada ${s.byCascade})` : ''),
  )
}

// Two pairings, because only the second answers the question that decides the
// design. A heavy screen already fails on its own, so pairing it with anything
// proves nothing about tabs. Two screens that never fail alone isolate the
// cross-tab effect: if they start failing together, coordinating between tabs
// is necessary; if they do not, coalescing inside a tab is enough and an
// origin-wide lock would be unjustified complexity.
const PAIRINGS = [
  ['heavy+light', `/projects/${CONFIG.project}`, '/dashboard'],
  ['light+light', '/dashboard', '/projects'],
]

const pairSummaries = []
for (const [label, routeA, routeB] of PAIRINGS) {
  log(`\n  Dos pestanas - ${label}:`)
  const pair = []
  for (let i = 0; i < CONFIG.runs; i++) pair.push(await twoTabRun(browser, routeA, routeB))
  const dead = pair.filter((r) => r.tab1.dead || r.tab2.dead)
  const summary = {
    label,
    runs: CONFIG.runs,
    anyExpulsion: dead.length,
    byCollision: dead.filter((r) => (r.tab1.dead ? r.tab1.cause : r.tab2.cause) === 'collision').length,
    byCascade: dead.filter((r) => (r.tab1.dead ? r.tab1.cause : r.tab2.cause) === 'cascade').length,
    crossOverlapMax: Math.max(...pair.map((r) => r.crossOverlap)),
    deadTabs: dead.map((r) => ({
      tab: r.tab1.dead ? 1 : 2,
      refreshes: r.tab1.dead ? r.tab1.refreshes : r.tab2.refreshes,
      rejected: r.tab1.dead ? r.tab1.rejected : r.tab2.rejected,
    })),
  }
  pairSummaries.push(summary)
  report.twoTabs.push({ summary, runs: pair })
  log(
    `    expulsiones ${summary.anyExpulsion}/${summary.runs}  ` +
      `(colision ${summary.byCollision}, cascada ${summary.byCascade})  ` +
      `solapes CRUZADOS reales: ${summary.crossOverlapMax}`,
  )
}
report.twoTabsSummary = pairSummaries

await browser.close()

const totalExpulsions =
  Object.values(report.screens).reduce((n, s) => n + s.expulsions, 0) +
  pairSummaries.reduce((n, s) => n + s.anyExpulsion, 0)
report.totalExpulsions = totalExpulsions

if (CONFIG.json) console.log(JSON.stringify(report, null, 2))
else log(`\n  TOTAL de expulsiones: ${totalExpulsions}`)

// Non-zero exit when the session died, so this can gate a pipeline instead of
// relying on someone reading console output.
process.exit(totalExpulsions === 0 ? 0 : 1)
