# Final enquiry template replies

The inbound webhook understands Meta template quick replies (`type: button`,
`button.text`, `button.payload`) as well as session interactive replies.
Button labels appear in the transcript and payloads are retained as reply IDs.

For `enquiry_final_check_ar`, a reply must reference a locally stored outgoing
template message in the same conversation before enquiry actions run:

- `نعم، أود المتابعة`: create/deduplicate a staff handoff follow-up using the
  current conversation assignee and inbound message as evidence. This uses the
  existing task due-date/reminder defaults; it does not send a customer reply
  or grant marketing consent.
- `ليس الآن`: cancel existing open, acknowledged or deferred quotation,
  location and comparison tasks in this account/conversation. This stops the
  current enquiry reminders without inventing a future contact date. Staff
  can create a new task when the customer wants to resume. Bookings, inspection,
  repair, document review and handoff tasks are preserved. This does not disable
  unrelated campaigns or automation workflows.
- `إيقاف المتابعة`: exact whole-message opt-out, also accepted as plain text.
  Uses the existing contact opt-out flag for broadcasts/automation/flow send
  gates and closes the same sales reminder kinds. Existing manual inbox replies
  remain available. Existing START/UNSTOP or the admin toggle can clear opt-out;
  the continue button never clears it implicitly.

Recognized controls are stored but bypass flow, automation and AI reply dispatch.
No customer acknowledgement is sent automatically. A template sent outside the
CRM without a locally stored parent can still opt out, but pause/continue actions
cannot be attributed and do not run.

No database migration is required. Local tests cover extraction, exact labels,
parent-template isolation, task scoping and preserved consent. Live webhook
delivery and deployed behavior must be verified separately.
