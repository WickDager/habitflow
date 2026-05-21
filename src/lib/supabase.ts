import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let browserClientInstance: ReturnType<
  typeof createClient<Database>
> | null = null;

export function browserClient() {
  if (browserClientInstance) return browserClientInstance;
  browserClientInstance = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return browserClientInstance;
}

export function serverClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
