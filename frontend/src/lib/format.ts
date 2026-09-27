import type { Action, CaseStatus, Money } from './types'

export function money(m: Money): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: m.currency }).format(m.value)
  } catch {
    return `${m.value.toFixed(2)} ${m.currency}`
  }
}

export function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function dateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const ACTION_LABEL: Record<Action, string> = {
  represent: 'Represent',
  accept_liability: 'Accept liability',
  request_more_evidence: 'Request more evidence',
}

// The dataset has no deadlines: respond-by dates use an illustrative window per scheme (see rules.py).
export const RESPOND_BY_HELP =
  'Illustrative response window: 30 days from the chargeback for Visa, 45 for Mastercard. The simplified rules in the exercise leave out time limits.'

export function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00`)
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// What each decision means for the dispute.
export const ACTION_HELP: Record<Action, string> = {
  represent: 'Fight the chargeback: the rationale is filed with the issuer as the merchant’s defence.',
  accept_liability: 'Don’t fight it: the chargeback stands and the merchant takes the loss.',
  request_more_evidence: 'Pause the case: ask the merchant for the documents listed below, then re-analyse when they arrive.',
}

// What the final button does in Exhibit.
export const COMPLETE_HELP: Record<Action, string> = {
  represent: 'Saves the decision, marks the case Completed and opens the next case to review.',
  accept_liability: 'Saves the decision, marks the case Completed and opens the next case to review.',
  request_more_evidence: 'Saves the decision, moves the case to Awaiting merchant and opens the next case. Use Copy as email to send the requests.',
}

export const COMPLETE_LABEL: Record<Action, string> = {
  represent: 'File representment',
  accept_liability: 'Accept liability',
  request_more_evidence: 'Send request',
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  processing: 'Processing',
  ready: 'To review',
  in_review: 'In review',
  awaiting_merchant: 'Awaiting merchant',
  completed: 'Completed',
  failed: 'Failed',
  manual_review: 'Manual review',
}

export const SCHEME_LABEL = { visa: 'Visa', mastercard: 'Mastercard' } as const

export function sentenceCount(text: string): number {
  return (text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? []).length || (text.trim() ? 1 : 0)
}
