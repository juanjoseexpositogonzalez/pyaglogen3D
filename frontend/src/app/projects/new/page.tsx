'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useCreateProject } from '@/hooks/useProjects'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Where a project starts: a name, an optional description, and nothing else.
 *
 * The shell draws the navigation, so this file does not. What that costs is
 * worth stating plainly, and it is more than a tidy-up: `Header` was mounted
 * here to cover the sessions the shell leaves chromeless. `showChrome` is
 * `!chromeless && isAuthenticated && !isLoading`, while the middleware only
 * checks that a session cookie exists — so a stale cookie with a rejected
 * token painted this route with no rail, no top bar and no account link, and
 * `Header` was the only sign-in affordance on the screen. What this page gives
 * up is that fallback chrome, and with it the way back in. It is not a claim
 * that the two components are equivalent, and the navigation is not unchanged.
 *
 * Below the frame nothing moves: the fields, their defaults, the guard on a
 * blank name, the payload and the landing page after a successful create stay
 * exactly as they were.
 *
 * The column is capped at 672px, the measure the migrated FRAKTAL creation
 * screens use. Left to itself the form stretches to the shell's full 1440px
 * and each field grows to a ~650px reading line. The cap is `mx-auto w-full`,
 * not the legacy `container px-4 py-8`: the shell already owns the page
 * gutter, and both together pad the screen twice.
 *
 * The form sits in a titled panel so that a reader moving by headings meets an
 * `h2` between the page title and the fields. `Panel` renders a plain
 * `<section>`, which takes no accessible name from a child heading, so an
 * untitled one is neither a landmark nor a step in the outline: the `h1` would
 * stand alone and the fields would hang off nothing.
 *
 * The payload keeps its shape: the name is trimmed, and a description that is
 * only whitespace travels as `undefined` rather than as an empty string — the
 * API reads a missing key as "no description", not as one that is empty.
 */
export default function NewProjectPage() {
  const router = useRouter()
  const createProject = useCreateProject()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    try {
      const project = await createProject.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      router.push(`/projects/${project.id}`)
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Breadcrumb */}
      <Link
        href="/projects"
        className="mb-5 inline-flex items-center gap-2 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Projects
      </Link>

      <PageHeader
        eyebrow="PROJECTS"
        title="Create New Project"
        description="Projects help you organize simulations and analyses for a specific research goal."
      />

      <Panel title="Project details">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Project Name *</Label>
            <Input
              id="name"
              placeholder="e.g., DLA Sticking Probability Study"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Describe the purpose of this project..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex gap-4">
            <Button
              type="submit"
              disabled={!name.trim() || createProject.isPending}
            >
              {createProject.isPending ? 'Creating...' : 'Create Project'}
            </Button>
            {/*
              The look comes from the variant's classes, not from wrapping a
              `Button` in the link. `Button` declares `asChild` in
              `ButtonProps` but never destructures it, so it does not merge the
              two elements: it reaches the DOM `<button>` as an unknown
              `aschild` attribute, leaving `<a><button></a>` — invalid HTML,
              two tab stops for one destination, and an inner button that
              fires nothing.
            */}
            <Link href="/projects" className={buttonVariants({ variant: 'outline' })}>
              Cancel
            </Link>
          </div>
        </form>
      </Panel>
    </div>
  )
}
