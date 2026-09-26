import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, ImageIcon, Paperclip, RefreshCw, TriangleAlert, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui'

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp'

export interface Gap {
  id: string
  title: string
  gap: string
}

interface Item {
  file: File
  slot: string | null // requirement id the analyst attached it to, if any
}

export function AddEvidenceDialog({ open, onClose, gaps, canAnalyse, onSubmit }: {
  open: boolean
  onClose: () => void
  gaps: Gap[]
  canAnalyse: boolean
  onSubmit: (files: File[]) => Promise<void>
}) {
  const [items, setItems] = useState<Item[]>([])
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const slotFor = useRef<string | null>(null)

  useEffect(() => {
    if (open) setItems([])
  }, [open])

  const add = (files: FileList | File[], slot: string | null) =>
    setItems((cur) => [...cur, ...Array.from(files).map((file) => ({ file, slot }))])

  const pick = (slot: string | null) => {
    slotFor.current = slot
    input.current?.click()
  }

  const submit = async () => {
    setBusy(true)
    try {
      await onSubmit(items.map((i) => i.file))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Add evidence"
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={<RefreshCw className="size-4" />} onClick={submit} loading={busy} disabled={!items.length}>
            {canAnalyse ? 'Add and re-analyse' : 'Add documents'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {gaps.length > 0 && (
          <section>
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Missing, flagged by the analysis</p>
            <ul className="space-y-2">
              {gaps.map((g) => {
                const attached = items.filter((i) => i.slot === g.id)
                return (
                  <li key={g.id} className={clsx('rounded-xl border px-3.5 py-3 transition-colors', attached.length ? 'border-ok/30 bg-ok-soft/50' : 'border-dashed border-[#cfd6e4]')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[13px] font-semibold text-text">
                          <span className="rounded bg-line-2 px-1.5 py-px font-mono text-[10.5px] text-text-2">{g.id}</span>
                          {g.title}
                        </p>
                        <p className="mt-1 text-[12.5px] leading-snug text-text-2">{g.gap}</p>
                      </div>
                      <button onClick={() => pick(g.id)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold hover:border-blue-line hover:text-blue">
                        <Paperclip className="size-3.5" /> Attach
                      </button>
                    </div>
                    {attached.map((a, i) => (
                      <p key={i} className="mt-2 flex items-center gap-2 text-[12.5px] text-ok">
                        <FileText className="size-3.5" /> {a.file.name}
                      </p>
                    ))}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section>
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{gaps.length ? 'Other documents' : 'Documents'}</p>
          <button
            type="button"
            onClick={() => pick(null)}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              add(e.dataTransfer.files, null)
            }}
            className={clsx(
              'flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-6 py-6 transition-all',
              over ? 'border-blue bg-blue-soft' : 'border-line hover:border-blue-line hover:bg-[#fafbfd]',
            )}
          >
            <Upload className="size-5 text-blue" />
            <span className="text-[13px] font-semibold">Drop files or browse</span>
            <span className="text-[12px] text-muted">PDF or image · as many as you need</span>
          </button>
          <ul className="mt-2 space-y-1.5">
            <AnimatePresence initial={false}>
              {items.map((it, i) => (
                <motion.li key={`${it.file.name}-${i}`} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 16 }}
                  className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-[13px]">
                  {it.file.type.startsWith('image/') ? <ImageIcon className="size-4 text-muted" /> : <FileText className="size-4 text-muted" />}
                  <span className="min-w-0 flex-1 truncate">{it.file.name}</span>
                  {it.slot && <span className="rounded bg-line-2 px-1.5 font-mono text-[10.5px] text-text-2">{it.slot}</span>}
                  <button aria-label={`Remove ${it.file.name}`} onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))} className="rounded p-0.5 text-muted hover:text-bad">
                    <X className="size-3.5" />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>

        <p className="flex items-start gap-2.5 rounded-lg bg-warn-soft px-3.5 py-2.5 text-[12.5px] leading-snug text-[#8a4a0b]">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          {canAnalyse
            ? 'Adding documents runs the analysis again on the whole case (about a minute). Your edits are kept and changed verdicts are marked.'
            : 'The documents will be added, but re-analysis is unavailable because no API key is configured.'}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={ACCEPT}
        onChange={(e) => {
          if (e.target.files?.length) add(e.target.files, slotFor.current)
          e.target.value = ''
        }}
      />
    </Modal>
  )
}
