ALTER TABLE public.user_settings ADD COLUMN email_search_terms TEXT[] DEFAULT ARRAY['Pagamento Pix recebido'];

UPDATE public.user_settings 
SET email_search_terms = ARRAY[COALESCE(NULLIF(email_search_term, ''), 'Pagamento Pix recebido')]
WHERE email_search_term IS NOT NULL;

UPDATE public.user_settings 
SET email_search_terms = ARRAY['Pagamento Pix recebido']
WHERE email_search_terms IS NULL;

ALTER TABLE public.user_settings ALTER COLUMN email_search_terms SET NOT NULL;

ALTER TABLE public.user_settings DROP COLUMN IF EXISTS email_search_term;