# app-shell-navigation Specification

> Each scenario is tagged with its verification mechanism: `[test]` is automatable with the
> repository's vitest + jsdom runner; `[manual]` is verified by hand with evidence recorded in
> the change Log. jsdom evaluates no media query and performs no layout.

## ADDED Requirements

### Requirement: R1. The shell is mounted once in the root layout

The application chrome (sidebar, top bar and page frame) MUST be mounted a single time in
`frontend/src/app/layout.tsx` and MUST NOT be imported by individual pages.

#### Scenario: Shell wraps every application route `[test]`

- GIVEN any route under `/dashboard` or `/projects`
- WHEN it renders
- THEN the sidebar and top bar are present exactly once in the document

#### Scenario: Pages do not import the shell `[test]`

- GIVEN the files under `frontend/src/app/**/page.tsx`
- WHEN they are searched for an import of `components/shell/AppShell`
- THEN no match is found

---

### Requirement: R2. The shell does not render on public routes

The shell MUST NOT render on the public landing route `/` nor on any route under `/auth/`.
Those routes carry their own layout and, per `middleware.ts`, redirect an authenticated user
away; showing a sidebar, a breadcrumb and a user menu over a sign-in form would be incoherent.

`frontend/src/app/auth/layout.tsx` currently hard-codes `text-white` and `text-gray-400`,
which assume a dark background. It MUST be re-expressed in tokens so it stays legible once the
light theme is the default.

#### Scenario: No shell on the sign-in route `[test]`

- GIVEN the route `/auth/login`
- WHEN it renders
- THEN no sidebar and no top bar are present

#### Scenario: No shell on the public landing route `[test]`

- GIVEN the route `/`
- WHEN it renders
- THEN no sidebar and no top bar are present

#### Scenario: The auth layout is legible in both themes `[test]`

- GIVEN `frontend/src/app/auth/layout.tsx`
- WHEN its classes are inspected
- THEN no fixed-colour utility such as `text-white` or `text-gray-400` remains
- AND its text resolves through theme tokens

---

### Requirement: R3. The legacy header is superseded without double navigation

`components/layout/Header.tsx` remains importable while pages are migrated, but MUST render
nothing when the shell is already mounted, so that no route shows two navigations at once.

#### Scenario: Legacy header yields to the shell `[test]`

- GIVEN a page that still imports `Header`
- WHEN it renders inside the shell
- THEN `Header` renders no navigation
- AND exactly one navigation is present in the document

---

### Requirement: R4. Grouped, context-aware navigation

The sidebar MUST group destinations under labelled sections: a workspace section always
present, a project section present only while a project is in scope, a tools section whose AI
entry appears only for users with AI access, and an admin section visible only to
administrators.

#### Scenario: Project section appears in project scope `[test]`

- GIVEN the user is on a route scoped to a project
- WHEN the sidebar renders
- THEN a section labelled with that project's name is present
- AND it lists Overview, Simulations, Batch studies, Compare, FRAKTAL analyses and FRAKTAL
  batches

#### Scenario: Project section is absent outside project scope `[test]`

- GIVEN the user is on the dashboard
- WHEN the sidebar renders
- THEN no project section is present

#### Scenario: AI entry follows access `[test]`

- GIVEN a user without AI access
- WHEN the sidebar renders
- THEN no AI assistant entry is present

#### Scenario: Admin section follows role `[test]`

- GIVEN a user who is not an administrator
- WHEN the sidebar renders
- THEN no admin section is present

#### Scenario: Active destination is marked without relying on colour `[test]`

- GIVEN the current route matches a navigation entry
- WHEN the sidebar renders
- THEN that entry carries `aria-current="page"`

---

### Requirement: R5. Top bar carries context, theme and identity

The top bar MUST show the current breadcrumb context, a theme control with System, Light and
Dark, a notifications affordance, and the signed-in user with access to Settings, AI settings
and sign out.

#### Scenario: Breadcrumb names the current entity `[test]`

- GIVEN the user is viewing a simulation inside a project
- WHEN the top bar renders
- THEN it shows the project and the simulation, with the simulation emphasised

#### Scenario: Theme control offers three states `[test]`

- GIVEN the top bar is rendered
- WHEN the theme control is opened
- THEN System, Light and Dark are offered
- AND the active one is indicated without relying on colour alone

---

### Requirement: R6. Responsive shell

The shell MUST remain usable from 1440px down to 360px, collapsing progressively rather than
truncating: icon-only sidebar below 1440px, off-canvas drawer below 900px, content centred in
a frame no wider than 1440px.

#### Scenario: Breakpoint behaviour `[manual]`

- GIVEN viewport widths of 1440, 1280, 900 and 360 px
- WHEN the shell renders in a browser at each width
- THEN the sidebar is full, icon-only, off-canvas and off-canvas respectively
- AND captures at all four widths are recorded in the Log

#### Scenario: Icon-only entries keep an accessible name `[test]`

- GIVEN the sidebar rendered in its collapsed form
- WHEN the accessibility tree is inspected
- THEN every entry exposes its destination as an accessible name

#### Scenario: The drawer traps focus `[test]`

- GIVEN the off-canvas drawer is open
- WHEN the user tabs past its last focusable element
- THEN focus returns into the drawer and does not reach the page behind it
