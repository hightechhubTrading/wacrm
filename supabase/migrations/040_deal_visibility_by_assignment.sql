-- 040_deal_visibility_by_assignment.sql
--
-- Restricts deal (lead) visibility for the 'agent' role to only deals
-- assigned to them via deals.assigned_to. Owners/Admins keep full
-- visibility of every deal in the account's pipelines and remain the
-- only roles who can see and hand out brand-new/unassigned leads --
-- mirrors 037's admin-or-assigned pattern for conversations.
--
-- deals.assigned_to is a FK to profiles.id (migration 002), not
-- auth.users.id directly like conversations.assigned_agent_id -- so
-- the check resolves the caller's own profile id via a subquery on
-- profiles.user_id = auth.uid().
--
-- deals_insert is intentionally left unchanged (agent+ can still
-- create a deal for any contact/stage; the assignee picker in the
-- deal form controls who owns it, and thus who can see/move it,
-- from then on).

DROP POLICY IF EXISTS deals_select ON deals;
CREATE POLICY deals_select ON deals FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS deals_update ON deals;
CREATE POLICY deals_update ON deals FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_delete ON deals FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid())
  )
);
