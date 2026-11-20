# Release #357 blockers

Issue/PR scope: correction gate for PR #357 before `develop` is merged into `main`.
Integrated branch: `fix/357-release-blockers-v2` from immutable release head `33e8bbb`.
Final correction branch: `fix/357-release-final-blockers` from corrected release head `d54dd2e`.

## Specs

1. **S1** — «ok, mergea y prepara el deploy a main».
2. **S2** — «Corroborá causalidad/severidad y mantené cualquier corrección dentro del contrato ya aprobado.»
3. **S3** — «Pasame los 4 findings normalizados, pruebas RED/GREEN, commits/PR y re-judgment antes de mergear #357.»
4. **S4** — «Si alguno exige decisión de producto o cambia contrato, frená y avisame.»
5. **S5** — «Adelante con el worktree aislado y la rama `fix/357-release-blockers`; no toques root ni los ODD untracked.»
6. **S6** — «Elevá también el MEDIUM de `FractalAnalysisTab.tsx:353`: es incumplimiento directo de #351 S3 (la columna del camino windowed debe distinguir la ventana aplicada de ese mismo camino, no mostrar la legacy junto al Df windowed). Corregilo a la fuente windowed canónica y añadí test público RED/GREEN que pruebe requested vs applied distintos. Sigue dentro del contrato aprobado; quedan 5 correcciones release-scoped.»
7. **S7** — «Protegé también el presupuesto de revisión: el/los PR de corrección a `develop` deben quedar ≤400 líneas cambiadas cada uno; si las 5 correcciones no caben honestamente con tests, encadenalas por áreas (engine/backend/frontend) sin comprimir pruebas. Después actualizá #357 al nuevo head y repetí CI + Judgment Day de release.»
8. **S8** — «Si el worker cierra parcial tras engine, no sigas secuencial: lanzá backend (findings 3–4) y frontend (finding 5) en paralelo con Allowed edit surfaces disjuntas/worktrees aislados, porque son unidades independientes y ya pagamos demasiado tiempo. Integrá solo después de RED/GREEN de cada una.»
9. **S9** — «No más agentes/reintentos. Cuando backend cierre, materializá los tres parciales y terminá inline en sus worktrees: engine actualizá los 6 call sites y llevá los 2 RED a GREEN; frontend usá un symlink temporal al `frontend/node_modules` del root para ejecutar el test, luego retiralo; backend completá según su resultado. Commit por área solo con GREEN enfocado y diff-check. Si algún área no cierra así, paramos con Needs decision.»

## Tasks

- **T1** — S2-S6 — **done** — Corroborated and froze five release findings against `33e8bbb`; route: parent read-only verification; commit: n/a.
- **T2** — S2-S4, S6, S8-S9 — **done** — Completed and independently verified the three isolated corrections; route: parent inline implementation plus fresh verifier; commits: engine `4377db1`, backend `f6ae437`, frontend `c12d569`.
- **T3** — S1-S3, S7 — **done** — Integrated the verified work as `d979467`, `31c26c8`, and `eb6f500`; stabilized CI in `4509ffa`; PR #364 stayed at 357/400 and exact-head CI `44698385059` passed Rust, Backend, and Frontend; route: parent delivery; commits: `d979467`, `31c26c8`, `eb6f500`, `4509ffa`.
- **T4** — S2-S4 — **done** — Integrated verifier `mwooq3w4-i-8nj1` passed T3/S2-S7; scoped re-judges `mwoovr2k-j-cacy` and `mwoovr3z-k-tx2i` independently resolved all six frozen rows as `verified`; route: fresh Judgment Day judges + verifier; commit: n/a.
- **T5** — S1-S3 — **in progress** — Merge PR #364 to `develop`, revalidate and merge PR #357 to `main`, then prepare the Easypanel deployment and smoke plan; route: parent delivery; commit: pending.
- **T6** — S2-S4, S7, S9 — **done** — Froze final release ledger `fb54d915f5c0c71c185693e9b6474ac029dd0ae26903bb7365b078b82f8a36c1` (7 raw rows / 5 logical claims) and corroborated three required corrections: #351 canonical contract sync, fallback budget metering, and manual-window attribution; `JD-B-003` is contract-intended; route: fresh blind judges + parent/explorer corroboration; commit: n/a.
- **T7** — S2-S4, S7, S9 — **in progress** — Implement the three final corrections with RED/GREEN evidence in one ≤400-line PR to `develop`; route: parent inline per S9; commit: pending.
- **T8** — S1-S3, S7 — **pending** — Run focused/full checks, scoped re-judgment of all seven frozen rows, merge correction PR, rebind #357, and close release/main/deploy preparation; route: parent delivery; commit: pending.

## Log

- **L1** — «Prepárame un merge de develop en main para despelgar nuevas funcionalidades».
- **L2** — «ok, mergea y prepara el deploy a main».
- **L3** — «Adelante con el worktree aislado y la rama `fix/357-release-blockers`; no toques root ni los ODD untracked. Corroborá causalidad/severidad y mantené cualquier corrección dentro del contrato ya aprobado. Pasame los 4 findings normalizados, pruebas RED/GREEN, commits/PR y re-judgment antes de mergear #357. Si alguno exige decisión de producto o cambia contrato, frená y avisame.»
- **L4** — «Elevá también el MEDIUM de `FractalAnalysisTab.tsx:353`: es incumplimiento directo de #351 S3 (la columna del camino windowed debe distinguir la ventana aplicada de ese mismo camino, no mostrar la legacy junto al Df windowed). Corregilo a la fuente windowed canónica y añadí test público RED/GREEN que pruebe requested vs applied distintos. Sigue dentro del contrato aprobado; quedan 5 correcciones release-scoped.»
- **L5** — «Protegé también el presupuesto de revisión: el/los PR de corrección a `develop` deben quedar ≤400 líneas cambiadas cada uno; si las 5 correcciones no caben honestamente con tests, encadenalas por áreas (engine/backend/frontend) sin comprimir pruebas. Después actualizá #357 al nuevo head y repetí CI + Judgment Day de release.»
- **L6** — Frozen Judgment Day ledger: 5 logical BLOCKER corrections, bound to release head `33e8bbb372cb7c1b792dd151cf10eecdd249714c`; judge rows `JD-A-003` and `JD-B-001` corroborate the same backend correction.
- **L7** — Provider defect: `jd-fix-agent` rejected three canonical bounded dispatches before queueing and made zero changes. Per orchestrator fallback policy, task `mwnov1rc-4-1s0q` runs in `gentle-ai-worker` with the same ledger, exact Allowed edit surfaces, RED/GREEN requirement, and ≤400-line budget.
- **L8** — «Si el worker cierra parcial tras engine, no sigas secuencial: lanzá backend (findings 3–4) y frontend (finding 5) en paralelo con Allowed edit surfaces disjuntas/worktrees aislados, porque son unidades independientes y ya pagamos demasiado tiempo. Integrá solo después de RED/GREEN de cada una.»
- **L9** — Exhausted worker `mwnov1rc-4-1s0q` canceled after preserving RED-only diffs. Parallel replacements: engine `mwnp5akl-5-w8ej` in `fix/357-engine-budget`, backend `mwnp5al5-6-32p2` in `fix/357-backend-markers`, frontend `mwnp5al7-7-4xh5` in `fix/357-frontend-window`.
- **L10** — «No más agentes/reintentos. Cuando backend cierre, materializá los tres parciales y terminá inline en sus worktrees: engine actualizá los 6 call sites y llevá los 2 RED a GREEN; frontend usá un symlink temporal al `frontend/node_modules` del root para ejecutar el test, luego retiralo; backend completá según su resultado. Commit por área solo con GREEN enfocado y diff-check. Si algún área no cierra así, paramos con Needs decision.»
- **L11** — «Continuar con una verificación nueva»; bounded verification then passed engine `4377db1`, backend `f6ae437`, and frontend `c12d569` without installs.
- **L12** — Fresh integration branch `fix/357-release-blockers-v2` cherry-picked the three verified commits; PR #364 targets `develop` with the sole label `type:bug`.
- **L13** — PR #364 Frontend CI reproduced locally at 1/70 failed because a fixed `2026-10-20` fixture crossed the UI relative-date threshold; the witness now derives a timestamp one hour before test execution without changing production behavior.
- **L14** — PR #364 Backend CI passed 2090 tests but measured mypy 1658 against 1657 and ruff 279 against 286. The new marker witness's three annotations remove its own mypy findings, yielding the CI-derived target 1655; ratchets were lowered to mypy 1655 and ruff 279, never raised.
- **L15** — Exact-head CI run `44698385059` passed Rust engine, Backend, and Frontend at `4509ffa85c6363be95a88f7ab74cf20a04e5f830`; integrated verifier `mwooq3w4-i-8nj1` passed all five logical corrections, focused engine 6/6, backend 5/5, CRLF-aware diff-check, and the 357-line review budget.
- **L16** — Scoped re-judgment used frozen ledger `b98a190158f0cf0441d423d11077cc0db70e047d2740a701aa05f4c0169b7406`; both fresh judges independently resolved `JD-A-001`, `JD-A-002`, `JD-A-003`, `JD-A-004`, `JD-B-001`, and `JD-B-002` as `verified`. `JUDGMENT: APPROVED`.
- **L17** — Fresh full release Judgment Day at corrected head `d54dd2ea9db44ded84b3b3c02ef0f0d92ca86068` froze ledger `fb54d915f5c0c71c185693e9b6474ac029dd0ae26903bb7365b078b82f8a36c1` from judges `mwoqivto-l-1wqp` and `mwoqivv2-m-az1c`. Corroboration found: (1) canonical R2/R8 still describe pre-#351 shapes and must be synchronized to approved #351 S1-S3 without reverting additive audit fields; (2) adaptive/ballistic fallback particle-pair work remains outside the #310 deterministic operation budget; (3) manual slider regression displays the immutable engine window instead of its actual selected range. `JD-B-003` is the explicitly approved partial-completion contract (status COMPLETED + persisted/exposed metadata + INFO notification) and requires no behavior change.
