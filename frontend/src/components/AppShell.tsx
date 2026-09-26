import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Cpu } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../lib/api'
import { ProcessingDock } from './ProcessingDock'

export function Logo({ light }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <img src="/logo.svg" alt="" className="size-8" />
      <span className={clsx('text-[17px] font-semibold tracking-tight', light ? 'text-white' : 'text-text')}>Exhibit</span>
    </span>
  )
}

export function AppShell() {
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity })
  return (
    <div className="flex h-full flex-col">
      <header className="z-30 flex h-16 shrink-0 items-center justify-between bg-ink px-6">
        <div className="flex items-center gap-10">
          <NavLink to="/" aria-label="Exhibit home">
            <Logo light />
          </NavLink>
          <nav className="flex items-center gap-1 rounded-full bg-white/[0.06] p-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                clsx(
                  'rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-white text-ink' : 'text-white/70 hover:text-white',
                )
              }
            >
              Dashboard
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {meta && (
            <span className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70">
              <Cpu className="size-3.5" />
              {meta.model}
              <span className={clsx('size-1.5 rounded-full', meta.has_api_key ? 'bg-[#4ade80]' : 'bg-white/30')} />
            </span>
          )}
          <span className="flex size-8 items-center justify-center rounded-full bg-blue text-xs font-semibold text-white">AN</span>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
      <ProcessingDock />
    </div>
  )
}
