export type UserRole = 'superuser' | 'player'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  email_verified: boolean
  created_at: string
  updated_at: string
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterCredentials {
  email: string
  name: string
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

export interface AuthResponse {
  user: User
  token: TokenResponse
}

export interface CSRFResponse {
  csrf_token: string
}

export interface MeResponse {
  user: User
}
