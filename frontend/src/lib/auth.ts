import api from './api'

export interface User {
  id: string
  email: string
  name?: string | null
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterCredentials {
  email: string
  password: string
  name: string
}

// Password rules enforced by the API (mirrored here for instant feedback)
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 72

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`
  if (!/[A-Za-z]/.test(password)) return 'Password must contain at least one letter'
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number'
  return null
}

export const authService = {
  // The API answers with the user and sets the httpOnly session cookie.
  async login(credentials: LoginCredentials): Promise<User> {
    const response = await api.post('/api/auth/login', credentials)
    return response.data.user
  },

  // Registering does not sign the user in; they log in afterwards.
  async register(credentials: RegisterCredentials): Promise<User> {
    const response = await api.post('/api/auth/register', credentials)
    return response.data.user
  },

  async logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout')
    } catch (error) {
      // The cookie may already be gone; the user is signed out either way
      console.error('Logout API call failed:', error)
    }
  },

  // Asks the API who is signed in. Returns null when there is no valid session.
  async getCurrentUser(): Promise<User | null> {
    try {
      const response = await api.get('/api/auth/me')
      return response.data.user
    } catch {
      return null
    }
  },

  async refreshSession(): Promise<void> {
    await api.post('/api/auth/refresh')
  },
}
