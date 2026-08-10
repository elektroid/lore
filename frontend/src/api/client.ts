const BASE = '/api'

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)lore_csrf=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : ''
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  }

  const method = (init?.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = getCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    const errField = (err as { error: unknown }).error
    const msg = typeof errField === 'string'
      ? errField
      : (errField as { message?: string })?.message ?? res.statusText
    throw new Error(msg || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {}
  const csrf = getCsrfToken()
  if (csrf) headers['X-CSRF-Token'] = csrf

  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    const errField = (err as { error: unknown }).error
    const msg = typeof errField === 'string'
      ? errField
      : (errField as { message?: string })?.message ?? res.statusText
    throw new Error(msg || res.statusText)
  }
  return res.json() as Promise<T>
}

// fetch() has no portable upload-progress signal, so a progress bar (and a
// cancel button) needs XMLHttpRequest instead — its `upload.onprogress` and
// `abort()` are what `upload()` above can't offer.
export interface UploadHandle<T> {
  promise: Promise<T>
  cancel: () => void
}

function uploadWithProgress<T>(path: string, form: FormData, onProgress?: (pct: number) => void): UploadHandle<T> {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', `${BASE}${path}`)
    const csrf = getCsrfToken()
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf)

    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T)
        return
      }
      let msg = xhr.statusText
      try {
        const err = JSON.parse(xhr.responseText) as { error: unknown }
        msg = typeof err.error === 'string' ? err.error : (err.error as { message?: string })?.message ?? xhr.statusText
      } catch {
        // non-JSON error body (e.g. a proxy's own error page) — fall back to statusText
      }
      reject(new Error(msg || xhr.statusText))
    }
    xhr.onerror = () => reject(new Error('Erreur réseau'))
    xhr.onabort = () => reject(new DOMException('annulé', 'AbortError'))
    xhr.send(form)
  })
  return { promise, cancel: () => xhr.abort() }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => upload<T>(path, form),
  uploadWithProgress: <T>(path: string, form: FormData, onProgress?: (pct: number) => void) =>
    uploadWithProgress<T>(path, form, onProgress),
}
