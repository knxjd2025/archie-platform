-- How a number should be answered: in the browser, on a phone, or both.
--
-- James's model has two kinds of line. The office and customer service answer
-- at a computer — no handset involved — while sales reps carry their own
-- numbers on a mobile. Same system, one setting per number.
--
-- 'both' is deliberately supported rather than a later addition: Twilio rings
-- several destinations in parallel and gives the call to whoever answers
-- first, which is exactly what someone who sits at a desk but also walks the
-- yard actually wants.
--
-- Defaults to 'phone', so every existing number keeps behaving as it does now.
ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS ring_to text NOT NULL DEFAULT 'phone';

-- The browser identity a call rings when ring_to includes the browser. Kept
-- separate from the team member's email so an identity can be reassigned
-- without touching their login, and so it can be made URL-safe once rather
-- than escaped at every call site.
ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS client_identity text;

COMMENT ON COLUMN phone_numbers.ring_to IS 'browser | phone | both';
COMMENT ON COLUMN phone_numbers.client_identity IS 'Twilio Voice SDK identity to ring when ring_to includes the browser';
