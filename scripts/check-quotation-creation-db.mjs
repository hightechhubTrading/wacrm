/** Disposable database validation of catalogue seeds and source metadata. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const account = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002',
  product = '20000000-0000-4000-8000-000000000001',
  item = '30000000-0000-4000-8000-000000000001';
try {
  await db.exec(
    `CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE TABLE ai_products(id uuid PRIMARY KEY,account_id uuid,status text,kind text,superseded_by uuid);INSERT INTO ai_products VALUES('${product}','${account}','approved','product',NULL);CREATE TABLE quotations(account_id uuid,status text,workspace_version integer,document_details jsonb);`
  );
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/092_quotation_catalogue_creation.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  await db.exec(
    'CREATE TRIGGER check_details BEFORE INSERT OR UPDATE OF document_details ON quotations FOR EACH ROW EXECUTE FUNCTION validate_quotation_document_details()'
  );
  const seed = {
    catalogueSeed: {
      item: {
        id: item,
        productId: product,
        itemType: 'line',
        description: 'Window shutter',
        unit: 'm2',
        qty: 1,
        unitPrice: 390,
        measurementUnit: 'cm',
      },
    },
    knowledge: { prices: {}, references: [] },
  };
  await db.query("INSERT INTO quotations VALUES($1,'draft',0,$2)", [
    account,
    JSON.stringify(seed),
  ]);
  assert.equal(
    (
      await db.query('SELECT quotation_document_details_valid($1) ok', [
        JSON.stringify(seed),
      ])
    ).rows[0].ok,
    true
  );
  for (const invalid of [
    { unknown: 'x' },
    { knowledge: { prices: [], references: [] } },
    {
      ...seed,
      catalogueSeed: { item: { ...seed.catalogueSeed.item, unitPrice: -1 } },
    },
    {
      ...seed,
      catalogueSeed: {
        item: { ...seed.catalogueSeed.item, productId: 'foreign' },
      },
    },
  ])
    assert.equal(
      (
        await db.query('SELECT quotation_document_details_valid($1) ok', [
          JSON.stringify(invalid),
        ])
      ).rows[0].ok,
      false
    );
  await assert.rejects(
    db.query("INSERT INTO quotations VALUES($1,'draft',0,$2)", [
      other,
      JSON.stringify(seed),
    ]),
    /not found in this account/
  );
  await assert.rejects(
    db.query("INSERT INTO quotations VALUES($1,'sent',1,$2)", [
      account,
      JSON.stringify(seed),
    ]),
    /only to new drafts/
  );
  await db.query(
    'UPDATE quotations SET document_details=$1,workspace_version=1',
    [
      JSON.stringify({
        knowledge: seed.knowledge,
        paymentSchedule: {
          advance: 60,
          delivery: 30,
          completion: 10,
          deliveryTrigger: 'on_delivery',
        },
      }),
    ]
  );
  console.log(
    '8 quotation-creation schema checks passed: known metadata accepted, malformed/foreign/issued seeds rejected, saved seed consumed.'
  );
} finally {
  await db.close();
}
