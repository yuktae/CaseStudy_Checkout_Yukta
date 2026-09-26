import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CircleAlert,
  Eye,
  FileSearch,
  FileWarning,
  Gavel,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  ShieldAlert,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useWithCode } from '../../components/AccessCode'
import { Modal } from '../../components/Modal'
import { ActionPill, ConfidenceMeter, SchemeBadge, StatusChip } from '../../components/status'
import { useToast } from '../../components/toast'
import { Button, Skeleton, Tooltip } from '../../components/ui'
import { api } from '../../lib/api'
import { dashboardPath } from '../../lib/filters'
import { ACTION_LABEL, COMPLETE_LABEL, money, shortDate } from '../../lib/format'
import type { Action, Alert, CaseDetail, Requirement, Review, Signal, Verdict } from '../../lib/types'
import { EvidenceSection } from './Evidence'
import { ActionSection, ActivitySection, ReasonSection, RationaleSection, RequestsSection } from './Sections'
import { Viewer, type CiteRef, type ViewerDoc } from './Viewer'

const DONE_TEXT: Record<Action, (id: string) => string> = {
  represent: (id) => `Representment filed for ${id}`,
  accept_liability: (id) => `Liability accepted for ${id}`,
  request_more_evidence: (id) => `Evidence requested for ${id}`,
}

const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  extracting: 'Extracting text',
  reading_images: 'Reading images',
  checking_rules: 'Checking rules',
  assessing: 'Assessing evidence',
  locating: 'Locating highlights',
}

export function AnalysisPage() {
  const { id = '' } = useParams()
  const [search] = useSearchParams()
  const version = search.get('v') ? Number(search.get('v')) : undefined
  const query = useQuery({
    queryKey: ['case', id, version ?? 'latest'],
    queryFn: () => api.case(id, version),
    refetchInterval: (q) => (q.state.data?.job ? 1500 : false),
  })

  if (query.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-2">
        <CircleAlert className="size-8 text-bad" />
        <p>{(query.error as Error).message}</p>
        <Link to="/" className="text-sm font-medium text-blue">
          Back to dashboard
        </Link>
      </div>
    )
  }
  if (!query.data) return <LoadingState />
  const d = query.data
  // Key by version so edits reset cleanly when a new analysis arrives.
  return <AnalysisView key={`${id}:${d.workup?.version ?? 0}`} detail={d} viewingOld={version !== undefined && version !== d.versions.at(-1)?.version} />
}

function emptyReview(version: number): Review {
  return { version, verdict_overrides: {}, relevance_overrides: {}, action: null, action_reason: '', rationale: null, justification: null, merchant_requests: null }
}

function AnalysisView({ detail, viewingOld }: { detail: CaseDetail; viewingOld: boolean }) {
  const { case: kase, workup } = detail
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const completed = kase.status === 'completed' || kase.status === 'awaiting_merchant'
  const readOnly = viewingOld || completed || !!detail.job

  const [draft, setDraft] = useState<Review>(() =>
    detail.review ? { ...emptyReview(workup?.version ?? 1), ...detail.review, version: workup?.version ?? 1 } : emptyReview(workup?.version ?? 1),
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [active, setActive] = useState<CiteRef | null>(null)
  const [focusNonce, setFocusNonce] = useState(0)
  const [activeDoc, setActiveDoc] = useState<string | null>(workup?.documents[0]?.doc_key ?? detail.pending_documents[0]?.doc_key ?? null)
  const [hoveredReq, setHoveredReq] = useState<string | null>(null)
  const [flashReq, setFlashReq] = useState<{ id: string; nonce: number } | null>(null)
  const [dialog, setDialog] = useState<null | 'complete' | 'reanalyse'>(null)
  const { withCode, dialog: codeDialog } = useWithCode()
  const [uploading, setUploading] = useState(false)
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity })
  const canAnalyse = meta?.has_api_key ?? false

  const update = useCallback((fn: (r: Review) => Review) => {
    setDraft(fn)
    setDirty(true)
  }, [])

  // Leaving with unsaved edits asks first.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  // ---------------------------------------------------------------- derived
  const verdictOf = useCallback((r: Requirement): Verdict => draft.verdict_overrides[r.id]?.verdict ?? r.verdict, [draft.verdict_overrides])
  const action: Action | null = workup ? draft.action ?? workup.decision.action : null
  const rationale = draft.rationale?.value ?? workup?.rationale ?? ''
  const justification = draft.justification?.value ?? workup?.justification ?? ''
  const requests = draft.merchant_requests?.value ?? workup?.merchant_requests ?? []

  const cites: CiteRef[] = useMemo(
    () =>
      workup?.requirements.flatMap((r) =>
        r.citations.map((c, idx) => ({ key: `${r.id}-${idx}`, reqId: r.id, reqTitle: r.title, idx, c })),
      ) ?? [],
    [workup],
  )

  const docs: ViewerDoc[] = useMemo(() => {
    const analysed = (workup?.documents ?? [])
      .filter((d) => !detail.removed_documents.includes(d.doc_key))
      .map((d) => ({ ...d, relevance: draft.relevance_overrides[d.doc_key] ?? d.relevance }))
    const pending = detail.pending_documents
      .filter((p) => !analysed.some((a) => a.doc_key === p.doc_key))
      .map((p) => ({ doc_key: p.doc_key, filename: p.filename, label: p.filename, kind: p.kind, error: null, is_new: true, reason: '', method: 'text' as const, pages: [], relevance: 'used' as const, pending: true }))
    return [...analysed, ...pending]
  }, [workup, detail.pending_documents, detail.removed_documents, draft.relevance_overrides])

  const hasNewEvidence = detail.pending_documents.length > 0 || detail.removed_documents.length > 0

  // ---------------------------------------------------------------- actions
  const activate = useCallback((cite: CiteRef) => {
    setActive(cite)
    setFocusNonce((n) => n + 1)
    // Stacked layout (narrow screens): bring the viewer into view as well.
    if (window.innerWidth < 1024) document.getElementById('evidence-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const selectRequirement = useCallback((reqId: string) => {
    setFlashReq({ id: reqId, nonce: Date.now() })
  }, [])

  // Deep link: /cases/:id?evidence=R1-0 opens the case focused on that piece of evidence.
  const [search] = useSearchParams()
  useEffect(() => {
    const key = search.get('evidence')
    const cite = key && cites.find((c) => c.key === key)
    if (!cite) return
    const t = setTimeout(() => {
      activate(cite)
      selectRequirement(cite.reqId)
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keyboard: [ and ] step through evidence, Esc clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select')) return
      if (e.key === 'Escape') setActive(null)
      if ((e.key === ']' || e.key === '[') && cites.length) {
        const usable = cites.filter((c) => c.c.verified && c.c.rects.length)
        if (!usable.length) return
        const i = active ? usable.findIndex((c) => c.key === active.key) : -1
        const next = e.key === ']' ? usable[(i + 1) % usable.length] : usable[(i - 1 + usable.length) % usable.length]
        activate(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cites, active, activate])

  const refresh = (data: CaseDetail) => {
    qc.setQueryData(['case', kase.case_id, 'latest'], data)
    qc.invalidateQueries({ queryKey: ['cases'] })
  }

  const save = async () => {
    if (action !== workup?.decision.action && !draft.action_reason.trim()) {
      toast('Add a reason for changing the recommendation before saving.', 'error')
      return false
    }
    setSaving(true)
    try {
      const data = await api.saveReview(kase.case_id, draft)
      setDirty(false)
      refresh(data)
      toast('Case saved')
      return true
    } catch (e) {
      toast((e as Error).message, 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  const complete = async () => {
    if (!action) return
    setSaving(true)
    try {
      await api.complete(kase.case_id, draft, action)
      setDirty(false)
      setDialog(null)
      qc.invalidateQueries({ queryKey: ['cases'] })
      qc.invalidateQueries({ queryKey: ['case', kase.case_id] })
      toast(DONE_TEXT[action](kase.case_id))
      const next = await nextCaseId(kase.case_id)
      navigate(next ? `/cases/${next}` : dashboardPath())
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const addFiles = (files: File[]) =>
    withCode(async () => {
      setUploading(true)
      try {
        const data = await api.addDocuments(kase.case_id, files)
        refresh(data)
        const newest = data.pending_documents.at(-1)
        if (newest) setActiveDoc(newest.doc_key)
        toast(`${files.length} document${files.length > 1 ? 's' : ''} added`)
      } finally {
        setUploading(false)
      }
    })

  const removeDoc = (docKey: string) =>
    withCode(async () => {
      const data = await api.removeDocument(kase.case_id, docKey)
      refresh(data)
      toast('Document removed')
    })

  const reanalyse = () =>
    withCode(async () => {
      if (dirty && !(await save())) return
      await api.reanalyse(kase.case_id)
      setDialog(null)
      qc.invalidateQueries({ queryKey: ['case', kase.case_id] })
      toast('Re-analysis started')
    })

  const overrides = Object.keys(draft.verdict_overrides).length + Object.keys(draft.relevance_overrides).length

  if (!workup) {
    return <NoWorkup detail={detail} />
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        detail={detail}
        action={action!}
        dirty={dirty}
        saving={saving}
        readOnly={readOnly}
        completed={completed}
        onSave={save}
        onComplete={() => {
          if (action !== workup.decision.action && !draft.action_reason.trim()) {
            toast('Add a reason for changing the recommendation first.', 'error')
            document.getElementById('section-action')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            return
          }
          setDialog('complete')
        }}
        onReopen={async () => refresh(await api.reopen(kase.case_id))}
      />

      <div className="pane-scroll grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 pt-4 pb-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:overflow-hidden">
        {/* Workup */}
        <div className="pane-scroll relative pr-1 lg:min-h-0 lg:overflow-y-auto">
          <div className="space-y-6 pb-10">
            <AnimatePresence>
              {hasNewEvidence && !viewingOld && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-[var(--shadow-pop)]"
                >
                  <span className="flex items-center gap-2.5 text-[13px]">
                    <FileSearch className="size-4 text-[#9db7f5]" />
                    {detail.pending_documents.length > 0 &&
                      `${detail.pending_documents.length} new document${detail.pending_documents.length > 1 ? 's' : ''}`}
                    {detail.pending_documents.length > 0 && detail.removed_documents.length > 0 && ', '}
                    {detail.removed_documents.length > 0 && `${detail.removed_documents.length} removed`}
                    <span className="text-white/50">· not yet in the analysis</span>
                  </span>
                  <Tooltip text={canAnalyse ? undefined : 'Add ANTHROPIC_API_KEY to the server .env to enable re-analysis'} side="bottom">
                    <Button size="sm" variant="primary" icon={<RefreshCw className="size-3.5" />} onClick={() => setDialog('reanalyse')} disabled={!!detail.job || !canAnalyse}>
                      Re-analyse case
                    </Button>
                  </Tooltip>
                </motion.div>
              )}
            </AnimatePresence>

            {viewingOld && (
              <div className="flex items-center justify-between rounded-xl border border-blue-line bg-blue-soft px-4 py-3 text-[13px] text-blue">
                <span className="flex items-center gap-2">
                  <Info className="size-4" /> You are viewing analysis v{workup.version}. It is read-only.
                </span>
                <Link to={`/cases/${kase.case_id}`} className="font-semibold hover:underline">
                  Go to latest
                </Link>
              </div>
            )}

            <Alerts alerts={workup.alerts} linked={detail.linked} onSelectRequirement={selectRequirement} />

            <ReasonSection workup={workup} kase={kase} />

            <EvidenceSection
              workup={workup}
              docs={docs}
              previous={detail.previous?.verdicts ?? null}
              verdictOf={verdictOf}
              override={(rid) => draft.verdict_overrides[rid]}
              onOverride={(rid, verdict, note) =>
                update((r) => {
                  const next = { ...r.verdict_overrides }
                  if (verdict === null) delete next[rid]
                  else next[rid] = { verdict, note: note ?? '' }
                  return { ...r, verdict_overrides: next }
                })
              }
              cites={cites}
              active={active}
              onActivate={activate}
              onHover={setHoveredReq}
              flashReq={flashReq}
              readOnly={readOnly}
            />

            <RationaleSection
              value={rationale}
              edited={!!draft.rationale}
              aiChanged={!!draft.rationale && draft.rationale.base !== workup.rationale}
              writtenFor={workup.decision.ai_action}
              recommended={workup.decision.action}
              onChange={(v) => update((r) => ({ ...r, rationale: { value: v, base: workup.rationale } }))}
              onReset={() => update((r) => ({ ...r, rationale: null }))}
              readOnly={readOnly}
            />

            <div id="section-action">
              <ActionSection
                workup={workup}
                action={action!}
                onAction={(a) => update((r) => ({ ...r, action: a === workup.decision.action ? null : a, action_reason: a === workup.decision.action ? '' : r.action_reason }))}
                reason={draft.action_reason}
                onReason={(v) => update((r) => ({ ...r, action_reason: v }))}
                justification={justification}
                onJustification={(v) => update((r) => ({ ...r, justification: { value: v, base: workup.justification } }))}
                justificationEdited={!!draft.justification}
                onResetJustification={() => update((r) => ({ ...r, justification: null }))}
                readOnly={readOnly}
              />
            </div>

            <AnimatePresence>
              {action === 'request_more_evidence' && (
                <RequestsSection
                  items={requests}
                  onChange={(items) => update((r) => ({ ...r, merchant_requests: { value: items, base: workup.merchant_requests } }))}
                  edited={!!draft.merchant_requests}
                  onReset={() => update((r) => ({ ...r, merchant_requests: null }))}
                  kase={kase}
                  readOnly={readOnly}
                />
              )}
            </AnimatePresence>

            {!readOnly && (
              <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 shadow-[var(--shadow-card)]">
                <span className="text-[13px] text-text-2">
                  {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
                  {overrides > 0 && <span className="ml-1 text-muted">{overrides} override{overrides > 1 ? 's' : ''}.</span>}
                </span>
                <div className="flex gap-2">
                  <Button icon={<Save className="size-4" />} onClick={save} loading={saving} disabled={!dirty}>
                    Save
                  </Button>
                  <Button variant="dark" icon={<Gavel className="size-4" />} onClick={() => setDialog('complete')}>
                    {COMPLETE_LABEL[action!]}
                  </Button>
                </div>
              </div>
            )}

            <ActivitySection activity={detail.activity} model={workup.model} />
          </div>

          {/* Re-analysis overlay */}
          <AnimatePresence>
            {detail.job && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 flex items-start justify-center bg-canvas/70 pt-32 backdrop-blur-[2px]"
              >
                <div className="flex items-center gap-3 rounded-2xl bg-ink px-5 py-4 text-white shadow-[var(--shadow-pop)]">
                  <Loader2 className="size-5 animate-spin text-[#9db7f5]" />
                  <div>
                    <p className="text-[13.5px] font-semibold">Re-analysing case</p>
                    <p className="text-xs text-white/60">{STAGE_LABEL[detail.job.stage] ?? detail.job.stage}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Evidence viewer */}
        <div id="evidence-viewer" className="h-[85vh] lg:h-auto lg:min-h-0">
        <Viewer
          caseId={kase.case_id}
          docs={docs}
          cites={cites}
          activeDoc={activeDoc}
          onActiveDoc={setActiveDoc}
          active={active}
          focusNonce={focusNonce}
          hoveredReq={hoveredReq}
          onSelectRequirement={selectRequirement}
          onAddFiles={addFiles}
          onRemove={removeDoc}
          onRelevance={(key, value) =>
            update((r) => {
              const next = { ...r.relevance_overrides }
              const ai = workup.documents.find((d) => d.doc_key === key)?.relevance
              if (value === ai) delete next[key]
              else next[key] = value
              return { ...r, relevance_overrides: next }
            })
          }
          uploading={uploading}
          readOnly={viewingOld || completed}
        />
        </div>
      </div>

      {/* Dialogs */}
      <Modal
        open={dialog === 'complete'}
        onClose={() => setDialog(null)}
        title={`${COMPLETE_LABEL[action!]} for ${kase.case_id}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="dark" icon={<Gavel className="size-4" />} loading={saving} onClick={complete}>
              {COMPLETE_LABEL[action!]}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-[13.5px]">
          <div className="flex items-center justify-between">
            <span className="text-text-2">Final action</span>
            <ActionPill action={action!} />
          </div>
          {action !== workup.decision.action && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
              Changed from the AI recommendation ({ACTION_LABEL[workup.decision.action]}): {draft.action_reason}
            </p>
          )}
          <div>
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Justification</p>
            <p>{justification}</p>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Rationale</p>
            <p className="leading-relaxed text-text-2">{rationale}</p>
          </div>
          {action === 'request_more_evidence' && (
            <div>
              <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Requests to the merchant ({requests.length})</p>
              <ol className="list-decimal space-y-1 pl-5 text-text-2">
                {requests.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </div>
          )}
          {overrides > 0 && <p className="text-[12.5px] text-muted">Includes {overrides} analyst override{overrides > 1 ? 's' : ''}.</p>}
        </div>
      </Modal>

      <Modal
        open={dialog === 'reanalyse'}
        onClose={() => setDialog(null)}
        title="Re-analyse this case?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="primary" icon={<RefreshCw className="size-4" />} onClick={reanalyse}>
              Re-analyse
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-text-2">
          The AI will re-read every document, including the new evidence, and produce version {workup.version + 1}.
          {dirty || detail.review ? ' Your edits are kept, and anything the AI changes is marked so you can compare.' : ''}
        </p>
      </Modal>

      {codeDialog}

      <Modal
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Leave without saving?"
        footer={
          <>
            <Button variant="ghost" onClick={() => blocker.proceed?.()}>
              Discard changes
            </Button>
            <Button
              variant="dark"
              onClick={async () => {
                if (await save()) blocker.proceed?.()
              }}
            >
              Save and leave
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-text-2">You have edits on this case that have not been saved.</p>
      </Modal>
    </div>
  )
}

async function nextCaseId(current: string): Promise<string | null> {
  const cases = await api.cases()
  const open = cases.filter((c) => c.case_id !== current && (c.status === 'ready' || c.status === 'in_review'))
  const after = open.find((c) => c.case_id > current)
  return (after ?? open[0])?.case_id ?? null
}

// ---------------------------------------------------------------- header

function Header({ detail, action, dirty, saving, readOnly, completed, onSave, onComplete, onReopen }: {
  detail: CaseDetail
  action: Action
  dirty: boolean
  saving: boolean
  readOnly: boolean
  completed: boolean
  onSave: () => void
  onComplete: () => void
  onReopen: () => void
}) {
  const { case: kase, workup, summary } = detail
  const navigate = useNavigate()
  const [next, setNext] = useState<string | null>(null)
  useEffect(() => {
    nextCaseId(kase.case_id).then(setNext).catch(() => setNext(null))
  }, [kase.case_id])

  return (
    <div className="border-b border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
        <div className="flex min-w-[320px] flex-1 items-center gap-4">
          <Tooltip text="Back to dashboard" side="bottom">
            <button onClick={() => navigate(dashboardPath())} className="flex size-9 items-center justify-center rounded-lg border border-line text-text-2 transition-colors hover:border-[#cfd6e4] hover:text-text" aria-label="Back to dashboard">
              <ArrowLeft className="size-4" />
            </button>
          </Tooltip>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs whitespace-nowrap text-muted">
              <span className="font-mono font-medium text-text-2">{kase.case_id}</span>
              <StatusChip status={kase.status} />
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" /> Chargeback {shortDate(kase.chargeback_date)}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-3">
              <h1 className="truncate text-xl font-semibold tracking-tight">{kase.transaction.merchant_name}</h1>
              <span className="shrink-0 font-mono text-xl font-semibold tabular">{money(kase.chargeback_amount)}</span>
              <span className="shrink-0"><SchemeBadge scheme={kase.scheme} code={kase.reason_code} /></span>
            </div>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          {workup && (
            <div className="flex items-center gap-3 border-r border-line pr-4">
              <ActionPill action={action} />
              {summary.needs_judgement && (
                <Tooltip text="The rule check and the AI disagree" side="bottom">
                  <span className="flex size-7 items-center justify-center rounded-full bg-judge-soft text-judge">
                    <Scale className="size-4" />
                  </span>
                </Tooltip>
              )}
              <ConfidenceMeter level={workup.decision.confidence.level} />
            </div>
          )}
          {detail.versions.length > 1 && (
            <select
              value={workup?.version}
              onChange={(e) => {
                const v = Number(e.target.value)
                navigate(v === detail.versions.at(-1)?.version ? `/cases/${kase.case_id}` : `/cases/${kase.case_id}?v=${v}`)
              }}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] font-medium outline-none"
              aria-label="Analysis version"
            >
              {[...detail.versions].reverse().map((v, i) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                  {i === 0 ? ' · latest' : ''}
                </option>
              ))}
            </select>
          )}
          {completed ? (
            <Button icon={<RotateCcw className="size-4" />} onClick={onReopen}>
              Reopen
            </Button>
          ) : (
            <>
              <Button icon={<Save className="size-4" />} onClick={onSave} loading={saving} disabled={readOnly || !dirty} className="relative">
                Save
                {dirty && <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-white bg-blue" />}
              </Button>
              <Button variant="dark" icon={<Gavel className="size-4" />} onClick={onComplete} disabled={readOnly || !workup}>
                {COMPLETE_LABEL[action]}
              </Button>
            </>
          )}
          <Tooltip text={next ? `Next case: ${next}` : 'No other open cases'} side="bottom">
            <button
              disabled={!next}
              onClick={() => next && navigate(`/cases/${next}`)}
              className="flex size-9 items-center justify-center rounded-lg border border-line text-text-2 transition-colors hover:text-text disabled:opacity-40"
              aria-label="Next case"
            >
              <ArrowRight className="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>
      <SignalStrip signals={detail.signals} />
    </div>
  )
}

const SIGNAL_STYLE: Record<Signal['status'], string> = {
  pass: 'text-ok',
  fail: 'text-bad',
  warn: 'text-warn',
  neutral: 'text-text-2',
}

function SignalStrip({ signals }: { signals: Signal[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line-2 px-6 py-2.5">
      {signals.map((s) => (
        <Tooltip key={s.key} text={s.detail} side="bottom">
          <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-canvas px-2.5 py-1 text-xs">
            <span className="font-medium text-muted">{s.label}</span>
            <span className={clsx('flex items-center gap-1 font-semibold', SIGNAL_STYLE[s.status])}>
              {s.status === 'pass' && <Check className="size-3.5" strokeWidth={2.6} />}
              {s.status === 'fail' && <X className="size-3.5" strokeWidth={2.6} />}
              {s.status === 'warn' && <TriangleAlert className="size-3.5" />}
              {s.value}
            </span>
          </span>
        </Tooltip>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- alerts

const ALERT_ICON: Record<Alert['type'], typeof Info> = {
  auto_rule: Gavel,
  conflict: TriangleAlert,
  inconsistency: Info,
  judgement: Scale,
  deep_page: FileSearch,
  vision: Eye,
  unverified: ShieldAlert,
  missing_file: FileWarning,
  no_documents: FileWarning,
}

function Alerts({ alerts, linked, onSelectRequirement }: { alerts: Alert[]; linked: CaseDetail['linked']; onSelectRequirement: (id: string) => void }) {
  if (!alerts.length && !linked.length) return null
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => {
        const Icon = ALERT_ICON[a.type]
        const target = a.target?.requirement
        return (
          <motion.button
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={target ? () => onSelectRequirement(target) : undefined}
            className={clsx(
              'flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[13px] leading-snug',
              a.type === 'judgement'
                ? 'border-judge/20 bg-judge-soft text-judge'
                : a.severity === 'warn'
                  ? 'border-warn/20 bg-warn-soft text-[#8a4a0b]'
                  : 'border-line bg-surface text-text-2',
              target ? 'cursor-pointer hover:border-blue-line' : 'cursor-default',
            )}
          >
            <Icon className="mt-px size-4 shrink-0" />
            <span>{a.text}</span>
          </motion.button>
        )
      })}
      {linked.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] text-text-2">
          <Link2 className="mt-px size-4 shrink-0" />
          <span>
            Linked cases:{' '}
            {linked.map((l, i) => (
              <span key={l.case_id}>
                {i > 0 && ', '}
                <Link to={`/cases/${l.case_id}`} className="font-medium text-blue hover:underline">
                  {l.case_id}
                </Link>{' '}
                <span className="text-muted">({l.merchant}, same {l.shared.join(' and ')})</span>
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------- small states

function NoWorkup({ detail }: { detail: CaseDetail }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      {detail.job ? <Loader2 className="size-8 animate-spin text-blue" /> : <CircleAlert className="size-8 text-bad" />}
      <p className="text-base font-semibold">{detail.job ? 'Analysing this case' : 'This case has not been analysed'}</p>
      <p className="max-w-md text-sm text-text-2">
        {detail.job ? STAGE_LABEL[detail.job.stage] ?? detail.job.stage : detail.activity[0]?.text}
      </p>
      <Link to="/" className="text-sm font-medium text-blue">
        Back to dashboard
      </Link>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-surface px-6 py-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-3 h-6 w-80" />
      </div>
      <div className="grid flex-1 grid-cols-2 gap-5 p-6">
        <div className="space-y-4">
          <Skeleton className="h-36" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
        <Skeleton className="h-full" />
      </div>
    </div>
  )
}
