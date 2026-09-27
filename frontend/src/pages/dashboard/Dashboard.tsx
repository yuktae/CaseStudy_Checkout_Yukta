import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { ArrowDownUp, ArrowRight, Check, FileJson, LayoutGrid, List, ListFilter, Search, SearchX, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useWithCode } from '../../components/AccessCode'
import { useJobs } from '../../components/ProcessingDock'
import { Skeleton } from '../../components/ui'
import { api } from '../../lib/api'
import { ACTION_LABEL, monthLabel } from '../../lib/format'
import {
  applyFilters,
  CATEGORIES,
  countFilters,
  EMPTY_FILTERS,
  rememberDashboard,
  SORTS,
  TABS,
  type Filters,
  type SortKey,
  type Tab,
} from '../../lib/filters'
import { CaseCard, CaseTable } from './CaseViews'
import { NewCaseDrawer } from './NewCaseDrawer'

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : [])

export function Dashboard() {
  const qc = useQueryClient()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { withCode, dialog } = useWithCode()
  const { data: cases, isLoading, isError, refetch } = useQuery({
    queryKey: ['cases'],
    queryFn: api.cases,
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === 'processing') ? 1500 : false),
  })
  const { data: jobs = [] } = useJobs()
  const [drawer, setDrawer] = useState<{ open: boolean; files: File[] }>(() => ({ open: params.get('new') === '1', files: [] }))

  // Workspace state lives in the URL so "back" from a case restores it exactly.
  const tab = (params.get('tab') as Tab) || 'all'
  const q = params.get('q') ?? ''
  const sort = (params.get('sort') as SortKey) || 'deadline'
  const view = params.get('view') === 'list' ? 'list' : 'grid'
  const filters: Filters = {
    scheme: list(params.get('scheme')),
    category: list(params.get('category')),
    recommendation: list(params.get('rec')),
    confidence: list(params.get('conf')),
    due: list(params.get('due')),
    flagged: params.get('flagged') === '1',
  }
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    setParams(next, { replace: true })
  }
  const setFilters = (f: Filters) =>
    update({
      scheme: f.scheme.join(',') || null,
      category: f.category.join(',') || null,
      rec: f.recommendation.join(',') || null,
      conf: f.confidence.join(',') || null,
      due: f.due.join(',') || null,
      flagged: f.flagged ? '1' : null,
    })

  useEffect(() => rememberDashboard(location.search), [location.search])

  // Respond-by months present in the queue, as filter options.
  const groups = useMemo(() => {
    const months = [...new Set((cases ?? []).map((c) => c.respond_by?.slice(0, 7)).filter((m): m is string => !!m))].sort()
    return [...FILTER_GROUPS, { key: 'due' as const, label: 'Respond by', options: months.map((m) => ({ value: m, label: monthLabel(m) })) }]
  }, [cases])

  const shown = useMemo(() => applyFilters(cases ?? [], tab, q, filters, sort), [cases, tab, q, params.toString(), sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, (cases ?? []).filter((c) => t.match(c.status)).length])), [cases])

  const retry = (id: string) =>
    withCode(async () => {
      await api.reanalyse(id)
      qc.invalidateQueries({ queryKey: ['jobs'] })
      qc.invalidateQueries({ queryKey: ['cases'] })
    })

  return (
    <div className="pane-scroll h-full overflow-y-auto">
      {dialog}
      <div className="mx-auto max-w-[1400px] px-8 pt-8 pb-24">
        <h1 className="text-[32px] font-semibold tracking-tight">Dashboard</h1>

        <UploadZone onOpen={(files) => setDrawer({ open: true, files })} />

        {/* Workspace */}
        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line">
            <div className="flex items-end gap-8">
              <h2 className="pb-3 text-lg font-semibold">Cases</h2>
              <LayoutGroup>
                <nav className="flex gap-1" aria-label="Status">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => update({ tab: t.key === 'all' ? null : t.key })}
                      className={clsx('relative flex items-center gap-2 px-3 pb-3 text-[13.5px] font-medium transition-colors', tab === t.key ? 'text-text' : 'text-muted hover:text-text-2')}
                    >
                      {t.label}
                      <span className={clsx('rounded-full px-1.5 text-[11px] font-semibold tabular', tab === t.key ? 'bg-ink text-white' : 'bg-line-2 text-text-2')}>{counts[t.key] ?? 0}</span>
                      {tab === t.key && <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue" />}
                    </button>
                  ))}
                </nav>
              </LayoutGroup>
            </div>
            <div className="flex items-center gap-2 pb-2.5">
              <label className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input
                  value={q}
                  onChange={(e) => update({ q: e.target.value || null })}
                  placeholder="Search cases"
                  className="h-9 w-56 rounded-lg border border-line bg-surface pr-3 pl-9 text-[13px] outline-none transition-all focus:w-64 focus:border-blue focus:ring-4 focus:ring-blue/10"
                />
              </label>
              <FilterMenu groups={groups} filters={filters} onChange={setFilters} />
              <SortMenu sort={sort} onChange={(s) => update({ sort: s === 'deadline' ? null : s })} />
              <div className="flex rounded-lg border border-line bg-surface p-0.5">
                {(['grid', 'list'] as const).map((v) => (
                  <button
                    key={v}
                    aria-label={v === 'grid' ? 'Card view' : 'List view'}
                    onClick={() => update({ view: v === 'grid' ? null : v })}
                    className={clsx('relative flex size-8 items-center justify-center rounded-md transition-colors', view === v ? 'text-white' : 'text-muted hover:text-text')}
                  >
                    {view === v && <motion.span layoutId="view-toggle" className="absolute inset-0 rounded-md bg-ink" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                    {v === 'grid' ? <LayoutGrid className="relative size-4" /> : <List className="relative size-4" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ActiveChips groups={groups} filters={filters} onChange={setFilters} />

          <div className="mt-5">
            {isLoading ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-[228px] rounded-[var(--radius-card)]" />
                ))}
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-bad/30 bg-surface/60 px-6 py-16 text-center">
                <p className="text-[15px] font-semibold">Cases could not be loaded</p>
                <button onClick={() => refetch()} className="mt-4 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white hover:bg-ink-2">
                  Try again
                </button>
              </div>
            ) : shown.length === 0 ? (
              <EmptyState
                filtered={!!q || countFilters(filters) > 0 || tab !== 'all'}
                onClear={() => setParams(new URLSearchParams(view === 'list' ? { view: 'list' } : {}), { replace: true })}
                onNew={() => setDrawer({ open: true, files: [] })}
              />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  {view === 'grid' ? (
                    <motion.div layout className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
                      <AnimatePresence initial={false}>
                        {shown.map((c, i) => (
                          <CaseCard key={c.case_id} c={c} index={i} job={jobs.find((j) => j.case_id === c.case_id && j.status === 'running')} onRetry={retry} />
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  ) : (
                    <CaseTable cases={shown} jobs={jobs} onRetry={retry} />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </section>
      </div>

      <NewCaseDrawer open={drawer.open} initialFiles={drawer.files} onClose={() => {
        setDrawer({ open: false, files: [] })
        if (params.get('new')) update({ new: null })
      }} />
    </div>
  )
}

// ------------------------------------------------------------- upload zone

function UploadZone({ onOpen }: { onOpen: (files: File[]) => void }) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const jsonInput = useRef<HTMLInputElement>(null)

  return (
    <motion.div
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current += 1
        setOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current -= 1
        if (depth.current <= 0) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        onOpen(Array.from(e.dataTransfer.files))
      }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen([])}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen([])}
      animate={{ scale: over ? 1.01 : 1 }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={clsx(
        'group relative mt-6 cursor-pointer overflow-hidden rounded-[20px] bg-gradient-to-br from-blue via-[#2257e0] to-[#1a3aa8] px-8 py-7 text-white outline-none',
        'shadow-[0_18px_40px_-20px_rgb(37_99_235/0.9)] transition-shadow duration-300 hover:shadow-[0_26px_50px_-18px_rgb(37_99_235/1)]',
        'focus-visible:ring-4 focus-visible:ring-blue/30',
        over && 'ring-4 ring-blue/30',
      )}
    >
      {/* Soft decorative rings, and a light wash that fades in on hover */}
      <span className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full border-[36px] border-white/[0.06] transition-transform duration-500 group-hover:scale-110" />
      <span className="pointer-events-none absolute -right-40 -bottom-32 size-80 rounded-full border-[28px] border-white/[0.05] transition-transform duration-500 group-hover:scale-105" />
      <span className={clsx('pointer-events-none absolute inset-0 bg-white/[0.07] opacity-0 transition-opacity duration-300 group-hover:opacity-100', over && 'opacity-100')} />

      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <motion.span
            animate={{ y: over ? -4 : 0 }}
            className="flex size-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm transition-all duration-300 group-hover:bg-white/25 group-hover:ring-white/40"
          >
            <Upload className="size-6 transition-transform duration-300 group-hover:-translate-y-0.5" />
          </motion.span>
          <span className="text-xl font-semibold tracking-tight">{over ? 'Drop to start a new case' : 'New case'}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation()
              jsonInput.current?.click()
            }}
            className="flex h-10 items-center gap-2 rounded-lg px-4 text-[13.5px] font-medium text-white/90 ring-1 ring-white/25 transition-colors hover:bg-white/15"
          >
            <FileJson className="size-4" /> Import JSON
          </button>
          <span className="flex size-10 items-center justify-center rounded-full bg-white text-blue shadow-sm transition-transform duration-300 group-hover:translate-x-1">
            <ArrowRight className="size-5" />
          </span>
        </div>
      </div>
      <input
        ref={jsonInput}
        type="file"
        hidden
        accept=".json,application/json"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          if (e.target.files?.length) onOpen(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
    </motion.div>
  )
}

// ----------------------------------------------------------- filter menus

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return { open, setOpen, ref }
}

type FilterGroup = { key: keyof Omit<Filters, 'flagged'>; label: string; options: { value: string; label: string }[] }

const FILTER_GROUPS: FilterGroup[] = [
  { key: 'scheme', label: 'Scheme', options: [{ value: 'visa', label: 'Visa' }, { value: 'mastercard', label: 'Mastercard' }] },
  { key: 'category', label: 'Category', options: CATEGORIES.map((c) => ({ value: c, label: c })) },
  {
    key: 'recommendation',
    label: 'Recommendation',
    options: [
      ...(['represent', 'request_more_evidence', 'accept_liability'] as const).map((a) => ({ value: a, label: ACTION_LABEL[a] })),
      { value: 'needs_judgement', label: 'Needs judgement' },
    ],
  },
  { key: 'confidence', label: 'Confidence', options: ['High', 'Medium', 'Low'].map((c) => ({ value: c, label: c })) },
]

function FilterMenu({ groups, filters, onChange }: { groups: FilterGroup[]; filters: Filters; onChange: (f: Filters) => void }) {
  const { open, setOpen, ref } = usePopover()
  const n = countFilters(filters)
  const toggle = (key: keyof Omit<Filters, 'flagged'>, value: string) => {
    const cur = filters[key]
    onChange({ ...filters, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] })
  }
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx('flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors', n ? 'border-blue bg-blue-soft text-blue' : 'border-line bg-surface text-text-2 hover:text-text')}
      >
        <ListFilter className="size-4" /> Filter
        {n > 0 && <span className="rounded-full bg-blue px-1.5 text-[11px] font-semibold text-white">{n}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 z-30 mt-2 w-[360px] origin-top-right rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-pop)]"
          >
            {groups.map((g) => (
              <div key={g.key} className="mb-4 last:mb-0">
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.options.map((o) => {
                    const on = filters[g.key].includes(o.value)
                    return (
                      <button
                        key={o.value}
                        onClick={() => toggle(g.key, o.value)}
                        className={clsx('flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors', on ? 'border-ink bg-ink text-white' : 'border-line text-text-2 hover:border-[#cfd6e4]')}
                      >
                        {on && <Check className="size-3" strokeWidth={3} />}
                        {o.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <label className="mt-2 flex cursor-pointer items-center justify-between border-t border-line-2 pt-3 text-[13px] text-text-2">
              Only cases with flags
              <input type="checkbox" checked={filters.flagged} onChange={(e) => onChange({ ...filters, flagged: e.target.checked })} className="size-4 accent-[#2563eb]" />
            </label>
            {n > 0 && (
              <button onClick={() => onChange(EMPTY_FILTERS)} className="mt-3 text-[12.5px] font-medium text-blue hover:underline">
                Clear all filters
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SortMenu({ sort, onChange }: { sort: SortKey; onChange: (s: SortKey) => void }) {
  const { open, setOpen, ref } = usePopover()
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-text-2 hover:text-text">
        <ArrowDownUp className="size-4" />
        {SORTS.find((s) => s.key === sort)?.label}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 z-30 mt-2 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)]"
          >
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => {
                  onChange(s.key)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-line-2"
              >
                {s.label}
                {s.key === sort && <Check className="size-4 text-blue" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ActiveChips({ groups, filters, onChange }: { groups: FilterGroup[]; filters: Filters; onChange: (f: Filters) => void }) {
  const chips = groups.flatMap((g) =>
    filters[g.key].map((v) => ({ key: g.key, value: v, label: g.options.find((o) => o.value === v)?.label ?? v })),
  )
  if (!chips.length && !filters.flagged) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <AnimatePresence initial={false}>
        {chips.map((c) => (
          <motion.button
            key={`${c.key}-${c.value}`}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={() => onChange({ ...filters, [c.key]: filters[c.key].filter((v) => v !== c.value) })}
            className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[12.5px] font-medium text-white hover:bg-ink-2"
          >
            {c.label} <X className="size-3" />
          </motion.button>
        ))}
        {filters.flagged && (
          <motion.button key="flagged" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => onChange({ ...filters, flagged: false })}
            className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[12.5px] font-medium text-white">
            With flags <X className="size-3" />
          </motion.button>
        )}
      </AnimatePresence>
      <button onClick={() => onChange(EMPTY_FILTERS)} className="text-[12.5px] font-medium text-muted hover:text-text">
        Clear all
      </button>
    </div>
  )
}

function EmptyState({ filtered, onClear, onNew }: { filtered: boolean; onClear: () => void; onNew: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-[#cfd6e4] bg-surface/60 px-6 py-16 text-center">
      <SearchX className="size-8 text-muted" />
      <p className="mt-3 text-[15px] font-semibold">{filtered ? 'No cases match' : 'No cases yet'}</p>
      <button onClick={filtered ? onClear : onNew} className="mt-4 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white hover:bg-ink-2">
        {filtered ? 'Clear filters' : 'Create a case'}
      </button>
    </motion.div>
  )
}
