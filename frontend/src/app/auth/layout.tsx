/**
 * The frame shared by the authentication routes.
 *
 * This is the whole reason these routes must not carry a frame of their own:
 * `isChromeless` in `AppShell` returns true for `/auth/*`, so the shell's
 * `<main>` is `display: contents` and provides no gutter, no rail and no top
 * bar. What a reader gets here — full viewport height, a centred column capped
 * at 448px, and the product name above the card — is supplied by this file and
 * by nothing else.
 *
 * The token pass is the only change from what this file was: `text-foreground`
 * and `text-muted-foreground` are the shadcn bridge, not the kit, and both
 * resolved through the old HSL channel variables. `text-ink` and
 * `text-ink-muted` are the design system's own pair.
 *
 * No `PageHeader` here either, on purpose: it renders a level-one heading, and
 * the `<h1>` below is already that level on every one of these routes. A second
 * one would put two page titles on a centred card.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-ink">PyAglogen3D</h1>
          <p className="text-ink-muted mt-2">3D Agglomerate Simulation Platform</p>
        </div>
        {children}
      </div>
    </div>
  )
}
