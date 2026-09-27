export type Action = 'represent' | 'accept_liability' | 'request_more_evidence'
export type Verdict = 'satisfied' | 'partial' | 'missing' | 'not_applicable'
export type CaseStatus =
  | 'processing'
  | 'ready'
  | 'in_review'
  | 'awaiting_merchant'
  | 'completed'
  | 'failed'
  | 'manual_review'

export interface Money {
  value: number
  currency: string
}

export interface Transaction {
  transaction_id: string
  merchant_name: string
  merchant_mcc: string | null
  transaction_date: string
  amount: Money
  card_bin_country: string | null
  avs_result: string | null
  cvv_result: string | null
  three_ds_status: string | null
  ip_address: string | null
  device_fingerprint: string | null
  billing_address_postcode: string | null
  shipping_address_postcode: string | null
}

export interface Case {
  case_id: string
  scheme: 'visa' | 'mastercard'
  reason_code: string
  reason_code_label: string | null
  chargeback_date: string
  chargeback_amount: Money
  transaction: Transaction
  issuer_narrative: string
  merchant_evidence_documents: string[]
  status: CaseStatus
  unread: boolean
  created_at: string
  updated_at: string
}

export interface CaseSummary {
  case_id: string
  status: CaseStatus
  unread: boolean
  scheme: 'visa' | 'mastercard'
  reason_code: string
  reason_label: string
  category: string
  merchant: string
  amount: Money
  chargeback_date: string
  created_at: string
  updated_at: string
  doc_count: number
  linked: number
  action: Action | null
  confidence: 'High' | 'Medium' | 'Low' | null
  needs_judgement: boolean
  flags: string[]
}

export interface Citation {
  page_id: string
  quote: string
  doc_key: string | null
  page_no: number | null
  verified: boolean
  match: 'exact' | 'fuzzy' | 'approximate' | 'description' | 'none'
  rects: [number, number, number, number][]
  source: 'text' | 'vision' | 'txn'
  relocated: boolean
}

export interface Requirement {
  id: string
  title: string
  text: string
  verdict: Verdict
  ai_verdict: Verdict
  finding: string
  gap: string
  fixable: boolean
  citations: Citation[]
  downgraded: string | null
  date_check: { ok: boolean | null; detail: string } | null
  vision_only: boolean
}

export interface DocPage {
  page_no: number
  width: number
  height: number
  method: 'text' | 'vision'
}

export interface DocView {
  doc_key: string
  filename: string
  kind: 'pdf' | 'image' | 'missing' | 'unreadable' | 'unsupported'
  error: string | null
  is_new: boolean
  label: string
  relevance: 'used' | 'not_relevant' | 'unreadable'
  reason: string
  pages: DocPage[]
  method: 'text' | 'vision'
}

export interface Alert {
  type:
    | 'auto_rule'
    | 'conflict'
    | 'inconsistency'
    | 'judgement'
    | 'deep_page'
    | 'vision'
    | 'unverified'
    | 'missing_file'
    | 'no_documents'
  severity: 'info' | 'warn' | 'critical'
  text: string
  target?: { requirement?: string; doc?: string }
}

export interface Workup {
  case_id: string
  version: number
  model: string
  created_at: string
  rule: {
    key: string
    scheme: string
    code: string
    title: string
    category: string
    logic: 'ALL' | 'ANY_TWO' | 'ANY_ONE' | 'EITHER' | 'AUTO_ACCEPT'
    logic_label: string
    note: string | null
    definition?: string | null
  }
  summary: { allegation: string; to_defend: string }
  requirements: Requirement[]
  score: { satisfied: number; applicable: number }
  documents: DocView[]
  alerts: Alert[]
  decision: {
    action: Action
    code_action: Action
    ai_action: Action
    needs_judgement: boolean
    confidence: {
      level: 'High' | 'Medium' | 'Low'
      score: number
      reasons: string[]
      notes: string[]
      checks?: { label: string; passed: boolean }[]
    }
  }
  justification: string
  rationale: string
  merchant_requests: string[]
}

export interface TextEdit {
  value: string
  base: string
}

export interface Review {
  version: number
  verdict_overrides: Record<string, { verdict: Verdict; note: string }>
  relevance_overrides: Record<string, 'used' | 'not_relevant'>
  action: Action | null
  action_reason: string
  rationale: TextEdit | null
  justification: TextEdit | null
  merchant_requests: { value: string[]; base: string[] } | null
  final_action?: Action
  saved_at?: string
  completed_at?: string | null
}

export interface Signal {
  key: string
  label: string
  value: string
  status: 'pass' | 'fail' | 'warn' | 'neutral'
  detail?: string
}

export interface Job {
  id: number
  case_id: string
  kind: 'analyse' | 'reanalyse'
  stage: string
  status: 'running' | 'done' | 'failed'
  error: string | null
  started_at: string
  finished_at: string | null
  merchant?: string
}

export interface CaseDetail {
  case: Case
  summary: CaseSummary
  signals: Signal[]
  linked: { case_id: string; merchant: string; shared: string[] }[]
  workup: Workup | null
  previous: { version: number; action: Action; verdicts: Record<string, Verdict> } | null
  versions: { version: number; created_at: string }[]
  review: Review | null
  pending_documents: { doc_key: string; filename: string; is_new: boolean; kind: 'pdf' | 'image' }[]
  removed_documents: string[]
  activity: { text: string; created_at: string }[]
  job: Job | null
}

export interface Meta {
  model: string
  has_api_key: boolean
  max_files: number
  max_file_mb: number
  access_code_required: boolean
}
