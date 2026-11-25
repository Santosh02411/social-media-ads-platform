export const formatNumber = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))

export function formatMoney(amount: number, currency: string | null | undefined = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export const formatPercent = (n: number, digits = 2) => `${n.toFixed(digits)}%`

/** "+12.5%" / "-3.0%" / null (when there is nothing to compare against). */
export function formatChange(change: number | null): string | null {
  if (change === null || Number.isNaN(change)) return null
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'never'
  const seconds = Math.max(0, (Date.now() - new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z')).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86400)} d ago`
}

export const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google Ads',
  tiktok: 'TikTok',
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
