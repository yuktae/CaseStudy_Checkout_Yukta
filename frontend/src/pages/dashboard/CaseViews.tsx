import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ChevronRight, Eye, FileSearch, FileWarning, RotateCcw, Scale, ShieldAlert, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { stageInfo } from '../../components/ProcessingDock'
import { ActionPill, ConfidenceMeter, SchemeBadge, StatusChip } from '../../components/status'
import { Tooltip } from '../../components/ui'
import { money, shortDate } from '../../lib/format'
import type { CaseSummary, Job } from '../../lib/types'

const FLAG_META: Record<string, { icon: typeof Eye; text: string }> = {
  judgement: { icon: Scale, text: 'Rule check and AI disagree' },
  conflict: { icon: TriangleAlert, text: 'Evidence conflicts with the claim' },
  vision: { icon: Eye, text: 'Key evidence read from an image' },
  deep_page: { icon: FileSearch, text: 'Evidence deep inside a long document' },
  unverified: { icon: ShieldAlert, text: 'A quote could not be verified' },
  missing_file: { icon: FileWarning, text: 'A document is missing or unreadable' },
}

/** Only the flags that change what the analyst does before opening a case; the rest live on the case page. */
function Flags({ c }: { c: CaseSummary }) {
  const shown = ['judgement', 'conflict'].filter((f) => c.flags.includes(f) || (f === 'judgement' && c.needs_judgement))
  return (
    <span className="flex items-center gap-1.5">
      {shown.map((f) => {
        const meta = FLAG_META[f]
        return (
          <Tooltip key={f} text={meta.text}>
            <meta.icon className={clsx('size-4', f === 'judgement' ? 'text-judge' : 'text-warn')} />
          </Tooltip>
        )
      })}
    </span>
  )
}

export function CaseCard({ c, job, onRetry, index }: { c: CaseSummary; job?: Job; onRetry: (id: string) => void; index: number }) {
  const processing = c.status === 'processing'
  const failed = c.status === 'failed'
  const info = job ? stageInfo(job.stage) : null
  const muted = c.status === 'completed'

  const body = (
    <div
      className={clsx(
        'group relative flex h-full flex-col rounded-[var(--radius-card)] border bg-surface p-5 shadow-[var(--shadow-card)] transition-all duration-200',
        failed ? 'border-bad/30' : 'border-line',
        !processing && !failed && 'hover:-translate-y-0.5 hover:border-blue-line hover:shadow-[0_12px_28px_-14px_rgb(37_99_235/0.35)]',
      )}
    >
      {c.unread && !processing && <span className="absolute top-5 left-0 h-6 w-1 rounded-r-full bg-blue" aria-label="New" />}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] font-medium text-muted">{c.case_id}</span>
        <StatusChip status={c.status} />
      </div>
      <h3 className={clsx('mt-3 truncate text-[16px] font-semibold', muted ? 'text-text-2' : 'text-text')}>{c.merchant}</h3>
      <p className="mt-0.5 font-mono text-[22px] font-semibold tracking-tight tabular">{money(c.amount)}</p>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        <SchemeBadge scheme={c.scheme} code={c.reason_code} />
        <Tooltip text={c.reason_label}>
          <span className="truncate text-[12.5px] text-text-2">{c.category}</span>
        </Tooltip>
      </div>

      <div className="mt-auto pt-4">
        <div className="border-t border-line-2 pt-3.5">
          {processing ? (
            <div>
              <div className="mb-2 flex items-center justify-between text-[12px]">
                <span className="font-medium text-blue">{info?.label ?? 'Queued'}…</span>
                <span className="text-muted">{Math.round((info?.progress ?? 0.05) * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line-2">
                <motion.div className="h-full rounded-full bg-blue" animate={{ width: `${(info?.progress ?? 0.05) * 100}%` }} transition={{ duration: 0.6 }} />
              </div>
            </div>
          ) : failed ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-bad">Analysis did not complete</span>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  onRetry(c.case_id)
                }}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold hover:bg-line-2"
              >
                <RotateCcw className="size-3.5" /> Retry
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              {c.action ? <ActionPill action={c.action} size="sm" /> : <span />}
              <Flags c={c} />
            </div>
          )}
          {!processing && !failed && c.confidence && (
            <div className="mt-2.5">
              <ConfidenceMeter level={c.confidence} />
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.22, delay: Math.min(index, 12) * 0.03, layout: { type: 'spring', stiffness: 400, damping: 36 } }}
    >
      {processing || failed ? body : <Link to={`/cases/${c.case_id}`} className="block h-full rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-blue">{body}</Link>}
    </motion.div>
  )
}

export function CaseTable({ cases, jobs, onRetry }: { cases: CaseSummary[]; jobs: Job[]; onRetry: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-[#fafbfd] text-[11.5px] font-semibold tracking-wide text-muted uppercase">
          <tr className="border-b border-line">
            <th className="py-3 pr-3 pl-5 font-semibold">Case</th>
            <th className="px-3 font-semibold">Merchant</th>
            <th className="px-3 font-semibold">Reason</th>
            <th className="px-3 text-right font-semibold">Amount</th>
            <th className="px-3 font-semibold">Chargeback</th>
            <th className="px-3 font-semibold">Recommendation</th>
            <th className="px-3 font-semibold">Confidence</th>
            <th className="px-3 font-semibold">Flags</th>
            <th className="px-3 font-semibold">Status</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {cases.map((c, i) => {
            const job = jobs.find((j) => j.case_id === c.case_id && j.status === 'running')
            return (
              <motion.tr
                key={c.case_id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i, 12) * 0.02 }}
                className="group border-b border-line-2 last:border-0 hover:bg-[#fafbfd]"
              >
                <td className="py-3.5 pr-3 pl-5">
                  <span className="flex items-center gap-2 font-mono text-[12.5px] text-text-2">
                    <span className={clsx('size-1.5 rounded-full', c.unread ? 'bg-blue' : 'bg-transparent')} />
                    {c.case_id}
                  </span>
                </td>
                <td className="max-w-48 truncate px-3 font-semibold">
                  <Link to={`/cases/${c.case_id}`} className="hover:text-blue">
                    {c.merchant}
                  </Link>
                </td>
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <SchemeBadge scheme={c.scheme} code={c.reason_code} />
                    <span className="max-w-44 truncate text-text-2">{c.category}</span>
                  </span>
                </td>
                <td className="px-3 text-right font-mono font-semibold tabular">{money(c.amount)}</td>
                <td className="px-3 text-text-2 tabular">{shortDate(c.chargeback_date)}</td>
                <td className="px-3">
                  {c.status === 'processing' ? (
                    <span className="text-[12px] font-medium text-blue">{job ? stageInfo(job.stage).label : 'Queued'}…</span>
                  ) : c.status === 'failed' ? (
                    <button onClick={() => onRetry(c.case_id)} className="flex items-center gap-1 text-[12px] font-semibold text-bad hover:underline">
                      <RotateCcw className="size-3.5" /> Retry
                    </button>
                  ) : (
                    c.action && <ActionPill action={c.action} size="sm" />
                  )}
                </td>
                <td className="px-3">{c.confidence && <ConfidenceMeter level={c.confidence} />}</td>
                <td className="px-3">
                  <Flags c={c} />
                </td>
                <td className="px-3">
                  <StatusChip status={c.status} />
                </td>
                <td className="pr-4">
                  <Link to={`/cases/${c.case_id}`} aria-label={`Open ${c.case_id}`}>
                    <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
