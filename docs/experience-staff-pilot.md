# Staff pilot: replying and following up

Owner: the HTH team, as confirmed by the user on 30 October 2026.
Status: prepared; no staff observations or physical-device results recorded.
Code and automated QA are complete; this pilot is the team-owned rollout step.
Business calendar: Asia/Qatar for every user, including staff travelling abroad.

Use a staging account with synthetic contacts and approved test recipients. Recruit
3–5 staff who reply to customers daily. Include Arabic and English readers and
both Android and iPhone users. Record baseline results on the existing release,
then repeat equivalent tasks with the proposed release. Do not put customer
messages, names, phone numbers or recordings in the research worksheet.

## Tasks

1. Find an unanswered conversation, inspect its owner and reply deadline, and
   explain which action should happen next.
2. Draft a reply, switch conversations, return, reload, and finish the reply.
3. Recover from a rejected send; explain what to do when acceptance is unknown.
   Verify with a test recipient before considering actual delivery successful.
4. Find an older Arabic/English message, inspect surrounding context, reply to it,
   and return to the latest messages.
5. Save an inbox view and recover the same filters after reload and browser Back.
6. With a second staff member, open the same conversation and begin composing.
   Explain the indicator and explicitly assign the conversation to one person.
7. Review a selected job's accepted quotation, blocked work and forwarded report.
   Explain the difference between a requested visit date and a confirmed visit.
8. Schedule a follow-up near Qatar midnight from a device set to Europe/Berlin;
   compare its Today placement with another device set to Asia/Qatar.
9. On physical phones, attach a photo, start/stop audio, switch apps, reopen the
   keyboard, and recover a draft after temporary loss of connectivity.

## Worksheet

| Participant code | Device / language | Task | Baseline seconds | Proposed seconds | Completed unaided | Error / recovery | Observation |
| ---------------- | ----------------- | ---- | ---------------: | ---------------: | ----------------- | ---------------- | ----------- |
| Pending          |                   |      |                  |                  |                   |                  |             |

Record task time from the prompt until the participant says they are done. Count
wrong-conversation drafts, duplicate sends, lost drafts and misunderstood deadlines
separately. Ask participants to explain unknown-send recovery and assignment in
their own words. Capture confusion as an observation, without coaching first.

Proposed release criteria: no wrong-customer or duplicate sends in these tasks;
all retained drafts recovered; all staff distinguish rejected from unknown sends;
Qatar calendar agrees across devices; essential phone controls remain reachable;
keyboard and screen-reader users can complete reply/search/recovery. Compare
median reply/follow-up task time with baseline; set a numeric improvement target
with staff after collecting the baseline rather than inventing one.

## Release prerequisites

Apply migrations 087, 088 and 089 in staging and run the database preflight.
Verify real provider acceptance/delivery and microphone/media behavior separately
from synthetic browser checks. Resolve observed blockers and repeat affected tasks.
Pilot results and the production release decision remain pending.
