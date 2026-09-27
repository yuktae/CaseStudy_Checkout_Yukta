import type { CaseStatus, CaseSummary } from './types'

export type Tab = 'all' | 'to_review' | 'in_review' | 'awaiting' | 'completed'

export const TABS: { key: Tab; label: string; match: (s: CaseStatus) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'to_review', label: 'To review', match: (s) => s === 'ready' || s === 'processing' || s === 'failed' || s === 'manual_review' },
  { key: 'in_review', label: 'In review', match: (s) => s === 'in_review' },
  { key: 'awaiting', label: 'Awaiting merchant', match: (s) => s === 'awaiting_merchant' },
  { key: 'completed', label: 'Completed', match: (s) => s === 'completed' },
]

export type SortKey = 'deadline' | 'newest' | 'chargeback' | 'amount' | 'easiest'

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'deadline', label: 'Deadline' },
  { key: 'easiest', label: 'Easiest first' },
  { key: 'newest', label: 'Newest' },
  { key: 'chargeback', label: 'Oldest chargeback' },
  { key: 'amount', label: 'Highest amount' },
]

export const CATEGORIES = ['Fraud', 'Fraud monitoring', 'Not received', 'Not as described', 'Processing error', 'Cancellation', 'Hospitality']

export interface Filters {
  scheme: string[]
  category: string[]
  recommendation: string[]
  confidence: string[]
  due: string[] // respond-by months, YYYY-MM
  flagged: boolean
}

export const EMPTY_FILTERS: Filters = { scheme: [], category: [], recommendation: [], confidence: [], due: [], flagged: false }

const CONF_RANK = { High: 0, Medium: 1, Low: 2 } as const

export function applyFilters(cases: CaseSummary[], tab: Tab, q: string, f: Filters, sort: SortKey): CaseSummary[] {
  const needle = q.trim().toLowerCase()
  const tabMatch = TABS.find((t) => t.key === tab)!.match
  const out = cases.filter((c) => {
    if (!tabMatch(c.status)) return false
    if (needle && !`${c.case_id} ${c.merchant} ${c.reason_code} ${c.reason_label}`.toLowerCase().includes(needle)) return false
    if (f.scheme.length && !f.scheme.includes(c.scheme)) return false
    if (f.category.length && !f.category.includes(c.category)) return false
    if (f.recommendation.length) {
      const key = c.needs_judgement ? 'needs_judgement' : ''
      if (!f.recommendation.includes(c.action ?? '') && !f.recommendation.includes(key)) return false
    }
    if (f.confidence.length && !f.confidence.includes(c.confidence ?? '')) return false
    if (f.due.length && !f.due.includes(c.respond_by?.slice(0, 7) ?? '')) return false
    if (f.flagged && !c.flags.length && !c.needs_judgement) return false
    return true
  })
  const by: Record<SortKey, (a: CaseSummary, b: CaseSummary) => number> = {
    deadline: (a, b) => (a.respond_by ?? '9999').localeCompare(b.respond_by ?? '9999') || a.case_id.localeCompare(b.case_id),
    newest: (a, b) => b.created_at.localeCompare(a.created_at) || b.case_id.localeCompare(a.case_id),
    chargeback: (a, b) => a.chargeback_date.localeCompare(b.chargeback_date),
    amount: (a, b) => b.amount.value - a.amount.value,
    easiest: (a, b) =>
      (a.confidence ? CONF_RANK[a.confidence] : 3) - (b.confidence ? CONF_RANK[b.confidence] : 3) ||
      Number(a.needs_judgement) - Number(b.needs_judgement) ||
      a.case_id.localeCompare(b.case_id),
  }
  return out.sort(by[sort])
}

export function countFilters(f: Filters): number {
  return f.scheme.length + f.category.length + f.recommendation.length + f.confidence.length + f.due.length + (f.flagged ? 1 : 0)
}

const DASH_KEY = 'exhibit.dashboardSearch'

export function rememberDashboard(search: string) {
  try {
    sessionStorage.setItem(DASH_KEY, search)
  } catch {
    /* storage unavailable */
  }
}

export function dashboardPath(): string {
  try {
    return `/${sessionStorage.getItem(DASH_KEY) ?? ''}`
  } catch {
    return '/'
  }
}
