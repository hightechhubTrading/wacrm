/** Disposable database validation of catalogue seeds and source metadata. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
let ssr;
const account = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002',
  product = '20000000-0000-4000-8000-000000000001',
  item = '30000000-0000-4000-8000-000000000001';
try {
  await db.exec(
    `CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE TABLE ai_products(id uuid PRIMARY KEY,account_id uuid,status text,kind text,superseded_by uuid,parent_id uuid);INSERT INTO ai_products(id,account_id,status,kind,superseded_by) VALUES('${product}','${account}','approved','product',NULL);CREATE TABLE quotations(account_id uuid,status text,workspace_version integer,document_details jsonb);`
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
    await readFile(
      new URL(
        '../supabase/migrations/093_quotation_structured_configuration.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/094_quotation_payment_allocation_limit.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  await db.exec(
    'CREATE TRIGGER check_details BEFORE INSERT OR UPDATE OF document_details ON quotations FOR EACH ROW EXECUTE FUNCTION validate_quotation_document_details()'
  );
  const seed = {
    formatVersion: 2,
    paymentPlan: { stages: [{ percent: 100, event: 'acceptance' }] },
    itemOptions: {
      [item]: { drawingReference: 'W-01', selections: { finish: 'White' } },
    },
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
    { formatVersion: 3 },
    { paymentPlan: { stages: [{ percent: 100, event: 'invented' }] } },
    { paymentPlan: { stages: [{ percent: '100', event: 'acceptance' }] } },
    { paymentPlan: { stages: [] } },
    {
      paymentPlan: {
        stages: [
          { percent: 40, event: 'acceptance' },
          { percent: 30, event: 'before_installation' },
          { percent: 70, event: 'unspecified' },
        ],
      },
    },
    { itemOptions: { foreign: { drawingReference: 'W-01' } } },
    { itemOptions: { [item]: { selections: { finish: 12 } } } },
    { itemOptions: { [item]: { unexpected: true } } },
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
      account,
      JSON.stringify({
        paymentPlan: { stages: [{ percent: 100, event: 'invented' }] },
      }),
    ]),
    /Invalid or unknown/
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
  await db.exec(
    `INSERT INTO ai_products(id,account_id,status,kind,parent_id) VALUES('20000000-0000-4000-8000-000000000002','${account}','approved','variant','${product}')`
  );
  await assert.rejects(
    db.query("INSERT INTO quotations VALUES($1,'draft',0,$2)", [
      account,
      JSON.stringify(seed),
    ]),
    /not found in this account/
  );
  await db.exec(
    "DELETE FROM ai_products WHERE id='20000000-0000-4000-8000-000000000002'"
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
  // Exercise the real creation payload against the production SQL trigger.
  // Browser fixtures intercept POST /api/quotations, so they cannot catch a
  // payload rejected only at the database boundary.
  const created = [];
  globalThis.__quotationCreationInsert = async (payload) => {
    await db.query("INSERT INTO quotations VALUES($1,'draft',0,$2)", [
      payload.account_id,
      JSON.stringify(payload.document_details ?? {}),
    ]);
    created.push(payload);
  };
  ssr = await createServer({
    configFile: false,
    root: process.cwd(),
    logLevel: 'error',
    resolve: {
      alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
    },
    server: { middlewareMode: true },
    plugins: [
      {
        name: 'quotation-creation-database',
        enforce: 'pre',
        resolveId(source, importer) {
          if (
            source.endsWith('/quotations/admin-client.ts') ||
            (source === './admin-client' &&
              /\/quotations\/(crud|reference)\.ts$/.test(importer ?? ''))
          )
            return '\0quotation-creation-admin';
        },
        load(id) {
          if (id !== '\0quotation-creation-admin') return;
          return `export function supabaseAdmin(){return {
          rpc:async()=>({data:'WS-26-TEST',error:null}),
          from:()=>({insert:payload=>({select:()=>({single:async()=>{
            await globalThis.__quotationCreationInsert(payload);
            return {data:{id:'fixture',...payload},error:null};
          }})})})
        }}`;
        },
      },
    ],
  });
  const { createQuotation } = await ssr.ssrLoadModule(
    '/src/lib/quotations/crud.ts'
  );
  for (const terms of [
    undefined,
    { deliveryTerms: '', paymentTerms: 'Agreed separately', warrantyTerms: '' },
    {
      deliveryTerms: '',
      paymentTerms: '',
      warrantyTerms: '',
      paymentPlan: seed.paymentPlan,
    },
  ]) {
    await createQuotation({
      accountId: account,
      productCode: 'WS',
      currency: 'QAR',
      preparedBy: 'Sales Person',
      catalogueSeed: { item: seed.catalogueSeed.item },
      catalogueTerms: terms,
    });
    const details = created.at(-1).document_details;
    assert.equal(details.preparedBy, 'Sales Person');
    assert.equal(details.document_details, undefined);
    assert.deepEqual(details.paymentPlan, terms?.paymentPlan);
  }
  await createQuotation({
    accountId: account,
    productCode: 'WS',
    currency: 'QAR',
    preparedBy: 'Sales Person',
  });
  assert.deepEqual(created.at(-1).document_details, {
    preparedBy: 'Sales Person',
  });
  const malformed = {
    ...created[0].document_details,
    document_details: { preparedBy: 'Sales Person' },
  };
  await assert.rejects(
    db.query("INSERT INTO quotations VALUES($1,'draft',0,$2)", [
      account,
      JSON.stringify(malformed),
    ]),
    /Invalid or unknown/
  );
  console.log(
    'Structured quotation schema checks passed: actual creation payloads with/without payment plans and blank drafts accepted; malformed nesting, foreign/issued seeds rejected; saved seed consumed.'
  );
} finally {
  await ssr?.close();
  delete globalThis.__quotationCreationInsert;
  await db.close();
}
