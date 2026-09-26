import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, Check, ChevronDown, CircleAlert, CircleCheck, Loader2, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { Job } from '../lib/types'
import { useWithCode } from './AccessCode'
import { useToast } from './toast'

export const STAGES: { key: string; label: string; progress: number }[] = [
  { key: 'queued', label: 'Uploading files', progress: 0.06 },
  { key: 'extracting', label: 'Extracting text', progress: 0.2 },
  { key: 'reading_images', label: 'Reading images', progress: 0.34 },
  { key: 'checking_rules', label: 'Checking rules', progress: 0.44 },
  { key: 'assessing', label: 'Assessing evidence', progress: 0.72 },
  { key: 'locating', label: 'Locating highlights', progress: 0.94 },
]

export function stageInfo(stage: string) {
  const i = STAGES.findIndex((s) => s.key === stage)
  return { index: i, label: STAGES[i]?.label ?? 'Processing', progress: STAGES[i]?.progress ?? 0.1 }
}

export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.jobs(),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'running') ? 1200 : 10000),
  })
}

export function ProcessingDock() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const { withCode, dialog } = useWithCode()
  const { data: jobs = [] } = useJobs()
  const [sessionStart] = useState(() => Date.now() - 5000)
  const previous = useRef<Record<number, string>>({})
  const [open, setOpen] = useState(true)
  const [dismissed, setDismissed] = useState<number[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)

  // React to jobs finishing: refresh the data they changed and tell the analyst.
  useEffect(() => {
    for (const j of jobs) {
      const before = previous.current[j.id]
      if (before === 'running' && j.status !== 'running') {
        qc.invalidateQueries({ queryKey: ['cases'] })
        qc.invalidateQueries({ queryKey: ['case', j.case_id] })
        if (j.status === 'done') toast(`${j.case_id} is ready for review`)
        else toast(`${j.case_id}: ${j.error ?? 'analysis failed'}`, 'error')
      }
      previous.current[j.id] = j.status
    }
  }, [jobs, qc, toast])

  const visible = jobs.filter(
    (j) => !dismissed.includes(j.id) && (j.status === 'running' || new Date(j.started_at).getTime() >= sessionStart),
  )
  const running = visible.filter((j) => j.status === 'running')
  if (!visible.length) return dialog

  return (
    <>
      {dialog}
      <div className="fixed right-6 bottom-6 z-40 flex w-[360px] flex-col items-end">
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="w-full overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)]"
            >
              <div className="flex items-center justify-between bg-ink px-4 py-3 text-white">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  {running.length ? <Loader2 className="size-4 animate-spin text-[#9db7f5]" /> : <CircleCheck className="size-4 text-[#6ee7a0]" />}
                  {running.length ? `Processing ${running.length} case${running.length > 1 ? 's' : ''}` : 'Processing complete'}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setOpen(false)} aria-label="Minimise" className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white">
                    <ChevronDown className="size-4" />
                  </button>
                  {!running.length && (
                    <button onClick={() => setDismissed(jobs.map((j) => j.id))} aria-label="Close" className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white">
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              </div>
              <ul className="max-h-[360px] divide-y divide-line-2 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {visible.map((j) => (
                    <JobRow
                      key={j.id}
                      job={j}
                      expanded={expanded === j.id || (j.status === 'running' && visible.length === 1)}
                      onToggle={() => setExpanded((e) => (e === j.id ? null : j.id))}
                      onOpen={() => {
                        setDismissed((d) => [...d, j.id])
                        navigate(`/cases/${j.case_id}`)
                      }}
                      onRetry={() =>
                        withCode(async () => {
                          await api.reanalyse(j.case_id)
                          qc.invalidateQueries({ queryKey: ['jobs'] })
                          qc.invalidateQueries({ queryKey: ['cases'] })
                        })
                      }
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </motion.div>
          ) : (
            <motion.button
              key="pill"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={() => setOpen(true)}
              className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white shadow-[var(--shadow-pop)] hover:bg-ink-2"
            >
              {running.length ? <Loader2 className="size-4 animate-spin text-[#9db7f5]" /> : <CircleCheck className="size-4 text-[#6ee7a0]" />}
              {running.length ? `${running.length} processing` : 'All done'}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

function JobRow({ job, expanded, onToggle, onOpen, onRetry }: { job: Job; expanded: boolean; onToggle: () => void; onOpen: () => void; onRetry: () => void }) {
  const info = stageInfo(job.stage)
  const done = job.status === 'done'
  const failed = job.status === 'failed'
  const progress = done ? 1 : failed ? 1 : info.progress
  return (
    <motion.li layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="px-4 py-3">
      <button onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <span
          className={clsx(
            'flex size-8 shrink-0 items-center justify-center rounded-full',
            done ? 'bg-ok-soft text-ok' : failed ? 'bg-bad-soft text-bad' : 'bg-blue-soft text-blue',
          )}
        >
          {done ? <Check className="size-4" strokeWidth={2.6} /> : failed ? <CircleAlert className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-text">{job.case_id}</span>
            {job.kind === 'reanalyse' && <span className="rounded bg-line-2 px-1.5 text-[10px] font-medium text-text-2">Re-analysis</span>}
          </span>
          <span className="block truncate text-[12px] text-muted">
            {done ? 'Ready for review' : failed ? job.error ?? 'Failed' : `${info.label}…`} · {job.merchant}
          </span>
        </span>
        {done && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            className="flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-ink-2"
          >
            Open <ArrowUpRight className="size-3.5" />
          </span>
        )}
        {failed && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              onRetry()
            }}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-text hover:bg-line-2"
          >
            <RotateCcw className="size-3.5" /> Retry
          </span>
        )}
      </button>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-line-2">
        <motion.div
          className={clsx('h-full rounded-full', done ? 'bg-ok' : failed ? 'bg-bad' : 'bg-blue')}
          initial={false}
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <AnimatePresence initial={false}>
        {expanded && !done && !failed && (
          <motion.ol initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 space-y-1.5 overflow-hidden">
            {STAGES.map((s, i) => {
              const state = i < info.index ? 'done' : i === info.index ? 'active' : 'todo'
              return (
                <li key={s.key} className={clsx('flex items-center gap-2 text-[12px]', state === 'todo' ? 'text-muted' : 'text-text')}>
                  {state === 'done' ? (
                    <Check className="size-3.5 text-ok" strokeWidth={2.6} />
                  ) : state === 'active' ? (
                    <Loader2 className="size-3.5 animate-spin text-blue" />
                  ) : (
                    <span className="mx-[3px] size-2 rounded-full border border-line" />
                  )}
                  {s.label}
                </li>
              )
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </motion.li>
  )
}
