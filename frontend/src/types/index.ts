// User types
export interface User {
  id: string
  email: string
  created_at?: string
  updated_at?: string
}

// Platform types (the API never returns credentials, only this safe summary)
export interface PlatformConfigSummary {
  connectedAt: string | null
  disconnectedAt: string | null
  accountHint: string | null
  accountName: string | null
  currency: string | null
  tokenExpiresAt: string | null
  authMethod: 'oauth' | 'manual' | null
}

export type PlatformType = 'facebook' | 'google' | 'tiktok' | 'instagram'

export interface Platform {
  id: string
  name: string
  type: PlatformType
  config: PlatformConfigSummary
  user_id: string
  is_connected: boolean
  created_at: string
  updated_at: string
}

export interface PlatformProviders {
  providers: Record<PlatformType, { oauth: boolean }>
  sandbox: boolean
}

export interface AccountOption { id: string; name: string; currency?: string }
export interface PageOption { id: string; name: string; instagramUserId: string | null; instagramUsername: string | null }

// Campaign types
export type CampaignState = 'draft' | 'publishing' | 'active' | 'paused' | 'completed'
export type Objective = 'TRAFFIC' | 'AWARENESS'
export type CallToAction = 'LEARN_MORE' | 'SHOP_NOW' | 'SIGN_UP' | 'CONTACT_US' | 'DOWNLOAD' | 'GET_QUOTE'

export interface Targeting {
  countries: string[]
  ageMin: number
  ageMax: number
  keywords: string[]
}

export interface Campaign {
  id: string
  title: string
  description?: string | null
  budget: number
  budget_type: 'daily' | 'lifetime'
  objective: Objective
  status: CampaignState
  schedule_start?: string | null
  schedule_end?: string | null
  destination_url?: string | null
  headline?: string | null
  ad_copy?: string | null
  call_to_action: CallToAction
  targeting: Targeting
  variants: { headlines: string[]; descriptions: string[] }
  publish_paused: boolean
  user_id: string
  created_at: string
  updated_at: string
  platforms?: CampaignPlatform[]
  platform_count?: number
  success_count?: number
  failed_count?: number
}

export interface CampaignPlatform {
  id: string
  platformId: string
  platformName: string
  platformType: PlatformType
  status: 'pending' | 'processing' | 'success' | 'failed' | 'retrying'
  errorMessage?: string | null
  retryCount: number
  externalId?: string | null
  publishedAt?: string | null
}

export interface CreateCampaignData {
  title: string
  budget: number
  budgetType: 'daily' | 'lifetime'
  objective: Objective
  scheduleStart?: string
  scheduleEnd?: string
  destinationUrl?: string
  headline?: string
  adCopy?: string
  callToAction: CallToAction
  targeting: Targeting
  variants?: { headlines: string[]; descriptions: string[] }
  publishPaused: boolean
  platforms: string[]
  mediaIds: string[]
}

// AI + analytics
export interface AdCopyResult {
  headlines: string[]
  descriptions: string[]
  primaryTexts: string[]
  callToAction: CallToAction
}

export interface AnalyticsTotals { impressions: number; clicks: number; spend: number; conversions: number; ctr: number; cpc: number }
export interface AnalyticsSummary {
  days: number
  totals: AnalyticsTotals
  changes: { impressions: number | null; clicks: number | null; spend: number | null; ctr: number | null }
  series: { date: string; impressions: number; clicks: number; spend: number }[]
  byPlatform: { platform: PlatformType; impressions: number; clicks: number; spend: number }[]
  topCampaigns: { id: string; title: string; impressions: number; clicks: number; spend: number }[]
  currency: string | null
  mixedCurrencies: boolean
  hasData: boolean
  lastSyncedAt: string | null
}

// Media types
export interface Media {
  id: string
  filename: string
  original_name: string
  mime_type: string
  size: number
  url: string
  user_id: string
  created_at: string
  updated_at: string
}

export interface CampaignMedia {
  id: string
  campaign_id: string
  media_id: string
  media_type: 'image' | 'video' | 'text'
  ad_copy?: string
  created_at: string
  filename: string
  original_name: string
  mime_type: string
  size: number
  url: string
}

// Job types
export interface Job {
  id: string
  campaign_id: string
  platform_id: string
  action: 'publish' | 'update' | 'delete'
  status: 'pending' | 'processing' | 'success' | 'failed'
  error_message?: string
  retry_count: number
  scheduled_at: string
  processed_at?: string
  created_at: string
  updated_at: string
  campaign_title?: string
  platform_name?: string
}

// Log types
export interface Log {
  id: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  context: Record<string, any>
  user_id?: string
  campaign_id?: string
  platform_id?: string
  created_at: string
}

// Status types
export interface StatusOverview {
  campaigns: {
    total_campaigns: number
    active_campaigns: number
    draft_campaigns: number
    paused_campaigns: number
    completed_campaigns: number
    total_budget: number
  }
  platforms: {
    total_platforms: number
    connected_platforms: number
    disconnected_platforms: number
  }
  jobs: {
    total_jobs: number
    pending_jobs: number
    processing_jobs: number
    success_jobs: number
    failed_jobs: number
  }
  recentActivity: Log[]
}

export interface CampaignStatus {
  campaign: Campaign
  platformStatus: CampaignPlatform[]
  jobHistory: Job[]
  recentLogs: Log[]
}

export interface PlatformStatus {
  platform: Platform
  campaignPerformance: {
    id: string
    title: string
    campaign_status: string
    platform_status: string
    error_message?: string
    retry_count: number
    created_at: string
  }[]
  recentLogs: Log[]
}

// UI types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

// Form types
export interface FormData {
  [key: string]: any
}

export interface FormErrors {
  [key: string]: string | undefined
}

// Chart types
export interface ChartData {
  name: string
  value: number
  color?: string
}

export interface TimeSeriesData {
  date: string
  value: number
  label?: string
}

// Component props
export interface BaseComponentProps {
  className?: string
  children?: React.ReactNode
}

export interface ModalProps extends BaseComponentProps {
  isOpen: boolean
  onClose: () => void
  title?: string
}

export interface ButtonProps extends BaseComponentProps {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
}

export interface InputProps extends BaseComponentProps {
  type?: string
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  error?: string
  disabled?: boolean
  required?: boolean
}

export interface SelectProps extends BaseComponentProps {
  options: { value: string; label: string }[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  error?: string
  disabled?: boolean
}

export interface TableProps extends BaseComponentProps {
  columns: {
    key: string
    label: string
    render?: (value: any, row: any) => React.ReactNode
  }[]
  data: any[]
  loading?: boolean
  empty?: string
}

// Navigation types
export interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<any>
  current?: boolean
}

export interface SidebarProps extends BaseComponentProps {
  navigation: NavItem[]
  user?: User
}

// Filter and search types
export interface FilterOptions {
  status?: string
  platform?: string
  dateRange?: string
  search?: string
}

export interface SortOptions {
  field: string
  direction: 'asc' | 'desc'
}

// Notification types
export interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  timestamp: string
  read: boolean
}
