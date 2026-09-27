import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Copy, History, Info, Mail, MessageSquareQuote, Plus, RotateCcw, Scale, Sparkles, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { ACTION, ConfidenceMeter, SchemeBadge, VERDICT } from '../../components/status'
import { Button, Card, SectionTitle, Tooltip } from '../../components/ui'
import { useToast } from '../../components/toast'
import { ACTION_HELP, ACTION_LABEL, dateTime } from '../../lib/format'
import type { Action, Case, Verdict, Workup } from '../../lib/types'

// ------------------------------------------------------------ 1. Reason

export interface DefendItem {
  id: string
  title: string
  text: string
  verdict: Verdict
}

type Logic = Workup['rule']['logic']

const LOGIC_HELP: Record<Exclude<Logic, 'AUTO_ACCEPT'>, string> = {
  ALL: 'The merchant’s evidence must prove every item below.',
  ANY_TWO: 'The merchant’s evidence must prove at least two of the items below.',
  ANY_ONE: 'The merchant’s evidence must prove at least one of the items below.',
  EITHER: 'The merchant’s evidence must prove at least one of the items below.',
}

function needed(logic: Logic, items: DefendItem[]) {
  if (logic === 'ALL') return items.filter((i) => i.verdict !== 'not_applicable').length
  return logic === 'ANY_TWO' ? 2 : 1
}

export function ReasonSection({ workup, kase, items, onPick }: { workup: Workup; kase: Case; items: DefendItem[]; onPick: (id: string) => void }) {
  const { rule } = workup
  const auto = rule.logic === 'AUTO_ACCEPT'
  const need = needed(rule.logic, items)
  const proven = items.filter((i) => i.verdict === 'satisfied').length
  const met = proven >= need
  return (
    <section>
      <SectionTitle index={1}>Reason code</SectionTitle>
      <Card className="p-5">
        <div className="flex items-center gap-2.5">
          <SchemeBadge scheme={kase.scheme} code={kase.reason_code} />
          <span className="text-[14px] font-semibold">{rule.title}</span>
          <span className="ml-auto rounded-md bg-line-2 px-2 py-0.5 text-[11px] font-medium text-text-2">{rule.category}</span>
        </div>
        <dl className="mt-4 grid gap-3.5 text-[13.5px] leading-relaxed">
          {rule.definition && (
            <div>
              <dt className="mb-1 flex items-center gap-2 text-[13.5px] font-bold text-ink">
                <span className="h-3.5 w-1 shrink-0 rounded-full bg-blue" />
                What this code means
              </dt>
              <dd className="text-text-2">{rule.definition}</dd>
            </div>
          )}
          <div>
            <dt className="mb-1 flex items-center gap-2 text-[13.5px] font-bold text-ink">
              <span className="h-3.5 w-1 shrink-0 rounded-full bg-blue" />
              The issuer’s claim in this case
              <Tooltip text={<>Issuer’s original words: “{kase.issuer_narrative}”</>}>
                <MessageSquareQuote className="size-3.5 text-blue" aria-label="Issuer’s original words" />
              </Tooltip>
            </dt>
            <dd className="text-text">{workup.summary.allegation}</dd>
          </div>
          <div>
            <dt className="mb-1.5 flex flex-wrap items-center gap-2 text-[13.5px] font-bold text-ink">
              <span className="h-3.5 w-1 shrink-0 rounded-full bg-blue" />
              To defend
              <span className="rounded bg-blue-soft px-1.5 py-px text-[11px] font-semibold text-blue">{rule.logic_label}</span>
              <span className={clsx('ml-auto rounded px-1.5 py-px text-[11px] font-semibold', met ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>
                {proven} of {need} needed proven
              </span>
            </dt>
            <dd>
              <p className={clsx('mb-2 text-[12.5px] leading-snug', auto ? 'rounded-lg bg-judge-soft px-3 py-2 text-judge' : 'text-text-2')}>
                {auto ? rule.note : LOGIC_HELP[rule.logic as Exclude<Logic, 'AUTO_ACCEPT'>]}
              </p>
              <ul className="divide-y divide-line-2 overflow-hidden rounded-xl border border-line">
                {items.map((it) => {
                  const v = VERDICT[it.verdict]
                  return (
                    <li key={it.id}>
                      <button onClick={() => onPick(it.id)} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[#fafbfd]">
                        <v.icon className={clsx('mt-0.5 size-[18px] shrink-0', v.cls.split(' ')[1])} strokeWidth={2.2} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-semibold text-muted">{it.id}</span>
                            <span className={clsx('text-[13.5px] font-medium', it.verdict === 'not_applicable' ? 'text-muted line-through decoration-muted/40' : 'text-text')}>{it.title}</span>
                          </span>
                          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{it.text}</span>
                        </span>
                        <Tooltip text={v.hint}>
                          <span className={clsx('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', v.cls)}>{v.label}</span>
                        </Tooltip>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </dd>
          </div>
        </dl>
      </Card>
    </section>
  )
}

// --------------------------------------------------------- 3. Rationale

export function AutoTextarea({ value, onChange, disabled, className }: { value: string; onChange: (v: string) => void; disabled?: boolean; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    document.fonts?.ready.then(fit)
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth
        fit()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={clsx('w-full resize-none overflow-hidden rounded-xl border border-line bg-surface px-4 py-3 outline-none transition-colors focus:border-blue focus:ring-4 focus:ring-blue/10 disabled:bg-[#fafbfd]', className)}
    />
  )
}

export function RationaleSection({ value, edited, aiChanged, writtenFor, recommended, onChange, onReset, readOnly }: {
  value: string
  edited: boolean
  aiChanged: boolean
  writtenFor: Action
  recommended: Action
  onChange: (v: string) => void
  onReset: () => void
  readOnly: boolean
}) {
  const toast = useToast()
  const items = value.split('\n')
  const n = items.filter((x) => x.trim()).length
  const inRange = n >= 3 && n <= 5
  const setItem = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v.replace(/\n/g, ' ') : x)).join('\n'))
  const removeItem = (i: number) => onChange(items.filter((_, j) => j !== i).join('\n'))
  const addItem = () => onChange([...items.filter((x) => x.trim()), ''].join('\n'))
  return (
    <section>
      <SectionTitle
        index={3}
        right={
          <span className={clsx('rounded-md px-2 py-0.5 text-xs font-semibold', inRange ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>
            {n} point{n === 1 ? '' : 's'}
          </span>
        }
      >
        Representment rationale
      </SectionTitle>
      <Card className="p-5">
        {writtenFor !== recommended && !edited && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-judge-soft px-3 py-2 text-[12.5px] text-judge">
            <Scale className="mt-px size-4 shrink-0" />
            <span>
              This draft argues for <span className="font-semibold">{ACTION_LABEL[writtenFor]}</span>, the AI's view. The rule check recommends{' '}
              <span className="font-semibold">{ACTION_LABEL[recommended]}</span>. Edit before filing.
            </span>
          </div>
        )}
        {aiChanged && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-blue-soft px-3 py-2 text-[12.5px] text-blue">
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" /> The AI suggests a different version after re-analysis.
            </span>
            <button onClick={onReset} className="font-semibold hover:underline">
              Use AI version
            </button>
          </div>
        )}
        <ol className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="group flex items-start gap-3">
              <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-soft text-[12px] font-semibold text-blue">{i + 1}</span>
              <AutoTextarea
                value={it}
                onChange={(v) => setItem(i, v)}
                disabled={readOnly}
                className="!border-transparent !bg-[#fafbfd] !px-3 !py-2 text-[14px] leading-relaxed text-text hover:!border-line focus:!border-blue"
              />
              {!readOnly && items.length > 1 && (
                <button aria-label={`Remove point ${i + 1}`} onClick={() => removeItem(i)} className="mt-2.5 rounded p-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-bad">
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ol>
        {!readOnly && (
          <button onClick={addItem} className="mt-2 ml-9 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-blue hover:bg-blue-soft">
            <Plus className="size-3.5" /> Add a point
          </button>
        )}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-muted">{edited ? 'Edited by you' : 'Drafted by AI, ready to edit'}</span>
          <div className="flex gap-1.5">
            {edited && !readOnly && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={onReset}>
                Reset to AI
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy className="size-3.5" />}
              onClick={() =>
                navigator.clipboard
                  .writeText(items.filter((x) => x.trim()).map((x, i) => `${i + 1}. ${x.trim()}`).join('\n'))
                  .then(() => toast('Rationale copied'))
              }
            >
              Copy
            </Button>
          </div>
        </div>
      </Card>
    </section>
  )
}

// ------------------------------------------------------ 4. Recommended action

export function ActionSection({ workup, action, onAction, reason, onReason, justification, onJustification, justificationEdited, onResetJustification, readOnly }: {
  workup: Workup
  action: Action
  onAction: (a: Action) => void
  reason: string
  onReason: (v: string) => void
  justification: string
  onJustification: (v: string) => void
  justificationEdited: boolean
  onResetJustification: () => void
  readOnly: boolean
}) {
  const d = workup.decision
  const changed = action !== d.action
  const options: Action[] = ['represent', 'request_more_evidence', 'accept_liability']
  return (
    <section>
      <SectionTitle index={4}>Recommended action</SectionTitle>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-blue/20 bg-gradient-to-br from-blue to-[#1b3fb8] p-5 text-white shadow-[0_12px_30px_-16px_rgb(37_99_235/0.8)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ConfidenceMeter level={d.confidence.level} light />
          {d.needs_judgement && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">
              <Scale className="size-3.5" /> Needs judgement
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-white/10 p-1">
          {options.map((a) => {
            const meta = ACTION[a]
            const selected = a === action
            return (
              <button
                key={a}
                disabled={readOnly}
                onClick={() => onAction(a)}
                className={clsx(
                  'relative flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-[12.5px] font-semibold transition-colors',
                  selected ? 'text-ink' : 'text-white/80 hover:text-white',
                )}
              >
                {selected && <motion.span layoutId="action-pick" className="absolute inset-0 rounded-lg bg-white shadow" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <meta.icon className={clsx('relative size-5', selected && meta.cls.split(' ')[1])} />
                <span className="relative">{ACTION_LABEL[a]}</span>
                {a === d.action && <span className={clsx('relative text-[10px] font-medium', selected ? 'text-muted' : 'text-white/60')}>Recommended</span>}
              </button>
            )
          })}
        </div>

        <p className="mt-2.5 text-[12.5px] leading-snug text-white/80">{ACTION_HELP[action]}</p>

        {d.needs_judgement && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
            <div className="rounded-lg bg-white/10 px-3 py-2">
              <p className="text-white/60">Rule check</p>
              <p className="font-semibold">{ACTION_LABEL[d.code_action]}</p>
            </div>
            <div className="rounded-lg bg-white/10 px-3 py-2">
              <p className="text-white/60">AI review</p>
              <p className="font-semibold">{ACTION_LABEL[d.ai_action]}</p>
            </div>
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1.5 flex items-center justify-between text-[11px] font-semibold tracking-wide text-white/60 uppercase">
            Justification
            {justificationEdited && !readOnly && (
              <button onClick={onResetJustification} className="font-medium tracking-normal normal-case hover:text-white">
                Reset to AI
              </button>
            )}
          </label>
          <AutoTextarea
            value={justification}
            disabled={readOnly}
            onChange={onJustification}
            className="!rounded-lg !border-white/15 !bg-white/10 !px-3 !py-2 text-[13.5px] leading-snug !text-white focus:!border-white/40 focus:!ring-white/10"
          />
        </div>

        <AnimatePresence initial={false}>
          {changed && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <label className="mt-3 mb-1.5 block text-[11px] font-semibold tracking-wide text-white/60 uppercase">Why are you changing the recommendation?</label>
              <input
                value={reason}
                disabled={readOnly}
                onChange={(e) => onReason(e.target.value)}
                placeholder="Required when you override the AI"
                className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-[13.5px] text-white outline-none placeholder:text-white/50 focus:border-white/40"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <ConfidenceBreakdown confidence={d.confidence} />
      </div>
    </section>
  )
}

/** How the confidence label was reached: every check, passed or failed, and the notes that don't count. */
function ConfidenceBreakdown({ confidence }: { confidence: Workup['decision']['confidence'] }) {
  const checks = confidence.checks
  return (
    <div className="mt-4 border-t border-white/15 pt-3 text-[12.5px]">
      <p className="text-[11px] font-semibold tracking-wide text-white/60 uppercase">How confidence is worked out</p>
      {checks ? (
        <>
          <p className="mt-1 leading-snug text-white/70">Starts at High. Each failed check lowers it one level: none failed is High, one is Medium, two or more is Low.</p>
          <ul className="mt-2 space-y-1">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2">
                {c.passed ? <Check className="mt-0.5 size-3.5 shrink-0 text-[#86efac]" strokeWidth={2.6} /> : <X className="mt-0.5 size-3.5 shrink-0 text-[#fca5a5]" strokeWidth={2.6} />}
                <span className={c.passed ? 'text-white/80' : 'font-semibold text-white'}>{c.label}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="mt-2 space-y-1 text-white/80">
          {confidence.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {confidence.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-white/60">
          {confidence.notes.map((n) => (
            <li key={n} className="flex items-start gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>{n} (for information, doesn’t change confidence)</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------ 5. Merchant requests

export function RequestsSection({ items, onChange, edited, onReset, kase, readOnly }: {
  items: string[]
  onChange: (items: string[]) => void
  edited: boolean
  onReset: () => void
  kase: Case
  readOnly: boolean
}) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const email = () => {
    const lines = items.map((it, i) => `${i + 1}. ${it}`).join('\n')
    const text = `Subject: Additional evidence needed for chargeback ${kase.case_id}\n\nHello ${kase.transaction.merchant_name} team,\n\nTo represent chargeback ${kase.case_id} (transaction ${kase.transaction.transaction_id}), we need the following:\n\n${lines}\n\nPlease reply with these documents as soon as possible so we can respond within the scheme deadline.\n\nThank you,\nDisputes team`
    navigator.clipboard.writeText(text).then(() => toast('Email copied to clipboard'))
  }
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <SectionTitle index={5}>Ask the merchant for</SectionTitle>
      <Card className="p-5">
        {items.length === 0 && <p className="text-[13px] text-muted">No requests yet. Add what the merchant needs to provide.</p>}
        <ol className="space-y-2">
          <AnimatePresence initial={false}>
            {items.map((it, i) => (
              <motion.li key={`${i}-${it}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="group flex items-start gap-3 rounded-lg px-1 py-1">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-warn-soft text-[11px] font-semibold text-warn">{i + 1}</span>
                <AutoTextarea
                  value={it}
                  disabled={readOnly}
                  onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))}
                  className="!rounded-md !border-transparent !bg-transparent !px-1 !py-0.5 text-[13.5px] leading-snug text-text focus:!bg-line-2 focus:!ring-0"
                />
                {!readOnly && (
                  <button aria-label="Remove request" onClick={() => onChange(items.filter((_, j) => j !== i))} className="rounded p-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-bad">
                    <X className="size-3.5" />
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
        {!readOnly && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) onChange([...items, draft.trim()])
              setDraft('')
            }}
            className="mt-3 flex items-center gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a request"
              className="h-9 flex-1 rounded-lg border border-line px-3 text-[13px] outline-none focus:border-blue"
            />
            <Button size="sm" type="submit" icon={<Plus className="size-3.5" />}>
              Add
            </Button>
          </form>
        )}
        <div className="mt-4 flex items-center justify-between border-t border-line-2 pt-3">
          <span className="text-xs text-muted">{edited ? 'Edited by you' : 'Drafted by AI'}</span>
          <div className="flex gap-1.5">
            {edited && !readOnly && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={onReset}>
                Reset to AI
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Mail className="size-3.5" />} onClick={email} disabled={!items.length}>
              Copy as email
            </Button>
          </div>
        </div>
      </Card>
    </motion.section>
  )
}

// --------------------------------------------------------------- Activity

export function ActivitySection({ activity }: { activity: { text: string; created_at: string }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-[13px] font-medium text-text-2 hover:text-text">
        <History className="size-4" /> Activity
        <ChevronDown className={clsx('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 overflow-hidden">
            {activity.map((a, i) => (
              <li key={i} className="flex justify-between gap-4 border-b border-line-2 py-2 text-[12.5px] last:border-0">
                <span className="text-text-2">{a.text}</span>
                <span className="text-muted tabular">{dateTime(a.created_at)}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  )
}
