-- An acknowledgement holds its notice row before touching the event. The drain
-- locks events first, so fail/retry immediately instead of waiting in a deadlock.
BEGIN;
CREATE OR REPLACE FUNCTION sync_notification_ack() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.acknowledged_at IS NOT NULL AND OLD.acknowledged_at IS NULL THEN
  PERFORM id FROM notification_events WHERE id=NEW.event_id AND user_id=NEW.user_id FOR UPDATE NOWAIT;
  UPDATE notification_events SET acknowledged_at=NEW.acknowledged_at WHERE id=NEW.event_id AND user_id=NEW.user_id;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION notification_operations_ready() RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT to_regprocedure('maintain_notifications()') IS NOT NULL AND to_regclass('notification_worker_health') IS NOT NULL
 AND has_function_privilege('service_role','maintain_notifications()','EXECUTE')
 AND NOT has_function_privilege('authenticated','maintain_notifications()','EXECUTE')
 AND pg_get_functiondef('sync_notification_ack()'::regprocedure) LIKE '%NOWAIT%'
 AND (SELECT count(*)=4 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'D' AND tgname IN
 ('capture_review_notification','capture_media_notification','capture_appointment_notice','hydrate_notification'));
$$;
COMMIT;
