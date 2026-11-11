/** Disposable PostgreSQL checks: metadata, ownership/RLS, immutable snapshots and cleanup. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const account = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const quote = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const third = '20000000-0000-4000-8000-000000000003';
const makeImage = (n, q = quote) => ({
  storagePath: `${q}/30000000-0000-4000-8000-${String(n).padStart(12, '0')}.jpg`,
  mimeType: 'image/jpeg',
  bytes: 123,
  width: 640,
  height: 480,
});
const register = async (image, q = quote, a = account, ready = true) =>
  db.query(
    "INSERT INTO quotation_images(storage_path,quotation_id,account_id,image,ready,created_at) VALUES($1,$2,$3,$4,$5,now()-interval '2 days')",
    [image.storagePath, q, a, JSON.stringify(image), ready]
  );
const save = async (q, image) =>
  db.query('UPDATE quotations SET document_details=$1 WHERE id=$2', [
    JSON.stringify(image ? { referenceImage: image } : {}),
    q,
  ]);
try {
  await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   CREATE TABLE ai_products(id uuid PRIMARY KEY,account_id uuid,status text,kind text,superseded_by uuid,parent_id uuid);
   CREATE TABLE quotations(id uuid PRIMARY KEY,account_id uuid,status text DEFAULT 'draft',workspace_version integer DEFAULT 0,document_details jsonb DEFAULT '{}');
   CREATE TABLE quotation_documents(id uuid PRIMARY KEY,quotation_id uuid,account_id uuid,snapshot jsonb);
   ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
   CREATE POLICY quotation_scope ON quotations TO authenticated USING(account_id=current_setting('test.account')::uuid);
   GRANT SELECT,UPDATE ON quotations TO authenticated;
   INSERT INTO quotations(id,account_id) VALUES('${quote}','${account}'),('${second}','${account}'),('${third}','${other}');`);
  for (const file of [
    '092_quotation_catalogue_creation.sql',
    '093_quotation_structured_configuration.sql',
    '094_quotation_payment_allocation_limit.sql',
    '098_quotation_reference_image.sql',
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        'utf8'
      )
    );
  await db.exec(
    'CREATE TRIGGER check_details BEFORE INSERT OR UPDATE OF document_details ON quotations FOR EACH ROW EXECUTE FUNCTION validate_quotation_document_details()'
  );
  assert.equal(
    (await db.query('SELECT quotation_images_ready() ready')).rows[0].ready,
    true
  );
  const image = makeImage(1),
    replacement = makeImage(2),
    abandoned = makeImage(3),
    pending = makeImage(4),
    foreign = makeImage(5, third);
  for (const entry of [image, replacement, abandoned]) await register(entry);
  await register(pending, quote, account, false);
  await register(foreign, third, other);
  for (const invalid of [
    null,
    [],
    [image],
    { ...image, url: 'https://example.com' },
    { ...image, bytes: 0 },
    { ...image, width: 2401 },
    { ...image, height: 1.5 },
    { ...image, mimeType: 'image/svg+xml' },
    { ...image, storagePath: 'https://example.com/x.jpg' },
  ]) {
    assert.equal(
      (
        await db.query('SELECT quotation_document_details_valid($1) ok', [
          JSON.stringify({ referenceImage: invalid }),
        ])
      ).rows[0].ok,
      false
    );
  }
  assert.equal(
    (await db.query("SELECT quotation_document_details_valid('{}') ok")).rows[0]
      .ok,
    true
  );
  await save(quote, image);
  await assert.rejects(
    save(quote, { ...image, bytes: 124 }),
    /referenceImageInvalid/
  );
  await assert.rejects(save(second, image), /referenceImageInvalid/);
  await assert.rejects(save(quote, foreign), /referenceImageInvalid/);
  await assert.rejects(save(quote, pending), /referenceImageInvalid/);
  await db.query('INSERT INTO quotation_documents VALUES($1,$2,$3,$4)', [
    '40000000-0000-4000-8000-000000000001',
    quote,
    account,
    JSON.stringify({ documentDetails: { referenceImage: image } }),
  ]);
  await assert.rejects(
    db.query('INSERT INTO quotation_documents VALUES($1,$2,$3,$4)', [
      '40000000-0000-4000-8000-000000000002',
      second,
      account,
      JSON.stringify({ documentDetails: { referenceImage: image } }),
    ]),
    /referenceImageInvalid/
  );
  await save(quote, replacement);
  await db.exec(`SET test.account='${account}';SET ROLE authenticated`);
  assert.equal(
    (await db.query('SELECT * FROM quotation_images')).rows.length,
    4
  );
  await assert.rejects(
    db.query('UPDATE quotation_images SET ready=true'),
    /permission denied/
  );
  await assert.rejects(
    db.query('SELECT * FROM claim_unused_quotation_images()'),
    /permission denied/
  );
  await db.exec(
    `RESET ROLE;SET test.account='${other}';SET ROLE authenticated`
  );
  assert.equal(
    (await db.query('SELECT * FROM quotation_images')).rows.length,
    1
  );
  assert.equal(
    (
      await db.query('SELECT * FROM quotation_images WHERE storage_path=$1', [
        image.storagePath,
      ])
    ).rows.length,
    0
  );
  await db.exec('RESET ROLE');
  const claimed = (
    await db.query('SELECT storage_path FROM claim_unused_quotation_images()')
  ).rows.map((r) => r.storage_path);
  assert.deepEqual(
    claimed.sort(),
    [abandoned.storagePath, pending.storagePath, foreign.storagePath].sort()
  );
  await assert.rejects(save(quote, abandoned), /referenceImageInvalid/);
  // Cleanup retries the same tombstones after a storage failure, preserving snapshot/draft assets.
  assert.equal(
    (await db.query('SELECT * FROM claim_unused_quotation_images()')).rows
      .length,
    3
  );
  await save(quote, undefined);
  const afterRemoval = (
    await db.query('SELECT storage_path FROM claim_unused_quotation_images()')
  ).rows.map((r) => r.storage_path);
  assert.ok(afterRemoval.includes(replacement.storagePath));
  assert.ok(!afterRemoval.includes(image.storagePath));
  // Deleted quotations keep registry records for eventual object deletion.
  const deletedImage = makeImage(6, second);
  await register(deletedImage, second);
  await db.query('DELETE FROM quotations WHERE id=$1', [second]);
  assert.equal(
    (
      await db.query(
        'SELECT quotation_id FROM quotation_images WHERE storage_path=$1',
        [deletedImage.storagePath]
      )
    ).rows[0].quotation_id,
    null
  );
  assert.ok(
    (
      await db.query('SELECT storage_path FROM claim_unused_quotation_images()')
    ).rows.some((r) => r.storage_path === deletedImage.storagePath)
  );
  console.log(
    'Quotation image database checks passed: validation, account/quotation ownership, RLS, snapshots, pending uploads, cleanup and deletion.'
  );
} finally {
  await db.close();
}
