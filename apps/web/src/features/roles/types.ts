export type PermissionRow = {
  key: string;
  group: string;
  description: string;
};

export type PermissionGroup = {
  name: string;
  permissions: PermissionRow[];
};

export type RoleSummary = {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_protected: boolean;
  user_count: number;
  permission_count: number;
};

export type RoleDetail = RoleSummary & { permission_keys: string[] };
