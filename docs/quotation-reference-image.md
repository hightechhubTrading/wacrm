# Optional quotation reference picture

A quotation supports one optional picture for the customer PDF. In **Products & services**, the reference-image controls sit below the items and quotation discount. Staff can upload, replace or remove the picture. Uploads accept JPG, PNG and WebP up to 5 MiB; animated/multipage files are rejected. Pictures are decoded with a 40-million-pixel input limit, oriented, reduced to at most 2400 pixels per edge, flattened onto white and stored as JPEG without source metadata.

The editor shows upload progress, processing and retry states. An unfinished upload blocks saving, revision/status actions and PDF/WhatsApp preparation. A failed replacement preserves the previous picture. Selecting a picture or removing it changes the draft; the existing versioned save persists the choice. Locked quotations require a revision before changes. The picture follows the quotation into that revision.

The customer document includes one bilingual reference-image section after item totals, before selected specifications. It retains the picture's proportions, has a 95 mm maximum printed height and stays together across page breaks. Without a picture, the section is absent. Preview and PDF generation download authenticated bytes and embed a data URI; PDF rendering retains its network and script isolation and verifies that images decode. A missing attached picture prevents generation with a retryable error.

## Storage and persistence

Migration `098_quotation_reference_image.sql` adds the private `quotation-images` bucket and server-written `quotation_images` registry. `documentDetails.referenceImage` stores exactly one reference with `storagePath`, `mimeType`, `bytes`, `width` and `height`. Uploads register an unfinished immutable path, store normalized bytes, then mark the registry row ready. The upload does not save the draft.

`/api/quotations/[id]/image` accepts raw-file POST uploads and serves authenticated GET thumbnails. Both require agent access to the account-scoped quotation; uploads additionally require an editable draft and the workspace's assignment rules. No public/signed image URLs or client storage-write policies are used. Registry reads follow quotation visibility; authenticated roles cannot mutate the registry.

Application validation and database triggers enforce exact registry metadata, readiness, quotation/account ownership and one picture. Issued `quotation_documents.snapshot` values retain the picture reference; stored PDF bytes remain immutable. Replacing a picture always creates a new path.

Hourly container maintenance claims up to 100 abandoned uploads older than 24 hours. Database row locks serialize cleanup against draft saves and document publication. A claimed asset cannot subsequently be attached. Storage removal happens before registry deletion, and failed removals remain retryable. References from current quotations or issued snapshots prevent cleanup. Registry rows survive quotation deletion until their objects can be removed. An unsaved picture left in an editor for over 24 hours may need uploading again if cleanup has reclaimed it.

## Verification and release

- Full unit suite: 1,748 passing, 74 skipped.
- TypeScript, production build, changed-file ESLint and deployment-preflight tests pass.
- Disposable PostgreSQL checks cover malformed metadata, quotation/account ownership, RLS, unfinished uploads, snapshot retention, cleanup retries and quotation deletion.
- Eight complete browser journeys cover English/Arabic, light/dark and 390/1440 widths, including upload blocking, save/reload, failed replacement/retry, save conflict, removal and real PDF rendering with/without a picture.
- Portrait/landscape PDFs were rendered and visually inspected; proportions and printed bounds pass. Synthetic artifacts are in `.local/quotation-image/browser`.
- The 21st catalog search returned HTTP 401. The implementation reuses existing project buttons, icons and quotation styles. 21st review reports four existing color-token observations elsewhere in `workspace.css`; the new UI adds no hardcoded colors.
- Live migration 098 is recorded as `20261111105635`. Existing quotation/item/document fingerprints remained unchanged after migration. A live synthetic storage/PDF smoke passed and removed its temporary quotation and files.

The startup preflight requires the registry fields, image-aware document validation and `quotation_images_ready()`, which verifies private storage, RLS, protected writes, cleanup privileges and validation triggers. Apply the reviewed migration through the timestamped linked process before application deployment. The previous application remains compatible with the additive schema.

Application rollout evidence is recorded after promotion. Private logs are under `.local/quotation-image` and excluded from git and the container build context.
