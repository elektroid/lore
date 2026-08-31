import type { LoginCredentials, RegisterCredentials, AuthResponse, CSRFResponse, MeResponse, User } from '@/types/user'

// Auth endpoints - these don't use the default api client because they need to handle
// cookies and don't send the Authorization header

const authBase = '/api/auth'

// Helper to make auth requests (without credentials initially)
async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${authBase}${path}`, {
    ...init,
    credentials: 'include', // Always send cookies
  })
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: { message?: string } }).error?.message || res.statusText)
  }
  
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// Get CSRF token - call this before making any state-changing requests
// that require CSRF protection
export async function getCSRFToken(): Promise<string> {
  const res = await authRequest<CSRFResponse>('/csrf')
  return res.csrf_token
}

// Get current user
export async function me(): Promise<User> {
  return authRequest<MeResponse>('/me').then((res) => res.user)
}

// Login
export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  return authRequest<AuthResponse>('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
}

// Register
export async function register(credentials: RegisterCredentials): Promise<AuthResponse> {
  return authRequest<AuthResponse>('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
}

// Logout
export async function logout(): Promise<void> {
  await authRequest<void>('/logout', { method: 'POST' })
}

// Forgot password — always resolves with the same generic message, whether
// or not the address is registered (see backend AuthHandler.ForgotPassword).
export async function forgotPassword(email: string): Promise<{ message: string }> {
  return authRequest<{ message: string }>('/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

// Reset password using the token from the emailed link
export async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  return authRequest<{ message: string }>('/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  })
}

// Refresh token
export async function refreshToken(): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  return authRequest<{ access_token: string; refresh_token: string; expires_in: number }>('/refresh', {
    method: 'POST',
  })
}

// Bootstrap - create first superuser (dev only)
export async function bootstrap(email: string, password: string, role: string): Promise<void> {
  await authRequest<void>('/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role }),
  })
}

// Create a fetch wrapper that automatically handles token refresh
// This should be used for all authenticated requests
export function createAuthenticatedFetch() {
  return async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // First try with existing tokens
    const res = await fetch(input, {
      ...init,
      credentials: 'include',
    })

    // If we get a 401, try refreshing the token and retry
    if (res.status === 401) {
      try {
        await refreshToken()
        // Retry the original request
        return fetch(input, {
          ...init,
          credentials: 'include',
        })
      } catch {
        // If refresh fails, return the original 401
        return res
      }
    }

    return res
  }
}

// Main authenticated API client
export const authenticatedApi = {
  get: <T>(path: string) => createAuthenticatedFetch()(path, { method: 'GET' }).then(res => res.json() as Promise<T>),
  post: <T>(path: string, body: unknown, csrfToken?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    return createAuthenticatedFetch()(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }).then(res => res.json() as Promise<T>)
  },
  put: <T>(path: string, body: unknown, csrfToken?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    return createAuthenticatedFetch()(path, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }).then(res => res.json() as Promise<T>)
  },
  delete: (path: string, csrfToken?: string) => {
    const headers: Record<string, string> = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    return createAuthenticatedFetch()(path, { method: 'DELETE', headers })
  },
}

// Character API functions
export const characterApi = {
  list: () => authenticatedApi.get<{ characters: unknown[] }>('/api/characters').then(r => r.characters),
  create: (data: unknown) => authenticatedApi.post<unknown>('/api/characters', data),
  get: (id: string) => authenticatedApi.get<{ character: unknown }>(`/api/characters/${id}`).then(r => r.character),
  update: (id: string, data: unknown, csrfToken?: string) => authenticatedApi.put<{ character: unknown }>(`/api/characters/${id}`, data, csrfToken).then(r => r.character),
  delete: (id: string, csrfToken?: string) => authenticatedApi.delete(`/api/characters/${id}`, csrfToken),
}
