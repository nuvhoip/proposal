-- ============================================================
-- Nuvho Proposal System — D1 Schema
-- ============================================================

-- ── Staff ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  role              TEXT NOT NULL,
  role_type         TEXT NOT NULL,
  bd_facing         INTEGER NOT NULL DEFAULT 1,
  is_signatory      INTEGER NOT NULL DEFAULT 0,
  hubspot_owner_id  TEXT,
  asana_gid         TEXT,
  m365_user_id      TEXT,
  m365_upn          TEXT,
  timezone          TEXT NOT NULL DEFAULT 'Australia/Sydney',
  -- NUVCL-117: per-user signature, set once from Settings → User Settings
  -- and used to pre-fill (still overridably) the proposal wizard's
  -- Signature step. A typed signature always renders as this staff
  -- member's own `name` above — no separate "signatory name" column.
  -- See migrations/0012_staff_signature.sql for the already-deployed-DB
  -- migration pairing this schema change.
  signature_method   TEXT,    -- 'type' | 'draw' | NULL (not set)
  signature_data_url  TEXT,   -- drawn signature, base64 PNG data URL
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Proposals ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposals (
  id                   TEXT PRIMARY KEY,
  np_id                TEXT UNIQUE,  -- client-facing "Proposal ID" (NP-{REGION}-{YYMMDD}-{6RAND}),
                                      -- reserved from register.nuvho.com POST /v1/np-ids at create time
  hotel_name           TEXT NOT NULL,
  contact_name         TEXT NOT NULL,
  contact_email        TEXT NOT NULL,
  contact_phone        TEXT,
  contact_title        TEXT,
  property_address     TEXT,
  region               TEXT NOT NULL DEFAULT 'au',
  -- Snapshot of region_settings at create time (see that table below) — kept
  -- on the proposal itself so historical proposals keep the address/company
  -- name/about/footer/currency that applied when they were generated, even
  -- if Settings are edited later. Same pattern as proposal_terms.clauses_json.
  nuvho_address        TEXT,
  company_name         TEXT,
  about_nuvho          TEXT,
  footer_text          TEXT,
  currency             TEXT NOT NULL DEFAULT 'AUD',
  status               TEXT NOT NULL DEFAULT 'draft',
  sender_staff_id      TEXT NOT NULL REFERENCES staff(id),
  account_manager_stf_id TEXT REFERENCES staff(id),
  sender_message       TEXT,
  -- Comma-separated additional recipients on the proposal-sent email (wizard
  -- Step 5 — Sender). Parsed into arrays for the Resend API call in
  -- sendProposalEmail(); NULL/empty means no extra recipients.
  sender_cc            TEXT,
  sender_bcc           TEXT,
  -- Email subject line for the proposal-sent email (wizard Step 5 — Sender).
  -- NULL/empty falls back to the default "Your Nuvho Proposal — {hotel_name}"
  -- (see sendProposalEmail() in routes/proposals.ts). Added to an already-
  -- deployed database via migrations/0010_proposal_sender_subject.sql.
  sender_subject       TEXT,
  cover_url            TEXT,
  pdf_url              TEXT,
  signed_pdf_url       TEXT,
  signer_name          TEXT,
  signed_at            TEXT,
  sent_at              TEXT,
  expires_at           TEXT,
  valid_until          TEXT,
  hubspot_deal_id      TEXT,
  hubspot_proposal_id  TEXT,
  asana_project_gid    TEXT,
  xero_quote_id        TEXT,
  sharepoint_folder    TEXT,
  view_count           INTEGER NOT NULL DEFAULT 0,
  last_viewed_at       TEXT,
  signing_token        TEXT UNIQUE,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proposals_status      ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_sender      ON proposals(sender_staff_id);
CREATE INDEX IF NOT EXISTS idx_proposals_hotel       ON proposals(hotel_name);
CREATE INDEX IF NOT EXISTS idx_proposals_signing_tok ON proposals(signing_token);
CREATE INDEX IF NOT EXISTS idx_proposals_created     ON proposals(created_at DESC);

-- ── Proposal Services ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_services (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  monthly_fee  REAL NOT NULL DEFAULT 0,
  setup_fee    REAL NOT NULL DEFAULT 0,
  term_months  INTEGER NOT NULL DEFAULT 12,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_proposal ON proposal_services(proposal_id);

-- ── Proposal Scope Items ──────────────────────────────────────
-- One row per scope-of-work line item on a service line (Scope editor step).
-- `sort_order` preserves the drag-reordered position within the service.
CREATE TABLE IF NOT EXISTS proposal_scope_items (
  id                TEXT PRIMARY KEY,
  proposal_service_id TEXT NOT NULL REFERENCES proposal_services(id) ON DELETE CASCADE,
  section_heading   TEXT NOT NULL,
  text              TEXT NOT NULL DEFAULT '',
  enabled           INTEGER NOT NULL DEFAULT 1,
  is_custom         INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scope_items_service ON proposal_scope_items(proposal_service_id, sort_order);

-- ── Proposal Fee Rows ─────────────────────────────────────────
-- One row per pricing line item on a service line (flexible Pricing editor
-- step) — component / fee type / amount / term / note, reorderable.
CREATE TABLE IF NOT EXISTS proposal_fee_rows (
  id                   TEXT PRIMARY KEY,
  proposal_service_id  TEXT NOT NULL REFERENCES proposal_services(id) ON DELETE CASCADE,
  component            TEXT NOT NULL DEFAULT '',
  fee_type             TEXT NOT NULL DEFAULT 'monthly', -- monthly | setup | fixed | daily | hourly | commission | custom
  fee                  REAL,
  term                 INTEGER,
  note                 TEXT,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fee_rows_service ON proposal_fee_rows(proposal_service_id, sort_order);

-- ── Proposal Pricing Footnotes ────────────────────────────────
-- "Small print" lines shown below a service line's pricing table.
CREATE TABLE IF NOT EXISTS proposal_pricing_footnotes (
  id                   TEXT PRIMARY KEY,
  proposal_service_id  TEXT NOT NULL REFERENCES proposal_services(id) ON DELETE CASCADE,
  text                 TEXT NOT NULL DEFAULT '',
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pricing_footnotes_service ON proposal_pricing_footnotes(proposal_service_id, sort_order);

-- ── Proposal Attachments ──────────────────────────────────────
-- Files attached to the proposal-sent email (wizard Step 5 — Sender). Bytes
-- live in R2 (env.STORAGE) under r2_key; this row is just the pointer + a
-- little metadata for the wizard's attachment list. ON DELETE CASCADE drops
-- the row when its proposal is deleted, but — same known gap as the registry
-- orphan rows noted on deleteProposal() — does NOT delete the R2 object
-- itself; deleteAttachment() (routes/proposals.ts) removes both together
-- for the normal single-attachment-remove path.
CREATE TABLE IF NOT EXISTS proposal_attachments (
  id            TEXT PRIMARY KEY,
  proposal_id   TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content_type  TEXT,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  r2_key        TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proposal_attachments_proposal ON proposal_attachments(proposal_id, sort_order);

-- ── Proposal Terms & Conditions ───────────────────────────────
-- One row per proposal: validity window + optional signature block. Clauses
-- themselves are stored JSON-serialized in `clauses_json` (TEXT), following
-- the same pattern as audit_log.meta — they're an ordered, per-proposal list
-- of {id, heading, text, enabled} with no independent relational identity.
CREATE TABLE IF NOT EXISTS proposal_terms (
  proposal_id         TEXT PRIMARY KEY REFERENCES proposals(id) ON DELETE CASCADE,
  clauses_json        TEXT NOT NULL DEFAULT '[]',
  validity_days       INTEGER NOT NULL DEFAULT 30,
  -- Registry entity_code (e.g. NVH-AU-OPS) this agreement is governed by —
  -- selected on the wizard's Step 7 Governing Entity picker. Added to an
  -- already-deployed database via migrations/0009_proposal_terms_governing_entity.sql.
  governing_entity_code TEXT,
  signature_required  INTEGER NOT NULL DEFAULT 1,
  -- 'type' (signatory name rendered in a script font) or 'draw' (hand-drawn
  -- on a <canvas>, captured as a PNG data URL in signature_data_url below).
  signature_method    TEXT NOT NULL DEFAULT 'type',
  signatory_name      TEXT,
  signatory_title     TEXT,
  signature_data_url  TEXT,
  -- Optional rich-text (HTML, authored via TinyMCE on the wizard's Signature
  -- step) message shown to the client above the Quote Approval signature
  -- block, in place of the default static sentence when set.
  signature_message   TEXT,
  -- NUVCL-131: per-category "Page Break" checkboxes from the wizard's
  -- Preview & Save step (Step7Preview) — JSON-encoded
  -- Record<sectionKey, boolean>, e.g. {"background":true}. Added to an
  -- already-deployed database via migrations/0013_proposal_terms_page_breaks_and_client_signature.sql.
  page_breaks_json    TEXT NOT NULL DEFAULT '{}',
  -- NUVCL-131: the CLIENT's own captured e-signature from the public sign
  -- page, kept separate from signatory_name/signature_method/
  -- signature_data_url above (the SENDER's own letter sign-off), so neither
  -- overwrites the other and both can be rendered distinctly in the
  -- generated document/PDF.
  client_signatory_name      TEXT,
  client_signatory_title     TEXT,
  client_signature_method    TEXT,
  client_signature_data_url  TEXT,
  client_signed_at           TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Service Categories (Settings → Body Configuration) ────────────
-- Main service-line categories offered to a client on Step 2 (Services) of
-- the proposal wizard. `code` is the same stable identifier stored on
-- proposal_services.code (and, for the original four, on
-- frontend/lib/serviceCatalog.ts's SERVICE_CATALOG keys) — it is the PK so it
-- must not change once a proposal references it. Fully staff-editable: new
-- categories can be added (with their own code) or removed via Settings;
-- codes without a matching SERVICE_CATALOG entry simply start with no
-- pre-built scope/pricing template (staff add scope/pricing rows manually in
-- Steps 3–4), same as any custom scope item today.
CREATE TABLE IF NOT EXISTS service_categories (
  code                TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  -- Default Scope of Work (Step 3) for this service line — an ordered array
  -- of {id, heading, items:[{id, text}]}, editable from Settings → Body
  -- Configuration. When a proposal adds this service on Step 2, Step 3 pre-fills
  -- from this snapshot (frontend/lib/serviceCatalog.ts's getServiceEntry
  -- prefers this over its own hardcoded SERVICE_CATALOG fallback). Editing
  -- this later does not change scope items already added to an existing
  -- proposal — same "settings are a template, not a live link" pattern as
  -- region_settings.clauses_json.
  default_scope_json  TEXT NOT NULL DEFAULT '[]',
  -- Default Small Print / Footnotes (Pricing step) for this service line —
  -- an ordered array of {id, text}, editable from Settings → Body
  -- Configuration alongside Scope of Work. When a proposal adds this service
  -- on Step 2, its Pricing-step footnotes pre-fill from this snapshot
  -- (frontend/lib/serviceCatalog.ts's initFootnotes prefers this over its
  -- own hardcoded SERVICE_CATALOG fallback). Same "settings are a template,
  -- not a live link" pattern as default_scope_json above.
  default_footnotes_json TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_categories_sort ON service_categories(sort_order);

-- Seed: the 6 main categories, in the requested order. Codes for the first
-- four match the pre-existing SERVICE_CATALOG/proposal_services codes so
-- their curated pricing templates (frontend/lib/serviceCatalog.ts) keep
-- applying unchanged; Systems (SY) and Advisory (AD) are new and start with
-- no default scope. default_scope_json below mirrors the client-approved
-- wording supplied for each service line.
INSERT OR IGNORE INTO service_categories (code, label, description, sort_order, active, default_scope_json) VALUES
  ('SM', 'Sales',                'Corporate sales, MICE, pro-active outreach',            1, 1, '[{"id":"sm_sec_1","heading":"New Property Set Up","items":[{"id":"sm1_1","text":"Sales Planning – Develop a sales activity plan by market segment including strategy and tactics."},{"id":"sm1_2","text":"Account Setup – Establish the properties in Pipedrive CRM, email inbox and configure reporting on an agreed basis."},{"id":"sm1_3","text":"Template Development – Where required, create a suite of templates for use in the proposal and request for tender process."}]},{"id":"sm_sec_2","heading":"Business Development","items":[{"id":"sm2_1","text":"Sales Calls & Emails – Conduct connected reactive and proactive research, sales calls and emails incorporating an agreed blend of segments to hit an average of 90 connects per month."},{"id":"sm2_2","text":"Tenders & RFPs - Undertake tenders and requests for proposals on demand based on client requirements."},{"id":"sm2_3","text":"Site Inspections - Facilitate site inspections to showcase the property to local accounts."},{"id":"sm2_4","text":"Dedicated Resource – Assign dedicated team members assigned to execute sales strategy and tactics."}]},{"id":"sm_sec_3","heading":"Account Management","items":[{"id":"sm3_1","text":"Account Management - Implement and execute account management strategies to ensure both company and TMCs are being targeted."}]},{"id":"sm_sec_4","heading":"Administration","items":[{"id":"sm4_1","text":"Reporting – Provide a monthly activity report highlighting sales activities, return on investment as well as maintain a live online dashboard identifying the forward pipeline of business."},{"id":"sm4_2","text":"Strategy Consult - Conduct on-going and interim consultation with the property to provide feedback on return on investment & performance."},{"id":"sm4_3","text":"Sales Management – Management of overall sales strategy and implementation."}]}]'),
  ('MK', 'Marketing',            'Digital marketing, content, campaigns',                 2, 1, '[{"id":"mk_sec_1","heading":"Strategic Marketing Planning","items":[{"id":"mk1_1","text":"Marketing Plan Production – Produce a marketing plan for approval by the Client by hotel, restaurant, group or as directed."},{"id":"mk1_2","text":"Budget Management – Allocate and review paid media and partnerships budget monthly as required."},{"id":"mk1_3","text":"Strategy Review - Conduct on-going and interim consultation to provide feedback on return on investment & performance."}]},{"id":"mk_sec_2","heading":"Listing Management","items":[{"id":"mk2_1","text":"Business Listings – Manage static listings across Google and Bing."},{"id":"mk2_2","text":"Partnership Listings – Manage static listings with partners including ATDW, Australian Good Food Guide, Google Meta, local tourism information centres and other relevant partner sites."},{"id":"mk2_3","text":"Other Channels - Other meta channels to be discussed on a case by case basis."}]},{"id":"mk_sec_3","heading":"Social Media Management","items":[{"id":"mk3_1","text":"Campaign Creation – Campaign creation includes strategizing and scheduling of social media across Facebook & Instagram channels (additional channels such as TikTok & Pinterest to be considered on request). Content creation is focused on agreed content pillars suitable to the Client and the market."},{"id":"mk3_2","text":"Artwork – Directly liaise with the Client personnel in relation to artwork production for campaigns, with images and videography to be supplied by the hotel. Content can be coordinated by Nuvho on an as-need basis."},{"id":"mk3_3","text":"Posting and Scheduling - Build a content calendar to plan, schedule, and manage the distribution of 10 posts per month across approved channels, spanning a mix of content types."},{"id":"mk3_4","text":"Monitoring and Improving – Monitor content results to continually work to enhance performance of posts and themes that attract more engagement."},{"id":"mk3_5","text":"Social Listening – Monitor and respond to follower messages and comments within a timely manner."}]},{"id":"mk_sec_4","heading":"Direct Marketing Campaigns","items":[{"id":"mk4_1","text":"Account Setup – Establish the account in the nominated CRM and connect the relevant opt-in funnels to the CRM in a segmented manner."},{"id":"mk4_2","text":"Template Development – Establish a suite of templates including standardised header and footer."},{"id":"mk4_3","text":"EDM Production – Produce EDMs as directed, circulate for internal review prior to client release."},{"id":"mk4_4","text":"Reporting – Provide feedback reporting on campaigns undertaken."}]},{"id":"mk_sec_5","heading":"Database Management","items":[{"id":"mk5_1","text":"Account Setup – Establish the database in the nominated CRM and connect the relevant interfaces to the CRM in a segmented manner."},{"id":"mk5_2","text":"Segmentation – Segment the database by property in an appropriate manner including website leads, property management system & booking engine and other segments as provided."}]},{"id":"mk_sec_6","heading":"Website Development","items":[{"id":"mk6_1","text":"Supply - Supply and host an independently branded accommodation website based on the Nuvho template."},{"id":"mk6_2","text":"Booking Widgets - Customise integration of the booking engine mask for reservations of the accommodation and/or other departments."},{"id":"mk6_3","text":"Integration - Connect a range of third-party content to the site including but not limited to Instagram, social media, CRM and Trip Advisor review widgets into each site."},{"id":"mk6_4","text":"SEO – Undertake organic search-engine optimisation on the site backend to manage search engine optimisation."},{"id":"mk6_5","text":"Analytics – Connect and configure each page for tracking on the clients Google Analytics account. Connect Google Search Console and index the site upon completion."},{"id":"mk6_6","text":"Responsiveness – Our platform inherently includes optimisation across all mobile and desktop platforms."},{"id":"mk6_7","text":"Testing – Conduct full user testing on the following operating systems/devices prior to a live launch date - iOS: Safari, Android, Google Chrome and Firefox."},{"id":"mk6_8","text":"Security – Issue generic SSL Certificates to enhance security and provide consumer comfort."},{"id":"mk6_9","text":"Imagery, Video, Advertising & Gallery – The Divi platform can accommodate a range of imagery and video content that can be easily edited."},{"id":"mk6_10","text":"Tracking & Reporting – Provide reporting on site visitation data derived from Google Analytics."},{"id":"mk6_11","text":"Support – Include four hours of support per year incorporating edits and changes as requested. Subsequent changes are charged on an hourly basis."}]},{"id":"mk_sec_7","heading":"Booking Engine – Simple Booking","items":[{"id":"mk7_1","text":"Supply – Supply Simple Booking software under licence from Qnt Srl."}]},{"id":"mk_sec_8","heading":"Seamless Guest Journey – Accommodation Correspondence","items":[{"id":"mk8_1","text":"Correspondence – Required correspondence includes confirmation letter (HTML), pre-stay (HTML minus 7 days), day-of-arrival (HTML), post-stay (HTML plus one day), cancellation letter (HTML) and registration card (PDF)."},{"id":"mk8_2","text":"Draft – Produce a draft structure outline for each template that will form the basis of the development process and agree with the client before proceeding."},{"id":"mk8_3","text":"Components – Specific elements of the templates where appropriate will include the following: Personalisation (personalise the correspondence utilising the specific property management system short-codes); Reservation Details (provide reservation details specific to the profile of correspondence); Upselling (as well as rich content for the integrated tours and activities product, include client specified products to upsell); Manage my Booking (provide clear buttons that link to the client portal of the property management system in order to modify or update reservations); Property Reviews (establish an avenue for guests to leave reviews for the subject property)."},{"id":"mk8_4","text":"Review – Present the suite of templates for review and make amendments as directed."},{"id":"mk8_5","text":"Load – Load the templates within the property management system and booking engine as required."}]},{"id":"mk_sec_9","heading":"Photography Management","items":[{"id":"mk9_1","text":"Photographer Engagement – Review existing local photographer skills and quotes and engage an appropriate photographer."},{"id":"mk9_2","text":"Photography Brief – Produce a detailed brief for the photographer incorporating the following: equipment list appropriate to the desired shots including drone and appropriate 360-degree footage; prop list outlining the props to be utilised per shot including appropriate room, restaurant, bar, meetings and seasonal props for forward social media campaigns; best practice example photography footage showcasing ideal outputs; and shot list detailing the number of shots per each element of the property including aspect and time of day."},{"id":"mk9_3","text":"Photographer Liaison – Liaise with the photographer prior to the shoot day to overview the photography brief and during the shoot to discuss any particular shots and scenes."},{"id":"mk9_4","text":"Property Liaison – Liaise with the property prior to the shoot day to ensure the property set-up, as per the photography brief, has been undertaken and completed."},{"id":"mk9_5","text":"Photograph Selection – Review the photographs and select the appropriate suite of photographs to professionally represent the property."},{"id":"mk9_6","text":"Photography Dissemination – Coordinate and manage the dissemination of the selected photographs across sales channels."}]},{"id":"mk_sec_10","heading":"Collateral Production","items":[{"id":"mk10_1","text":"Collateral Production – Create draft collateral for pre-approval and roll out on respective channels or print once approved."},{"id":"mk10_2","text":"Printing Coordination – Coordinate with nominated printing outlets for production of collateral and distribution."}]},{"id":"mk_sec_11","heading":"Brand Development","items":[{"id":"mk11_1","text":"Internal Consultation & Workshop – Conduct an internal focus group to identify key insights pertaining to the subject property and brand positioning relative to competition, market segment, target audience and likely building profiles."},{"id":"mk11_2","text":"Brand Strategy – Define the brand''s mission, vision, values, and unique selling proposition. Conduct market research and analysis to identify the brand''s target audience, competitors, and positioning within the market."},{"id":"mk11_3","text":"Logo Design – Present scalable and adaptable logo options for different applications and produce mock-ups of the logo for client selection."},{"id":"mk11_4","text":"Visual Identity – Establish the brand''s visual identity by defining colour palettes, typography, and graphic elements that align with the brand''s values and positioning. Create basic guidelines for consistent usage of these visual elements across various brand touchpoints."},{"id":"mk11_5","text":"Brand Messaging - Develop a brand voice and tone that reflects the brand''s personality and resonates with the target audience. Craft key messages, taglines, and brand story to effectively communicate the brand''s values and offerings."},{"id":"mk11_6","text":"Approval – The brand development stages may require consultation sessions and will require sign-off to ensure satisfaction in the approval process, before moving to output."},{"id":"mk11_7","text":"Brand Guidelines – Including the hotel messaging, tone of voice, key words, tagline, target customer, USPs, competitive matrix, ambitions, brand positioning, character, assets, brand experience pillars."},{"id":"mk11_8","text":"Logos – Generate full logo suite in .AI, PNG and JPEG formats."},{"id":"mk11_9","text":"Develop Supporting Graphic Elements – Hotel factsheet, key card & key holder, compendium, DND hanger, mini bar slips, room service menus, bar menus, internal and external signage, posters, letterheads, business cards, email signature, with-compliments slip, email invitation, tent cards, A5 notepads, pens."}]},{"id":"mk_sec_12","heading":"Influencer / Content Creator Marketing","items":[{"id":"mk12_1","text":"Sourcing – Proactively source influencers/content creators that fit the client''s target market and requirements."},{"id":"mk12_2","text":"Management – Negotiate with influencers/content creators to ensure deliverables are received within time frame and messaging aligns with the client''s tone of voice."},{"id":"mk12_3","text":"Account Management – Engage with the influencer/content creator post-stay to pre-approve content and receive any feedback from their stay."}]},{"id":"mk_sec_13","heading":"Paid Media","items":[{"id":"mk13_1","text":"Google Setup – Setup Google hotel ads sponsored connectivity."},{"id":"mk13_2","text":"Meta Setup – Setup Meta ads connectivity."},{"id":"mk13_3","text":"Content – Directly liaise with Client personnel in relation to content production for campaigns, with images to be supplied by the hotel."},{"id":"mk13_4","text":"Hotel Tracking Setup – Audit and setup tracking across the sponsored connectivity consumer journey to report on return on investment and digital performance. Tracking includes both Google and Meta channels."},{"id":"mk13_5","text":"Campaign Types – Ad types will be selected based on overall goals and budget and may be adjusted as needed, including: Brand Protection (Google Search Ads) - strategic use of branded keyword campaigns to safeguard the online identity, ensuring visibility and preventing competitor encroachment; Keywords Unbranded (Google Ads) - using general, non-brand terms to search for the accommodation without referencing a specific company name; Performance Max (Google Ads) - includes Search, Display, YouTube, Discover, Maps and Gmail with a mix of static and video content; Demand Generation (Google Ads) - designed to attract high-intent audiences, increase brand visibility and drive qualified traffic; Meta Retargeting - reconnect with potential guests who have already shown interest by sending them relevant ads that encourage them to return and complete their booking; Meta Traffic Generation - attract high quality visitors to the website who are most likely to book."},{"id":"mk13_6","text":"Paid Media Budget – Effectively manage the approved paid media budget."}]}]'),
  ('RM', 'Revenue Management',   'Full RM strategy, pricing, OTA management',             3, 1, '[{"id":"rm_sec_1","heading":"Revenue Management Services","items":[{"id":"rm_1","text":"Audit – Conduct market assessment and market share analysis to inform broad recommendations for yield strategy based on the value matrix."},{"id":"rm_2","text":"Setup – Setup property across our various systems and create process efficiencies."},{"id":"rm_3","text":"Revenue 365 - Supply a daily report comprising a 365-day rolling forecast and incorporating market pricing & competitor pricing."},{"id":"rm_4","text":"Strategy Consultation - Conduct 3 x weekly strategy sessions with the property with recommendations on pricing implementation."},{"id":"rm_5","text":"Room & Rate Strategy – Review and set up the room structure, pricing matrix, value matrix, interface across systems and propagate across channels."},{"id":"rm_6","text":"Yield Management - Manage overall pricing and yield management including updating and propagation of rates across channels."},{"id":"rm_7","text":"OTA Management - Ongoing management of OTA channels, relationships, accounts and represent the property with OTA account managers."},{"id":"rm_8","text":"GDS Management - Ongoing management of GDS relationships and represent the property with GDS account managers."},{"id":"rm_9","text":"Forecasting - Provide rolling top-line twelve-month forecasts."},{"id":"rm_10","text":"Budget – Provide twelve-month rooms revenue budget broken down into market segments per month; provided once per contract year."},{"id":"rm_11","text":"Reporting - Provide reporting measuring performance against the competitive set and the same period last year including an end of month report focusing on key revenue metrics."}]}]'),
  ('CR', 'Central Reservations', 'Reservations handling, upselling, ancillary revenue',   4, 1, '[{"id":"cr_sec_1","heading":"Reservation Management Services","items":[{"id":"cr_1","text":"Systems Setup – Setup the systems associated with the provision of central reservations including the reservations system, telephony system and chatbot."},{"id":"cr_2","text":"Hours & Location of Service – Provide reservations hours of service from Monday to Friday 9am to 5pm."},{"id":"cr_3","text":"Property Research & Training – Coordinate training with the property such that in-depth knowledge of room types and facilities is present."},{"id":"cr_4","text":"Sales Training – Provide appropriate sales training to reservation personnel in terms of telephony manner, connection, conversion and upselling."},{"id":"cr_5","text":"Inbound Reservation Handling – Handle all inbound accommodation reservation enquiries from telephone and email channels at all stages of the reservation process from enquiry, proposal, execution, cancellation and post-stay."},{"id":"cr_6","text":"Manage Existing Reservations – Manage existing reservations with PMS access."},{"id":"cr_7","text":"Lead Generation – Pass appropriate leads to the sales team of the property in terms of corporate and MICE segments as well as any other prospective account management leads."},{"id":"cr_8","text":"Report Generation – Generate and distribute daily arrivals and no-show reports. Produce monthly reporting on activity comprising calls, proposals, conversion and up-sales."}]}]'),
  ('SY', 'Systems',              '',                                                       5, 1, '[]'),
  ('AD', 'Advisory',             '',                                                       6, 1, '[]');

-- ── Registry Sync (Nuvho Master Registry — register.nuvho.com) ──
-- One row per bundled service_line per proposal: the registry's proposal
-- record (POST /v1/proposals) only accepts a single service_line, but a
-- Nuvho proposal can bundle several (RM, SM, MK, CR…), so each service gets
-- its own canonical PROP-{GEO}-{YYYY}-{SEQ4} record, linked back here.
-- pid/eid/eid_display/eid_sync_error/eid_synced_at (migration 0014) track
-- the same row's Engagement (EID, ENG-{GEO}-{SVC}-{YYYY}-{SEQ4}) sync,
-- independently of the prop_id columns above — engagement creation needs an
-- already-registered property (pid), which prop_id sync does not, so the
-- two can succeed/fail independently for the same service line.
CREATE TABLE IF NOT EXISTS proposal_registry_links (
  id             TEXT PRIMARY KEY,
  proposal_id    TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  service_line   TEXT NOT NULL,
  hgid           TEXT NOT NULL,
  entity_code    TEXT NOT NULL,
  geo            TEXT NOT NULL,
  prop_id        TEXT,                 -- registry-assigned Proposal record id; null until synced
  status         TEXT NOT NULL DEFAULT 'draft',
  sync_error     TEXT,
  synced_at      TEXT,
  pid            TEXT,                 -- registry Property id this service's Engagement is tied to (from hotel.pid)
  eid            TEXT,                 -- registry-assigned Engagement id (structural); null until synced
  eid_display    TEXT,                 -- registry-assigned Engagement id (display, ENG-{slug}-{svc}-{seq3})
  eid_sync_error TEXT,
  eid_synced_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prl_proposal ON proposal_registry_links(proposal_id);
CREATE INDEX IF NOT EXISTS idx_prl_prop_id  ON proposal_registry_links(prop_id);
CREATE INDEX IF NOT EXISTS idx_prl_eid      ON proposal_registry_links(eid);

-- ── Engagements ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engagements (
  id              TEXT PRIMARY KEY,
  proposal_id     TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  hotel_name      TEXT NOT NULL,
  contact_email   TEXT NOT NULL,
  services        TEXT NOT NULL,
  start_date      TEXT NOT NULL,
  staff_id        TEXT NOT NULL REFERENCES staff(id),
  hubspot_deal_id TEXT,
  asana_project   TEXT,
  xero_invoice_id TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── SharePoint Folders ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sharepoint_folders (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  folder_url   TEXT NOT NULL,
  drive_id     TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Audit Log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  actor        TEXT,
  meta         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_proposal ON audit_log(proposal_id, created_at DESC);

-- ── Region Settings (per-region proposal defaults) ───────────────
-- LEGACY / no longer editable from the UI — kept only so an existing
-- database still has this data available for a one-time migration into
-- entity_settings (see migrations/0008_entity_settings.sql). Settings →
-- Entities now manages this data per legal entity (entity_settings below),
-- and the worker's getRegionSettings() computes the wizard's per-region
-- feed from entity_settings + the Master Registry's operating entity per
-- geo, rather than reading this table directly. Not dropped, in case a
-- rollback is ever needed.
CREATE TABLE IF NOT EXISTS region_settings (
  region              TEXT PRIMARY KEY,   -- 'au' | 'uk' | 'ie'
  address             TEXT NOT NULL DEFAULT '',
  company_name        TEXT NOT NULL DEFAULT '',  -- legal entity name shown as the section heading — e.g. "Nuvho Pty Ltd" (AU)
  about_nuvho         TEXT NOT NULL DEFAULT '',  -- about-us paragraph under that heading — wording differs per region too
  footer_text         TEXT NOT NULL DEFAULT '',
  currency            TEXT NOT NULL DEFAULT 'AUD',  -- ISO 4217 code: AUD | GBP | EUR
  clauses_json        TEXT NOT NULL DEFAULT '[]',
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed clauses mirror the previous hardcoded defaults in
-- frontend/lib/serviceCatalog.ts (defaultTermsClauses) so behaviour is
-- unchanged until someone edits them via Settings. address/about_nuvho/
-- footer_text are left blank — Nuvho's legal entity address, about-us text,
-- and company-registration footer text must be entered once via
-- Settings → Region Settings rather than guessed here. company_name is
-- seeded 'Nuvho Pty Ltd' for AU only (the known, previously-hardcoded
-- entity name) — UK/IE are left blank until their own entity is entered.
INSERT OR IGNORE INTO region_settings (region, address, company_name, about_nuvho, footer_text, currency, clauses_json) VALUES
('au', '', 'Nuvho Pty Ltd', '', '', 'AUD', '[
  {"id":"term_au_payment",      "heading":"Payment Terms",           "text":"Fees are invoiced in advance (monthly retainers) or on issue (setup/fixed fees) and are payable within 14 days of the invoice date, in AUD.", "enabled":true},
  {"id":"term_au_contract",     "heading":"Contract Term & Renewal", "text":"This agreement commences on the date of signing and continues for the term specified against each service. Thereafter it continues on a month-to-month basis unless terminated by either party.", "enabled":true},
  {"id":"term_au_cancellation", "heading":"Cancellation",            "text":"Either party may terminate this agreement with 60 days'' written notice, effective after the expiry of the initial term.", "enabled":true},
  {"id":"term_au_confidential", "heading":"Confidentiality",         "text":"Both parties agree to keep confidential all non-public information disclosed in connection with this agreement and this proposal.", "enabled":true},
  {"id":"term_au_liability",    "heading":"Limitation of Liability", "text":"Nuvho''s aggregate liability under this agreement is limited to the fees paid in the twelve months preceding the claim.", "enabled":true},
  {"id":"term_au_ip",           "heading":"Intellectual Property",   "text":"Nuvho retains ownership of all systems, processes, and materials used to deliver the services. The client retains ownership of its own brand assets and data.", "enabled":true},
  {"id":"term_au_forcemajeure", "heading":"Force Majeure",           "text":"Neither party is liable for delay or failure to perform caused by circumstances beyond its reasonable control.", "enabled":true},
  {"id":"term_au_governinglaw", "heading":"Governing Law",           "text":"This agreement is governed by the laws of Queensland, Australia, and the parties submit to the exclusive jurisdiction of its courts.", "enabled":true}
]'),
('uk', '', '', '', '', 'GBP', '[
  {"id":"term_uk_payment",      "heading":"Payment Terms",           "text":"Fees are invoiced in advance (monthly retainers) or on issue (setup/fixed fees) and are payable within 14 days of the invoice date, in GBP.", "enabled":true},
  {"id":"term_uk_contract",     "heading":"Contract Term & Renewal", "text":"This agreement commences on the date of signing and continues for the term specified against each service. Thereafter it continues on a month-to-month basis unless terminated by either party.", "enabled":true},
  {"id":"term_uk_cancellation", "heading":"Cancellation",            "text":"Either party may terminate this agreement with 60 days'' written notice, effective after the expiry of the initial term.", "enabled":true},
  {"id":"term_uk_confidential", "heading":"Confidentiality",         "text":"Both parties agree to keep confidential all non-public information disclosed in connection with this agreement and this proposal.", "enabled":true},
  {"id":"term_uk_liability",    "heading":"Limitation of Liability", "text":"Nuvho''s aggregate liability under this agreement is limited to the fees paid in the twelve months preceding the claim.", "enabled":true},
  {"id":"term_uk_ip",           "heading":"Intellectual Property",   "text":"Nuvho retains ownership of all systems, processes, and materials used to deliver the services. The client retains ownership of its own brand assets and data.", "enabled":true},
  {"id":"term_uk_forcemajeure", "heading":"Force Majeure",           "text":"Neither party is liable for delay or failure to perform caused by circumstances beyond its reasonable control.", "enabled":true},
  {"id":"term_uk_governinglaw", "heading":"Governing Law",           "text":"This agreement is governed by the laws of England & Wales, and the parties submit to the exclusive jurisdiction of its courts.", "enabled":true}
]'),
('ie', '', '', '', '', 'EUR', '[
  {"id":"term_ie_payment",      "heading":"Payment Terms",           "text":"Fees are invoiced in advance (monthly retainers) or on issue (setup/fixed fees) and are payable within 14 days of the invoice date, in EUR.", "enabled":true},
  {"id":"term_ie_contract",     "heading":"Contract Term & Renewal", "text":"This agreement commences on the date of signing and continues for the term specified against each service. Thereafter it continues on a month-to-month basis unless terminated by either party.", "enabled":true},
  {"id":"term_ie_cancellation", "heading":"Cancellation",            "text":"Either party may terminate this agreement with 60 days'' written notice, effective after the expiry of the initial term.", "enabled":true},
  {"id":"term_ie_confidential", "heading":"Confidentiality",         "text":"Both parties agree to keep confidential all non-public information disclosed in connection with this agreement and this proposal.", "enabled":true},
  {"id":"term_ie_liability",    "heading":"Limitation of Liability", "text":"Nuvho''s aggregate liability under this agreement is limited to the fees paid in the twelve months preceding the claim.", "enabled":true},
  {"id":"term_ie_ip",           "heading":"Intellectual Property",   "text":"Nuvho retains ownership of all systems, processes, and materials used to deliver the services. The client retains ownership of its own brand assets and data.", "enabled":true},
  {"id":"term_ie_forcemajeure", "heading":"Force Majeure",           "text":"Neither party is liable for delay or failure to perform caused by circumstances beyond its reasonable control.", "enabled":true},
  {"id":"term_ie_governinglaw", "heading":"Governing Law",           "text":"This agreement is governed by the laws of Ireland, and the parties submit to the exclusive jurisdiction of its courts.", "enabled":true}
]');

-- ── Entity Settings (per-legal-entity proposal defaults) ─────────
-- One row per Nuvho Master Registry entity_code (e.g. NVH-AU-OPS,
-- NVH-AU-HOLD, NVH-UK-OPS…) — replaces region_settings above. Address,
-- about-us text, legal footer, currency, and default Terms & Conditions are
-- this app's own data (the Master Registry has no concept of them); the
-- entity's legal_name/jurisdiction/role/is_active are never stored here —
-- they're read live from the registry and merged in by entity_code (see
-- getEntitySettings() in worker/src/routes/settings.ts). Editable from
-- Settings → Entities, one entity at a time. `clauses_json` follows the
-- same shape as region_settings.clauses_json / proposal_terms.clauses_json.
CREATE TABLE IF NOT EXISTS entity_settings (
  entity_code         TEXT PRIMARY KEY,   -- Master Registry entity_code, e.g. NVH-AU-OPS
  address             TEXT NOT NULL DEFAULT '',
  about_nuvho         TEXT NOT NULL DEFAULT '',
  footer_text         TEXT NOT NULL DEFAULT '',
  currency            TEXT NOT NULL DEFAULT 'AUD',
  clauses_json        TEXT NOT NULL DEFAULT '[]',
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the 3 previously-editable operating entities with the same defaults
-- region_settings used to seed for au/uk/ie, so behaviour for a brand-new
-- database is unchanged until someone edits Settings → Entities. The other
-- active entities (NVH-AU-HOLD, NVH-AU-IP, NVH-AU-SYS…) are intentionally
-- left unseeded — they get sensible blanks the first time Settings →
-- Entities loads them, same "get-or-default" pattern as service_categories.
INSERT OR IGNORE INTO entity_settings (entity_code, address, about_nuvho, footer_text, currency, clauses_json) VALUES
('NVH-AU-OPS', '', '', '', 'AUD', '[
  {"id":"term_au_payment",      "heading":"Payment Terms",           "text":"Fees are invoiced in advance (monthly retainers) or on issue (setup/fixed fees) and are payable within 14 days of the invoice date, in AUD.", "enabled":true},
  {"id":"term_au_contract",     "heading":"Contract Term & Renewal", "text":"This agreement commences on the date of signing and continues for the term specified against each service. Thereafter it continues on a month-to-month basis unless terminated by either party.", "enabled":true},
  {"id":"term_au_cancellation", "heading":"Cancellation",            "text":"Either party may terminate this agreement with 60 days'' written notice, effective after the expiry of the initial term.", "enabled":true},
  {"id":"term_au_confidential", "heading":"Confidentiality",         "text":"Both parties agree to keep confidential all non-public information disclosed in connection with this agreement and this proposal.", "enabled":true},
  {"id":"term_au_liability",    "heading":"Limitation of Liability", "text":"Nuvho''s aggregate liability under this agreement is limited to the fees paid in the twelve months preceding the claim.", "enabled":true},
  {"id":"term_au_ip",           "heading":"Intellectual Property",   "text":"Nuvho retains ownership of all systems, processes, and materials used to deliver the services. The client retains ownership of its own brand assets and data.", "enabled":true},
  {"id":"term_au_forcemajeure", "heading":"Force Majeure",           "text":"Neither party is liable for delay or failure to perform caused by circumstances beyond its reasonable control.", "enabled":true},
  {"id":"term_au_governinglaw", "heading":"Governing Law",           "text":"This agreement is governed by the laws of Queensland, Australia, and the parties submit to the exclusive jurisdiction of its courts.", "enabled":true}
]'),
('NVH-UK-OPS', '', '', '', 'GBP', '[
  {"id":"term_uk_payment",      "heading":"Payment Terms",           "text":"Fees are invoiced in advance (monthly retainers) or on issue (setup/fixed fees) and are payable within 14 days of the invoice date, in GBP.", "enabled":true},
  {"id":"term_uk_contract",     "heading":"Contract Term & Renewal", "text":"This agreement commences on the date of signing and continues for the term specified against each service. Thereafter it continues on a month-to-month basis unless terminated by either party.", "enabled":true},
  {"id":"term_uk_cancellation", "heading":"Cancellation",            "text":"Either party may terminate this agreement with 60 days'' written notice, effective after the expiry of the initial term.", "enabled":true},
  {"id":"term_uk_confidential", "heading":"Confidentiality",         "text":"Both parties agree to keep confidential all non-public information disclosed in connection with this agreement and this proposal.", "enabled":true},
  {"id":"term_uk_liability",    "heading":"Limitation of Liability", "text":"Nuvho''s aggregate liability under this agreement is limited to the fees paid in the twelve months preceding the claim.", "enabled":true},
  {"id":"term_uk_ip",           "heading":"Intellectual Property",   "text":"Nuvho retains ownership of all systems, processes, and materials used to deliver the services. The client retains ownership of its own brand assets and data.", "enabled":true},
  {"id":"term_uk_forcemajeure", "heading":"Force Majeure",           "text":"Neither party is liable for delay or failure to perform caused by circumstances beyond its reasonable control.", "enabled":true},
  {"id":"term_uk_governinglaw", "heading":"Governing Law",           "text":"This agreement is governed by the laws of England & Wales, and the parties submit to the exclusive jurisdiction of its courts.", "enabled":true}
]'),
('NVH-IE-OPS', '', '', '', 'EUR', '[
  {"id":"term_ie_payment",      "heading":"Payment Terms",           "text":"Fees are invoiced in advance (monthly retainers) or on issue (setup/fixed fees) and are payable within 14 days of the invoice date, in EUR.", "enabled":true},
  {"id":"term_ie_contract",     "heading":"Contract Term & Renewal", "text":"This agreement commences on the date of signing and continues for the term specified against each service. Thereafter it continues on a month-to-month basis unless terminated by either party.", "enabled":true},
  {"id":"term_ie_cancellation", "heading":"Cancellation",            "text":"Either party may terminate this agreement with 60 days'' written notice, effective after the expiry of the initial term.", "enabled":true},
  {"id":"term_ie_confidential", "heading":"Confidentiality",         "text":"Both parties agree to keep confidential all non-public information disclosed in connection with this agreement and this proposal.", "enabled":true},
  {"id":"term_ie_liability",    "heading":"Limitation of Liability", "text":"Nuvho''s aggregate liability under this agreement is limited to the fees paid in the twelve months preceding the claim.", "enabled":true},
  {"id":"term_ie_ip",           "heading":"Intellectual Property",   "text":"Nuvho retains ownership of all systems, processes, and materials used to deliver the services. The client retains ownership of its own brand assets and data.", "enabled":true},
  {"id":"term_ie_forcemajeure", "heading":"Force Majeure",           "text":"Neither party is liable for delay or failure to perform caused by circumstances beyond its reasonable control.", "enabled":true},
  {"id":"term_ie_governinglaw", "heading":"Governing Law",           "text":"This agreement is governed by the laws of Ireland, and the parties submit to the exclusive jurisdiction of its courts.", "enabled":true}
]');

-- ── Seed: default staff ───────────────────────────────────────
INSERT OR IGNORE INTO staff (id, name, email, role, role_type, bd_facing, is_signatory, timezone)
VALUES
  ('staff_jude', 'Jude Bolger', 'jude.bolger@nuvho.com', 'Director',        'bd',  1, 1, 'Australia/Sydney'),
  ('staff_emma', 'Emma Clarke', 'emma.clarke@nuvho.com', 'BD Manager',      'bd',  1, 0, 'Australia/Sydney'),
  ('staff_ryan', 'Ryan Nguyen', 'ryan.nguyen@nuvho.com', 'Revenue Manager', 'ops', 0, 0, 'Australia/Sydney');
