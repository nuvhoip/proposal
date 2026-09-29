-- Migration 0018: NUVCL-154 — per-service acceptance at signing.
-- The public signing page now has one acceptance checkbox per proposed
-- service; the client can sign for a subset. Each proposal_services row is
-- marked 'accepted' or 'declined' by signProposal(). Declined services are
-- excluded from fee totals, the proposals list, automations (HubSpot deal
-- amount, Asana, ...) and are closed out in the Master Registry
-- (engagement → inactive, registry proposal → declined).
-- NULL = not signed yet, or signed before this existed (= all accepted).
--
-- Run once against the live database BEFORE deploying the matching worker:
--   wrangler d1 execute nuvho-proposals --remote --file=migrations/0018_proposal_services_acceptance.sql

ALTER TABLE proposal_services ADD COLUMN acceptance TEXT;
