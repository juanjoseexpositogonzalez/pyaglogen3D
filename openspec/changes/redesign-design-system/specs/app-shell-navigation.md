# app-shell-navigation Specification

## ADDED Requirements

### Requirement: The shell is mounted once in the root layout

The application chrome — sidebar, top bar and page frame — MUST be mounted a single time in
`frontend/src/app/layout.tsx` and MUST NOT be imported by individual pages.

#### Scenario: Shell wraps every authenticated route

- GIVEN any authenticated route
- WHEN it renders
- THEN the sidebar and top bar are present exactly once in the document

#### Scenario: Pages do not import the shell

- GIVEN the files under `frontend/src/app/**/page.tsx`
- WHEN they are searched for an import of `components/shell/AppShell`
- THEN no match is found

---

### Requirement: The legacy header is superseded without double navigation

`components/layout/Header.tsx` remains importable while pages are migrated, but MUST render
nothing when the shell is already mounted, so that no route shows two navigations at once.

#### Scenario: Legacy header yields to the shell

- GIVEN a page that still imports `Header`
- WHEN it renders inside the shell
- THEN `Header` renders no navigation
- AND exactly one navigation is present in the document

---

### Requirement: Grouped, context-aware navigation

The sidebar MUST group destinations under labelled sections: a workspace section always
present, a project section present only while a project is in scope, a tools section whose AI
entry appears only for users with AI access, and an admin section visible only to
administrators.

#### Scenario: Project section appears in project scope

- GIVEN the user is on a route scoped to a project
- WHEN the sidebar renders
- THEN a section labelled with that project's name is present
- AND it lists Overview, Simulations, Batch studies, Compare, FRAKTAL analyses and FRAKTAL
  batches

#### Scenario: Project section is absent outside project scope

- GIVEN the user is on the dashboard
- WHEN the sidebar renders
- THEN no project section is present

#### Scenario: AI entry follows access

- GIVEN a user without AI access
- WHEN the sidebar renders
- THEN no AI assistant entry is present

#### Scenario: Admin section follows role

- GIVEN a user who is not an administrator
- WHEN the sidebar renders
- THEN no admin section is present

#### Scenario: Active destination is marked without relying on colour

- GIVEN the current route matches a navigation entry
- WHEN the sidebar renders
- THEN that entry carries `aria-current="page"`

---

### Requirement: Top bar carries context, theme and identity

The top bar MUST show the current breadcrumb context, a theme control with System, Light and
Dark, a notifications affordance, and the signed-in user with access to Settings, AI settings
and sign out.

#### Scenario: Breadcrumb names the current entity

- GIVEN the user is viewing a simulation inside a project
- WHEN the top bar renders
- THEN it shows the project and the simulation, with the simulation emphasised

#### Scenario: Theme control offers three states

- GIVEN the top bar is rendered
- WHEN the theme control is opened
- THEN System, Light and Dark are offered
- AND the active one is indicated without relying on colour alone

---

### Requirement: Responsive shell

The shell MUST remain usable from 1440px down to 360px, collapsing progressively rather than
truncating.

#### Scenario: Sidebar collapses to icons

- GIVEN a viewport width between 1280px and 1439px
- WHEN the shell renders
- THEN the sidebar shows icons without labels
- AND each entry exposes its label as an accessible name

#### Scenario: Sidebar becomes a drawer

- GIVEN a viewport narrower than 900px
- WHEN the shell renders
- THEN the sidebar is off-canvas
- AND a control in the top bar opens it
- AND opening it traps focus until dismissed

#### Scenario: Page frame bounds the content

- GIVEN any viewport wider than 1440px
- WHEN a page renders
- THEN its content is centred within a frame no wider than 1440px

---

### Requirement: Unit convention notice

Any page presenting physical quantities MUST show a dismissible notice stating the length unit
and the schema version in force. Dismissal MUST persist.

#### Scenario: Notice states unit and schema

- GIVEN a simulation detail page
- WHEN it renders for a user who has not dismissed the notice
- THEN a notice states the length unit and the schema version

#### Scenario: Dismissal persists

- GIVEN the user dismisses the notice
- WHEN they open another page presenting physical quantities
- THEN the notice is not shown
