import axios from 'axios'
import toast from 'react-hot-toast'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'

// The session lives in an httpOnly cookie set by the API. JavaScript never sees
// the token, so there is nothing to steal via XSS and nothing to attach manually.
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const url: string = error.config?.url || ''
    const isAuthCall = url.includes('/api/auth/')

    if (status === 401 && !isAuthCall) {
      // Session missing, expired or revoked -> back to the login page
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
    } else if (status === 429) {
      toast.error(error.response?.data?.error || 'Too many requests. Please try again later.')
    } else if (error.response?.data?.error) {
      const data = error.response.data
      const detail = Array.isArray(data.details) && data.details.length > 0
        ? data.details.map((d: { message: string }) => d.message).join(', ')
        : data.message
      toast.error(detail ? `${data.error}: ${detail}` : data.error)
    } else if (status >= 500) {
      toast.error('Server error. Please try again later.')
    } else if (error.code === 'ERR_NETWORK') {
      toast.error('Network error. Please check your connection.')
    }
    return Promise.reject(error)
  }
)

export default api
