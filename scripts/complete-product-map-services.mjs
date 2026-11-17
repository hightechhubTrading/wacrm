/** Guarded follow-up: complete the service shelf and the last reviewed photo assignments. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const dir = '.local/product-map',
  baseline = JSON.parse(fs.readFileSync(`${dir}/after.json`)),
  original = JSON.parse(fs.readFileSync(`${dir}/before.json`)),
  manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`));
const a = original.accountId,
  u = original.userId;
process.loadEnvFile('.env.local');
if (
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
  `${fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim()}.supabase.co`
)
  throw Error('Linked project mismatch');
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;
const family = baseline.products.find(
  (p) => p.name === 'Services and Delivery'
);
if (!family) throw Error('Service family missing');
const services = [
  [
    'Site Visit and Measurement',
    'معاينة الموقع وأخذ المقاسات',
    'SVC-MEASURE',
    'approved',
  ],
  ['Electrical Connection', 'توصيل الكهرباء', 'SVC-ELECTRICAL', 'approved'],
  ['Box and Decor Work', 'أعمال البوكس والديكور', 'SVC-DECOR', 'approved'],
  ['Repair Visit', 'زيارة صيانة', 'SVC-REPAIR', 'draft'],
  ['Motor Replacement', 'استبدال المحرك', 'SVC-MOTOR', 'draft'],
  ['Annual Maintenance', 'صيانة سنوية', 'SVC-ANNUAL', 'draft'],
];
const sql = [
  `BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'; SELECT pg_advisory_xact_lock(hashtextextended(${lit(a)},101));`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM profiles WHERE account_id=${lit(a)} AND user_id=${lit(u)} AND account_role IN ('owner','admin')) THEN RAISE EXCEPTION 'Account admin required';END IF;END $$;`,
  `CREATE TEMP TABLE saved_products AS SELECT * FROM ai_products WHERE account_id=${lit(a)};`,
  `DO $$ BEGIN IF (SELECT count(*) FROM saved_products)<>${baseline.products.length} THEN RAISE EXCEPTION 'Inventory changed';END IF;END $$;`,
];
for (const [name, ar, sku, status] of services) {
  const hash = createHash('sha256')
    .update(`${a}:product-map-v3:${sku}`)
    .digest('hex');
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  sql.push(
    `INSERT INTO ai_products(id,account_id,created_by,parent_id,kind,inventory_type,name,name_ar,description,description_ar,sku,unit_of_measure,status,customer_visible,source_notes,limitations) VALUES(${lit(id)},${lit(a)},${lit(u)},${lit(family.id)},'product','service',${lit(name)},${lit(ar)},${lit(name)},${lit(ar)},${lit(sku)},'job',${lit(status)},false,'Owner-directed product map v3, 17 November 2026. No price was supplied. Installation is included in products and is not a separately charged service.','${status === 'draft' ? 'After-sale service availability remains unconfirmed. ' : ''}Quotation-specific scope and selling price are required.');`
  );
}
const mediaChanges = [
  { index: 33, to: manifest.rows.find((r) => r.name === 'Swing').id },
  {
    index: 49,
    to: original.products.find(
      (r) => r.name === 'Aluminium Roller Window Shutters'
    ).id,
  },
];
for (const d of mediaChanges) {
  const old = baseline.media.find((m) => m.id === original.media[d.index].id);
  sql.push(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM ai_product_media WHERE id=${lit(old.id)} AND account_id=${lit(a)} AND product_id=${lit(old.product_id)}) THEN RAISE EXCEPTION 'Media moved since review';END IF;END $$;UPDATE ai_product_media SET product_id=${lit(d.to)} WHERE account_id=${lit(a)} AND id=${lit(old.id)};`
  );
}
sql.push(
  `DO $$ BEGIN IF EXISTS(SELECT * FROM saved_products EXCEPT SELECT * FROM ai_products WHERE account_id=${lit(a)}) THEN RAISE EXCEPTION 'Original product changed';END IF;END $$;`,
  process.argv.includes('--apply') ? 'COMMIT;' : 'ROLLBACK;'
);
fs.writeFileSync(`${dir}/complete-services.sql`, sql.join('\n'), {
  mode: 0o600,
});
const r = spawnSync(
  'supabase',
  [
    'db',
    'query',
    '--linked',
    '--file',
    `${dir}/complete-services.sql`,
    '-o',
    'json',
  ],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
);
fs.writeFileSync(
  `${dir}/complete-services-${process.argv.includes('--apply') ? 'applied' : 'rehearsal'}.json`,
  r.stdout || r.stderr,
  { mode: 0o600 }
);
if (r.status) throw Error(r.stderr || r.stdout);
console.log(
  process.argv.includes('--apply')
    ? 'Committed 6 service records and 2 reviewed media moves'
    : 'Follow-up rehearsal passed and rolled back'
);
