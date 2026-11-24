-- Archie: one more kind of use for the roof reports record (plan
-- docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md, Task D7b, finding
-- the roof from a satellite picture). Off until ARCHIE_ROOF_REPORTS=on. Needs 0024.
-- Never edit this file once applied. It creates NOTHING and touches ONE existing
-- table, roof_report_uses, in ONE way: the list of kinds its check allows grows
-- from ('send','rewrite') to ('send','rewrite','satellite'). No column, no row, no
-- policy, no grant changes. A press of "Find it from the satellite" is a use of
-- kind 'satellite' (it has no report yet, so it is kept under the all-zero report
-- id), and that is what its daily limit and its double-press protection count.
--
-- Apply this by hand, as the owner, BEFORE any deploy of the code that reads it.
-- Nothing reads it while ARCHIE_ROOF_REPORTS is off, and nothing in the build or
-- the deploy runs migrations. The code that is live today never writes a kind
-- this check would refuse and never writes 'satellite', so applying this first is
-- safe under it.
--
-- Locks on a live database: dropping and adding a check takes a brief exclusive
-- lock on roof_report_uses, and adding it reads every row once; the table holds
-- one row for each Send or Rewrite ever pressed, so it is small.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "roof_report_uses" DROP CONSTRAINT "roof_report_uses_kind_check";
--> statement-breakpoint
ALTER TABLE "roof_report_uses" ADD CONSTRAINT "roof_report_uses_kind_check" CHECK ("roof_report_uses"."kind" IN ('send','rewrite','satellite'));
