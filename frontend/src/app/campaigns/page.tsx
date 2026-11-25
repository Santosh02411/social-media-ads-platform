'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  CubeIcon,
  DocumentDuplicateIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RocketLaunchIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/DashboardLayout'
import api from '@/lib/api'
import { PLATFORM_LABELS } from '@/lib/format'
import type { Campaign, CampaignPlatform } from '@/types'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  publishing: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-blue-100 text-blue-800',
}

const PLATFORM_STATUS: Record<CampaignPlatform['status'], { label: string; style: string }> = {
  pending: { label: 'queued', style: 'bg-gray-100 text-gray-700' },
  processing: { label: 'publishing…', style: 'bg-blue-100 text-blue-800' },
  retrying: { label: 'retrying…', style: 'bg-yellow-100 text-yellow-800' },
  success: { label: 'created', style: 'bg-green-100 text-green-800' },
  failed: { label: 'failed', style: 'bg-red-100 text-red-800' },
}

const isBusy = (c: Campaign) =>
  c.status === 'publishing' || (c.platforms || []).some((p) => ['pending', 'processing', 'retrying'].includes(p.status))

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [acting, setActing] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The list endpoint has per-platform counts only; load details for campaigns that are in flight
  const fetchCampaigns = useCallback(async () => {
    try {
      const { data } = await api.get('/api/campaigns')
      const list: Campaign[] = data.campaigns || []
      const detailed = await Promise.all(
        list.map(async (c) => {
          if (c.status === 'draft' && !c.platform_count) return c
          const detail = await api.get(`/api/campaigns/${c.id}`)
          return { ...c, ...detail.data.campaign } as Campaign
        })
      )
      setCampaigns(detailed)
    } catch (error) {
      console.error('Failed to fetch campaigns:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCampaigns() }, [fetchCampaigns])

  // Poll while the worker is publishing or switching ads on/off
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (campaigns.some(isBusy)) timer.current = setTimeout(fetchCampaigns, 2500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [campaigns, fetchCampaigns])

  async function run(campaign: Campaign, action: 'publish' | 'activate' | 'pause', message: string) {
    setActing(campaign.id)
    try {
      const { data } = await api.post(`/api/campaigns/${campaign.id}/${action}`, {})
      toast.success(data.message || message)
      await fetchCampaigns()
    } catch {
      // interceptor shows the reason
    } finally {
      setActing(null)
    }
  }

  async function duplicate(campaign: Campaign) {
    const newTitle = prompt('Title for the copy:', `${campaign.title} (copy)`)
    if (!newTitle) return
    await api.post(`/api/campaigns/${campaign.id}/duplicate`, { newTitle })
    await fetchCampaigns()
  }

  async function remove(campaign: Campaign) {
    if (!confirm(`Delete "${campaign.title}"?`)) return
    try {
      const { data } = await api.delete(`/api/campaigns/${campaign.id}`)
      if (data.warning) toast(data.warning, { duration: 8000 })
      await fetchCampaigns()
    } catch {
      // e.g. "Pause the campaign before deleting it"
    }
  }

  const filtered = campaigns.filter((c) => {
    const text = `${c.title} ${c.description || ''}`.toLowerCase()
    return text.includes(searchTerm.toLowerCase()) && (filterStatus === 'all' || c.status === filterStatus)
  })

  if (loading) {
    return (
      <DashboardLayout>
        <div className="animate-pulse px-4 sm:px-6 lg:px-8 py-8 space-y-4">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-lg shadow h-28" />)}
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Campaigns</h1>
            <p className="mt-2 text-gray-600">Create, publish and control your ads across every connected platform.</p>
          </div>
          <Link href="/campaigns/new" className="btn-primary"><PlusIcon className="h-5 w-5 mr-2" />New Campaign</Link>
        </div>

        <div className="bg-white p-4 rounded-lg shadow mb-6 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input className="input pl-10" placeholder="Search campaigns…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} aria-label="Search campaigns" />
          </div>
          <select className="input sm:w-48" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {Object.keys(STATUS_STYLES).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <CubeIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">{campaigns.length === 0 ? 'No campaigns yet' : 'No campaigns match'}</h3>
            {campaigns.length === 0 && (
              <Link href="/campaigns/new" className="btn-primary mt-6 inline-flex"><PlusIcon className="h-5 w-5 mr-2" />Create your first campaign</Link>
            )}
          </div>
        ) : (
          <ul className="space-y-4">
            {filtered.map((c) => {
              const platforms = c.platforms || []
              const published = platforms.filter((p) => p.status === 'success').length
              const hasFailed = platforms.some((p) => p.status === 'failed')
              const busy = isBusy(c) || acting === c.id
              const canPublish = c.status !== 'publishing' && platforms.some((p) => p.status !== 'success')

              return (
                <li key={c.id} className="bg-white rounded-lg shadow p-6">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-gray-900 truncate">{c.title}</h2>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[c.status] || STATUS_STYLES.draft}`}>
                          {c.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {Number(c.budget).toFixed(2)} {c.budget_type === 'daily' ? 'per day' : 'total'} · {c.objective === 'TRAFFIC' ? 'Traffic' : 'Awareness'} · {c.targeting?.countries?.join(', ')}
                      </p>
                      {c.destination_url && <p className="mt-1 text-sm text-gray-500 truncate">{c.headline} → {c.destination_url}</p>}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {canPublish && (
                        <button className="btn-primary" disabled={busy} onClick={() => run(c, 'publish', 'Publishing started')}>
                          <RocketLaunchIcon className="h-4 w-4 mr-1" />{hasFailed ? 'Retry failed' : 'Publish'}
                        </button>
                      )}
                      {published > 0 && c.status === 'paused' && (
                        <button className="btn-success" disabled={busy} onClick={() => run(c, 'activate', 'Activation requested')}>
                          <PlayIcon className="h-4 w-4 mr-1" />Activate
                        </button>
                      )}
                      {published > 0 && c.status === 'active' && (
                        <button className="btn-warning" disabled={busy} onClick={() => run(c, 'pause', 'Pause requested')}>
                          <PauseIcon className="h-4 w-4 mr-1" />Pause
                        </button>
                      )}
                      <button className="btn-outline" disabled={busy} onClick={() => duplicate(c)} title="Duplicate"><DocumentDuplicateIcon className="h-4 w-4" /></button>
                      <button className="btn-outline text-red-700" disabled={busy} onClick={() => remove(c)} title="Delete"><TrashIcon className="h-4 w-4" /></button>
                    </div>
                  </div>

                  {platforms.length > 0 && (
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {platforms.map((p) => {
                          const state = PLATFORM_STATUS[p.status] || PLATFORM_STATUS.pending
                          return (
                            <li key={p.id} className="text-sm">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-800">{PLATFORM_LABELS[p.platformType] || p.platformType}</span>
                                <span className={`px-2 py-0.5 rounded-full text-xs ${state.style}`}>{state.label}</span>
                              </div>
                              {p.errorMessage && <p className={`mt-1 text-xs ${p.status === 'failed' ? 'text-red-700' : 'text-yellow-700'}`}>{p.errorMessage}</p>}
                            </li>
                          )
                        })}
                      </ul>
                      {c.status === 'paused' && published > 0 && (
                        <p className="mt-3 text-xs text-gray-500">Ads exist on the platforms but are paused: nothing is running or spending until you activate.</p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DashboardLayout>
  )
}
