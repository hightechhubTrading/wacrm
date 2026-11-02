-- One canonical product identity for knowledge, quotation selection and inventory.
-- catalog_items is a compatibility projection; issued quote rows/PDFs are untouched.
ALTER TABLE public.ai_products
 ADD COLUMN inventory_type text NOT NULL DEFAULT 'product' CHECK(inventory_type IN ('product','component','equipment','service')),
 ADD COLUMN sku text,
 ADD COLUMN name_ar text,
 ADD COLUMN description_ar text,
 ADD COLUMN unit_of_measure text,
 ADD COLUMN customer_visible boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX shared_inventory_sku ON public.ai_products(account_id,sku) WHERE sku IS NOT NULL;

-- Preserve every legacy catalogue identity and its original values for review.
INSERT INTO public.ai_products(id,account_id,created_by,name,description,kind,status,inventory_type,
 sku,name_ar,description_ar,unit_of_measure,customer_visible,source_notes)
SELECT c.id,c.account_id,c.created_by,c.name,coalesce(nullif(c.description,''),'Legacy quotation item; description and unit require review.'),
 'product','draft',CASE WHEN c.category IN ('component','equipment','service') THEN c.category ELSE 'product' END,
 c.sku,c.name_ar,c.description_ar,c.unit_of_measure,false,
 'Original quotation catalogue record (retained, not approved company facts): '||to_jsonb(c)::text
FROM public.catalog_items c WHERE NOT EXISTS(SELECT 1 FROM public.ai_products p WHERE p.id=c.id);
ALTER TABLE public.catalog_items ADD CONSTRAINT shared_catalog_product_fk
 FOREIGN KEY(account_id,id) REFERENCES public.ai_products(account_id,id) ON DELETE CASCADE;
ALTER TABLE public.catalog_items ADD COLUMN price_min numeric, ADD COLUMN price_max numeric,
 ADD COLUMN price_unit text, ADD COLUMN review_status text, ADD COLUMN customer_visible boolean;

CREATE OR REPLACE FUNCTION public.ai_product_is_approved(p_id uuid,p_account uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH RECURSIVE chain AS (
  SELECT id,parent_id,status,superseded_by,customer_visible FROM ai_products WHERE id=p_id AND account_id=p_account
  UNION SELECT p.id,p.parent_id,p.status,p.superseded_by,p.customer_visible FROM ai_products p JOIN chain c ON p.id=c.parent_id WHERE p.account_id=p_account
 ) SELECT count(*)>0 AND bool_and(status='approved' AND superseded_by IS NULL AND customer_visible) AND bool_or(parent_id IS NULL) FROM chain;
$$;
CREATE FUNCTION public.sync_shared_product_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE product ai_products;
BEGIN
 -- Recompute descendants when approval/ancestry changes; never update quote snapshots.
 FOR product IN WITH RECURSIVE branch AS (
  SELECT * FROM ai_products WHERE id=NEW.id AND account_id=NEW.account_id
  UNION ALL SELECT p.* FROM ai_products p JOIN branch b ON p.parent_id=b.id WHERE p.account_id=NEW.account_id
 ) SELECT * FROM branch LOOP
  INSERT INTO catalog_items(id,account_id,created_by,category,name,name_ar,description,description_ar,sku,unit_of_measure,
    default_unit_price,status,price_min,price_max,price_unit,review_status,customer_visible)
  VALUES(product.id,product.account_id,product.created_by,product.inventory_type,product.name,product.name_ar,
    coalesce(nullif(product.specifications,''),product.description),product.description_ar,product.sku,
    coalesce(product.unit_of_measure,CASE product.price_unit WHEN 'per_square_meter' THEN 'm2' WHEN 'per_meter' THEN 'm' WHEN 'per_item' THEN 'piece' WHEN 'per_project' THEN 'job' END),
    CASE WHEN ai_product_is_approved(product.id,product.account_id) AND product.price_min=product.price_max THEN product.price_min ELSE NULL END,
    CASE WHEN product.kind<>'family' AND ai_product_is_approved(product.id,product.account_id) THEN 'active' ELSE 'archived' END,
    product.price_min,product.price_max,product.price_unit,product.status,product.customer_visible)
  ON CONFLICT(id) DO UPDATE SET category=EXCLUDED.category,name=EXCLUDED.name,name_ar=EXCLUDED.name_ar,
    description=EXCLUDED.description,description_ar=EXCLUDED.description_ar,sku=EXCLUDED.sku,unit_of_measure=EXCLUDED.unit_of_measure,
    default_unit_price=EXCLUDED.default_unit_price,status=EXCLUDED.status,price_min=EXCLUDED.price_min,price_max=EXCLUDED.price_max,
    price_unit=EXCLUDED.price_unit,review_status=EXCLUDED.review_status,customer_visible=EXCLUDED.customer_visible;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER shared_product_projection AFTER INSERT OR UPDATE ON public.ai_products
 FOR EACH ROW EXECUTE FUNCTION public.sync_shared_product_projection();
-- Build projections without editing canonical facts, timestamps or existing vectors.
DO $$ DECLARE p ai_products; BEGIN
 FOR p IN SELECT * FROM ai_products LOOP
  INSERT INTO catalog_items(id,account_id,created_by,category,name,name_ar,description,description_ar,sku,unit_of_measure,default_unit_price,status,price_min,price_max,price_unit,review_status,customer_visible)
  VALUES(p.id,p.account_id,p.created_by,p.inventory_type,p.name,p.name_ar,coalesce(nullif(p.specifications,''),p.description),p.description_ar,p.sku,
   coalesce(p.unit_of_measure,CASE p.price_unit WHEN 'per_square_meter' THEN 'm2' WHEN 'per_meter' THEN 'm' WHEN 'per_item' THEN 'piece' WHEN 'per_project' THEN 'job' END),
   CASE WHEN ai_product_is_approved(p.id,p.account_id) AND p.price_min=p.price_max THEN p.price_min END,
   CASE WHEN p.kind<>'family' AND ai_product_is_approved(p.id,p.account_id) THEN 'active' ELSE 'archived' END,p.price_min,p.price_max,p.price_unit,p.status,p.customer_visible)
  ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,name_ar=EXCLUDED.name_ar,description=EXCLUDED.description,description_ar=EXCLUDED.description_ar,
   category=EXCLUDED.category,sku=EXCLUDED.sku,unit_of_measure=EXCLUDED.unit_of_measure,default_unit_price=EXCLUDED.default_unit_price,status=EXCLUDED.status,
   price_min=EXCLUDED.price_min,price_max=EXCLUDED.price_max,price_unit=EXCLUDED.price_unit,review_status=EXCLUDED.review_status,customer_visible=EXCLUDED.customer_visible;
 END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE ON public.catalog_items FROM authenticated;
REVOKE ALL ON FUNCTION public.sync_shared_product_projection() FROM PUBLIC;

CREATE FUNCTION public.create_shared_catalog_draft(p_account uuid,p_item jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; type text;
BEGIN
 IF NOT is_account_member(p_account,'agent') THEN RAISE EXCEPTION 'Agent required'; END IF;
 IF jsonb_typeof(p_item)<>'object' OR length(trim(coalesce(p_item->>'name','')))=0 OR length(p_item->>'name')>500 THEN RAISE EXCEPTION 'Enter a product name'; END IF;
 IF p_item ? 'defaultUnitPrice' AND ((p_item->>'defaultUnitPrice')::numeric<0 OR (p_item->>'defaultUnitPrice')::numeric::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Invalid price'; END IF;
 type:=CASE WHEN p_item->>'category' IN ('component','equipment','service') THEN p_item->>'category' ELSE 'product' END;
 INSERT INTO ai_products(account_id,created_by,name,name_ar,description,description_ar,sku,unit_of_measure,inventory_type,kind,status,customer_visible,source_notes)
 VALUES(p_account,auth.uid(),trim(p_item->>'name'),p_item->>'nameAr',coalesce(nullif(p_item->>'description',''),'Quotation proposal; details require review.'),p_item->>'descriptionAr',nullif(p_item->>'sku',''),p_item->>'unitOfMeasure',type,'product','draft',false,'Quotation proposal, not approved company information: '||p_item::text)
 RETURNING id INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.create_shared_catalog_draft(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_shared_catalog_draft(uuid,jsonb) TO authenticated;

-- Source links attach archive evidence to exact canonical items, without approving it.
CREATE TABLE public.product_source_links (
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 product_id uuid NOT NULL, source_record_id uuid NOT NULL REFERENCES quotation_knowledge_records(id) ON DELETE CASCADE,
 relationship text NOT NULL CHECK(relationship IN ('product','price','component','supplier','specification','example')),
 notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(product_id,source_record_id), FOREIGN KEY(account_id,product_id) REFERENCES ai_products(account_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX catalog_questions_account_id_id ON ai_catalog_questions(account_id,id);
CREATE TABLE public.catalog_question_findings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 question_id uuid NOT NULL, source_record_id uuid NOT NULL REFERENCES quotation_knowledge_records(id) ON DELETE CASCADE,
 coverage text NOT NULL CHECK(coverage IN ('partial','answers','not_answered')),
 finding text NOT NULL, remaining_question text NOT NULL DEFAULT '',
 created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(question_id,source_record_id), FOREIGN KEY(account_id,question_id) REFERENCES ai_catalog_questions(account_id,id) ON DELETE CASCADE
);
CREATE FUNCTION public.validate_product_source_account() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM quotation_knowledge_records WHERE id=NEW.source_record_id AND account_id=NEW.account_id) THEN RAISE EXCEPTION 'Source record must belong to this account'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER product_source_account BEFORE INSERT OR UPDATE ON product_source_links FOR EACH ROW EXECUTE FUNCTION validate_product_source_account();
CREATE TRIGGER question_source_account BEFORE INSERT OR UPDATE ON catalog_question_findings FOR EACH ROW EXECUTE FUNCTION validate_product_source_account();
ALTER TABLE product_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_question_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_source_read ON product_source_links FOR SELECT USING(is_account_member(account_id));
CREATE POLICY product_source_write ON product_source_links FOR ALL USING(is_account_member(account_id,'admin')) WITH CHECK(is_account_member(account_id,'admin'));
CREATE POLICY question_findings_read ON catalog_question_findings FOR SELECT USING(is_account_member(account_id));
CREATE POLICY question_findings_write ON catalog_question_findings FOR ALL USING(is_account_member(account_id,'admin')) WITH CHECK(is_account_member(account_id,'admin'));
GRANT SELECT,INSERT,UPDATE,DELETE ON product_source_links,catalog_question_findings TO authenticated,service_role;
REVOKE ALL ON product_source_links,catalog_question_findings FROM anon;

CREATE FUNCTION public.protect_quoted_inventory_product() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM quotation_items WHERE product_id=OLD.id AND account_id=OLD.account_id) THEN
  RAISE EXCEPTION 'This inventory item is referenced by quotations. Retain it and withdraw approval instead of deleting it.' USING ERRCODE='23503';
 END IF; RETURN OLD;
END; $$;
CREATE TRIGGER protect_quoted_inventory_product BEFORE DELETE ON ai_products FOR EACH ROW EXECUTE FUNCTION protect_quoted_inventory_product();
