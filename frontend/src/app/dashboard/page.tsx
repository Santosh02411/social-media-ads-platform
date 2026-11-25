'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import toast from 'react-hot-toast'
import {
  ArrowPathIcon,
  CursorArrowRaysIcon,
  CurrencyDollarIcon,
  EyeIcon,
  PercentBadgeIcon,
  PlusIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/DashboardLayout'
import api from '@/lib/api'
import {
  PLATFORM_LABELS,
  formatChange,
  formatMoney,
  formatNumber,
  formatPercent,
  timeAgo,
} from '@/lib/format'
import type { AnalyticsSummary, StatusOverview } from '@/types'

const RANGES = [7, 30, 90]

function Delta({ change, days }: { change: number | null; days: number }) {
  const text = formatChange(change)
  if (!text) return <span className="text-sm text-gray-400">No data for the previous {days} days</span>
  return (
    <span className={`text-sm ${change! >= 0 ? 'text-green-600' : 'text-red-600'}`}>
      {text} <span className="text-gray-500">vs previous {days} days</span>
    </span>
  )
}

export default function DashboardPage() {
  const [days, setDays] = useState(7)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [overview, setOverview] = useState<StatusOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [analytics, status] = await Promise.all([
        api.get(`/api/analytics/summary?days=${days}`),
        api.get('/api/status/overview'),
      ])
      setSummary(analytics.data)
      setOverview(status.data)
    } catch (error) {
      console.error('Failed to load dashboard:', error)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Ask the platforms for fresh numbers, then reload what the worker saved
  const refresh = async () => {
    setRefreshing(true)
    try {
      const { data } = await api.post('/api/analytics/sync')
      if (data.queued === 0) {
        toast('Nothing to sync yet: publish a campaign first.')
      } else {
        toast.success(`Syncing ${data.queued} campaign${data.queued === 1 ? '' : 's'} with the ad platforms…`)
        setTimeout(load, 6000)
      }
    } finally {
      setRefreshing(false)
    }
  }

  const currency = summary?.currency || 'USD'
  const money = (n: number) => formatMoney(n, currency)

  const kpis = summary
    ? [
        { name: 'Spend', value: money(summary.totals.spend), change: summary.changes.spend, icon: CurrencyDollarIcon, color: 'bg-yellow-500' },
        { name: 'Impressions', value: formatNumber(summary.totals.impressions), change: summary.changes.impressions, icon: EyeIcon, color: 'bg-blue-500' },
        { name: 'Clicks', value: formatNumber(summary.totals.clicks), change: summary.changes.clicks, icon: CursorArrowRaysIcon, color: 'bg-green-500' },
        { name: 'CTR', value: formatPercent(summary.totals.ctr), change: summary.changes.ctr, icon: PercentBadgeIcon, color: 'bg-purple-500' },
      ]
    : []

  const failedJobs = overview?.jobs.failed_jobs || 0

  if (loading) {
    return (
      <DashboardLayout>
        <div className="animate-pulse px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-lg shadow h-28" />
            ))}
          </div>
          <div className="bg-white rounded-lg shadow h-80" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="mt-2 text-gray-600">
              Performance pulled from your ad platforms · last synced {timeAgo(summary?.lastSyncedAt)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-md shadow-sm" role="group" aria-label="Date range">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  className={`px-3 py-2 text-sm font-medium border first:rounded-l-md last:rounded-r-md -ml-px first:ml-0 ${
                    days === r ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {r}d
                </button>
              ))}
            </div>
            <button onClick={refresh} disabled={refreshing} className="btn-outline" title="Fetch the latest numbers from the platforms">
              <ArrowPathIcon className={`h-5 w-5 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Sync
            </button>
            <Link href="/campaigns/new" className="btn-primary">
              <PlusIcon className="h-5 w-5 mr-2" />
              New Campaign
            </Link>
          </div>
        </div>

        {failedJobs > 0 && (
          <div className="mb-6 rounded-md bg-red-50 p-4 flex items-start">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-500 mt-0.5 mr-3" />
            <p className="text-sm text-red-800">
              {failedJobs} publishing {failedJobs === 1 ? 'job has' : 'jobs have'} failed.{' '}
              <Link href="/status" className="font-medium underline">See why and retry</Link>
            </p>
          </div>
        )}

        {summary?.mixedCurrencies && (
          <div className="mb-6 rounded-md bg-yellow-50 p-4 text-sm text-yellow-800">
            Your ad accounts use different currencies. Spend totals add the raw amounts together, so treat them as approximate.
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {kpis.map((kpi) => {
            const Icon = kpi.icon
            return (
              <div key={kpi.name} className="bg-white p-6 rounded-lg shadow">
                <div className="flex items-center">
                  <div className={`${kpi.color} p-3 rounded-lg`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-600">{kpi.name}</p>
                    <p className="text-2xl font-semibold text-gray-900">{summary?.hasData ? kpi.value : '–'}</p>
                  </div>
                </div>
                <div className="mt-4">
                  {summary?.hasData ? <Delta change={kpi.change} days={days} /> : <span className="text-sm text-gray-400">No data yet</span>}
                </div>
              </div>
            )
          })}
        </div>

        {!summary?.hasData ? (
          <div className="bg-white rounded-lg shadow p-10 text-center mb-8">
            <h2 className="text-lg font-semibold text-gray-900">No performance data yet</h2>
            <p className="mt-2 text-gray-600 max-w-xl mx-auto">
              Numbers appear here after a campaign is published, activated and has delivered impressions. They come straight from
              Facebook, Instagram, Google Ads and TikTok, nothing is estimated.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/integrations" className="btn-outline">Connect a platform</Link>
              <Link href="/campaigns" className="btn-primary">Go to campaigns</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Spend and clicks, last {days} days</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={summary.series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                    <YAxis yAxisId="spend" fontSize={12} tickFormatter={(v: number) => money(v)} width={70} />
                    <YAxis yAxisId="clicks" orientation="right" fontSize={12} width={50} />
                    <Tooltip formatter={(value: number, name: string) => (name === 'Spend' ? money(value) : formatNumber(value))} />
                    <Legend />
                    <Line yAxisId="spend" type="monotone" dataKey="spend" name="Spend" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line yAxisId="clicks" type="monotone" dataKey="clicks" name="Clicks" stroke="#16a34a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Spend by platform</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summary.byPlatform.map((p) => ({ ...p, name: PLATFORM_LABELS[p.platform] || p.platform }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" fontSize={12} />
                      <YAxis fontSize={12} tickFormatter={(v: number) => money(v)} width={70} />
                      <Tooltip formatter={(value: number) => money(value)} />
                      <Bar dataKey="spend" name="Spend" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Top campaigns by spend</h2>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="pb-2 font-medium">Campaign</th>
                      <th className="pb-2 font-medium text-right">Spend</th>
                      <th className="pb-2 font-medium text-right">Clicks</th>
                      <th className="pb-2 font-medium text-right">CTR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.topCampaigns.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2 text-gray-900 truncate max-w-[12rem]">{c.title}</td>
                        <td className="py-2 text-right">{money(c.spend)}</td>
                        <td className="py-2 text-right">{formatNumber(c.clicks)}</td>
                        <td className="py-2 text-right">{c.impressions ? formatPercent((c.clicks / c.impressions) * 100) : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Account state */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          <Link href="/campaigns" className="bg-white p-5 rounded-lg shadow hover:shadow-md transition-shadow">
            <p className="text-sm text-gray-600">Active campaigns</p>
            <p className="text-2xl font-semibold text-gray-900">{overview?.campaigns.active_campaigns || 0}</p>
            <p className="text-xs text-gray-500 mt-1">{overview?.campaigns.draft_campaigns || 0} drafts · {overview?.campaigns.paused_campaigns || 0} paused</p>
          </Link>
          <Link href="/integrations" className="bg-white p-5 rounded-lg shadow hover:shadow-md transition-shadow">
            <p className="text-sm text-gray-600">Connected platforms</p>
            <p className="text-2xl font-semibold text-gray-900">{overview?.platforms.connected_platforms || 0}</p>
            <p className="text-xs text-gray-500 mt-1">{overview?.platforms.total_platforms || 0} added in total</p>
          </Link>
          <Link href="/status" className="bg-white p-5 rounded-lg shadow hover:shadow-md transition-shadow">
            <p className="text-sm text-gray-600">Publishing jobs</p>
            <p className="text-2xl font-semibold text-gray-900">{overview?.jobs.success_jobs || 0} done</p>
            <p className="text-xs text-gray-500 mt-1">{overview?.jobs.pending_jobs || 0} waiting · {failedJobs} failed</p>
          </Link>
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent activity</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {(overview?.recentActivity || []).length === 0 && (
              <li className="px-6 py-8 text-center text-gray-500">Nothing yet.</li>
            )}
            {(overview?.recentActivity || []).map((log, i) => (
              <li key={i} className="px-6 py-3 flex items-center justify-between text-sm">
                <span className="flex items-center">
                  <span className={`h-2 w-2 rounded-full mr-3 ${log.level === 'error' ? 'bg-red-500' : log.level === 'warn' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                  <span className="text-gray-900">{log.message}</span>
                </span>
                <span className="text-gray-500">{timeAgo(log.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </DashboardLayout>
  )
}
