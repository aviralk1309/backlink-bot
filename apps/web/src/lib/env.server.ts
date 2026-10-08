import "server-only";
import { z } from "zod";

export const serverEnv = z
  .object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) })
  .parse({ SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY });
