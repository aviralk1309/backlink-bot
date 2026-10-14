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
      domains: {
        Row: {
          blocked_suspected: boolean;
          blocked_suspected_at: string | null;
          checked_at: string | null;
          created_at: string;
          global_spam: boolean;
          global_spam_at: string | null;
          global_spam_by: string | null;
          global_spam_job_id: string | null;
          has_about_page: boolean | null;
          has_contact_page: boolean | null;
          last_fetch_at: string | null;
          last_fetch_status: string | null;
          registered_domain: string;
          robots_fetched_at: string | null;
          robots_txt: string | null;
          tld_flags: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          blocked_suspected?: boolean;
          blocked_suspected_at?: string | null;
          checked_at?: string | null;
          created_at?: string;
          global_spam?: boolean;
          global_spam_at?: string | null;
          global_spam_by?: string | null;
          global_spam_job_id?: string | null;
          has_about_page?: boolean | null;
          has_contact_page?: boolean | null;
          last_fetch_at?: string | null;
          last_fetch_status?: string | null;
          registered_domain: string;
          robots_fetched_at?: string | null;
          robots_txt?: string | null;
          tld_flags?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          blocked_suspected?: boolean;
          blocked_suspected_at?: string | null;
          checked_at?: string | null;
          created_at?: string;
          global_spam?: boolean;
          global_spam_at?: string | null;
          global_spam_by?: string | null;
          global_spam_job_id?: string | null;
          has_about_page?: boolean | null;
          has_contact_page?: boolean | null;
          last_fetch_at?: string | null;
          last_fetch_status?: string | null;
          registered_domain?: string;
          robots_fetched_at?: string | null;
          robots_txt?: string | null;
          tld_flags?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "domains_global_spam_by_fkey";
            columns: ["global_spam_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "domains_global_spam_job_id_fkey";
            columns: ["global_spam_job_id"];
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
      job_domains: {
        Row: {
          first_seen_at: string;
          first_source_type: string;
          job_id: string;
          registered_domain: string;
        };
        ComputedFields: never;
        Insert: {
          first_seen_at?: string;
          first_source_type: string;
          job_id: string;
          registered_domain: string;
        };
        Update: {
          first_seen_at?: string;
          first_source_type?: string;
          job_id?: string;
          registered_domain?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_domains_job_id_fkey";
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
      job_stats: {
        Row: {
          credits_used: number;
          duplicates_skipped: number;
          job_id: string;
          queries_done: number;
          queries_total: number;
          unchecked_count: number;
          unique_opportunities: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          credits_used?: number;
          duplicates_skipped?: number;
          job_id: string;
          queries_done?: number;
          queries_total?: number;
          unchecked_count?: number;
          unique_opportunities?: number;
          updated_at?: string;
        };
        Update: {
          credits_used?: number;
          duplicates_skipped?: number;
          job_id?: string;
          queries_done?: number;
          queries_total?: number;
          unchecked_count?: number;
          unique_opportunities?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_stats_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
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
      opportunities: {
        Row: {
          activity_key: string | null;
          attempts: number;
          check_reason: string | null;
          check_status: Database["public"]["Enums"]["opportunity_check_status"];
          client_link_status: string;
          config_version: number;
          created_at: string;
          domain: string;
          duplicate_of: string | null;
          extras: NonNullable<Json>;
          fetch_summary: Json | null;
          filter_reason: string | null;
          first_source_type: string;
          flags: NonNullable<Json>;
          found_by_count: number;
          host: string;
          id: string;
          job_id: string;
          lease_expires_at: string | null;
          locked_by: string | null;
          normalized_url: string;
          original_url: string;
          overlap_count: number;
          priority: number;
          queue_group:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          score: number | null;
          score_breakdown: Json | null;
          tier: Database["public"]["Enums"]["opportunity_tier"] | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          activity_key?: string | null;
          attempts?: number;
          check_reason?: string | null;
          check_status?: Database["public"]["Enums"]["opportunity_check_status"];
          client_link_status?: string;
          config_version: number;
          created_at?: string;
          domain: string;
          duplicate_of?: string | null;
          extras?: NonNullable<Json>;
          fetch_summary?: Json | null;
          filter_reason?: string | null;
          first_source_type: string;
          flags?: NonNullable<Json>;
          found_by_count?: number;
          host: string;
          id?: string;
          job_id: string;
          lease_expires_at?: string | null;
          locked_by?: string | null;
          normalized_url: string;
          original_url: string;
          overlap_count?: number;
          priority?: number;
          queue_group?:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          score?: number | null;
          score_breakdown?: Json | null;
          tier?: Database["public"]["Enums"]["opportunity_tier"] | null;
          updated_at?: string;
        };
        Update: {
          activity_key?: string | null;
          attempts?: number;
          check_reason?: string | null;
          check_status?: Database["public"]["Enums"]["opportunity_check_status"];
          client_link_status?: string;
          config_version?: number;
          created_at?: string;
          domain?: string;
          duplicate_of?: string | null;
          extras?: NonNullable<Json>;
          fetch_summary?: Json | null;
          filter_reason?: string | null;
          first_source_type?: string;
          flags?: NonNullable<Json>;
          found_by_count?: number;
          host?: string;
          id?: string;
          job_id?: string;
          lease_expires_at?: string | null;
          locked_by?: string | null;
          normalized_url?: string;
          original_url?: string;
          overlap_count?: number;
          priority?: number;
          queue_group?:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          score?: number | null;
          score_breakdown?: Json | null;
          tier?: Database["public"]["Enums"]["opportunity_tier"] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "opportunities_duplicate_of_fkey";
            columns: ["duplicate_of"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "opportunities_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      opportunity_sources: {
        Row: {
          found_at: string;
          opportunity_id: string;
          source_ref: string;
          source_type: string;
        };
        ComputedFields: never;
        Insert: {
          found_at?: string;
          opportunity_id: string;
          source_ref: string;
          source_type: string;
        };
        Update: {
          found_at?: string;
          opportunity_id?: string;
          source_ref?: string;
          source_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "opportunity_sources_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
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
      worker_heartbeats: {
        Row: {
          current_job_id: string | null;
          host: string;
          last_seen_at: string;
          started_at: string;
          worker_id: string;
        };
        ComputedFields: never;
        Insert: {
          current_job_id?: string | null;
          host: string;
          last_seen_at?: string;
          started_at?: string;
          worker_id: string;
        };
        Update: {
          current_job_id?: string | null;
          host?: string;
          last_seen_at?: string;
          started_at?: string;
          worker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "worker_heartbeats_current_job_id_fkey";
            columns: ["current_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_opportunity_checks: {
        Args: {
          p_batch?: number;
          p_lease_seconds?: number;
          p_worker_id: string;
        };
        Returns: {
          activity_key: string;
          attempts: number;
          config_version: number;
          domain: string;
          host: string;
          id: string;
          job_id: string;
          lease_expires_at: string;
          normalized_url: string;
          original_url: string;
          priority: number;
        }[];
      };
      current_role_id: { Args: Record<PropertyKey, never>; Returns: string };
      extend_opportunity_leases: {
        Args: {
          p_ids: string[];
          p_lease_seconds?: number;
          p_worker_id: string;
        };
        Returns: string[];
      };
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
      job_stats_add: {
        Args: {
          p_credits?: number;
          p_job_id: string;
          p_queries_done?: number;
          p_queries_total?: number;
        };
        Returns: undefined;
      };
      job_stats_recount: {
        Args: { p_job_id: string };
        Returns: {
          unchecked_count: number;
          unique_opportunities: number;
        }[];
      };
      job_transition_target: {
        Args: {
          p_action: string;
          p_status: Database["public"]["Enums"]["job_status"];
        };
        Returns: Database["public"]["Enums"]["job_status"];
      };
      job_work_pending: { Args: { p_job_id: string }; Returns: string[] };
      merge_opportunity_after_fetch: {
        Args: { p_final_normalized_url: string; p_opportunity_id: string };
        Returns: {
          canonical_id: string;
          outcome: string;
        }[];
      };
      opportunity_counts_unchecked: {
        Args: {
          p_check_status: Database["public"]["Enums"]["opportunity_check_status"];
          p_duplicate_of: string;
          p_queue_group: Database["public"]["Enums"]["opportunity_queue_group"];
          p_tier: Database["public"]["Enums"]["opportunity_tier"];
        };
        Returns: boolean;
      };
      reap_expired_leases: {
        Args: { p_limit?: number; p_max_attempts?: number };
        Returns: {
          failed: number;
          requeued: number;
        }[];
      };
      record_discovery: {
        Args: {
          p_domain: string;
          p_extras?: Json;
          p_host: string;
          p_job_id: string;
          p_normalized_url: string;
          p_original_url: string;
          p_source_ref: string;
          p_source_type: string;
        };
        Returns: {
          created: boolean;
          domain_added: boolean;
          filter_reason: string;
          opp_id: string;
          previously_spam: boolean;
          source_added: boolean;
        }[];
      };
      release_opportunity_claims: {
        Args: { p_worker_id: string };
        Returns: number;
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
      worker_complete_drained_jobs: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      worker_pick_up_next_job: {
        Args: Record<PropertyKey, never>;
        Returns: {
          job_id: string;
          outcome: string;
        }[];
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
      opportunity_check_status:
        "pending" | "running" | "done" | "failed" | "skipped";
      opportunity_queue_group: "auto_filtered" | "ready" | "backlog";
      opportunity_tier: "high" | "medium" | "low" | "unchecked";
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
      opportunity_check_status: [
        "pending",
        "running",
        "done",
        "failed",
        "skipped",
      ],
      opportunity_queue_group: ["auto_filtered", "ready", "backlog"],
      opportunity_tier: ["high", "medium", "low", "unchecked"],
      profile_status: ["pending", "active", "rejected", "deactivated"],
    },
  },
} as const;
