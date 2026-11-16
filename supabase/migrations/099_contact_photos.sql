-- Contact thumbnails are immutable, private and served only after contact RLS.
-- No browser/native storage policies: the authenticated application route
-- checks contact visibility and agent role before bounded storage operations.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('contact-photos','contact-photos',false,65536,ARRAY['image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=65536,
 allowed_mime_types=ARRAY['image/webp'];
