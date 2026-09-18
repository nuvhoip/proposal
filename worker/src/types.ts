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
  // (2026-09-15: removed MS_TEAM_ID_AU/UK/IE — the v2.0 fixed-geo-Team
  // design they supported was abandoned in favor of one dedicated Team
  // per Hotel Group; see lib/graph.ts's createClientTeam/findTeamByName
  // and HOTEL_GROUP_CHANNEL_OWNERS.)
  // Secrets
  AZURE_CLIENT_SECRET: string
  HUBSPOT_API_KEY:     string
  ASANA_PAT:           string
  XERO_CLIENT_ID:      string
  XERO_CLIENT_SECRET:  string
  JWT_SECRET:          string
  RESEND_API_KEY:      string   // DEPRECATED — replaced by Microsoft Graph app-only sendMail
                                 // (lib/graph.ts sendMailViaGraph, using AZURE_CLIENT_SECRET below).
                                 // Kept here only so the binding doesn't dangle if still set in
                                 // wrangler.toml; safe to remove once that secret is deleted.
  ANTHROPIC_API_KEY:   string
  REGISTRY_API_KEY:    string   // Nuvho Master Registry X-Registry-Key (register.nuvho.com)
  GRAPH_REFRESH_TOKEN: string   // FIRST-RUN SEED ONLY for the delegated service-account token used
                                 // to post Teams channel activity (lib/graph.ts). After the first
                                 // refresh the live token lives in KV, because Entra rotates it on
                                 // every redemption and a Worker can't rewrite its own secrets.
                                 // Optional: /admin/graph-consent seeds KV directly.
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
  nuvho_address:       string | null
  company_name:        string | null
  about_nuvho:         string | null
  footer_text:         string | null
  currency:            string
  status:              string
  sender_staff_id:     string
  account_manager_stf_id: string | null
  sender_message:      string | null
  sender_cc:           string | null
  sender_bcc:          string | null
  sender_subject:      string | null
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
  ms_team_id:          string | null
  ms_team_web_url:     string | null
  ms_channel_id:       string | null
  ms_channel_web_url:  string | null
  ms_team_created_at:  string | null
  ms_team_error:       string | null
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

export interface ScopeItemRow {
  id:                   string
  proposal_service_id:  string
  section_heading:      string
  text:                 string
  enabled:              number
  is_custom:            number
  sort_order:           number
}

export interface FeeRowRow {
  id:                   string
  proposal_service_id:  string
  component:             string
  fee_type:              string
  fee:                   number | null
  term:                  number | null
  note:                  string | null
  sort_order:            number
}

export interface PricingFootnoteRow {
  id:                   string
  proposal_service_id:  string
  text:                 string
  sort_order:           number
}

export interface TermsClauseJson {
  id:      string
  heading: string
  text:    string
  enabled: boolean
}

export interface TermsRow {
  proposal_id:            string
  clauses_json:           string
  validity_days:          number
  // Registry entity_code the agreement is governed by — selected on Step 7's
  // Governing Entity picker (see migrations/0009_proposal_terms_governing_entity.sql).
  governing_entity_code:  string | null
  signature_required:     number
  signature_method:       'type' | 'draw'
  signatory_name:         string | null
  signatory_title:        string | null
  signature_data_url:     string | null
  signature_message:      string | null
  // NUVCL-131: per-category "Page Break" checkboxes from Step7Preview —
  // JSON-encoded Record<sectionKey, boolean>, e.g. {"background":true}.
  page_breaks_json:       string | null
  // NUVCL-131: the CLIENT's own captured e-signature from the public sign
  // page, kept in dedicated columns separate from signatory_name/
  // signature_method/signature_data_url above (which are the SENDER's own
  // letter sign-off). Previously the client's signature was written into
  // those same sender columns via signProposal()'s upsertTerms() call,
  // silently overwriting the sender's sign-off instead of being tracked in
  // its own right — which is also why it never appeared in the generated
  // PDF as the client's signature.
  client_signatory_name:      string | null
  client_signatory_title:     string | null
  client_signature_method:    'type' | 'draw' | null
  client_signature_data_url:  string | null
  client_signed_at:           string | null
}

export interface AttachmentRow {
  id:           string
  proposal_id:  string
  filename:     string
  content_type: string | null
  size_bytes:   number
  r2_key:       string
  sort_order:   number
  created_at:   string
}

export interface RegionSettingsRow {
  region:       string
  address:      string
  company_name: string
  about_nuvho:  string
  footer_text:  string
  currency:     string
  clauses_json: string
  updated_at:   string
}

// entity_settings — replaces RegionSettingsRow above (per Master Registry
// entity_code instead of per region). No company_name column: the legal
// entity name is never stored locally, always read live from the registry.
export interface EntitySettingsRow {
  entity_code:  string
  address:      string
  about_nuvho:  string
  footer_text:  string
  currency:     string
  clauses_json: string
  updated_at:   string
}

export interface ServiceCategoryRow {
  code:                   string
  label:                  string
  description:            string
  sort_order:             number
  active:                 number
  default_scope_json:     string
  default_footnotes_json: string
  created_at:             string
  updated_at:             string
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
