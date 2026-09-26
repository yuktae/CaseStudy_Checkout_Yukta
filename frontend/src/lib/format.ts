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
