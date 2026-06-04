-- Sub op codes (variants) for parent op codes.
-- Example: recall 24TA07 → sub codes R1, R2, R3, each with its own flag hours.

CREATE TABLE public.op_code_variants (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  op_code_id   UUID         NOT NULL REFERENCES public.op_codes(id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code         TEXT         NOT NULL,
  description  TEXT         NOT NULL DEFAULT '',
  flag_hours   NUMERIC(6,2) NOT NULL DEFAULT 0,
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.op_code_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their op code variants"
  ON public.op_code_variants
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Link an RO line to a specific sub op code (nullable — legacy lines have no sub).
ALTER TABLE public.entry_op_codes
  ADD COLUMN sub_op_code_id UUID
  REFERENCES public.op_code_variants(id) ON DELETE SET NULL;
