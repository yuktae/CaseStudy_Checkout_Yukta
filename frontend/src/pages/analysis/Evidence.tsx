import clsx from 'clsx'
import { motion } from 'framer-motion'
import {
  BadgeCheck,
  CalendarCheck,
  CalendarX,
  ChevronDown,
  Database,
  Eye,
  FileText,
  ImageIcon,
  Info,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Wrench,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Card, SectionTitle, Tooltip } from '../../components/ui'
import { VERDICT, VerdictBadge } from '../../components/status'
import type { Requirement, Verdict, Workup } from '../../lib/types'
import type { CiteRef, ViewerDoc } from './Viewer'

interface EvidenceProps {
  workup: Workup
  docs: ViewerDoc[]
  previous: Record<string, Verdict> | null
  verdictOf: (r: Requirement) => Verdict
  override: (id: string) => { verdict: Verdict; note: string } | undefined
  onOverride: (id: string, verdict: Verdict | null, note?: string) => void
  cites: CiteRef[]
  active: CiteRef | null
  onActivate: (cite: CiteRef) => void
  onHover: (reqId: string | null) => void
  flashReq: { id: string; nonce: number } | null
  readOnly: boolean
}

export function EvidenceSection(props: EvidenceProps) {
  const { workup, docs, verdictOf } = props
  const applicable = workup.requirements.filter((r) => verdictOf(r) !== 'not_applicable')
  const satisfied = applicable.filter((r) => verdictOf(r) === 'satisfied').length
  const notUsed = docs.filter((d) => !d.pending && (d.relevance === 'not_relevant' || d.error))

  return (
    <section>
      <SectionTitle
        index={2}
        right={
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className="rounded-md bg-ink px-2 py-0.5 font-semibold text-white">
              {satisfied} of {applicable.length} satisfied
            </span>
            {workup.rule.logic_label}
          </span>
        }
      >
        Evidence assessment
      </SectionTitle>
      <div className="space-y-3">
        {workup.requirements.map((r, i) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.05, duration: 0.25 }}
          >
            <RequirementCard {...props} req={r} />
          </motion.div>
        ))}
        {notUsed.length > 0 && (
          <Card className="px-5 py-4">
            <p className="mb-2 text-[13px] font-semibold text-text">Documents not used as evidence</p>
            <ul className="space-y-2">
              {notUsed.map((d) => (
                <li key={d.doc_key} className="flex gap-2.5 text-[13px] text-text-2">
                  <span className="mt-0.5 font-mono text-xs text-muted">{d.doc_key}</span>
                  <span>
                    <span className="font-medium text-text">{d.label}</span>
                    {d.reason ? `: ${d.reason}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </section>
  )
}

function RequirementCard({ req, docs, previous, verdictOf, override, onOverride, cites, active, onActivate, onHover, flashReq, readOnly }: EvidenceProps & { req: Requirement }) {
  const verdict = verdictOf(req)
  const ov = override(req.id)
  const mine = cites.filter((c) => c.reqId === req.id)
  const isActive = active?.reqId === req.id
  const prev = previous?.[req.id]
  const updated = prev && prev !== req.verdict
  const ref = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (flashReq?.id !== req.id) return
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1200)
    return () => clearTimeout(t)
  }, [flashReq, req.id])

  return (
    <div
      ref={ref}
      id={`req-${req.id}`}
      onMouseEnter={() => onHover(req.id)}
      onMouseLeave={() => onHover(null)}
      className={clsx(
        'rounded-[var(--radius-card)] border bg-surface p-5 shadow-[var(--shadow-card)] transition-all duration-300',
        isActive || flash ? 'border-blue ring-4 ring-blue/10' : 'border-line hover:border-[#d3d9e6]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-line-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-text-2">{req.id}</span>
            <Tooltip text={req.text}>
              <h3 className="text-[14px] font-semibold text-text">{req.title}</h3>
            </Tooltip>
            {updated && (
              <Tooltip text={`${VERDICT[prev].label} → ${VERDICT[req.verdict].label} after re-analysis`}>
                <span className="rounded bg-blue px-1.5 py-0.5 text-[10px] font-semibold text-white">Updated</span>
              </Tooltip>
            )}
          </div>
        </div>
        <VerdictMenu verdict={verdict} aiVerdict={req.verdict} edited={!!ov} note={ov?.note ?? ''} readOnly={readOnly}
          onChange={(v, note) => onOverride(req.id, v, note)} />
      </div>

      <p className="mt-2.5 text-[13.5px] leading-relaxed text-text-2">{req.finding}</p>

      {mine.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {mine.map((c) => (
            <EvidenceChip key={c.key} cite={c} docs={docs} active={active?.key === c.key} onClick={() => onActivate(c)} />
          ))}
        </div>
      )}

      {(req.gap && verdict !== 'satisfied' && verdict !== 'not_applicable') || req.date_check || req.downgraded || ov?.note ? (
        <div className="mt-3 space-y-1.5 border-t border-line-2 pt-3 text-[12.5px]">
          {req.gap && verdict !== 'satisfied' && verdict !== 'not_applicable' && (
            <p className="flex items-start gap-2 text-text-2">
              <Wrench className="mt-0.5 size-3.5 shrink-0 text-muted" />
              <span>
                <span className="font-medium text-text">Gap: </span>
                {req.gap}
                <span className={clsx('ml-2 rounded px-1.5 py-px text-[10.5px] font-semibold', req.fixable ? 'bg-warn-soft text-warn' : 'bg-line-2 text-muted')}>
                  {req.fixable ? 'Fixable' : 'Not fixable'}
                </span>
              </span>
            </p>
          )}
          {req.date_check && (
            <p className="flex items-center gap-2 text-text-2">
              {req.date_check.ok === false ? <CalendarX className="size-3.5 text-bad" /> : <CalendarCheck className="size-3.5 text-ok" />}
              Date check: {req.date_check.detail}
            </p>
          )}
          {req.downgraded && (
            <p className="flex items-start gap-2 text-bad">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              Lowered from {VERDICT[req.ai_verdict].label.toLowerCase()}: {req.downgraded}
            </p>
          )}
          {ov?.note && (
            <p className="flex items-start gap-2 text-text-2">
              <Pencil className="mt-0.5 size-3.5 shrink-0 text-blue" />
              <span>
                <span className="font-medium text-text">Analyst note: </span>
                {ov.note}
              </span>
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function EvidenceChip({ cite, docs, active, onClick }: { cite: CiteRef; docs: ViewerDoc[]; active: boolean; onClick: () => void }) {
  const c = cite.c
  const doc = docs.find((d) => d.doc_key === c.doc_key)
  const isTxn = c.source === 'txn'
  const Icon = isTxn ? Database : c.source === 'vision' ? ImageIcon : FileText
  const clickable = !isTxn && c.verified && c.rects.length > 0
  const status = !c.verified
    ? { icon: ShieldAlert, cls: 'text-bad', text: 'Not found in the documents: not counted as evidence' }
    : c.source === 'vision'
      ? {
          icon: Eye,
          cls: 'text-blue',
          text:
            c.match === 'description'
              ? 'From the vision model’s description of the image, not text printed on it'
              : c.match === 'approximate'
                ? 'Read from an image; location is approximate'
                : 'Read from an image and located by OCR',
        }
      : { icon: BadgeCheck, cls: 'text-ok', text: isTxn ? 'Matches the transaction record' : 'Quote verified in the document' }

  return (
    <button
      onClick={clickable ? onClick : undefined}
      className={clsx(
        'group flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-150',
        active ? 'border-blue bg-blue-soft' : 'border-line-2 bg-[#fafbfd]',
        clickable ? 'cursor-pointer hover:border-blue-line hover:bg-blue-soft/60' : 'cursor-default',
        !c.verified && 'border-bad/20 bg-bad-soft/40',
      )}
    >
      <Icon className={clsx('mt-0.5 size-4 shrink-0', active ? 'text-blue' : 'text-muted')} />
      <span className="min-w-0 flex-1">
        <span className={clsx('block text-[13px] leading-snug text-text', !c.verified && 'line-through decoration-bad/40')}>
          <span className="rounded-sm bg-highlight/35 box-decoration-clone px-0.5">&ldquo;{c.quote}&rdquo;</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
          {isTxn ? (
            'Transaction data'
          ) : (
            <>
              <span className="font-mono font-medium text-text-2">
                {c.doc_key} · p{c.page_no}
              </span>
              {doc && <span className="truncate">{doc.label}</span>}
              {c.relocated && (
                <Tooltip text="The model cited a different page; the quote was found here instead.">
                  <Info className="size-3" />
                </Tooltip>
              )}
            </>
          )}
        </span>
      </span>
      <Tooltip text={status.text}>
        <status.icon className={clsx('mt-0.5 size-4 shrink-0', status.cls)} />
      </Tooltip>
    </button>
  )
}

function VerdictMenu({ verdict, aiVerdict, edited, note, readOnly, onChange }: {
  verdict: Verdict
  aiVerdict: Verdict
  edited: boolean
  note: string
  readOnly: boolean
  onChange: (v: Verdict | null, note?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftNote, setDraftNote] = useState(note)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        disabled={readOnly}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-full transition-transform active:scale-95 disabled:cursor-default"
        aria-label="Change verdict"
      >
        <VerdictBadge verdict={verdict} />
        {edited && <span className="rounded bg-blue-soft px-1.5 py-0.5 text-[10px] font-semibold text-blue">Edited</span>}
        {!readOnly && <ChevronDown className="size-3.5 text-muted" />}
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-[var(--shadow-pop)]"
        >
          {(Object.keys(VERDICT) as Verdict[]).map((v) => {
            const meta = VERDICT[v]
            return (
              <button
                key={v}
                onClick={() => {
                  onChange(v === aiVerdict && !draftNote ? null : v, draftNote)
                  setOpen(false)
                }}
                className={clsx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-line-2', v === verdict && 'bg-line-2')}
              >
                <meta.icon className={clsx('size-4', meta.cls.split(' ')[1])} />
                <span className="flex-1">{meta.label}</span>
                {v === aiVerdict && <span className="text-[10.5px] font-medium text-muted">AI</span>}
              </button>
            )
          })}
          <textarea
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="Note (optional)"
            rows={2}
            className="mt-1 w-full resize-none rounded-lg border border-line px-2.5 py-2 text-[13px] outline-none focus:border-blue"
          />
          {edited && (
            <button
              onClick={() => {
                onChange(null)
                setDraftNote('')
                setOpen(false)
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-text-2 hover:bg-line-2"
            >
              <RotateCcw className="size-3.5" /> Reset to AI verdict
            </button>
          )}
        </motion.div>
      )}
    </div>
  )
}
