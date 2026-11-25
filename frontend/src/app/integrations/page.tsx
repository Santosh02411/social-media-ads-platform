'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { CheckCircleIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/DashboardLayout'
import api from '@/lib/api'
import { PLATFORM_LABELS, timeAgo } from '@/lib/format'
import type { AccountOption, PageOption, Platform, PlatformProviders, PlatformType } from '@/types'

const TYPES: PlatformType[] = ['facebook', 'instagram', 'google', 'tiktok']

const DESCRIPTIONS: Record<PlatformType, string> = {
  facebook: 'Run ads on Facebook with the Meta Marketing API.',
  instagram: 'Run ads on Instagram through your Meta ad account.',
  google: 'Responsive search ads on Google Ads.',
  tiktok: 'In-feed video ads with TikTok Ads.',
}

interface Field { key: string; label: string; secret?: boolean; optional?: boolean; help?: string }

const MANUAL_FIELDS: Record<PlatformType, Field[]> = {
  facebook: [
    { key: 'accessToken', label: 'Access token', secret: true, help: 'A user or system-user token with ads_management' },
    { key: 'accountId', label: 'Ad account ID', help: 'Numbers only, e.g. 1234567890 (without "act_")' },
    { key: 'pageId', label: 'Facebook Page ID' },
  ],
  instagram: [
    { key: 'accessToken', label: 'Access token', secret: true },
    { key: 'accountId', label: 'Ad account ID' },
    { key: 'pageId', label: 'Facebook Page ID', help: 'The Page linked to your Instagram account' },
    { key: 'instagramUserId', label: 'Instagram business account ID' },
  ],
  google: [
    { key: 'refreshToken', label: 'OAuth refresh token', secret: true },
    { key: 'accountId', label: 'Customer ID', help: 'The 10-digit Google Ads account ID' },
    { key: 'loginCustomerId', label: 'Manager (MCC) customer ID', optional: true },
    { key: 'clientId', label: 'OAuth client ID', optional: true, help: 'Leave empty if the server has its own' },
    { key: 'clientSecret', label: 'OAuth client secret', secret: true, optional: true },
    { key: 'developerToken', label: 'Developer token', secret: true, optional: true },
  ],
  tiktok: [
    { key: 'accessToken', label: 'Access token', secret: true },
    { key: 'accountId', label: 'Advertiser ID' },
  ],
}

const OAUTH_ERRORS: Record<string, string> = {
  denied: 'You cancelled the authorisation.',
  invalid_state: 'The connection link expired or was already used. Please try again.',
  session_mismatch: 'Your session did not match. Sign in again and retry.',
  not_configured: 'One-click connect is not configured on this server.',
  no_ad_accounts: 'No ad accounts were found for that login.',
  no_pages: 'No Facebook Pages were found for that login.',
  no_instagram_account: 'None of your Pages has a linked Instagram business account.',
  exchange_failed: 'The platform did not accept the authorisation. Please try again.',
}

function IntegrationsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [providers, setProviders] = useState<PlatformProviders | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [manualFor, setManualFor] = useState<PlatformType | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [accountsFor, setAccountsFor] = useState<Platform | null>(null)
  const [options, setOptions] = useState<{ accounts: AccountOption[]; pages?: PageOption[] } | null>(null)
  const [choice, setChoice] = useState<{ accountId: string; pageId: string }>({ accountId: '', pageId: '' })

  const load = useCallback(async () => {
    try {
      const [list, prov] = await Promise.all([api.get('/api/platforms'), api.get('/api/platforms/providers')])
      setPlatforms(list.data.platforms || [])
      setProviders(prov.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Result of the OAuth round trip (the API redirects here with ?oauth=…)
  useEffect(() => {
    const result = searchParams.get('oauth')
    if (!result) return
    if (result === 'success') toast.success('Platform connected')
    else toast.error(OAUTH_ERRORS[searchParams.get('reason') || ''] || 'Could not connect the platform')
    router.replace('/integrations')
    load()
  }, [searchParams, router, load])

  const byType = (type: PlatformType) => platforms.find((p) => p.type === type)

  /** The platform row is created the first time the user connects it. */
  async function ensurePlatform(type: PlatformType): Promise<Platform> {
    const existing = byType(type)
    if (existing) return existing
    const { data } = await api.post('/api/platforms', { name: PLATFORM_LABELS[type], type })
    return data.platform
  }

  async function connectWithOAuth(type: PlatformType) {
    setBusy(type)
    try {
      const platform = await ensurePlatform(type)
      const { data } = await api.post(`/api/platforms/${platform.id}/oauth/start`, {})
      window.location.href = data.url // off to the provider's consent screen
    } catch {
      setBusy(null)
    }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault()
    if (!manualFor) return
    setBusy(manualFor)
    try {
      const platform = await ensurePlatform(manualFor)
      const payload = Object.fromEntries(Object.entries(formValues).filter(([, v]) => v.trim() !== ''))
      await api.post(`/api/platforms/${platform.id}/connect`, payload)
      toast.success(`${PLATFORM_LABELS[manualFor]} connected`)
      setManualFor(null)
      setFormValues({})
      await load()
    } catch {
      // the API interceptor already showed the reason
    } finally {
      setBusy(null)
    }
  }

  async function testConnection(platform: Platform) {
    setBusy(platform.id)
    try {
      const { data } = await api.post(`/api/platforms/${platform.id}/test`, {})
      data.success ? toast.success(data.message) : toast.error(data.message)
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(platform: Platform) {
    if (!confirm(`Disconnect ${PLATFORM_LABELS[platform.type]}? Stored credentials will be erased. Ads already created stay on the platform.`)) return
    await api.post(`/api/platforms/${platform.id}/disconnect`, {})
    await load()
  }

  async function openAccounts(platform: Platform) {
    setBusy(platform.id)
    try {
      const { data } = await api.get(`/api/platforms/${platform.id}/accounts`)
      setOptions(data)
      setChoice({ accountId: data.selected.accountId || data.accounts[0]?.id || '', pageId: data.selected.pageId || data.pages?.[0]?.id || '' })
      setAccountsFor(platform)
    } finally {
      setBusy(null)
    }
  }

  async function saveAccount() {
    if (!accountsFor) return
    try {
      await api.post(`/api/platforms/${accountsFor.id}/select-account`, {
        accountId: choice.accountId,
        ...(choice.pageId ? { pageId: choice.pageId } : {}),
      })
      toast.success('Account updated')
      setAccountsFor(null)
      await load()
    } catch {
      // interceptor shows the reason
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="animate-pulse px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-lg shadow h-48" />)}
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Integrations</h1>
          <p className="mt-2 text-gray-600">Connect your ad accounts. Credentials are verified with the platform before they are saved, and stored encrypted.</p>
        </div>

        {providers?.sandbox && (
          <div className="mb-6 rounded-md bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-900">
            <strong>Sandbox mode:</strong> the server is talking to a local mock of the ad platforms, not to Facebook, Google or TikTok. Nothing here reaches a real ad account.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {TYPES.map((type) => {
            const platform = byType(type)
            const connected = Boolean(platform?.is_connected)
            const oauth = providers?.providers[type]?.oauth
            const expiring = platform?.config.tokenExpiresAt && new Date(platform.config.tokenExpiresAt).getTime() - Date.now() < 7 * 86400000
            const working = busy === type || busy === platform?.id

            return (
              <div key={type} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{PLATFORM_LABELS[type]}</h2>
                    <p className="text-sm text-gray-600 mt-1">{DESCRIPTIONS[type]}</p>
                  </div>
                  {connected ? (
                    <span className="inline-flex items-center text-sm text-green-700"><CheckCircleIcon className="h-5 w-5 mr-1" />Connected</span>
                  ) : (
                    <span className="text-sm text-gray-500">Not connected</span>
                  )}
                </div>

                {connected && platform && (
                  <dl className="mt-4 text-sm grid grid-cols-2 gap-y-1">
                    <dt className="text-gray-500">Account</dt>
                    <dd className="text-gray-900 truncate">{platform.config.accountName || '–'} {platform.config.accountHint && <span className="text-gray-400">({platform.config.accountHint})</span>}</dd>
                    <dt className="text-gray-500">Currency</dt>
                    <dd className="text-gray-900">{platform.config.currency || '–'}</dd>
                    <dt className="text-gray-500">Connected via</dt>
                    <dd className="text-gray-900">{platform.config.authMethod === 'oauth' ? 'One-click login' : 'Manual credentials'} · {timeAgo(platform.config.connectedAt)}</dd>
                  </dl>
                )}

                {expiring && (
                  <p className="mt-3 flex items-center text-sm text-yellow-700">
                    <ExclamationTriangleIcon className="h-4 w-4 mr-1" />
                    Access expires {new Date(platform!.config.tokenExpiresAt!).toLocaleDateString()}. Reconnect to renew.
                  </p>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  {connected && platform ? (
                    <>
                      <button className="btn-outline" disabled={working} onClick={() => testConnection(platform)}>Test connection</button>
                      <button className="btn-outline" disabled={working} onClick={() => openAccounts(platform)}>Change account</button>
                      {oauth && <button className="btn-outline" disabled={working} onClick={() => connectWithOAuth(type)}>Reconnect</button>}
                      <button className="btn-outline text-red-700" disabled={working} onClick={() => disconnect(platform)}>Disconnect</button>
                    </>
                  ) : (
                    <>
                      {oauth && (
                        <button className="btn-primary" disabled={working} onClick={() => connectWithOAuth(type)}>
                          {working ? 'Opening…' : `Connect with ${PLATFORM_LABELS[type]}`}
                        </button>
                      )}
                      <button className={oauth ? 'btn-outline' : 'btn-primary'} disabled={working} onClick={() => { setManualFor(type); setFormValues({}) }}>
                        Enter credentials manually
                      </button>
                    </>
                  )}
                </div>
                {!connected && !oauth && (
                  <p className="mt-3 text-xs text-gray-500">One-click login needs the app credentials for {PLATFORM_LABELS[type]} on the server (see docs/INTEGRATIONS.md).</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Manual credentials */}
      {manualFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-600 bg-opacity-75 p-4" role="dialog" aria-modal="true">
          <form onSubmit={submitManual} className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Connect {PLATFORM_LABELS[manualFor]}</h3>
              <button type="button" onClick={() => setManualFor(null)} aria-label="Close"><XMarkIcon className="h-6 w-6 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">These are checked against {PLATFORM_LABELS[manualFor]} right now. Wrong values are rejected and nothing is saved.</p>
            <div className="space-y-4">
              {MANUAL_FIELDS[manualFor].map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={field.key}>
                    {field.label}{field.optional && <span className="text-gray-400"> (optional)</span>}
                  </label>
                  <input
                    id={field.key}
                    className="input"
                    type={field.secret ? 'password' : 'text'}
                    autoComplete="off"
                    required={!field.optional}
                    value={formValues[field.key] || ''}
                    onChange={(e) => setFormValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  />
                  {field.help && <p className="mt-1 text-xs text-gray-500">{field.help}</p>}
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn-outline" onClick={() => setManualFor(null)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy === manualFor}>{busy === manualFor ? 'Verifying…' : 'Verify and connect'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Switch account / page */}
      {accountsFor && options && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-600 bg-opacity-75 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Choose account for {PLATFORM_LABELS[accountsFor.type]}</h3>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="account">Ad account</label>
            <select id="account" className="input" value={choice.accountId} onChange={(e) => setChoice((c) => ({ ...c, accountId: e.target.value }))}>
              {options.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
            </select>
            {options.pages && (
              <>
                <label className="block text-sm font-medium text-gray-700 mt-4 mb-1" htmlFor="page">Facebook Page</label>
                <select id="page" className="input" value={choice.pageId} onChange={(e) => setChoice((c) => ({ ...c, pageId: e.target.value }))}>
                  {options.pages.map((p) => (
                    <option key={p.id} value={p.id} disabled={accountsFor.type === 'instagram' && !p.instagramUserId}>
                      {p.name}{p.instagramUsername ? ` (@${p.instagramUsername})` : ''}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button className="btn-outline" onClick={() => setAccountsFor(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveAccount}>Save</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

export default function IntegrationsPage() {
  // useSearchParams needs a Suspense boundary in the App Router
  return (
    <Suspense fallback={null}>
      <IntegrationsContent />
    </Suspense>
  )
}
