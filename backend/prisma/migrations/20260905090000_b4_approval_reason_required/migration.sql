-- A rejection or a return must carry a reason.
--
-- The service raises a ValidationError, which is what gives a usable message.
-- This is the backstop: §A3 requires every approval, rejection and edit to be
-- logged "with user, timestamp, and reason", and a rejection nobody has to
-- justify is exactly the record that makes an audit trail worthless.

ALTER TABLE "ApprovalRequest"
  ADD CONSTRAINT "ApprovalRequest_reason_required_when_negative" CHECK (
    "status" NOT IN ('REJECTED', 'RETURNED')
    OR ("decisionReason" IS NOT NULL AND length(btrim("decisionReason")) > 0)
  );
