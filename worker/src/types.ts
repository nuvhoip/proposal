export interface Env {
  // D1
  DB: D1Database
  // R2
  STORAGE: R2Bucket
  // KV
  SESSIONS:   KVNamespace
  RATE_LIMIT: KVNamespace
  // Vars
  FRONTEND_URL:        string
  AZURE_TENANT_ID:     string
  AZURE_CLIENT_ID:     string
  ASANA_WORKSPACE_GID: string
  REGISTRY_BASE_URL:   string   // e.g. https://register.nuvho.com
  // Secrets
  AZURE_CLIENT_SECRET: string
  HUBSPOT_API_KEY:     string
  ASANA_PAT:           string
  XERO_CLIENT_ID:      string
  XERO_CLIENT_SECRET:  string
  JWT_SECRET:          string
  RESEND_API_KEY:      string
  ANTHROPIC_API_KEY:   string
  REGISTRY_API_KEY:    string   // Nuvho Master Registry X-Registry-Key (register.nuvho.com)
}

export interface Session {
  userId:    string
  email:     string
  name:      string
  staffId?:  string
  expiresAt: number
}

export interface ProposalRow {
  id:                  string
  np_id:               string | null
  hotel_name:          string
  contact_name:        string
  contact_email:       string
  contact_phone:       string | null
  contact_title:       string | null
  property_address:    string | null
  region:              string
  status:              string
  sender_staff_id:     string
  sender_message:      string | null
  cover_url:           string | null
  pdf_url:             string | null
  signed_pdf_url:      string | null
  signer_name:         string | null
  signed_at:           string | null
  sent_at:             string | null
  expires_at:          string | null
  valid_until:         string | null
  hubspot_deal_id:     string | null
  asana_project_gid:   string | null
  signing_token:       string | null
  view_count:          number
  created_at:          string
  updated_at:          string
}

export interface ServiceRow {
  id:          string
  proposal_id: string
  code:        string
  monthly_fee: number
  setup_fee:   number
  term_months: number
}

export interface StaffRow {
  id:               string
  name:             string
  email:            string
  role:             string
  role_type:        string
  bd_facing:        number
  is_signatory:     number
  hubspot_owner_id: string | null
  asana_gid:        string | null
  m365_user_id:     string | null
  m365_upn:         string | null
  timezone:         string
}

export type ApiResponse<T> =
  | { success: true;  data: T;     error?: never }
  | { success: false; data?: never; error: string }
