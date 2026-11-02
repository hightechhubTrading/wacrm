/** Disposable integration checks for the canonical inventory projection and evidence boundaries. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const a = '20000000-0000-4000-8000-000000000001',
  b = '20000000-0000-4000-8000-000000000002',
  u = '10000000-0000-4000-8000-000000000001',
  p = '30000000-0000-4000-8000-000000000001',
  c = '30000000-0000-4000-8000-000000000002',
  legacy = '30000000-0000-4000-8000-000000000003',
  source = '40000000-0000-4000-8000-000000000001',
  foreignSource = '40000000-0000-4000-8000-000000000002',
  question = '50000000-0000-4000-8000-000000000001';
let checks = 0;
const eq = (x, y) => {
  assert.deepEqual(x, y);
  checks++;
};
try {
  await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE FUNCTION is_account_member(a uuid,r text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT a::text=current_setting('app.account',true) AND auth.uid() IS NOT NULL AND (r IS NULL OR r='agent' OR current_setting('app.role',true)='admin')$$;
CREATE TABLE accounts(id uuid PRIMARY KEY); INSERT INTO accounts VALUES('${a}'),('${b}');
CREATE TABLE ai_products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL,created_by uuid,name text NOT NULL,description text NOT NULL,kind text DEFAULT 'product',parent_id uuid,status text DEFAULT 'approved',superseded_by uuid,specifications text DEFAULT '',price_min numeric,price_max numeric,price_unit text,source_notes text DEFAULT '',updated_at timestamptz DEFAULT now(),UNIQUE(account_id,id));
CREATE TABLE catalog_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL,created_by uuid,category text DEFAULT 'product',name text,name_ar text,description text,description_ar text,sku text,unit_of_measure text,default_unit_price numeric,status text);
CREATE TABLE quotation_items(id uuid PRIMARY KEY,account_id uuid,product_id uuid REFERENCES catalog_items(id) ON DELETE SET NULL,description text,unit_price numeric);
CREATE TABLE ai_catalog_questions(id uuid PRIMARY KEY,account_id uuid,answer text,status text);
CREATE TABLE quotation_knowledge_records(id uuid PRIMARY KEY,account_id uuid);
INSERT INTO ai_products(id,account_id,name,description,kind) VALUES('${p}','${a}','Family','Family','family');
INSERT INTO ai_products(id,account_id,name,description,parent_id,price_min,price_max,price_unit) VALUES('${c}','${a}','Window','Original','${p}',350,380,'per_square_meter');
INSERT INTO catalog_items(id,account_id,name,default_unit_price,status) VALUES('${legacy}','${a}','Legacy',100,'active');
INSERT INTO quotation_items VALUES('${u}','${a}','${legacy}','Issued snapshot',999);
INSERT INTO ai_catalog_questions VALUES('${question}','${a}','Staff answer','closed');
INSERT INTO quotation_knowledge_records VALUES('${source}','${a}'),('${foreignSource}','${b}');
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;CREATE POLICY cr ON catalog_items FOR SELECT USING(is_account_member(account_id));
ALTER TABLE ai_products ENABLE ROW LEVEL SECURITY;CREATE POLICY pr ON ai_products FOR SELECT USING(is_account_member(account_id));
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;GRANT SELECT,INSERT,UPDATE,DELETE ON catalog_items TO authenticated; GRANT SELECT ON ai_products,quotation_knowledge_records TO authenticated;`);
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/091_shared_product_inventory.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  eq(
    (
      await db.query(
        `SELECT status,price_min,price_max,default_unit_price,unit_of_measure FROM catalog_items WHERE id='${c}'`
      )
    ).rows[0],
    {
      status: 'active',
      price_min: '350',
      price_max: '380',
      default_unit_price: null,
      unit_of_measure: 'm2',
    }
  );
  eq(
    (
      await db.query(
        `SELECT status,customer_visible,source_notes LIKE '%100%' AS preserved FROM ai_products WHERE id='${legacy}'`
      )
    ).rows[0],
    { status: 'draft', customer_visible: false, preserved: true }
  );
  eq(
    (await db.query('SELECT description,unit_price FROM quotation_items'))
      .rows[0],
    { description: 'Issued snapshot', unit_price: '999' }
  );
  await db.exec(
    `UPDATE ai_products SET name='Updated',price_min=390,price_max=390 WHERE id='${c}'`
  );
  eq(
    (
      await db.query(
        `SELECT name,default_unit_price FROM catalog_items WHERE id='${c}'`
      )
    ).rows[0],
    { name: 'Updated', default_unit_price: '390' }
  );
  await db.exec(`UPDATE ai_products SET status='draft' WHERE id='${p}'`);
  eq(
    (
      await db.query(
        `SELECT status,default_unit_price FROM catalog_items WHERE id='${c}'`
      )
    ).rows[0],
    { status: 'archived', default_unit_price: null }
  );
  await db.exec(
    `UPDATE ai_products SET status='approved',customer_visible=false WHERE id='${p}'`
  );
  eq(
    (await db.query(`SELECT ai_product_is_approved('${c}','${a}') ok`)).rows[0]
      .ok,
    false
  );
  await db.exec(`UPDATE ai_products SET customer_visible=true WHERE id='${p}'`);
  eq(
    (await db.query(`SELECT ai_product_is_approved('${c}','${a}') ok`)).rows[0]
      .ok,
    true
  );
  await assert.rejects(
    db.exec(`DELETE FROM ai_products WHERE id='${legacy}'`),
    /referenced by quotations/
  );
  checks++;
  await db.exec(
    `SET ROLE authenticated; SET app.account='${a}';SET app.role='agent';SET request.jwt.claim.sub='${u}';`
  );
  await assert.rejects(
    db.exec(`UPDATE catalog_items SET name='Bypass' WHERE id='${c}'`),
    /permission denied/
  );
  checks++;
  const draft = (
    await db.query(
      `SELECT create_shared_catalog_draft('${a}','{"name":"Proposal","defaultUnitPrice":123,"category":"component"}') id`
    )
  ).rows[0].id;
  eq(
    (
      await db.query(
        'SELECT status,customer_visible,inventory_type,price_min FROM ai_products WHERE id=$1',
        [draft]
      )
    ).rows[0],
    {
      status: 'draft',
      customer_visible: false,
      inventory_type: 'component',
      price_min: null,
    }
  );
  await assert.rejects(
    db.exec(
      `SELECT create_shared_catalog_draft('${b}','{"name":"Wrong tenant"}')`
    ),
    /Agent required/
  );
  checks++;
  await assert.rejects(
    db.exec(
      `INSERT INTO product_source_links(account_id,product_id,source_record_id,relationship) VALUES('${a}','${c}','${source}','product')`
    ),
    /row-level security/
  );
  checks++;
  await db.exec(`SET app.role='admin'`);
  await assert.rejects(
    db.exec(
      `INSERT INTO product_source_links(account_id,product_id,source_record_id,relationship) VALUES('${a}','${c}','${foreignSource}','product')`
    ),
    /must belong/
  );
  checks++;
  await db.exec(`INSERT INTO product_source_links(account_id,product_id,source_record_id,relationship) VALUES('${a}','${c}','${source}','product');
INSERT INTO catalog_question_findings(account_id,question_id,source_record_id,coverage,finding,remaining_question) VALUES('${a}','${question}','${source}','partial','Source context','Exact model remains unknown');`);
  await db.exec(`RESET ROLE`);
  eq(
    (await db.query('SELECT answer,status FROM ai_catalog_questions')).rows[0],
    { answer: 'Staff answer', status: 'closed' }
  );
  await db.exec(`SET ROLE authenticated;SET app.account='${b}'`);
  eq((await db.query('SELECT * FROM catalog_question_findings')).rows, []);
  eq((await db.query('SELECT * FROM product_source_links')).rows, []);
  console.log(`${checks} shared inventory database checks passed.`);
} finally {
  await db.close();
}
