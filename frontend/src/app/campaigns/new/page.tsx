'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { ArrowLeftIcon, SparklesIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/DashboardLayout'
import api from '@/lib/api'
import { COUNTRIES } from '@/lib/countries'
import { API_URL, PLATFORM_LABELS } from '@/lib/format'
import type { AdCopyResult, CallToAction, CreateCampaignData, Media, Objective, Platform } from '@/types'

const CTAS: { value: CallToAction; label: string }[] = [
  { value: 'LEARN_MORE', label: 'Learn more' },
  { value: 'SHOP_NOW', label: 'Shop now' },
  { value: 'SIGN_UP', label: 'Sign up' },
  { value: 'CONTACT_US', label: 'Contact us' },
  { value: 'DOWNLOAD', label: 'Download' },
  { value: 'GET_QUOTE', label: 'Get a quote' },
]

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)

export default function NewCampaignPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [media, setMedia] = useState<Media[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [selectedMedia, setSelectedMedia] = useState<string[]>([])

  const [form, setForm] = useState({
    title: '',
    objective: 'TRAFFIC' as Objective,
    budget: 20,
    budgetType: 'daily' as 'daily' | 'lifetime',
    scheduleStart: '',
    scheduleEnd: '',
    destinationUrl: '',
    headline: '',
    adCopy: '',
    callToAction: 'LEARN_MORE' as CallToAction,
    extraHeadlines: '',
    extraDescriptions: '',
    countries: ['US'] as string[],
    ageMin: 18,
    ageMax: 65,
    keywords: '',
    publishPaused: true,
  })

  // AI copy
  const [aiEnabled, setAiEnabled] = useState(false)
  const [ai, setAi] = useState({ productName: '', description: '', audience: '', tone: 'friendly' })
  const [aiBusy, setAiBusy] = useState(false)
  const [aiResult, setAiResult] = useState<AdCopyResult | null>(null)

  useEffect(() => {
    api.get('/api/platforms/connected').then((r) => setPlatforms(r.data.platforms || []))
    api.get('/api/media').then((r) => setMedia((r.data.media || []).filter((m: Media) => m.mime_type.startsWith('image/') || m.mime_type.startsWith('video/'))))
    api.get('/api/ai/status').then((r) => setAiEnabled(Boolean(r.data.enabled))).catch(() => setAiEnabled(false))
  }, [])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const types = new Set(platforms.filter((p) => selectedPlatforms.includes(p.id)).map((p) => p.type))
  const needsKeywords = types.has('google')
  const needsVideo = types.has('tiktok')
  const needsImage = types.has('facebook') || types.has('instagram')

  async function generateCopy() {
    setAiBusy(true)
    try {
      const { data } = await api.post('/api/ai/ad-copy', {
        productName: ai.productName,
        description: ai.description,
        objective: form.objective,
        tone: ai.tone,
        ...(ai.audience ? { audience: ai.audience } : {}),
      })
      setAiResult(data)
    } finally {
      setAiBusy(false)
    }
  }

  function applyCopy(result: AdCopyResult) {
    setForm((f) => ({
      ...f,
      headline: result.headlines[0],
      adCopy: result.primaryTexts[0],
      callToAction: result.callToAction,
      extraHeadlines: result.headlines.slice(1).join('\n'),
      extraDescriptions: result.descriptions.join('\n'),
    }))
    toast.success('Copy applied. Edit anything you like below.')
  }

  function buildPayload(): CreateCampaignData {
    const extraHeadlines = lines(form.extraHeadlines)
    const extraDescriptions = lines(form.extraDescriptions)
    return {
      title: form.title,
      budget: Number(form.budget),
      budgetType: form.budgetType,
      objective: form.objective,
      ...(form.scheduleStart ? { scheduleStart: form.scheduleStart } : {}),
      ...(form.scheduleEnd ? { scheduleEnd: form.scheduleEnd } : {}),
      ...(form.destinationUrl ? { destinationUrl: form.destinationUrl } : {}),
      ...(form.headline ? { headline: form.headline } : {}),
      ...(form.adCopy ? { adCopy: form.adCopy } : {}),
      callToAction: form.callToAction,
      targeting: {
        countries: form.countries,
        ageMin: Number(form.ageMin),
        ageMax: Number(form.ageMax),
        keywords: form.keywords.split(/[\n,]/).map((k) => k.trim()).filter(Boolean),
      },
      ...(extraHeadlines.length || extraDescriptions.length ? { variants: { headlines: extraHeadlines, descriptions: extraDescriptions } } : {}),
      publishPaused: form.publishPaused,
      platforms: selectedPlatforms,
      mediaIds: selectedMedia,
    }
  }

  async function submit(publish: boolean) {
    if (selectedPlatforms.length === 0) {
      toast.error('Select at least one connected platform')
      return
    }
    setSaving(true)
    try {
      const { data } = await api.post('/api/campaigns', buildPayload())
      if (publish) {
        await api.post(`/api/campaigns/${data.campaign.id}/publish`, {})
        toast.success('Publishing started')
      } else {
        toast.success('Draft saved')
      }
      router.push('/campaigns')
    } catch {
      // the API interceptor already showed the reason
    } finally {
      setSaving(false)
    }
  }

  const section = 'bg-white rounded-lg shadow p-6 mb-6'
  const label = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-4xl">
        <Link href="/campaigns" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4">
          <ArrowLeftIcon className="h-4 w-4 mr-1" /> Back to campaigns
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mb-8">New campaign</h1>

        <form onSubmit={(e) => { e.preventDefault(); submit(false) }}>
          {/* Basics */}
          <div className={section}>
            <h2 className="text-lg font-semibold mb-4">Basics</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="title">Campaign name</label>
                <input id="title" className="input" required maxLength={150} value={form.title} onChange={(e) => set('title', e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="objective">Goal</label>
                <select id="objective" className="input" value={form.objective} onChange={(e) => set('objective', e.target.value as Objective)}>
                  <option value="TRAFFIC">Website traffic (clicks)</option>
                  <option value="AWARENESS">Awareness (reach)</option>
                </select>
              </div>
            </div>

            <p className={`${label} mt-5`}>Platforms</p>
            {platforms.length === 0 ? (
              <p className="text-sm text-gray-600">
                No connected platforms yet. <Link href="/integrations" className="text-primary-600 underline">Connect one first</Link>.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {platforms.map((p) => (
                  <label key={p.id} className={`flex items-center px-3 py-2 rounded-md border cursor-pointer ${selectedPlatforms.includes(p.id) ? 'border-primary-600 bg-primary-50' : 'border-gray-300'}`}>
                    <input type="checkbox" className="mr-2" checked={selectedPlatforms.includes(p.id)} onChange={() => setSelectedPlatforms((l) => toggle(l, p.id))} />
                    {PLATFORM_LABELS[p.type]} <span className="ml-1 text-xs text-gray-500">{p.config.accountName}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Budget */}
          <div className={section}>
            <h2 className="text-lg font-semibold mb-4">Budget and schedule</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={label} htmlFor="budget">Budget (in your ad account currency)</label>
                <input id="budget" type="number" min="1" step="0.01" required className="input" value={form.budget} onChange={(e) => set('budget', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className={label} htmlFor="budgetType">Budget type</label>
                <select id="budgetType" className="input" value={form.budgetType} onChange={(e) => set('budgetType', e.target.value as 'daily' | 'lifetime')}>
                  <option value="daily">Per day</option>
                  <option value="lifetime">Total for the whole run (needs an end date)</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="start">Start date <span className="text-gray-400">(optional)</span></label>
                <input id="start" type="date" className="input" value={form.scheduleStart} onChange={(e) => set('scheduleStart', e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="end">End date {form.budgetType === 'lifetime' ? '' : <span className="text-gray-400">(optional)</span>}</label>
                <input id="end" type="date" className="input" required={form.budgetType === 'lifetime'} value={form.scheduleEnd} onChange={(e) => set('scheduleEnd', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Creative */}
          <div className={section}>
            <h2 className="text-lg font-semibold mb-4">Ad creative</h2>

            {aiEnabled && (
              <div className="rounded-md border border-purple-200 bg-purple-50 p-4 mb-6">
                <p className="flex items-center font-medium text-purple-900 mb-3"><SparklesIcon className="h-5 w-5 mr-2" />Write the copy with AI</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input className="input" placeholder="Product or business name" value={ai.productName} onChange={(e) => setAi({ ...ai, productName: e.target.value })} aria-label="Product name" />
                  <select className="input" value={ai.tone} onChange={(e) => setAi({ ...ai, tone: e.target.value })} aria-label="Tone">
                    {['friendly', 'professional', 'playful', 'urgent', 'luxury'].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)} tone</option>)}
                  </select>
                  <textarea className="input sm:col-span-2" rows={2} placeholder="What do you sell, and why is it good? (a sentence or two)" value={ai.description} onChange={(e) => setAi({ ...ai, description: e.target.value })} aria-label="Product description" />
                  <input className="input sm:col-span-2" placeholder="Who is it for? (optional)" value={ai.audience} onChange={(e) => setAi({ ...ai, audience: e.target.value })} aria-label="Audience" />
                </div>
                <button type="button" className="btn-primary mt-3" disabled={aiBusy || !ai.productName || ai.description.length < 10} onClick={generateCopy}>
                  {aiBusy ? 'Writing…' : aiResult ? 'Write again' : 'Generate copy'}
                </button>

                {aiResult && (
                  <div className="mt-4 text-sm bg-white rounded-md p-4 border border-purple-100">
                    <p className="font-medium text-gray-700">Headlines</p>
                    <ul className="mb-3 space-y-1">{aiResult.headlines.map((h) => (
                      <li key={h}><button type="button" className="text-left hover:text-primary-600" onClick={() => set('headline', h)}>{h}</button> <span className="text-gray-400">({h.length})</span></li>
                    ))}</ul>
                    <p className="font-medium text-gray-700">Ad text</p>
                    <ul className="mb-3 space-y-1">{aiResult.primaryTexts.map((t) => (
                      <li key={t}><button type="button" className="text-left hover:text-primary-600" onClick={() => set('adCopy', t)}>{t}</button> <span className="text-gray-400">({t.length})</span></li>
                    ))}</ul>
                    <button type="button" className="btn-outline" onClick={() => applyCopy(aiResult)}>Use this copy</button>
                    <p className="mt-2 text-xs text-gray-500">AI can be wrong or too confident. Check every claim before you publish. Click a line to use it as the main headline or ad text.</p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className={label} htmlFor="url">Destination URL</label>
                <input id="url" type="url" className="input" placeholder="https://example.com/offer" value={form.destinationUrl} onChange={(e) => set('destinationUrl', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={label} htmlFor="headline">Headline <span className="text-gray-400">({form.headline.length}/30 fits every platform)</span></label>
                  <input id="headline" className="input" maxLength={40} value={form.headline} onChange={(e) => set('headline', e.target.value)} />
                </div>
                <div>
                  <label className={label} htmlFor="cta">Button</label>
                  <select id="cta" className="input" value={form.callToAction} onChange={(e) => set('callToAction', e.target.value as CallToAction)}>
                    {CTAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={label} htmlFor="copy">Ad text <span className="text-gray-400">({form.adCopy.length}/100 fits TikTok)</span></label>
                <textarea id="copy" className="input" rows={3} maxLength={2200} value={form.adCopy} onChange={(e) => set('adCopy', e.target.value)} />
              </div>
              {needsKeywords && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={label} htmlFor="eh">More headlines for Google <span className="text-gray-400">(one per line, max 30 characters)</span></label>
                    <textarea id="eh" className="input" rows={4} value={form.extraHeadlines} onChange={(e) => set('extraHeadlines', e.target.value)} />
                  </div>
                  <div>
                    <label className={label} htmlFor="ed">Descriptions for Google <span className="text-gray-400">(one per line, max 90)</span></label>
                    <textarea id="ed" className="input" rows={4} value={form.extraDescriptions} onChange={(e) => set('extraDescriptions', e.target.value)} />
                  </div>
                  <p className="sm:col-span-2 text-xs text-gray-500">Google needs at least 3 headlines and 2 descriptions in total.</p>
                </div>
              )}
            </div>

            <p className={`${label} mt-6`}>Media</p>
            {media.length === 0 ? (
              <p className="text-sm text-gray-600">No images or videos yet. <Link href="/media" className="text-primary-600 underline">Upload some</Link>.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {media.map((m) => (
                  <label key={m.id} className={`relative rounded-md overflow-hidden border-2 cursor-pointer ${selectedMedia.includes(m.id) ? 'border-primary-600' : 'border-transparent'}`}>
                    <input type="checkbox" className="absolute top-2 left-2 z-10" checked={selectedMedia.includes(m.id)} onChange={() => setSelectedMedia((l) => toggle(l, m.id))} />
                    {m.mime_type.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${API_URL}${m.url}`} alt={m.original_name} className="h-24 w-full object-cover" />
                    ) : (
                      <div className="h-24 flex items-center justify-center bg-gray-100 text-xs text-gray-600 px-1 text-center">Video<br />{m.original_name}</div>
                    )}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500">
              {needsImage && 'Facebook/Instagram use the first image. '}
              {needsVideo && 'TikTok requires a video. '}
              {needsKeywords && 'Google Search ads are text only.'}
            </p>
          </div>

          {/* Targeting */}
          <div className={section}>
            <h2 className="text-lg font-semibold mb-4">Audience</h2>
            <p className={label}>Countries</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(COUNTRIES).map(([code, name]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => set('countries', toggle(form.countries, code))}
                  className={`px-2.5 py-1 text-sm rounded-full border ${form.countries.includes(code) ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300'}`}
                  aria-pressed={form.countries.includes(code)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-xs">
              <div>
                <label className={label} htmlFor="amin">Age from</label>
                <input id="amin" type="number" min={18} max={65} className="input" value={form.ageMin} onChange={(e) => set('ageMin', parseInt(e.target.value) || 18)} />
              </div>
              <div>
                <label className={label} htmlFor="amax">to</label>
                <input id="amax" type="number" min={18} max={65} className="input" value={form.ageMax} onChange={(e) => set('ageMax', parseInt(e.target.value) || 65)} />
              </div>
            </div>
            {needsKeywords && (
              <div className="mt-4">
                <label className={label} htmlFor="kw">Google keywords <span className="text-gray-400">(comma or one per line)</span></label>
                <textarea id="kw" className="input" rows={2} placeholder="fresh coffee, coffee subscription" value={form.keywords} onChange={(e) => set('keywords', e.target.value)} />
              </div>
            )}
          </div>

          {/* Safety */}
          <div className={section}>
            <label className="flex items-start">
              <input type="checkbox" className="mt-1 mr-3" checked={form.publishPaused} onChange={(e) => set('publishPaused', e.target.checked)} />
              <span>
                <span className="font-medium text-gray-900">Create ads paused (recommended)</span>
                <span className="block text-sm text-gray-600">Ads are created on the platforms but do not run or spend money until you press Activate. Untick only if you want them to go live straight away.</span>
              </span>
            </label>
          </div>

          <div className="flex justify-end gap-3">
            <Link href="/campaigns" className="btn-outline">Cancel</Link>
            <button type="submit" className="btn-outline" disabled={saving}>Save draft</button>
            <button type="button" className="btn-primary" disabled={saving} onClick={() => submit(true)}>
              {saving ? 'Working…' : 'Create and publish'}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  )
}
