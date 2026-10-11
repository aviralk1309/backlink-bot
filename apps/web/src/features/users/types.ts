import type { ProfileStatus } from "../../lib/auth/gate";

export type UserRow = {
  id: string;
  email: string;
  full_name: string;
  status: ProfileStatus;
  role_id: string | null;
  role_name: string | null;
  created_at: string;
};

export type RoleOption = { id: string; name: string };
