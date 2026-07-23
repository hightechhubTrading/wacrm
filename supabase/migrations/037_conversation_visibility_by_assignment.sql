-- 037_conversation_visibility_by_assignment.sql
--
-- Restricts conversation (and message) visibility for the 'agent'
-- role to only conversations assigned to them via
-- conversations.assigned_agent_id. Owners/Admins keep full
-- visibility of every conversation in the account and remain the
-- only roles who can see and hand out brand-new/unassigned
-- conversations.
--
-- Mirrors the same admin-or-assigned-agent check across:
--   - conversations (SELECT / UPDATE / DELETE)
--   - messages (SELECT / ALL), scoped through the parent conversation
--
-- conversations_insert is intentionally left unchanged (agent+).

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
    is_account_member(account_id, 'admin')
    OR (is_account_member(account_id, 'agent') AND assigned_agent_id = auth.uid())
  );

DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE USING (
    is_account_member(account_id, 'admin')
    OR (is_account_member(account_id, 'agent') AND assigned_agent_id = auth.uid())
  );

DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (
    is_account_member(account_id, 'admin')
    OR (is_account_member(account_id, 'agent') AND assigned_agent_id = auth.uid())
  );

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (
          is_account_member(c.account_id, 'admin')
          OR (is_account_member(c.account_id, 'agent') AND c.assigned_agent_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (
          is_account_member(c.account_id, 'admin')
          OR (is_account_member(c.account_id, 'agent') AND c.assigned_agent_id = auth.uid())
        )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (
          is_account_member(c.account_id, 'admin')
          OR (is_account_member(c.account_id, 'agent') AND c.assigned_agent_id = auth.uid())
        )
    )
  );
