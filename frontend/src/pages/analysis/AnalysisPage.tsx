import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Eye,
  FileSearch,
  FileWarning,
  Gavel,
  Info,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  ShieldAlert,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useWithCode } from '../../components/AccessCode'
import { Modal } from '../../components/Modal'
import { ActionPill, ConfidenceMeter, SchemeBadge, StatusChip, VERDICT } from '../../components/status'
import { useToast } from '../../components/toast'
import { Button, Skeleton, Tooltip } from '../../components/ui'
import { api } from '../../lib/api'
import { dashboardPath } from '../../lib/filters'
import { ACTION_LABEL, COMPLETE_HELP, COMPLETE_LABEL, money, RESPOND_BY_HELP, shortDate } from '../../lib/format'
import type { Action, Alert, CaseDetail, Requirement, Review, Signal, Verdict, Workup } from '../../lib/types'
import { AddEvidenceDialog, type Gap } from './AddEvidence'
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
  const [dialog, setDialog] = useState<null | 'complete' | 'reanalyse' | 'evidence'>(null)
  const { withCode, dialog: codeDialog } = useWithCode()
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity })
  const canAnalyse = meta?.has_api_key ?? false
  const paneRef = useRef<HTMLDivElement>(null)
  const [section, setSection] = useState('sec-reason')

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

  // Gaps the analysis flagged: offered as upload slots in the Add evidence dialog.
  const gaps: Gap[] = useMemo(() => {
    if (!workup) return []
    const reqGaps = workup.requirements
      .filter((r) => ['missing', 'partial'].includes(verdictOf(r)) && r.fixable && r.gap)
      .map((r) => ({ id: r.id, title: r.title, gap: r.gap }))
    const fileGaps = workup.documents.filter((d) => d.error).map((d) => ({ id: d.doc_key, title: `${d.filename} is missing`, gap: 'Upload the file again.' }))
    return [...reqGaps, ...fileGaps]
  }, [workup, verdictOf])

  const hasUnanalysed = (detail.pending_documents.length > 0 || detail.removed_documents.length > 0) && !detail.job

  // ------------------------------------------------------- section timeline
  const steps = useMemo(() => {
    const out: { id: string; label: string; dots?: Verdict[] }[] = [
      { id: 'sec-reason', label: 'Reason' },
      { id: 'sec-evidence', label: 'Evidence', dots: workup?.requirements.map(verdictOf) },
      { id: 'sec-rationale', label: 'Rationale' },
      { id: 'sec-action', label: 'Decision' },
    ]
    if (action === 'request_more_evidence') out.push({ id: 'sec-requests', label: 'Requests' })
    return out
  }, [workup, verdictOf, action])

  const onPaneScroll = useCallback(() => {
    const pane = paneRef.current
    if (!pane) return
    let current = steps[0].id
    for (const s of steps) {
      const el = document.getElementById(s.id)
      if (el && el.offsetTop - pane.scrollTop <= 130) current = s.id
    }
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4) current = steps.at(-1)!.id
    setSection(current)
  }, [steps])

  const goTo = (id: string) => {
    const pane = paneRef.current
    const el = document.getElementById(id)
    if (pane && el) pane.scrollTo({ top: el.offsetTop - 96, behavior: 'smooth' })
  }

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

  const startReanalysis = async () => {
    if (dirty && !(await save())) return
    await api.reanalyse(kase.case_id)
    qc.invalidateQueries({ queryKey: ['case', kase.case_id] })
    qc.invalidateQueries({ queryKey: ['jobs'] })
  }

  const addEvidence = (files: File[]) =>
    withCode(async () => {
      const data = await api.addDocuments(kase.case_id, files)
      refresh(data)
      setDialog(null)
      if (canAnalyse) {
        await startReanalysis()
        toast(`${files.length} document${files.length > 1 ? 's' : ''} added. Re-analysing the case`)
      } else {
        toast(`${files.length} document${files.length > 1 ? 's' : ''} added`)
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
      await startReanalysis()
      setDialog(null)
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
        onAddEvidence={() => setDialog('evidence')}
        onComplete={() => {
          if (action !== workup.decision.action && !draft.action_reason.trim()) {
            toast('Add a reason for changing the recommendation first.', 'error')
            goTo('sec-action')
            return
          }
          setDialog('complete')
        }}
        onReopen={async () => refresh(await api.reopen(kase.case_id))}
      />

      <CaseProfile detail={detail} workup={workup} />

      <div className="pane-scroll grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 pt-4 pb-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:overflow-hidden">
        {/* Workup */}
        <div ref={paneRef} onScroll={onPaneScroll} className="pane-scroll relative pr-1 lg:min-h-0 lg:overflow-y-auto">
          <Timeline steps={steps} active={section} onGo={goTo} />

          <div className="space-y-6 pt-2 pb-10">
            {hasUnanalysed && !viewingOld && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-white">
                <span className="flex items-center gap-2.5 text-[13px]">
                  <FileSearch className="size-4 text-[#9db7f5]" />
                  {detail.pending_documents.length > 0 &&
                    `${detail.pending_documents.length} new document${detail.pending_documents.length > 1 ? 's' : ''}`}
                  {detail.pending_documents.length > 0 && detail.removed_documents.length > 0 && ', '}
                  {detail.removed_documents.length > 0 && `${detail.removed_documents.length} removed`}
                  <span className="text-white/50">· not yet in the analysis</span>
                </span>
                <Tooltip text={canAnalyse ? undefined : 'Add ANTHROPIC_API_KEY to the server .env to enable re-analysis'} side="bottom">
                  <Button size="sm" variant="primary" icon={<RefreshCw className="size-3.5" />} onClick={() => setDialog('reanalyse')} disabled={!canAnalyse}>
                    Re-analyse case
                  </Button>
                </Tooltip>
              </div>
            )}

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

            <div id="sec-reason" className="space-y-6">
              <Alerts alerts={workup.alerts} linked={detail.linked} onSelectRequirement={selectRequirement} />
              <ReasonSection
                workup={workup}
                kase={kase}
                items={workup.requirements.map((r) => ({ id: r.id, title: r.title, text: r.text, verdict: verdictOf(r) }))}
                onPick={selectRequirement}
              />
            </div>

            <div id="sec-evidence">
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
            </div>

            <div id="sec-rationale">
              <RationaleSection
                value={rationale}
                edited={!!draft.rationale}
                aiChanged={!!draft.rationale && draft.rationale.base !== workup.rationale}
                writtenFor={workup.rationale_for ?? workup.decision.ai_action}
                recommended={workup.decision.action}
                onChange={(v) => update((r) => ({ ...r, rationale: { value: v, base: workup.rationale } }))}
                onReset={() => update((r) => ({ ...r, rationale: null }))}
                readOnly={readOnly}
              />
            </div>

            <div id="sec-action">
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
                <div id="sec-requests">
                  <RequestsSection
                    items={requests}
                    onChange={(items) => update((r) => ({ ...r, merchant_requests: { value: items, base: workup.merchant_requests } }))}
                    edited={!!draft.merchant_requests}
                    onReset={() => update((r) => ({ ...r, merchant_requests: null }))}
                    kase={kase}
                    readOnly={readOnly}
                  />
                </div>
              )}
            </AnimatePresence>

            <ActivitySection activity={detail.activity} />
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
            onActiveDoc={(key) => {
              setActiveDoc(key)
              // Moving to another document drops the selection there, so its highlights aren't dimmed.
              setActive((a) => (a && a.c.doc_key !== key ? null : a))
            }}
            active={active}
            focusNonce={focusNonce}
            hoveredReq={hoveredReq}
            onSelectRequirement={selectRequirement}
            onAddEvidence={() => setDialog('evidence')}
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
            readOnly={viewingOld || completed}
          />
        </div>
      </div>

      {/* Dialogs */}
      <AddEvidenceDialog open={dialog === 'evidence'} onClose={() => setDialog(null)} gaps={gaps} canAnalyse={canAnalyse} onSubmit={addEvidence} />

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
          <p className="rounded-lg bg-blue-soft px-3 py-2 text-[12.5px] text-blue">{COMPLETE_HELP[action!]}</p>
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
            <ol className="list-decimal space-y-1 pl-5 leading-relaxed text-text-2">
              {rationale.split('\n').filter((x) => x.trim()).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
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
          The AI will re-read every document and produce version {workup.version + 1}. Your edits are kept, and anything the AI changes is marked so you can compare.
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

function Header({ detail, action, dirty, saving, readOnly, completed, onSave, onAddEvidence, onComplete, onReopen }: {
  detail: CaseDetail
  action: Action
  dirty: boolean
  saving: boolean
  readOnly: boolean
  completed: boolean
  onSave: () => void
  onAddEvidence: () => void
  onComplete: () => void
  onReopen: () => void
}) {
  const { case: kase, workup, summary } = detail
  const navigate = useNavigate()

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface px-6 py-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <Tooltip text="Back to dashboard" side="bottom">
          <button onClick={() => navigate(dashboardPath())} className="flex size-9 items-center justify-center rounded-lg border border-line text-text-2 transition-colors hover:border-[#cfd6e4] hover:text-text" aria-label="Back to dashboard">
            <ArrowLeft className="size-4" />
          </button>
        </Tooltip>
        <div className="min-w-0">
          <p className="font-mono text-[11.5px] text-muted">{kase.case_id}</p>
          <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">{kase.transaction.merchant_name}</h1>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
        {workup && (
          <div className="mr-2 flex items-center gap-2.5">
            <ActionPill action={action} />
            {summary.needs_judgement && (
              <Tooltip text="The rule check and the AI disagree" side="bottom">
                <span className="flex size-7 items-center justify-center rounded-full bg-judge-soft text-judge">
                  <Scale className="size-4" />
                </span>
              </Tooltip>
            )}
            <Tooltip
              text={
                <>
                  <span className="font-semibold">Why {workup.decision.confidence.level.toLowerCase()} confidence</span>
                  {workup.decision.confidence.reasons.map((r) => (
                    <span key={r} className="block">
                      {r}
                    </span>
                  ))}
                </>
              }
              side="bottom"
            >
              <ConfidenceMeter level={workup.decision.confidence.level} />
            </Tooltip>
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
          <Tooltip text="Move the case back to review so it can be edited again." side="bottom">
            <Button icon={<RotateCcw className="size-4" />} onClick={onReopen}>
              Reopen
            </Button>
          </Tooltip>
        ) : (
          <>
            <Tooltip text="Upload more merchant files. The case is then re-analysed as a new version." side="bottom">
              <Button icon={<Plus className="size-4" />} onClick={onAddEvidence} disabled={readOnly}>
                Add evidence
              </Button>
            </Tooltip>
            <Tooltip text={dirty ? 'Save your edits without deciding. The case moves to In review.' : 'Nothing to save yet.'} side="bottom">
              <Button icon={<Save className="size-4" />} onClick={onSave} loading={saving} disabled={readOnly || !dirty} className="relative">
                Save
                {dirty && <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-white bg-blue" />}
              </Button>
            </Tooltip>
            <Tooltip text={`${COMPLETE_HELP[action]} You see a summary first.`} side="bottom">
              <Button variant="dark" icon={<Gavel className="size-4" />} onClick={onComplete} disabled={readOnly || !workup}>
                {COMPLETE_LABEL[action]}
              </Button>
            </Tooltip>
          </>
        )}
      </div>
    </header>
  )
}

// ----------------------------------------------------------- case profile

function Cell({ label, children, grow }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <div className={clsx('flex min-w-0 flex-col justify-center gap-1.5 px-5 py-3', grow && 'flex-1')}>
      <p className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">{label}</p>
      <div className="flex min-h-7 items-center text-[13px] text-text">{children}</div>
    </div>
  )
}

const PILL_TONE: Record<Signal['status'], string> = {
  pass: 'bg-ok-soft text-ok',
  fail: 'bg-bad-soft text-bad',
  warn: 'bg-warn-soft text-warn',
  neutral: 'bg-line-2 text-text-2',
}

function CheckPill({ s, name }: { s?: Signal; name: string }) {
  if (!s) return null
  const Icon = s.status === 'pass' ? Check : s.status === 'fail' ? X : TriangleAlert
  return (
    <Tooltip text={`${name}: ${s.value}${s.detail ? ` (${s.detail})` : ''}`}>
      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold', PILL_TONE[s.status])}>
        <Icon className="size-3.5" strokeWidth={2.6} />
        {name}
      </span>
    </Tooltip>
  )
}

/** The case at a glance, in one card. Stays fixed while the workup and documents scroll. */
function CaseProfile({ detail, workup }: { detail: CaseDetail; workup: Workup }) {
  const { case: kase } = detail
  const sig = (key: string) => detail.signals.find((s) => s.key === key)
  const device = sig('device')
  const address = sig('address')
  return (
    <div className="px-6 pt-4">
      <div className="flex flex-wrap items-stretch divide-x divide-line-2 rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
        <Cell label="Amount">
          <span className="font-mono text-[20px] leading-none font-semibold tabular">{money(kase.chargeback_amount)}</span>
        </Cell>
        <Cell label="Reason">
          <Tooltip text={workup.rule.title}>
            <span className="flex items-center gap-2 whitespace-nowrap">
              <SchemeBadge scheme={kase.scheme} code={kase.reason_code} />
              <span className="font-medium">{workup.rule.category}</span>
            </span>
          </Tooltip>
        </Cell>
        <Cell label="Chargeback">
          <span className="flex flex-col">
            <span className="font-medium whitespace-nowrap tabular">{shortDate(kase.chargeback_date)}</span>
            {detail.respond_by && (
              <Tooltip text={RESPOND_BY_HELP}>
                <span className="text-[11.5px] whitespace-nowrap text-muted">Respond by {shortDate(detail.respond_by)}</span>
              </Tooltip>
            )}
          </span>
        </Cell>
        <Cell label="Status">
          <StatusChip status={kase.status} />
        </Cell>
        <Cell label="Checks" grow>
          <span className="flex flex-wrap items-center gap-1.5">
            <CheckPill s={sig('avs')} name="AVS" />
            <CheckPill s={sig('cvv')} name="CVV" />
            <CheckPill s={sig('three_ds')} name="3DS" />
            {address && address.status !== 'neutral' && <CheckPill s={address} name={address.status === 'pass' ? 'Same address' : 'Different address'} />}
          </span>
        </Cell>
        <Cell label="Origin">
          <Tooltip text={device?.detail ? `Device ${device.detail}` : undefined}>
            <span className="flex flex-col leading-tight whitespace-nowrap">
              <span>
                <span className="font-semibold">{sig('bin')?.value}</span>
                <span className="ml-2 font-mono text-[12px] text-text-2">{sig('ip')?.value}</span>
              </span>
              {device && <span className="text-[11.5px] text-muted">Device: {device.value.toLowerCase()}</span>}
            </span>
          </Tooltip>
        </Cell>
      </div>
    </div>
  )
}

// --------------------------------------------------------------- timeline

function Timeline({ steps, active, onGo }: { steps: { id: string; label: string; dots?: Verdict[] }[]; active: string; onGo: (id: string) => void }) {
  const current = Math.max(0, steps.findIndex((s) => s.id === active))
  return (
    <nav aria-label="Sections" className="sticky top-0 z-20 -mx-1 bg-canvas px-1 pb-3">
      <div className="flex items-center rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-[var(--shadow-card)]">
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'todo'
          return (
            <Fragment key={s.id}>
              <button onClick={() => onGo(s.id)} className="group flex shrink-0 items-center gap-2 rounded-lg py-1 pr-1">
                <span
                  className={clsx(
                    'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors duration-300',
                    state === 'active' ? 'bg-ink text-white' : state === 'done' ? 'bg-blue text-white' : 'border border-line bg-surface text-muted group-hover:border-[#cfd6e4]',
                  )}
                >
                  {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={clsx('text-[13px] transition-colors', state === 'active' ? 'font-semibold text-text' : 'font-medium text-muted group-hover:text-text-2')}>{s.label}</span>
                {s.dots && (
                  <span className="flex items-center gap-[3px]" aria-hidden>
                    {s.dots.map((v, j) => (
                      <span key={j} className={clsx('size-1.5 rounded-full', VERDICT[v].dot)} />
                    ))}
                  </span>
                )}
              </button>
              {i < steps.length - 1 && (
                <span className="relative mx-2.5 h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-line">
                  <motion.span className="absolute inset-y-0 left-0 bg-blue" initial={false} animate={{ width: i < current ? '100%' : '0%' }} transition={{ duration: 0.35 }} />
                </span>
              )}
            </Fragment>
          )
        })}
      </div>
    </nav>
  )
}

// ---------------------------------------------------------------- alerts

const ALERT_META: Record<Alert['type'], { icon: typeof Info; label: string; tone: 'warn' | 'judge' | 'info' }> = {
  judgement: { icon: Scale, label: 'Needs judgement', tone: 'judge' },
  auto_rule: { icon: Gavel, label: 'Rule decides outcome', tone: 'judge' },
  conflict: { icon: TriangleAlert, label: 'Conflict', tone: 'warn' },
  unverified: { icon: ShieldAlert, label: 'Unverified quote', tone: 'warn' },
  missing_file: { icon: FileWarning, label: 'Missing file', tone: 'warn' },
  no_documents: { icon: FileWarning, label: 'No documents', tone: 'warn' },
  deep_page: { icon: FileSearch, label: 'Evidence deep in document', tone: 'info' },
  vision: { icon: Eye, label: 'Read from image', tone: 'info' },
  inconsistency: { icon: Info, label: 'Data check', tone: 'info' },
}

const TONE = {
  warn: { chip: 'border-warn/25 bg-warn-soft text-[#8a4a0b]', on: 'border-warn bg-warn text-white' },
  judge: { chip: 'border-judge/25 bg-judge-soft text-judge', on: 'border-judge bg-judge text-white' },
  info: { chip: 'border-line bg-surface text-text-2', on: 'border-ink bg-ink text-white' },
}

interface AlertGroup {
  key: string
  icon: typeof Info
  label: string
  tone: 'warn' | 'judge' | 'info'
  items: { text: ReactNode; target?: string }[]
}

/** Heads-up row: one short chip per kind of alert; the full explanation opens on click. */
function Alerts({ alerts, linked, onSelectRequirement }: { alerts: Alert[]; linked: CaseDetail['linked']; onSelectRequirement: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const groups: AlertGroup[] = []
  const order: Alert['type'][] = ['judgement', 'auto_rule', 'conflict', 'unverified', 'missing_file', 'no_documents', 'deep_page', 'vision', 'inconsistency']
  for (const type of order) {
    const of = alerts.filter((a) => a.type === type)
    if (!of.length) continue
    const meta = ALERT_META[type]
    const page = type === 'deep_page' ? of[0].text.match(/page (\d+) of (\d+)/) : null
    groups.push({
      key: type,
      icon: meta.icon,
      label: page ? `Page ${page[1]} of ${page[2]}` : meta.label,
      tone: meta.tone,
      items: of.map((a) => ({ text: a.text, target: a.target?.requirement })),
    })
  }
  if (linked.length) {
    groups.push({
      key: 'linked',
      icon: Link2,
      label: `${linked.length} linked case${linked.length > 1 ? 's' : ''}`,
      tone: 'info',
      items: linked.map((l) => ({
        text: (
          <>
            <Link to={`/cases/${l.case_id}`} className="font-medium text-blue hover:underline">
              {l.case_id}
            </Link>{' '}
            {l.merchant}: same {l.shared.join(' and ')}
          </>
        ),
      })),
    })
  }
  if (!groups.length) return null
  const current = groups.find((g) => g.key === open)

  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Heads-up</span>
        {groups.map((g) => {
          const selected = open === g.key
          return (
            <button
              key={g.key}
              onClick={() => setOpen(selected ? null : g.key)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-colors',
                selected ? TONE[g.tone].on : clsx(TONE[g.tone].chip, 'hover:brightness-95'),
              )}
            >
              <g.icon className="size-3.5" />
              {g.label}
              {g.items.length > 1 && g.key !== 'linked' && <span className="opacity-70">· {g.items.length}</span>}
            </button>
          )
        })}
      </div>
      <AnimatePresence initial={false}>
        {current && (
          <motion.ul
            key={current.key}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {current.items.map((it, i) => (
              <li key={i} className="mt-3 flex items-start justify-between gap-4 border-t border-line-2 pt-3 text-[13px] leading-snug text-text-2 first:mt-3">
                <span>{it.text}</span>
                {it.target && (
                  <button onClick={() => onSelectRequirement(it.target!)} className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold text-blue hover:bg-blue-soft">
                    Go to {it.target}
                  </button>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
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
      <div className="border-b border-line bg-surface px-6 py-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-2 h-5 w-64" />
      </div>
      <div className="flex gap-2.5 px-6 pt-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 flex-1" />
        ))}
      </div>
      <div className="grid flex-1 grid-cols-2 gap-5 p-6">
        <div className="space-y-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
        <Skeleton className="h-full" />
      </div>
    </div>
  )
}
