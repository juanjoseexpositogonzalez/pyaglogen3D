'use client'

import {
  Activity,
  Atom,
  Boxes,
  FolderOpen,
  Image as ImageIcon,
  LayoutDashboard,
  Layers,
  Microscope,
  Shield,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { StatusDot } from '@/components/kit/StatusDot'
import { cn } from '@/lib/utils'

/**
 * The fixed navigation rail.
 *
 * Grouped rather than flat, and the project group only exists while a project
 * is in scope: a researcher working inside one investigation should reach its
 * simulations, batches and analyses without going back out to a list first.
 */
export interface SidebarProject {
  id: string
  name: string
}

export interface SidebarProps {
  pathname: string
  /** Present only while a project is in scope. */
  project?: SidebarProject | null
  hasAiAccess?: boolean
  isAdmin?: boolean
  /** Icons only, for the 1280–1439px band. */
  collapsed?: boolean
  /** Engine state for the footer; omitted when unknown. */
  engine?: { online: boolean; queued: number } | null
  className?: string
}

interface NavItemProps {
  href: string
  icon: LucideIcon
  label: string
  active: boolean
  collapsed: boolean
  nested?: boolean
}

function NavItem({ href, icon: Icon, label, active, collapsed, nested }: NavItemProps) {
  return (
    <Link
      href={href}
      // aria-current is the non-visual half of "active": the highlight alone
      // would leave a screen-reader user without the information.
      aria-current={active ? 'page' : undefined}
      // When collapsed the label is gone from view but must remain the
      // accessible name.
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-[11px] rounded-[9px] px-[13px] py-2.5 transition-colors',
        nested ? 'py-[7px] text-[11px]' : 'text-[13px]',
        active
          ? 'bg-rail-active text-white shadow-[inset_3px_0_0_var(--rail-accent)]'
          : 'text-rail-ink-muted hover:bg-white/[.08] hover:text-white',
        collapsed && 'justify-center px-2',
      )}
    >
      <Icon className={cn('shrink-0', nested ? 'h-3.5 w-3.5' : 'h-[17px] w-[17px]')} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )
}

function Group({
  label,
  collapsed,
  children,
}: {
  label: string
  collapsed: boolean
  children: ReactNode
}) {
  return (
    <div className="mt-[19px] first:mt-0">
      {!collapsed && (
        <div className="px-[13px] pb-[9px] text-[10px] font-bold uppercase tracking-[0.12em] text-rail-ink-faint">
          {label}
        </div>
      )}
      <div className="grid gap-[3px]">{children}</div>
    </div>
  )
}

export function Sidebar({
  pathname,
  project,
  hasAiAccess = false,
  isAdmin = false,
  collapsed = false,
  engine,
  className,
}: SidebarProps) {
  const at = (href: string) => pathname === href

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex h-full flex-col overflow-hidden bg-rail px-3.5 pb-[18px] pt-6 text-rail-ink',
        className,
      )}
    >
      <Link href="/dashboard" className="flex items-center gap-[11px] px-3 pb-[31px]">
        <Atom className="h-[34px] w-[34px] shrink-0 text-rail-accent" />
        {!collapsed && (
          <span className="min-w-0">
            <strong className="block text-[15px] tracking-[0.01em] text-white">pyAgloGen3D</strong>
            <span className="mt-0.5 block text-[10px] uppercase tracking-[0.05em] text-rail-ink-faint">
              Fractal agglomerate lab
            </span>
          </span>
        )}
      </Link>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Group label="Workspace" collapsed={collapsed}>
          <NavItem
            href="/dashboard"
            icon={LayoutDashboard}
            label="Dashboard"
            active={at('/dashboard')}
            collapsed={collapsed}
          />
          <NavItem
            href="/projects"
            icon={FolderOpen}
            label="Projects"
            active={at('/projects')}
            collapsed={collapsed}
          />
        </Group>

        {project && (
          <Group label={project.name} collapsed={collapsed}>
            {/*
              Only real routes live here. An earlier version offered
              "Simulations" and "FRAKTAL analyses" as `?section=` links and
              "Compare" as a bare `/compare`, all three taken from the Base44
              prototype: the product's project page never reads `section`, and
              the compare page requires `?sims=<csv>` and shows an empty state
              without it. Those are sections of the overview and a flow that
              starts from selecting simulations, not destinations.
            */}
            <NavItem
              href={`/projects/${project.id}`}
              icon={Boxes}
              label="Overview"
              active={pathname === `/projects/${project.id}`}
              collapsed={collapsed}
              nested
            />
            <NavItem
              href={`/projects/${project.id}/simulations/new`}
              icon={Layers}
              label="New simulation"
              active={pathname.startsWith(`/projects/${project.id}/simulations/new`)}
              collapsed={collapsed}
              nested
            />
            <NavItem
              href={`/projects/${project.id}/batch`}
              icon={Activity}
              label="Batch studies"
              active={pathname.startsWith(`/projects/${project.id}/batch`)}
              collapsed={collapsed}
              nested
            />
            <NavItem
              href={`/projects/${project.id}/fraktal/new`}
              icon={Microscope}
              label="New FRAKTAL analysis"
              active={pathname.startsWith(`/projects/${project.id}/fraktal/new`)}
              collapsed={collapsed}
              nested
            />
            <NavItem
              href={`/projects/${project.id}/fraktal/batch`}
              icon={ImageIcon}
              label="FRAKTAL batches"
              active={pathname.startsWith(`/projects/${project.id}/fraktal/batch`)}
              collapsed={collapsed}
              nested
            />
          </Group>
        )}

        {hasAiAccess && (
          <Group label="Tools" collapsed={collapsed}>
            <NavItem
              href="/ai"
              icon={Sparkles}
              label="AI Assistant"
              active={pathname.startsWith('/ai')}
              collapsed={collapsed}
            />
          </Group>
        )}

        {isAdmin && (
          <Group label="Admin" collapsed={collapsed}>
            <NavItem
              href="/admin"
              icon={Shield}
              label="Users"
              active={pathname.startsWith('/admin')}
              collapsed={collapsed}
            />
          </Group>
        )}
      </div>

      {engine && !collapsed && (
        <div className="mt-auto flex items-center gap-2 px-3 pt-3.5 text-[11px] text-rail-ink-faint">
          <StatusDot
            tone={engine.online ? 'positive' : 'negative'}
            label={engine.online ? 'Engine online' : 'Engine unreachable'}
          />
          <span>{engine.online ? 'Engine online' : 'Engine unreachable'}</span>
          {engine.online && <span className="num ml-auto">{engine.queued} queued</span>}
        </div>
      )}
    </nav>
  )
}

export default Sidebar
