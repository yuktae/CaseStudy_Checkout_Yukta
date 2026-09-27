import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { FileQuestion, FileText, ImageIcon, Loader2, Trash2, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { IconButton, Tooltip } from '../../components/ui'
import { fileUrl } from '../../lib/api'
import type { Citation, DocPage, DocView } from '../../lib/types'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export interface CiteRef {
  key: string
  reqId: string
  reqTitle: string
  idx: number
  c: Citation
}

export type ViewerDoc = Pick<DocView, 'doc_key' | 'filename' | 'label' | 'kind' | 'error' | 'is_new' | 'reason' | 'method'> & {
  pages: DocPage[]
  relevance: DocView['relevance']
  pending?: boolean
}

interface ViewerProps {
  caseId: string
  docs: ViewerDoc[]
  cites: CiteRef[]
  activeDoc: string | null
  onActiveDoc: (key: string) => void
  active: CiteRef | null
  focusNonce: number
  hoveredReq: string | null
  onSelectRequirement: (reqId: string) => void
  onAddEvidence: () => void
  onRemove: (docKey: string) => void
  onRelevance: (docKey: string, value: 'used' | 'not_relevant') => void
  readOnly: boolean
}

const ZOOMS = [0.75, 0.9, 1, 1.15, 1.3, 1.5]

/**
 * Evidence viewer. Every document is loaded once and kept mounted; switching tabs only toggles visibility,
 * so moving between documents or jumping to a highlight never reloads a file.
 */
export function Viewer(props: ViewerProps) {
  const { docs, cites, activeDoc, onActiveDoc, active, readOnly } = props
  const doc = docs.find((d) => d.doc_key === activeDoc) ?? docs[0]

  // A citation in another document switches the tab; the pane itself then scrolls to it.
  useEffect(() => {
    if (active?.c.doc_key && active.c.doc_key !== doc?.doc_key) onActiveDoc(active.c.doc_key)
  }, [active, doc?.doc_key, onActiveDoc])

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of cites) if (c.c.doc_key && c.c.rects.length) out[c.c.doc_key] = (out[c.c.doc_key] ?? 0) + 1
    return out
  }, [cites])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      {/* Document tabs */}
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-line px-3 pt-2">
        {docs.map((d) => {
          const selected = d.doc_key === doc?.doc_key
          return (
            <button
              key={d.doc_key}
              ref={selected ? revealTab : undefined}
              onClick={() => onActiveDoc(d.doc_key)}
              className={clsx(
                'relative flex max-w-56 shrink-0 items-center gap-2 rounded-t-lg px-3 py-2.5 text-[13px] font-medium transition-colors',
                selected ? 'text-text' : 'text-muted hover:text-text-2',
              )}
            >
              {d.kind === 'image' ? <ImageIcon className="size-4 shrink-0" /> : d.kind === 'pdf' ? <FileText className="size-4 shrink-0" /> : <FileQuestion className="size-4 shrink-0" />}
              <span className="truncate">{d.label}</span>
              {d.is_new && <span className="rounded bg-blue px-1.5 text-[10px] font-semibold text-white">New</span>}
              {counts[d.doc_key] > 0 && (
                <span className={clsx('rounded-full px-1.5 text-[11px] font-semibold', selected ? 'bg-highlight/60 text-ink' : 'bg-line-2 text-text-2')}>{counts[d.doc_key]}</span>
              )}
              {selected && <motion.span layoutId="doc-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-blue" />}
            </button>
          )
        })}
      </div>

      {doc ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-2 text-xs text-muted">
            <span className="truncate font-mono text-text-2">{doc.filename}</span>
            <div className="flex shrink-0 items-center gap-1">
              {!doc.pending && !doc.error && (
                <Tooltip
                  text={
                    doc.relevance === 'not_relevant'
                      ? `${doc.reason ? `${doc.reason} ` : ''}Kept for reference, but it doesn’t count as evidence. Switch it back if you disagree.`
                      : 'This file counts as evidence for the case. Switch to Not relevant if it shouldn’t.'
                  }
                  side="bottom"
                >
                  <select
                    value={doc.relevance === 'not_relevant' ? 'not_relevant' : 'used'}
                    disabled={readOnly}
                    onChange={(e) => props.onRelevance(doc.doc_key, e.target.value as 'used' | 'not_relevant')}
                    className={clsx(
                      'cursor-pointer rounded-md border px-2 py-1 text-xs font-medium outline-none',
                      doc.relevance === 'not_relevant' ? 'border-line bg-line-2 text-text-2' : 'border-ok/20 bg-ok-soft text-ok',
                    )}
                  >
                    <option value="used">Used as evidence</option>
                    <option value="not_relevant">Not relevant</option>
                  </select>
                </Tooltip>
              )}
              {!readOnly && (
                <IconButton label="Remove document" onClick={() => props.onRemove(doc.doc_key)} className="size-7">
                  <Trash2 className="size-3.5" />
                </IconButton>
              )}
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            {docs.map((d) => (
              <DocPane key={d.doc_key} {...props} doc={d} visible={d.doc_key === doc.doc_key} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 bg-[#eef1f6] p-6">
          <EmptyDoc message="The merchant uploaded no evidence for this case." onUpload={readOnly ? undefined : props.onAddEvidence} />
        </div>
      )}
    </div>
  )
}

/** Keep the selected tab visible by scrolling only the tab strip (never the page). */
function revealTab(el: HTMLButtonElement | null) {
  const strip = el?.parentElement
  if (!el || !strip) return
  if (el.offsetLeft < strip.scrollLeft) strip.scrollTo({ left: el.offsetLeft - 8, behavior: 'smooth' })
  else if (el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth)
    strip.scrollTo({ left: el.offsetLeft + el.offsetWidth - strip.clientWidth + 8, behavior: 'smooth' })
}

type PaneProps = ViewerProps & { doc: ViewerDoc; visible: boolean }

const DocPane = memo(function DocPane(props: PaneProps) {
  const { caseId, doc, visible, active, focusNonce } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [zoom, setZoom] = useState(2)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  // Measure only while visible (a hidden pane has zero width).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => el.clientWidth > 0 && setWidth(el.clientWidth - 48))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Scroll to the active citation once its page has laid out.
  useEffect(() => {
    if (!visible || active?.c.doc_key !== doc.doc_key) return
    let tries = 0
    let frame = 0
    const seek = () => {
      const container = scrollRef.current
      const el = container?.querySelector<HTMLElement>(`[data-cite="${active.key}"]`)
      if (container && el && el.getBoundingClientRect().height > 0) {
        const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
        container.scrollTo({ top: top - container.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
        return
      }
      if (tries++ < 120) frame = requestAnimationFrame(seek)
    }
    frame = requestAnimationFrame(seek)
    return () => cancelAnimationFrame(frame)
  }, [active, focusNonce, visible, doc.doc_key])

  const onScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const mid = container.scrollTop + container.clientHeight / 3
    let current = 1
    container.querySelectorAll<HTMLElement>('[data-page]').forEach((p) => {
      if (p.offsetTop <= mid) current = Number(p.dataset.page)
    })
    setCurrentPage(current)
  }, [])

  const onLoad = useCallback(({ numPages: n }: { numPages: number }) => setNumPages(n), [])
  const file = useMemo(() => fileUrl(caseId, doc.doc_key), [caseId, doc.doc_key])
  const pageCount = doc.pages.length || numPages || 1
  const pageWidth = Math.max(280, Math.round(width * ZOOMS[zoom]))

  return (
    <div className={clsx('absolute inset-0 flex flex-col', !visible && 'invisible')} aria-hidden={!visible}>
      <div ref={scrollRef} onScroll={onScroll} className="pane-scroll min-h-0 flex-1 overflow-auto bg-[#eef1f6] px-6 py-6">
        {doc.error || doc.kind === 'missing' || doc.kind === 'unreadable' ? (
          <EmptyDoc message={doc.error ?? 'This file could not be read.'} onUpload={props.readOnly ? undefined : props.onAddEvidence} />
        ) : doc.kind === 'image' ? (
          <PageFrame pageNo={1} width={pageWidth}>
            <img src={file} alt={doc.label} className="block w-full" draggable={false} />
            <Highlights {...props} pageNo={1} />
          </PageFrame>
        ) : (
          <Document file={file} onLoadSuccess={onLoad} loading={PAGE_LOADING} error={PDF_ERROR}>
            {Array.from({ length: pageCount }, (_, i) => {
              const dims = doc.pages[i]
              return (
                <PageFrame key={i} pageNo={i + 1} width={pageWidth} aspect={dims ? dims.width / dims.height : undefined}>
                  <Page pageNumber={i + 1} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false} loading="" />
                  <Highlights {...props} pageNo={i + 1} />
                </PageFrame>
              )
            })}
          </Document>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
        <span className="tabular">
          Page {currentPage} of {pageCount}
        </span>
        <div className="flex items-center gap-1">
          <IconButton label="Zoom out" className="size-7" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>
            <ZoomOut className="size-4" />
          </IconButton>
          <span className="w-10 text-center tabular">{Math.round(ZOOMS[zoom] * 100)}%</span>
          <IconButton label="Zoom in" className="size-7" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>
            <ZoomIn className="size-4" />
          </IconButton>
        </div>
      </div>
    </div>
  )
})

const PAGE_LOADING = (
  <div className="flex h-40 items-center justify-center text-sm text-muted">
    <Loader2 className="mr-2 size-4 animate-spin" /> Loading document
  </div>
)

function PageFrame({ pageNo, width, aspect, children }: { pageNo: number; width: number; aspect?: number; children: ReactNode }) {
  return (
    <div
      data-page={pageNo}
      className="relative mx-auto mb-5 overflow-hidden rounded-sm bg-white shadow-[0_1px_3px_rgb(16_24_40/0.12),0_8px_24px_-12px_rgb(16_24_40/0.18)]"
      style={{ width, aspectRatio: aspect }}
    >
      {children}
    </div>
  )
}

/** Highlights are a soft fill only: no outlines or labels on top of the text. */
function Highlights({ cites, doc, pageNo, active, focusNonce, hoveredReq, onSelectRequirement }: PaneProps & { pageNo: number }) {
  const here = cites.filter((c) => c.c.doc_key === doc.doc_key && c.c.page_no === pageNo && c.c.rects.length)
  return (
    <>
      {here.map((cite) => {
        const isActive = active?.key === cite.key
        const dimmed = (active && !isActive) || (hoveredReq && hoveredReq !== cite.reqId && !isActive)
        const strong = hoveredReq === cite.reqId
        const approx = cite.c.match === 'approximate' || cite.c.match === 'description'
        return cite.c.rects.map(([x0, y0, x1, y1], i) => (
          <button
            key={`${cite.key}-${i}`}
            data-cite={i === 0 ? cite.key : undefined}
            onClick={() => onSelectRequirement(cite.reqId)}
            aria-label={`Evidence for ${cite.reqId}: ${cite.reqTitle}`}
            className={clsx(
              'group/hl absolute rounded-[2px] mix-blend-multiply transition-[background-color,opacity] duration-200',
              approx ? 'bg-blue/[0.06]' : isActive ? 'bg-[#8fb2ff]/70' : strong ? 'bg-highlight/80' : 'bg-highlight/50 hover:bg-highlight/75',
              dimmed && 'opacity-35',
            )}
            style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
          >
            <span className="pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-max max-w-64 rounded-md bg-ink px-2 py-1 text-left text-[11px] text-white group-hover/hl:block">
              Supports {cite.reqId} · {cite.reqTitle}
              {approx && ' · approximate location'}
            </span>
            <AnimatePresence>
              {isActive && (
                <motion.span
                  key={focusNonce}
                  className="pointer-events-none absolute inset-0 rounded-[2px] bg-blue/40"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 0, 1, 0] }}
                  transition={{ duration: 1.2, ease: 'easeInOut' }}
                />
              )}
            </AnimatePresence>
          </button>
        ))
      })}
    </>
  )
}

function EmptyDoc({ message, onUpload }: { message: string; onUpload?: () => void }) {
  return (
    <div className="mx-auto mt-10 flex max-w-sm flex-col items-center rounded-2xl border border-dashed border-[#cfd6e4] bg-white/60 px-8 py-10 text-center">
      <FileQuestion className="size-8 text-muted" />
      <p className="mt-3 text-sm text-text-2">{message}</p>
      {onUpload && (
        <button onClick={onUpload} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:bg-ink-2">
          <Upload className="size-4" /> Add evidence
        </button>
      )}
    </div>
  )
}

const PDF_ERROR = <EmptyDoc message="The PDF could not be displayed." />
