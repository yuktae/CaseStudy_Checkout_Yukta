import type { Action, CaseDetail, CaseSummary, Job, Meta, Review } from './types'

const CODE_KEY = 'exhibit.accessCode'

export function getAccessCode(): string {
  try {
    return sessionStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAccessCode(code: string) {
  try {
    sessionStorage.setItem(CODE_KEY, code)
  } catch {
    /* storage unavailable: the code is simply asked again */
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const code = getAccessCode()
  if (code) headers.set('X-Access-Code', code)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json()
      message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

export const api = {
  meta: () => request<Meta>('/api/meta'),
  cases: () => request<CaseSummary[]>('/api/cases'),
  case: (id: string, version?: number) =>
    request<CaseDetail>(`/api/cases/${id}${version ? `?version=${version}` : ''}`),
  saveReview: (id: string, review: Review) =>
    request<CaseDetail>(`/api/cases/${id}/review`, { method: 'PUT', body: JSON.stringify(review) }),
  complete: (id: string, review: Review, finalAction: Action) =>
    request<CaseDetail>(`/api/cases/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ ...review, final_action: finalAction }),
    }),
  reopen: (id: string) => request<CaseDetail>(`/api/cases/${id}/reopen`, { method: 'POST' }),
  addDocuments: (id: string, files: File[]) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    return request<CaseDetail>(`/api/cases/${id}/documents`, { method: 'POST', body: form })
  },
  removeDocument: (id: string, docKey: string) =>
    request<CaseDetail>(`/api/cases/${id}/documents/${docKey}`, { method: 'DELETE' }),
  reanalyse: (id: string) => request<{ job_id: number }>(`/api/cases/${id}/reanalyse`, { method: 'POST' }),
  reasonCodes: () => request<{ scheme: string; code: string; title: string; category: string; logic: string }[]>('/api/reason-codes'),
  createCase: (payload: unknown, files: File[]) => {
    const form = new FormData()
    form.append('case', JSON.stringify(payload))
    files.forEach((f) => form.append('files', f))
    return request<{ case_id: string; job_id: number }>('/api/cases', { method: 'POST', body: form })
  },
  jobs: (active = false) => request<Job[]>(`/api/jobs${active ? '?active=true' : ''}`),
}

export const fileUrl = (caseId: string, docKey: string) => `/api/cases/${caseId}/documents/${docKey}/file`
