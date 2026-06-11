-- RPC to reorder op codes in a single UPDATE instead of N parallel round trips.
-- Accepts a JSONB array of {id, sort_order} pairs.
-- auth.uid() filter ensures users can only reorder their own op codes.
CREATE OR REPLACE FUNCTION reorder_op_codes(updates jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE op_codes oc
  SET sort_order = (u->>'sort_order')::int
  FROM jsonb_array_elements(updates) AS u
  WHERE oc.id = (u->>'id')::uuid
    AND oc.user_id = auth.uid();
END;
$$;
