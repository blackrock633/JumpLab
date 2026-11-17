// Schema-derived contract. Regenerate with `supabase gen types typescript --local`;
// a generated-output comparison remains required against a running database.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
type Row = { id: string; user_id: string; revision: number; data: Json; created_at: string; updated_at: string };
type ReadTable<R> = { Row: R; Insert: never; Update: never; Relationships: [] };
export type Database = {
  public: {
    Tables: {
      profiles: ReadTable<Row>; plans: ReadTable<Row>; jump_results: ReadTable<Row>;
      workouts: ReadTable<Row & { prescription_id: string }>;
      prescriptions: ReadTable<{ id: string; user_id: string; plan_id: string; data: Json }>;
      adaptations: ReadTable<{ id: string; user_id: string; plan_id: string; data: Json; created_at: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      save_record: { Args: { kind: string; record_id: string; expected_revision: number; payload: Json }; Returns: number };
      delete_account: { Args: Record<string, never>; Returns: undefined };
      active_account: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: Record<string, never>; CompositeTypes: Record<string, never>;
  };
};
