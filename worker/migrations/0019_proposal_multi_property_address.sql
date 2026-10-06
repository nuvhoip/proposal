-- Migration 0019: multi-property engagements + structured client address.
--
-- 1. pids_json — the Master Registry now ties a proposal (and every
--    engagement under it) to a HOTEL GROUP and lets it cover one or more of
--    that group's properties (registry migration 011, proposal_properties).
--    The wizard's Step 1 now picks properties with checkboxes; the selected
--    PRP ids are kept here as a JSON array, e.g. ["PRP-AU-0013","PRP-AU-0027"].
--    NULL = proposal saved before this existed (falls back to
--    proposal_registry_links.pid).
-- 2. property_address_json — the address on Step 1 is now a regular postal
--    address ({ line1, line2, suburb, city, state, postcode, country }).
--    property_address keeps the formatted, multi-line text the document and
--    the Word export render, so older readers keep working unchanged.
--
-- Run once against the live database BEFORE deploying the matching worker:
--   wrangler d1 execute nuvho-proposals --remote --file=migrations/0019_proposal_multi_property_address.sql

ALTER TABLE proposals ADD COLUMN pids_json             TEXT;
ALTER TABLE proposals ADD COLUMN property_address_json TEXT;
