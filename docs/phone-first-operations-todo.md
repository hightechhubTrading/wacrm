# Phone-first operations: product direction and to-do

Recorded 29 October 2026. Planning and code review only; no implementation or deployment is implied.

## Direction

Build around the way Hightech already works: WhatsApp conversations, groups, calls, photos and voice notes. Help people coordinate and record work through familiar phone interactions, introducing structure gradually. Natural language is an optional input, alongside simple choices, dates, camera, audio and short notes. Favor one clear decision at a time. Design for the Android phones workers actually use and iPhones commonly used by managers; support Arabic and English. Validate with real staff and devices.

Possible product direction: turn everyday business conversations into trackable work, with modules that can later serve other similar companies. Validate the market and workflows before committing to packaging or platform choices.

## First discovery and prototype

- [ ] Follow several real requests from customer inquiry through group handoff, measurement, quotation, workshop and delivery. Identify who does what, missing information, delays, and where copying or repeated questions occur. Avoid assuming every job follows the same sequence.
- [ ] Prototype a connected flow: sales creates a request with a type, item/quantity, date, recipient and optional note/photo/voice; a worker responds using a few clear choices; the salesperson or manager sees the answer and next action.
- [ ] Test the prototype with sales, warehouse/production workers and managers on their actual Android and iOS devices, in their preferred languages. Measure completion, missed steps and time to respond; observe without coaching.
- [ ] Decide whether an existing web/mobile-web flow, a shared mobile app, or native apps best supports the observed tasks. Check low connectivity, notifications, camera and sharing requirements before choosing.
- [ ] Verify current official WhatsApp capabilities and account eligibility before promising access to existing groups. Explore copy/share/forward handoffs and preserve explicit confirmation of what was actually sent and received.

## Current app: opportunities to investigate

- [ ] **Make group handoffs easier.** The existing group-work sheet requests location, a minimum-length description, a free-text responsible person and a date; workshop work also requires an accepted quotation. Test a short, task-specific flow with prefilled known details, a phone-friendly date choice and optional voice/photo context. Preserve the accepted-quotation safeguard where it represents a real production commitment; distinguish an early feasibility request from an authorized workshop order.
- [ ] **Reduce copy-and-report friction.** Group work currently prepares text for copying into WhatsApp, then sales explicitly records posting and later enters forwarded reports. Explore a device share sheet where supported, clearer next steps and easy attachment capture. A share attempt must not be treated as proof of posting or completion.
- [ ] **Make updates action-first.** Current updates use a status dropdown, text and file input. Explore contextual buttons such as “On my way”, “Need help” or “Ready”, with evidence requested when appropriate. Check whether existing evidence requirements are proportionate before changing them, and keep actor attribution honest for forwarded reports.
- [ ] **Improve entry from customer chat.** Inbox job context already links to visit, report, workshop and quotation actions. The visit and report shortcuts both open the same measurement sheet; test opening the relevant creation or update state directly. Consider creating a simple request from a conversation without forcing early deal setup; inspect dependencies and permissions first.
- [ ] **Give each person a focused work list.** Dashboard agenda and waiting-work queue already surface sales follow-ups and handoffs. Explore a role-specific “Today” view showing assigned actions, waiting items and blockers; do not imply workers have app accounts or receive notifications today. Responsible person is currently a label, so real assignment requires identity and access design.
- [ ] **Use AI as assistance.** Existing sales assistance prepares a checked recap and next action. Explore suggested job details from supported conversation evidence, with source links, editable fields and explicit confirmation for operational commitments. Keep uncertainty and unsupported details visible; do not assume files are automatically understood.
- [ ] **Support common phone inputs.** Assess share-in, camera capture, voice recording, push notifications and unreliable connections in a prototype, including Android device variation. Define conflict handling and avoid duplicate stock or job updates before adding offline writes.
- [ ] **Review navigation and terms.** Observe whether staff understand deals, pipelines, handoffs, quotations and status labels. Offer task-oriented entry points and clear Arabic/English wording without discarding existing functionality.
- [ ] **Evaluate the eventual product foundation.** Review organization isolation, employee roles, per-company settings, audit history, data export, onboarding and module boundaries before selling externally. Verify existing tenant controls rather than assuming they cover new workflows.

## Existing foundations and limits

- `docs/group-work.md`: manual copy to existing groups, explicit posting and forwarded reports, job references and waiting-work queue. Group activity remains unknown until recorded; scheduled notifications are not part of that version.
- `docs/inbox-sales-workspace.md`: sales next-action strip, selected job context and mobile job sheet.
- `docs/sales-assistance.md`: opt-in evidence-backed assistance with human review boundaries; activation and current deployment must be verified separately.
- `src/components/jobs/group-work.tsx` and `src/components/inbox/sales-workspace.tsx`: current handoff and chat entry points examined for this review.

These are hypotheses based on local code and documentation, not observed employee behavior or a verification of the live deployment. No product change is authorized by this to-do alone.
