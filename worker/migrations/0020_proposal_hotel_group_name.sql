-- Migration 0020: hotel_group_name on proposals.
-- The Master Registry hotel group's name at creation time, shown in the
-- running header at the top of every document page (except the cover and
-- the cover letter). NULL on older proposals — the worker looks it up from
-- the registry once (resolveHotelGroupName in routes/proposals.ts) and saves it.
--
-- Run once against the live database BEFORE deploying the matching worker:
--   wrangler d1 execute nuvho-proposals --remote --file=migrations/0020_proposal_hotel_group_name.sql

ALTER TABLE proposals ADD COLUMN hotel_group_name TEXT;
