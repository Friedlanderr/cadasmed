CREATE TABLE public.sent_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  file_id text NOT NULL,
  file_name text,
  sheet_name text,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, file_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sent_invoices TO authenticated;
GRANT ALL ON public.sent_invoices TO service_role;

ALTER TABLE public.sent_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sent_invoices_self_select" ON public.sent_invoices
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "sent_invoices_self_insert" ON public.sent_invoices
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sent_invoices_self_delete" ON public.sent_invoices
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_sent_invoices_user ON public.sent_invoices(user_id);