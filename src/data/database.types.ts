// Provisional schema contract. Replace with output from
// `supabase gen types typescript --local --schema public` after a local reset.
// RPC-only mutation grants are enforced by Postgres independently of these types.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
type Row = { id: string; user_id: string; revision: number; data: Json; created_at: string; updated_at: string };
type Table<R, D extends keyof R, Relationships extends readonly unknown[] = []> = {
  Row: R; Insert: Omit<R, D> & Partial<Pick<R, D>>; Update: Partial<R>; Relationships: Relationships;
};
type Defaults = 'user_id' | 'created_at' | 'updated_at';
type PlanRelationship<Name extends string> = {
  foreignKeyName: Name; columns: ['plan_id', 'user_id']; isOneToOne: false;
  referencedRelation: 'plans'; referencedColumns: ['id', 'user_id'];
};
export type Database = {
  public: {
    Tables: {
      profiles: Table<Row, Defaults>;
      plans: Table<Row, Defaults>;
      jump_results: Table<Row, Defaults>;
      workouts: Table<Row & { prescription_id: string }, Defaults, [{
        foreignKeyName: 'workouts_prescription_id_user_id_fkey'; columns: ['prescription_id', 'user_id'];
        isOneToOne: true; referencedRelation: 'prescriptions'; referencedColumns: ['id', 'user_id'];
      }]>;
      prescriptions: Table<{ id: string; user_id: string; plan_id: string; data: Json }, 'user_id', [
        PlanRelationship<'prescriptions_plan_id_user_id_fkey'>,
      ]>;
      adaptations: Table<{ id: string; user_id: string; plan_id: string; data: Json; created_at: string }, 'user_id' | 'created_at', [
        PlanRelationship<'adaptations_plan_id_user_id_fkey'>,
      ]>;
    };
    Views: {
      jump_history: { Row: { id: string | null; user_id: string | null; revision: number | null; data: Json | null; created_at: string | null }; Relationships: [] };
    };
    Functions: {
      save_record: { Args: { kind: string; record_id: string; expected_revision: number; payload: Json }; Returns: Json };
      delete_account: { Args: Record<string, never>; Returns: undefined };
      active_account: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: Record<string, never>; CompositeTypes: Record<string, never>;
  };
};
