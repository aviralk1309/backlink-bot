export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      activity_profiles: {
        Row: {
          created_at: string;
          enabled: boolean;
          footprint_templates: NonNullable<Json>;
          id: string;
          key: string;
          name: string;
          page_type_signals: NonNullable<Json>;
          per_domain_cap: number;
          relevance_rule: NonNullable<Json>;
          reviewer_fields: NonNullable<Json>;
          scoring_weights: NonNullable<Json>;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          enabled?: boolean;
          footprint_templates?: NonNullable<Json>;
          id?: string;
          key: string;
          name: string;
          page_type_signals?: NonNullable<Json>;
          per_domain_cap?: number;
          relevance_rule?: NonNullable<Json>;
          reviewer_fields?: NonNullable<Json>;
          scoring_weights?: NonNullable<Json>;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          footprint_templates?: NonNullable<Json>;
          id?: string;
          key?: string;
          name?: string;
          page_type_signals?: NonNullable<Json>;
          per_domain_cap?: number;
          relevance_rule?: NonNullable<Json>;
          reviewer_fields?: NonNullable<Json>;
          scoring_weights?: NonNullable<Json>;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      blocklist: {
        Row: {
          added_by: string | null;
          created_at: string;
          domain: string;
          id: string;
          reason: string | null;
          source_job_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          created_at?: string;
          domain: string;
          id?: string;
          reason?: string | null;
          source_job_id?: string | null;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          domain?: string;
          id?: string;
          reason?: string | null;
          source_job_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "blocklist_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocklist_source_job_id_fkey";
            columns: ["source_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_config_history: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          job_id: string;
          snapshot: NonNullable<Json>;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          job_id: string;
          snapshot: NonNullable<Json>;
          version: number;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          job_id?: string;
          snapshot?: NonNullable<Json>;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "job_config_history_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_config_history_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_events: {
        Row: {
          actor: string | null;
          config_version: number | null;
          created_at: string;
          id: number;
          job_id: string;
          payload: NonNullable<Json>;
          type: string;
        };
        ComputedFields: never;
        Insert: {
          actor?: string | null;
          config_version?: number | null;
          created_at?: string;
          id?: never;
          job_id: string;
          payload?: NonNullable<Json>;
          type: string;
        };
        Update: {
          actor?: string | null;
          config_version?: number | null;
          created_at?: string;
          id?: never;
          job_id?: string;
          payload?: NonNullable<Json>;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_events_actor_fkey";
            columns: ["actor"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_events_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          activity_keys: string[];
          banned_categories: string[];
          blocked_domains: string[];
          brand_variants: string[];
          budget_credits: number;
          business_type: string | null;
          client: string | null;
          client_domain: string | null;
          competitor_domains: string[];
          config_version: number;
          country: string | null;
          created_at: string;
          created_by: string | null;
          finished_at: string | null;
          id: string;
          job_type: string;
          language: string | null;
          local_business: Json | null;
          name: string;
          pages_per_query: number;
          per_domain_cap: number;
          reference_sites: string[];
          regions: string[];
          require_language_region_match: boolean;
          review_queue_size: number;
          saturation_n: number;
          saturation_x: number;
          scrape_credit_cap: number;
          seed_keywords: string[];
          seed_list_urls: string[];
          skip_previously_spam_domains: boolean;
          started_at: string | null;
          status: Database["public"]["Enums"]["job_status"];
          status_reason: string | null;
          sub_niche: string | null;
          target_urls: string[];
          updated_at: string;
          job_config_snapshot: Json | null;
        };
        ComputedFields: "job_config_snapshot";
        Insert: {
          activity_keys?: string[];
          banned_categories?: string[];
          blocked_domains?: string[];
          brand_variants?: string[];
          budget_credits?: number;
          business_type?: string | null;
          client?: string | null;
          client_domain?: string | null;
          competitor_domains?: string[];
          config_version?: number;
          country?: string | null;
          created_at?: string;
          created_by?: string | null;
          finished_at?: string | null;
          id?: string;
          job_type?: string;
          language?: string | null;
          local_business?: Json | null;
          name: string;
          pages_per_query?: number;
          per_domain_cap?: number;
          reference_sites?: string[];
          regions?: string[];
          require_language_region_match?: boolean;
          review_queue_size?: number;
          saturation_n?: number;
          saturation_x?: number;
          scrape_credit_cap?: number;
          seed_keywords?: string[];
          seed_list_urls?: string[];
          skip_previously_spam_domains?: boolean;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          status_reason?: string | null;
          sub_niche?: string | null;
          target_urls?: string[];
          updated_at?: string;
        };
        Update: {
          activity_keys?: string[];
          banned_categories?: string[];
          blocked_domains?: string[];
          brand_variants?: string[];
          budget_credits?: number;
          business_type?: string | null;
          client?: string | null;
          client_domain?: string | null;
          competitor_domains?: string[];
          config_version?: number;
          country?: string | null;
          created_at?: string;
          created_by?: string | null;
          finished_at?: string | null;
          id?: string;
          job_type?: string;
          language?: string | null;
          local_business?: Json | null;
          name?: string;
          pages_per_query?: number;
          per_domain_cap?: number;
          reference_sites?: string[];
          regions?: string[];
          require_language_region_match?: boolean;
          review_queue_size?: number;
          saturation_n?: number;
          saturation_x?: number;
          scrape_credit_cap?: number;
          seed_keywords?: string[];
          seed_list_urls?: string[];
          skip_previously_spam_domains?: boolean;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          status_reason?: string | null;
          sub_niche?: string | null;
          target_urls?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      permissions: {
        Row: {
          description: string;
          group: string;
          key: string;
        };
        ComputedFields: never;
        Insert: {
          description: string;
          group: string;
          key: string;
        };
        Update: {
          description?: string;
          group?: string;
          key?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          role_id: string | null;
          status: Database["public"]["Enums"]["profile_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          email: string;
          full_name?: string;
          id: string;
          role_id?: string | null;
          status?: Database["public"]["Enums"]["profile_status"];
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          role_id?: string | null;
          status?: Database["public"]["Enums"]["profile_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      role_permissions: {
        Row: {
          permission_key: string;
          role_id: string;
        };
        ComputedFields: never;
        Insert: {
          permission_key: string;
          role_id: string;
        };
        Update: {
          permission_key?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey";
            columns: ["permission_key"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      roles: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_protected: boolean;
          is_system: boolean;
          name: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_protected?: boolean;
          is_system?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_protected?: boolean;
          is_system?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_role_id: { Args: Record<PropertyKey, never>; Returns: string };
      has_permission: { Args: { p_key: string }; Returns: boolean };
      job_apply_transition: {
        Args: {
          p_action: string;
          p_actor: string;
          p_job_id: string;
          p_reason: string;
        };
        Returns: Database["public"]["Enums"]["job_status"];
      };
      job_config_snapshot: {
        Args: {
          j: Omit<
            Database["public"]["Tables"]["jobs"]["Row"],
            Database["public"]["Tables"]["jobs"]["ComputedFields"]
          >;
        };
        Returns: Json;
      };
      job_start_problems: { Args: { p_job_id: string }; Returns: string[] };
      job_transition_target: {
        Args: {
          p_action: string;
          p_status: Database["public"]["Enums"]["job_status"];
        };
        Returns: Database["public"]["Enums"]["job_status"];
      };
      role_user_counts: {
        Args: Record<PropertyKey, never>;
        Returns: {
          role_id: string;
          user_count: number;
        }[];
      };
      save_role: {
        Args: {
          p_description: string;
          p_name: string;
          p_permission_keys: string[];
          p_role_id: string;
        };
        Returns: string;
      };
      transition_job: {
        Args: { p_action: string; p_job_id: string; p_reason?: string };
        Returns: Database["public"]["Enums"]["job_status"];
      };
      worker_transition_job: {
        Args: { p_action: string; p_job_id: string; p_reason?: string };
        Returns: Database["public"]["Enums"]["job_status"];
      };
    };
    Enums: {
      job_status:
        | "draft"
        | "queued"
        | "running"
        | "paused"
        | "completed"
        | "failed"
        | "saturated"
        | "stopped";
      profile_status: "pending" | "active" | "rejected" | "deactivated";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      job_status: [
        "draft",
        "queued",
        "running",
        "paused",
        "completed",
        "failed",
        "saturated",
        "stopped",
      ],
      profile_status: ["pending", "active", "rejected", "deactivated"],
    },
  },
} as const;
