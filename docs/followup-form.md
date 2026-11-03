# Follow-up form shortcuts

The inbox follow-up editor uses the shared styled Select for task types and task-specific completion outcomes. Staff can choose a standard outcome and optionally add details, or choose Other/custom and describe the work. Selecting an outcome never completes a task by itself; Mark completed retains the existing evidence validation and API authorization.

Follow-up and team-confirmed appointment fields have Today, Tomorrow and In one week shortcuts. The existing calendar provides a custom date, paired with an editable time. Today selects the current Qatar date/time for appointments; follow-up deferrals choose a time 30 minutes ahead on the same day (up to 23:59). Past deferrals remain disabled. Appointment confirmation still requires an explicit action. Calendar instances use unique label IDs and omit quotation-validity wording in this context.

Validation: 1,639 tests pass (68 skipped), TypeScript, production build, changed-file lint and 21st review pass. `PLAYWRIGHT_CHANNEL=chrome node scripts/check-followup-form-browser.mjs` exercises eight combinations of English/Arabic, light/dark and mobile/desktop. It verifies styled dropdowns, preset/custom evidence payloads, Qatar Today/Tomorrow timestamps, custom calendar access and no horizontal overflow. Synthetic network handlers intercept every write; no live follow-up or message is created by the check.

Deployed application revision `e0141b3770eaf7a4e62fb28793831b735e02ab88`. Exact live revision, login, protected inbox and follow-up API access checks pass. Candidate containers/environment files are absent and the private pack is excluded. Temporary SSH access was revoked, authentication denial verified and local keys deleted. Browser evidence remains private under `.local/followup-ui`.
