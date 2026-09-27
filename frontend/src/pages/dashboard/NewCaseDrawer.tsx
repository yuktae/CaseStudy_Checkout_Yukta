import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, FileText, ImageIcon, Sparkles, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWithCode } from '../../components/AccessCode'
import { useToast } from '../../components/toast'
import { Button } from '../../components/ui'
import { api } from '../../lib/api'

type Shipping = 'separate' | 'same' | 'none'

interface Form {
  case_id: string
  scheme: 'visa' | 'mastercard'
  reason_code: string
  chargeback_date: string
  cb_value: string
  cb_currency: string
  narrative: string
  transaction_id: string
  merchant_name: string
  mcc: string
  txn_datetime: string
  txn_value: string
  txn_currency: string
  bin_country: string
  avs: string
  cvv: string
  three_ds: string
  ip: string
  device: string
  billing: string
  shipping: string
  shippingMode: Shipping
}

const EMPTY: Form = {
  case_id: '', scheme: 'visa', reason_code: '', chargeback_date: '', cb_value: '', cb_currency: 'GBP', narrative: '',
  transaction_id: '', merchant_name: '', mcc: '', txn_datetime: '', txn_value: '', txn_currency: 'GBP', bin_country: '',
  avs: '', cvv: '', three_ds: 'not_attempted', ip: '', device: '', billing: '', shipping: '', shippingMode: 'separate',
}

const STEPS = ['Case', 'Transaction', 'Evidence'] as const
const CURRENCIES = ['GBP', 'EUR', 'USD']
const ACCEPT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp']

type Errors = Partial<Record<keyof Form | 'files', string>>

function validate(step: number, f: Form, files: File[], maxFiles: number, maxMb: number): Errors {
  const e: Errors = {}
  if (step === 0) {
    if (f.case_id && !/^[A-Za-z0-9_-]{3,40}$/.test(f.case_id)) e.case_id = 'Letters, numbers and dashes only'
    if (!f.reason_code) e.reason_code = 'Choose the reason code'
    if (!f.chargeback_date) e.chargeback_date = 'Required'
    if (!(Number(f.cb_value) > 0)) e.cb_value = 'Enter an amount above 0'
    if (f.narrative.trim().length < 20) e.narrative = 'At least 20 characters'
  }
  if (step === 1) {
    if (!f.transaction_id.trim()) e.transaction_id = 'Required'
    if (!f.merchant_name.trim()) e.merchant_name = 'Required'
    if (f.mcc && !/^\d{4}$/.test(f.mcc)) e.mcc = '4 digits'
    if (!f.txn_datetime) e.txn_datetime = 'Required'
    else if (f.chargeback_date && f.txn_datetime.slice(0, 10) > f.chargeback_date) e.txn_datetime = 'Must be before the chargeback date'
    if (!(Number(f.txn_value) > 0)) e.txn_value = 'Enter an amount above 0'
    if (f.bin_country && !/^[A-Za-z]{2}$/.test(f.bin_country)) e.bin_country = '2-letter country code'
    if (f.ip && !/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/.test(f.ip)) e.ip = 'Not a valid IP address'
  }
  if (step === 2) {
    if (files.length > maxFiles) e.files = `At most ${maxFiles} files`
    const bad = files.find((x) => !ACCEPT.some((ext) => x.name.toLowerCase().endsWith(ext)))
    if (bad) e.files = `${bad.name}: only PDF, PNG, JPG and WEBP`
    const big = files.find((x) => x.size > maxMb * 1024 * 1024)
    if (big) e.files = `${big.name} is larger than ${maxMb} MB`
  }
  return e
}

/** Map a case in the cases.json format onto the form. */
function fromJson(raw: unknown): Form | null {
  const c = (Array.isArray(raw) ? raw[0] : raw) as Record<string, any>
  if (!c || typeof c !== 'object' || !c.transaction) return null
  const t = c.transaction
  const shipping: Shipping = !t.shipping_address_postcode ? 'none' : t.shipping_address_postcode === t.billing_address_postcode ? 'same' : 'separate'
  return {
    ...EMPTY,
    case_id: c.case_id ?? '',
    scheme: c.scheme === 'mastercard' ? 'mastercard' : 'visa',
    reason_code: String(c.reason_code ?? ''),
    chargeback_date: c.chargeback_date ?? '',
    cb_value: String(c.chargeback_amount?.value ?? ''),
    cb_currency: c.chargeback_amount?.currency ?? 'GBP',
    narrative: c.issuer_narrative ?? '',
    transaction_id: t.transaction_id ?? '',
    merchant_name: t.merchant_name ?? '',
    mcc: t.merchant_mcc ?? '',
    txn_datetime: (t.transaction_date ?? '').slice(0, 16),
    txn_value: String(t.amount?.value ?? ''),
    txn_currency: t.amount?.currency ?? 'GBP',
    bin_country: t.card_bin_country ?? '',
    avs: t.avs_result ?? '',
    cvv: t.cvv_result ?? '',
    three_ds: t.three_ds_status ?? 'not_attempted',
    ip: t.ip_address ?? '',
    device: t.device_fingerprint ?? '',
    billing: t.billing_address_postcode ?? '',
    shipping: t.shipping_address_postcode ?? '',
    shippingMode: shipping,
  }
}

export function NewCaseDrawer({ open, onClose, initialFiles }: { open: boolean; onClose: () => void; initialFiles: File[] }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { withCode, dialog } = useWithCode()
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity })
  const { data: codes = [] } = useQuery({ queryKey: ['reason-codes'], queryFn: api.reasonCodes, staleTime: Infinity })
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<Form>(EMPTY)
  const [files, setFiles] = useState<File[]>([])
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [imported, setImported] = useState<string | null>(null)
  const maxFiles = meta?.max_files ?? 4
  const maxMb = meta?.max_file_mb ?? 20

  const importJson = async (file: File) => {
    try {
      const parsed = fromJson(JSON.parse(await file.text()))
      if (!parsed) throw new Error('not a case')
      setForm(parsed)
      setImported(file.name)
      toast(`Fields filled from ${file.name}`)
    } catch {
      toast(`${file.name} is not a case in the cases.json format`, 'error')
    }
  }

  // Reset each time the drawer opens; files dropped on the dashboard arrive pre-attached.
  useEffect(() => {
    if (!open) return
    setStep(0)
    setForm(EMPTY)
    setTouched({})
    setShowErrors(false)
    setImported(null)
    const json = initialFiles.find((f) => f.name.toLowerCase().endsWith('.json'))
    setFiles(initialFiles.filter((f) => f !== json))
    if (json) importJson(json)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const errors = useMemo(() => validate(step, form, files, maxFiles, maxMb), [step, form, files, maxFiles, maxMb])
  const err = (k: keyof Form | 'files') => ((showErrors || touched[k]) && errors[k]) || undefined
  const schemeCodes = codes.filter((c) => c.scheme === form.scheme)

  const next = () => {
    if (Object.keys(errors).length) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    setStep((s) => s + 1)
  }

  const submit = () => {
    if (Object.keys(errors).length) {
      setShowErrors(true)
      return
    }
    const rule = codes.find((c) => c.scheme === form.scheme && c.code === form.reason_code)
    const caseId = form.case_id.trim() || `CB-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`
    const payload = {
      case_id: caseId,
      scheme: form.scheme,
      reason_code: form.reason_code,
      reason_code_label: rule?.title ?? null,
      chargeback_date: form.chargeback_date,
      chargeback_amount: { value: Number(form.cb_value), currency: form.cb_currency },
      issuer_narrative: form.narrative.trim(),
      transaction: {
        transaction_id: form.transaction_id.trim(),
        merchant_name: form.merchant_name.trim(),
        merchant_mcc: form.mcc || null,
        transaction_date: `${form.txn_datetime.slice(0, 16)}:00Z`, // the field is entered in UTC
        amount: { value: Number(form.txn_value), currency: form.txn_currency },
        card_bin_country: form.bin_country.toUpperCase() || null,
        avs_result: form.avs || null,
        cvv_result: form.cvv || null,
        three_ds_status: form.three_ds,
        ip_address: form.ip || null,
        device_fingerprint: form.device || null,
        billing_address_postcode: form.billing || null,
        shipping_address_postcode: form.shippingMode === 'none' ? null : form.shippingMode === 'same' ? form.billing || null : form.shipping || null,
      },
    }
    withCode(async () => {
      setSubmitting(true)
      try {
        await api.createCase(payload, files)
        qc.invalidateQueries({ queryKey: ['cases'] })
        qc.invalidateQueries({ queryKey: ['jobs'] })
        toast(`${caseId} submitted for analysis`)
        onClose()
      } finally {
        setSubmitting(false)
      }
    })
  }

  return (
    <>
      {dialog}
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/35 backdrop-blur-[1px]" onClick={onClose} />
            <motion.aside
              role="dialog"
              aria-label="New case"
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="absolute top-0 right-0 flex h-full w-full max-w-[580px] flex-col bg-surface shadow-[var(--shadow-pop)]"
              onKeyDown={(e) => e.key === 'Escape' && onClose()}
            >
              <header className="flex items-center justify-between border-b border-line px-7 py-5">
                <h2 className="text-lg font-semibold">New case</h2>
                <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-line-2 hover:text-text">
                  <X className="size-4" />
                </button>
              </header>

              {/* Stepper */}
              <nav className="flex items-center gap-2 px-7 pt-5" aria-label="Steps">
                {STEPS.map((label, i) => (
                  <div key={label} className="flex flex-1 items-center gap-2">
                    <button
                      onClick={() => i < step && setStep(i)}
                      className={clsx('flex items-center gap-2 text-[13px] font-semibold transition-colors', i === step ? 'text-text' : i < step ? 'text-blue' : 'text-muted')}
                    >
                      <span className={clsx('flex size-6 items-center justify-center rounded-full text-[11px] transition-colors', i === step ? 'bg-ink text-white' : i < step ? 'bg-blue text-white' : 'bg-line-2 text-muted')}>
                        {i < step ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                      </span>
                      {label}
                    </button>
                    {i < STEPS.length - 1 && <span className={clsx('h-px flex-1 transition-colors', i < step ? 'bg-blue' : 'bg-line')} />}
                  </div>
                ))}
              </nav>

              {imported && (
                <p className="mx-7 mt-4 flex items-center gap-2 rounded-lg bg-blue-soft px-3 py-2 text-[12.5px] text-blue">
                  <Sparkles className="size-4" /> Filled from {imported}
                </p>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }} className="space-y-5">
                    {step === 0 && (
                      <>
                        <Field label="Scheme">
                          <Segmented value={form.scheme} onChange={(v) => setForm((f) => ({ ...f, scheme: v as Form['scheme'], reason_code: '' }))}
                            options={[{ value: 'visa', label: 'Visa' }, { value: 'mastercard', label: 'Mastercard' }]} />
                        </Field>
                        <Field label="Reason code" error={err('reason_code')}>
                          <select value={form.reason_code} onChange={(e) => set('reason_code', e.target.value)} onBlur={() => setTouched((t) => ({ ...t, reason_code: true }))} className={inputCls(err('reason_code'))}>
                            <option value="">Select a reason code</option>
                            {schemeCodes.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code} · {c.title}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="grid grid-cols-2 gap-4">
                          <Field label="Chargeback date" error={err('chargeback_date')}>
                            <input type="date" value={form.chargeback_date} onChange={(e) => set('chargeback_date', e.target.value)} className={inputCls(err('chargeback_date'))} />
                          </Field>
                          <Field label="Case ID" optional error={err('case_id')}>
                            <input value={form.case_id} onChange={(e) => set('case_id', e.target.value)} placeholder="Generated if empty" className={inputCls(err('case_id'), 'font-mono')} />
                          </Field>
                        </div>
                        <Field label="Chargeback amount" error={err('cb_value')}>
                          <Money value={form.cb_value} currency={form.cb_currency} error={err('cb_value')}
                            onValue={(v) => setForm((f) => ({ ...f, cb_value: v, txn_value: f.txn_value || v }))} onCurrency={(c) => setForm((f) => ({ ...f, cb_currency: c, txn_currency: c }))} />
                        </Field>
                        <Field label="Issuer narrative" error={err('narrative')}>
                          <textarea rows={5} value={form.narrative} onChange={(e) => set('narrative', e.target.value)} onBlur={() => setTouched((t) => ({ ...t, narrative: true }))}
                            placeholder="Reason text submitted by the issuing bank" className={clsx(inputCls(err('narrative')), 'h-auto resize-none py-2.5 leading-relaxed')} />
                        </Field>
                      </>
                    )}

                    {step === 1 && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <Field label="Merchant" error={err('merchant_name')}>
                            <input value={form.merchant_name} onChange={(e) => set('merchant_name', e.target.value)} className={inputCls(err('merchant_name'))} />
                          </Field>
                          <Field label="MCC" optional error={err('mcc')}>
                            <input value={form.mcc} onChange={(e) => set('mcc', e.target.value)} inputMode="numeric" maxLength={4} className={inputCls(err('mcc'), 'font-mono')} />
                          </Field>
                          <Field label="Transaction ID" error={err('transaction_id')}>
                            <input value={form.transaction_id} onChange={(e) => set('transaction_id', e.target.value)} className={inputCls(err('transaction_id'), 'font-mono')} />
                          </Field>
                          <Field label="Date and time (UTC)" error={err('txn_datetime')}>
                            <input type="datetime-local" value={form.txn_datetime} onChange={(e) => set('txn_datetime', e.target.value)} className={inputCls(err('txn_datetime'))} />
                          </Field>
                        </div>
                        <Field label="Transaction amount" error={err('txn_value')}>
                          <Money value={form.txn_value} currency={form.txn_currency} error={err('txn_value')} onValue={(v) => set('txn_value', v)} onCurrency={(c) => set('txn_currency', c)} />
                        </Field>
                        <div className="grid grid-cols-3 gap-4">
                          <Field label="AVS">
                            <select value={form.avs} onChange={(e) => set('avs', e.target.value)} className={inputCls()}>
                              <option value="Y">Match</option>
                              <option value="N">No match</option>
                              <option value="A">Partial (postcode mismatch)</option>
                              <option value="">Not checked</option>
                            </select>
                          </Field>
                          <Field label="CVV">
                            <select value={form.cvv} onChange={(e) => set('cvv', e.target.value)} className={inputCls()}>
                              <option value="M">Match</option>
                              <option value="N">No match</option>
                              <option value="">Not checked</option>
                            </select>
                          </Field>
                          <Field label="3DS">
                            <select value={form.three_ds} onChange={(e) => set('three_ds', e.target.value)} className={inputCls()}>
                              <option value="authenticated">Authenticated</option>
                              <option value="frictionless">Frictionless</option>
                              <option value="attempted">Attempted</option>
                              <option value="not_attempted">Not attempted</option>
                            </select>
                          </Field>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <Field label="BIN country" optional error={err('bin_country')}>
                            <input value={form.bin_country} onChange={(e) => set('bin_country', e.target.value.toUpperCase())} maxLength={2} placeholder="GB" className={inputCls(err('bin_country'), 'font-mono')} />
                          </Field>
                          <Field label="IP address" optional error={err('ip')}>
                            <input value={form.ip} onChange={(e) => set('ip', e.target.value)} className={inputCls(err('ip'), 'font-mono')} />
                          </Field>
                          <Field label="Device ID" optional>
                            <input value={form.device} onChange={(e) => set('device', e.target.value)} className={inputCls(undefined, 'font-mono')} />
                          </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <Field label="Billing postcode" optional>
                            <input value={form.billing} onChange={(e) => set('billing', e.target.value)} className={inputCls(undefined, 'font-mono')} />
                          </Field>
                          <Field label="Shipping postcode" optional>
                            <input value={form.shippingMode === 'same' ? form.billing : form.shipping} disabled={form.shippingMode !== 'separate'}
                              onChange={(e) => set('shipping', e.target.value)} placeholder={form.shippingMode === 'none' ? 'No shipping' : ''} className={inputCls(undefined, 'font-mono')} />
                          </Field>
                        </div>
                        <Segmented value={form.shippingMode} onChange={(v) => set('shippingMode', v as Shipping)}
                          options={[{ value: 'separate', label: 'Different address' }, { value: 'same', label: 'Same as billing' }, { value: 'none', label: 'Digital or service' }]} />
                      </>
                    )}

                    {step === 2 && (
                      <EvidenceStep files={files} setFiles={setFiles} max={maxFiles} maxMb={maxMb} error={err('files')} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              <footer className="flex items-center justify-between border-t border-line bg-[#fafbfd] px-7 py-4">
                <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}>
                  {step === 0 ? 'Cancel' : 'Back'}
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button variant="dark" onClick={next}>
                    Next <ArrowRight className="size-4" />
                  </Button>
                ) : (
                  <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={submit} loading={submitting}>
                    Analyse case
                  </Button>
                )}
              </footer>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function inputCls(error?: string, extra?: string) {
  return clsx(
    'h-10 w-full rounded-lg border bg-surface px-3 text-[14px] text-text outline-none transition-colors placeholder:text-muted disabled:bg-line-2 disabled:text-muted',
    error ? 'border-bad focus:ring-4 focus:ring-bad/10' : 'border-line focus:border-blue focus:ring-4 focus:ring-blue/10',
    extra,
  )
}

function Field({ label, optional, error, children }: { label: string; optional?: boolean; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[12.5px] font-semibold text-text-2">
        {label}
        {optional && <span className="font-normal text-muted">Optional</span>}
      </span>
      {children}
      <AnimatePresence>
        {error && (
          <motion.span initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 block text-[12px] text-bad">
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </label>
  )
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex rounded-lg bg-line-2 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={clsx('relative flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors', value === o.value ? 'text-text' : 'text-muted hover:text-text-2')}>
          {value === o.value && <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="absolute inset-0 rounded-md bg-surface shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

function Money({ value, currency, error, onValue, onCurrency }: { value: string; currency: string; error?: string; onValue: (v: string) => void; onCurrency: (c: string) => void }) {
  return (
    <div className="flex gap-2">
      <input type="number" min="0" step="0.01" value={value} onChange={(e) => onValue(e.target.value)} className={inputCls(error, 'font-mono tabular')} />
      <select value={currency} onChange={(e) => onCurrency(e.target.value)} className={inputCls(undefined, 'w-24')}>
        {CURRENCIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </div>
  )
}

function EvidenceStep({ files, setFiles, max, maxMb, error }: { files: File[]; setFiles: (f: File[]) => void; max: number; maxMb: number; error?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const add = (list: FileList | File[]) => setFiles([...files, ...Array.from(list)].slice(0, 10))
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          add(e.dataTransfer.files)
        }}
        className={clsx(
          'flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-9 transition-all duration-200',
          over ? 'scale-[1.01] border-blue bg-blue-soft' : 'border-line hover:border-blue-line hover:bg-[#fafbfd]',
        )}
      >
        <motion.span animate={{ y: over ? -3 : 0 }} className="flex size-11 items-center justify-center rounded-full bg-blue-soft text-blue">
          <Upload className="size-5" />
        </motion.span>
        <span className="text-[14px] font-semibold">Evidence files</span>
        <span className="text-[12.5px] text-muted">
          PDF or image · up to {max} files · {maxMb} MB each
        </span>
      </button>
      <input ref={input} type="file" multiple hidden accept={ACCEPT.join(',')} onChange={(e) => {
        if (e.target.files) add(e.target.files)
        e.target.value = ''
      }} />
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {files.map((f, i) => (
            <motion.li key={`${f.name}-${i}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}
              className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
              {f.type.startsWith('image/') ? <ImageIcon className="size-4 text-muted" /> : <FileText className="size-4 text-muted" />}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.name}</span>
              <span className="text-[12px] text-muted tabular">{(f.size / 1024).toFixed(0)} KB</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:text-bad">
                <X className="size-3.5" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {error && <p className="text-[12.5px] text-bad">{error}</p>}
      {!files.length && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">No evidence attached: the case will be assessed as missing evidence.</p>}
    </div>
  )
}
