import clsx from 'clsx'
import { CircleCheck, CircleDot, CircleMinus, CircleX, FilePlus2, Scale, ShieldCheck, ShieldX } from 'lucide-react'
import { ACTION_LABEL, STATUS_LABEL } from '../lib/format'
import type { Action, CaseStatus, Verdict } from '../lib/types'

export const VERDICT = {
  satisfied: { label: 'Satisfied', icon: CircleCheck, cls: 'bg-ok-soft text-ok', dot: 'bg-ok' },
  partial: { label: 'Partial', icon: CircleDot, cls: 'bg-warn-soft text-warn', dot: 'bg-warn' },
  missing: { label: 'Missing', icon: CircleX, cls: 'bg-bad-soft text-bad', dot: 'bg-bad' },
  not_applicable: { label: 'Not applicable', icon: CircleMinus, cls: 'bg-line-2 text-muted', dot: 'bg-muted' },
} as const

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const v = VERDICT[verdict]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', v.cls, className)}>
      <v.icon className="size-3.5" strokeWidth={2.4} />
      {v.label}
    </span>
  )
}

export const ACTION = {
  represent: { icon: ShieldCheck, cls: 'bg-ok-soft text-ok border-ok/20' },
  accept_liability: { icon: ShieldX, cls: 'bg-bad-soft text-bad border-bad/20' },
  request_more_evidence: { icon: FilePlus2, cls: 'bg-warn-soft text-warn border-warn/20' },
} as const

export function ActionPill({ action, size = 'md', className }: { action: Action; size?: 'sm' | 'md'; className?: string }) {
  const a = ACTION[action]
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-[13px]',
        a.cls,
        className,
      )}
    >
      <a.icon className={size === 'sm' ? 'size-3.5' : 'size-4'} strokeWidth={2.2} />
      {ACTION_LABEL[action]}
    </span>
  )
}

export function JudgementPill({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border border-judge/20 bg-judge-soft px-2.5 py-0.5 text-xs font-semibold text-judge', className)}>
      <Scale className="size-3.5" strokeWidth={2.2} />
      Needs judgement
    </span>
  )
}

export function ConfidenceMeter({ level, light }: { level: 'High' | 'Medium' | 'Low'; light?: boolean }) {
  const filled = level === 'High' ? 3 : level === 'Medium' ? 2 : 1
  const color = light ? 'bg-white' : level === 'High' ? 'bg-ok' : level === 'Medium' ? 'bg-warn' : 'bg-bad'
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex items-end gap-[3px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={clsx('w-[5px] rounded-sm transition-colors', i < filled ? color : light ? 'bg-white/30' : 'bg-line')}
            style={{ height: 7 + i * 4 }}
          />
        ))}
      </span>
      <span className={clsx('text-xs font-semibold', light ? 'text-white' : 'text-text')}>{level} confidence</span>
    </span>
  )
}

const STATUS_STYLE: Record<CaseStatus, string> = {
  processing: 'bg-blue-soft text-blue',
  ready: 'bg-blue-soft text-blue',
  in_review: 'bg-line-2 text-text-2',
  awaiting_merchant: 'bg-warn-soft text-warn',
  completed: 'bg-ok-soft text-ok',
  failed: 'bg-bad-soft text-bad',
  manual_review: 'bg-judge-soft text-judge',
}

export function StatusChip({ status }: { status: CaseStatus }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_STYLE[status])}>
      <span className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function SchemeBadge({ scheme, code }: { scheme: 'visa' | 'mastercard'; code: string }) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-md border border-line text-xs font-semibold">
      <span className={clsx('px-1.5 py-0.5 text-white', scheme === 'visa' ? 'bg-[#1a1f71]' : 'bg-ink')}>
        {scheme === 'visa' ? 'VISA' : 'MC'}
      </span>
      <span className="bg-surface px-1.5 py-0.5 font-mono text-text">{code}</span>
    </span>
  )
}
