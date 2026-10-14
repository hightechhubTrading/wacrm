# Sales workspace in chat

The inbox now connects chat to the sales-side workflow without requiring workers to use the app.

## Next action

A compact strip above the thread shows the most recent customer message needing a reply, an overdue follow-up, recorded group work, a future follow-up, or a neutral last-reply indication. Closed conversations are labelled closed. Follow-ups show due time and recorded owner; group work shows job reference, status, optional responsible person and requested date.

Actions focus the composer, open the existing follow-up panel, or open the authorized job's group-work sheet. An expired free-text session opens the template picker instead. The strip does not interpret WhatsApp group activity or mark any work complete.

## Sales views

The filter menu adds:

- **Needs a reply**: latest non-failed customer message, independently of unread count.
- **Follow up today**: overdue/today follow-ups owned by this salesperson or unassigned, plus group work with a requested date through today's end.
- **Last reply from us**: latest non-failed agent/bot message with no pending follow-up or group work. This describes evidence; it does not claim the customer has agreed to reply.
- **Waiting on measurements / workshop**: recorded active group work, excluding drafts not yet posted.

Closed conversations are excluded. Existing search, tags, company and assignee filters still combine with these views. Today uses the browser's local timezone. Views refresh on message timestamp changes, each thirty seconds, and after group-work/follow-up updates. Unavailable data is reported explicitly.

## Selected sales job

The contact sidebar has a selected-job panel with stage/owner, editable requirements, latest quotation/revision/status, active work and shortcuts for visit requests, forwarded reports, workshop requests and quotations. One linked deal is selected automatically. Multiple deals require an explicit selection. Records from a previously selected contact/deal are not displayed as the current job. A **Job** button opens contact/job information in a mobile sheet.

The existing group-work and quotation APIs continue enforcing deal/quotation visibility and accepted-quotation requirements. Customer messages remain separate from internal handoffs and reports.

## Schema and access

Migration `071_inbox_sales_context.sql` adds a read-only, SECURITY INVOKER function and a latest-message lookup index. It uses the caller's conversation, deal, follow-up and work RLS. The authenticated agent API derives the account from the session, validates/deduplicates UUID batches, and caps batches at 500. Anonymous execution is revoked. No new statuses are inferred or persisted, and no customer or worker messages are sent.

## Verification

Unit/API tests cover unread-independent reply detection, closed queues, draft work, task ownership, date boundaries, action ordering, account scoping, malformed batches and unavailable storage. Database checks verify invoker security and assigned-agent conversation/deal visibility. Browser checks use synthetic records in an isolated preview, without customer mutations.
