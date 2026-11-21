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
      csv_rows: {
        Row: {
          domain: string | null;
          error_code: string | null;
          extras: NonNullable<Json>;
          host: string | null;
          is_duplicate: boolean;
          is_valid: boolean;
          normalized_url: string | null;
          raw_url: string;
          row_no: number;
          upload_id: string;
        };
        ComputedFields: never;
        Insert: {
          domain?: string | null;
          error_code?: string | null;
          extras?: NonNullable<Json>;
          host?: string | null;
          is_duplicate?: boolean;
          is_valid: boolean;
          normalized_url?: string | null;
          raw_url: string;
          row_no: number;
          upload_id: string;
        };
        Update: {
          domain?: string | null;
          error_code?: string | null;
          extras?: NonNullable<Json>;
          host?: string | null;
          is_duplicate?: boolean;
          is_valid?: boolean;
          normalized_url?: string | null;
          raw_url?: string;
          row_no?: number;
          upload_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "csv_rows_upload_id_fkey";
            columns: ["upload_id"];
            isOneToOne: false;
            referencedRelation: "csv_uploads";
            referencedColumns: ["id"];
          },
        ];
      };
      csv_storage_cleanup: {
        Row: {
          created_at: string;
          job_id: string;
          path: string;
          upload_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          job_id: string;
          path: string;
          upload_id: string;
        };
        Update: {
          created_at?: string;
          job_id?: string;
          path?: string;
          upload_id?: string;
        };
        Relationships: [];
      };
      csv_uploads: {
        Row: {
          claim_token: string | null;
          competitor_label: string | null;
          confirmed_at: string | null;
          created_at: string;
          duplicate_rows: number;
          empty_rows: number;
          error_report_path: string | null;
          file_info: NonNullable<Json>;
          filename: string;
          id: string;
          invalid_rows: number;
          job_id: string;
          kind: string;
          lease_expires_at: string | null;
          locked_by: string | null;
          mapping: Json | null;
          processing_attempts: number;
          size_bytes: number;
          status: Database["public"]["Enums"]["csv_upload_status"];
          status_reason: string | null;
          storage_path: string;
          template_id: string | null;
          total_rows: number;
          updated_at: string;
          uploaded_by: string | null;
          valid_rows: number;
        };
        ComputedFields: never;
        Insert: {
          claim_token?: string | null;
          competitor_label?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          duplicate_rows?: number;
          empty_rows?: number;
          error_report_path?: string | null;
          file_info?: NonNullable<Json>;
          filename: string;
          id?: string;
          invalid_rows?: number;
          job_id: string;
          kind: string;
          lease_expires_at?: string | null;
          locked_by?: string | null;
          mapping?: Json | null;
          processing_attempts?: number;
          size_bytes: number;
          status?: Database["public"]["Enums"]["csv_upload_status"];
          status_reason?: string | null;
          storage_path: string;
          template_id?: string | null;
          total_rows?: number;
          updated_at?: string;
          uploaded_by?: string | null;
          valid_rows?: number;
        };
        Update: {
          claim_token?: string | null;
          competitor_label?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          duplicate_rows?: number;
          empty_rows?: number;
          error_report_path?: string | null;
          file_info?: NonNullable<Json>;
          filename?: string;
          id?: string;
          invalid_rows?: number;
          job_id?: string;
          kind?: string;
          lease_expires_at?: string | null;
          locked_by?: string | null;
          mapping?: Json | null;
          processing_attempts?: number;
          size_bytes?: number;
          status?: Database["public"]["Enums"]["csv_upload_status"];
          status_reason?: string | null;
          storage_path?: string;
          template_id?: string | null;
          total_rows?: number;
          updated_at?: string;
          uploaded_by?: string | null;
          valid_rows?: number;
        };
        Relationships: [
          {
            foreignKeyName: "csv_uploads_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "csv_uploads_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "mapping_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "csv_uploads_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      domain_check_budgets: {
        Row: {
          admitted_count: number;
          cap_limit: number;
          config_version: number;
          domain: string;
          job_id: string;
        };
        ComputedFields: never;
        Insert: {
          admitted_count?: number;
          cap_limit: number;
          config_version: number;
          domain: string;
          job_id: string;
        };
        Update: {
          admitted_count?: number;
          cap_limit?: number;
          config_version?: number;
          domain?: string;
          job_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "domain_check_budgets_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      domain_niche_rejections: {
        Row: {
          business_type: string;
          domain: string;
          flagged_at: string;
          opportunity_id: string;
          sub_niche: string;
        };
        ComputedFields: never;
        Insert: {
          business_type: string;
          domain: string;
          flagged_at?: string;
          opportunity_id: string;
          sub_niche: string;
        };
        Update: {
          business_type?: string;
          domain?: string;
          flagged_at?: string;
          opportunity_id?: string;
          sub_niche?: string;
        };
        Relationships: [
          {
            foreignKeyName: "domain_niche_rejections_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: true;
            referencedRelation: "opportunities";
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
      fetch_domain_limits: {
        Row: {
          domain: string;
          next_allowed_at: string;
        };
        ComputedFields: never;
        Insert: {
          domain: string;
          next_allowed_at: string;
        };
        Update: {
          domain?: string;
          next_allowed_at?: string;
        };
        Relationships: [];
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
      job_queries: {
        Row: {
          accepted_result_count: number | null;
          activity_key: string;
          attempts: number;
          completed_at: string | null;
          created_at: string;
          credit_spend_uncertain: boolean;
          credits_used: number | null;
          duplicate_result_count: number | null;
          error: string | null;
          gl: string | null;
          hl: string | null;
          id: string;
          job_id: string;
          lease_expires_at: string | null;
          location: string | null;
          locked_by: string | null;
          new_unique_domains: number | null;
          num: number;
          page: number;
          pre_redirect_new_unique_domains: number | null;
          priority: number;
          query_text: string;
          rejected_result_count: number | null;
          result_count: number | null;
          status: string;
          template_id: string;
          template_version: number;
        };
        ComputedFields: never;
        Insert: {
          accepted_result_count?: number | null;
          activity_key: string;
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          credit_spend_uncertain?: boolean;
          credits_used?: number | null;
          duplicate_result_count?: number | null;
          error?: string | null;
          gl?: string | null;
          hl?: string | null;
          id?: string;
          job_id: string;
          lease_expires_at?: string | null;
          location?: string | null;
          locked_by?: string | null;
          new_unique_domains?: number | null;
          num?: number;
          page?: number;
          pre_redirect_new_unique_domains?: number | null;
          priority?: number;
          query_text: string;
          rejected_result_count?: number | null;
          result_count?: number | null;
          status?: string;
          template_id: string;
          template_version: number;
        };
        Update: {
          accepted_result_count?: number | null;
          activity_key?: string;
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          credit_spend_uncertain?: boolean;
          credits_used?: number | null;
          duplicate_result_count?: number | null;
          error?: string | null;
          gl?: string | null;
          hl?: string | null;
          id?: string;
          job_id?: string;
          lease_expires_at?: string | null;
          location?: string | null;
          locked_by?: string | null;
          new_unique_domains?: number | null;
          num?: number;
          page?: number;
          pre_redirect_new_unique_domains?: number | null;
          priority?: number;
          query_text?: string;
          rejected_result_count?: number | null;
          result_count?: number | null;
          status?: string;
          template_id?: string;
          template_version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "job_queries_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_rescore_requests: {
        Row: {
          error_code: string | null;
          finished_at: string | null;
          id: string;
          job_id: string;
          requested_at: string;
          requested_by: string | null;
          scored_count: number;
          scoring_snapshot: NonNullable<Json>;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          error_code?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id: string;
          requested_at?: string;
          requested_by?: string | null;
          scored_count?: number;
          scoring_snapshot: NonNullable<Json>;
          status?: string;
        };
        Update: {
          error_code?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id?: string;
          requested_at?: string;
          requested_by?: string | null;
          scored_count?: number;
          scoring_snapshot?: NonNullable<Json>;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_rescore_requests_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_rescore_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_stats: {
        Row: {
          credits_uncertain: number;
          credits_used: number;
          duplicates_skipped: number;
          job_id: string;
          queries_done: number;
          queries_total: number;
          saturation_recheck_after: number;
          unchecked_count: number;
          unique_opportunities: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          credits_uncertain?: number;
          credits_used?: number;
          duplicates_skipped?: number;
          job_id: string;
          queries_done?: number;
          queries_total?: number;
          saturation_recheck_after?: number;
          unchecked_count?: number;
          unique_opportunities?: number;
          updated_at?: string;
        };
        Update: {
          credits_uncertain?: number;
          credits_used?: number;
          duplicates_skipped?: number;
          job_id?: string;
          queries_done?: number;
          queries_total?: number;
          saturation_recheck_after?: number;
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
      job_storage_cleanup: {
        Row: {
          created_at: string;
          job_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          job_id: string;
        };
        Update: {
          created_at?: string;
          job_id?: string;
        };
        Relationships: [];
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
      link_placement_events: {
        Row: {
          actor: string;
          at: string;
          id: number;
          kind: string;
          outreach_status: string;
          placement_id: string;
          reason: string | null;
          verification_status: string;
        };
        ComputedFields: never;
        Insert: {
          actor: string;
          at?: string;
          id?: never;
          kind: string;
          outreach_status: string;
          placement_id: string;
          reason?: string | null;
          verification_status: string;
        };
        Update: {
          actor?: string;
          at?: string;
          id?: never;
          kind?: string;
          outreach_status?: string;
          placement_id?: string;
          reason?: string | null;
          verification_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "link_placement_events_placement_id_fkey";
            columns: ["placement_id"];
            isOneToOne: false;
            referencedRelation: "link_placements";
            referencedColumns: ["id"];
          },
        ];
      };
      link_placements: {
        Row: {
          attempts: number;
          created_at: string;
          failure_reason: string | null;
          final_url: string | null;
          first_seen_at: string | null;
          id: string;
          job_id: string;
          last_checked_at: string | null;
          lease_expires_at: string | null;
          link_rel: string[];
          locked_by: string | null;
          next_check_at: string | null;
          opportunity_id: string;
          outreach_status: string;
          placed_at: string | null;
          row_version: number;
          source_url: string | null;
          target_url: string | null;
          updated_at: string;
          verification_status: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          created_at?: string;
          failure_reason?: string | null;
          final_url?: string | null;
          first_seen_at?: string | null;
          id?: string;
          job_id: string;
          last_checked_at?: string | null;
          lease_expires_at?: string | null;
          link_rel?: string[];
          locked_by?: string | null;
          next_check_at?: string | null;
          opportunity_id: string;
          outreach_status?: string;
          placed_at?: string | null;
          row_version?: number;
          source_url?: string | null;
          target_url?: string | null;
          updated_at?: string;
          verification_status?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          failure_reason?: string | null;
          final_url?: string | null;
          first_seen_at?: string | null;
          id?: string;
          job_id?: string;
          last_checked_at?: string | null;
          lease_expires_at?: string | null;
          link_rel?: string[];
          locked_by?: string | null;
          next_check_at?: string | null;
          opportunity_id?: string;
          outreach_status?: string;
          placed_at?: string | null;
          row_version?: number;
          source_url?: string | null;
          target_url?: string | null;
          updated_at?: string;
          verification_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "link_placements_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "link_placements_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: true;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      mapping_templates: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          kind: string;
          mapping: NonNullable<Json>;
          name: string;
          shared: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind: string;
          mapping: NonNullable<Json>;
          name: string;
          shared?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          mapping?: NonNullable<Json>;
          name?: string;
          shared?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mapping_templates_created_by_fkey";
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
          external_metrics: NonNullable<Json>;
          extras: NonNullable<Json>;
          fetch_summary: Json | null;
          filter_detail: string | null;
          filter_reason: string | null;
          first_ready: boolean;
          first_ready_rank: number | null;
          first_source_type: string;
          flags: NonNullable<Json>;
          found_by_count: number;
          host: string;
          id: string;
          job_id: string;
          lease_expires_at: string | null;
          locked_by: string | null;
          normalized_url: string;
          notes: string | null;
          original_url: string;
          overlap_count: number;
          priority: number;
          queue_group:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          reject_reason:
            Database["public"]["Enums"]["opportunity_reject_reason"] | null;
          reject_scope:
            Database["public"]["Enums"]["opportunity_reject_scope"] | null;
          review_status: Database["public"]["Enums"]["opportunity_review_status"];
          reviewed_at: string | null;
          reviewer_id: string | null;
          row_version: number;
          score: number | null;
          score_at_review: number | null;
          score_breakdown: Json | null;
          tier: Database["public"]["Enums"]["opportunity_tier"] | null;
          tier_at_review:
            Database["public"]["Enums"]["opportunity_tier"] | null;
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
          external_metrics?: NonNullable<Json>;
          extras?: NonNullable<Json>;
          fetch_summary?: Json | null;
          filter_detail?: string | null;
          filter_reason?: string | null;
          first_ready?: boolean;
          first_ready_rank?: number | null;
          first_source_type: string;
          flags?: NonNullable<Json>;
          found_by_count?: number;
          host: string;
          id?: string;
          job_id: string;
          lease_expires_at?: string | null;
          locked_by?: string | null;
          normalized_url: string;
          notes?: string | null;
          original_url: string;
          overlap_count?: number;
          priority?: number;
          queue_group?:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          reject_reason?:
            Database["public"]["Enums"]["opportunity_reject_reason"] | null;
          reject_scope?:
            Database["public"]["Enums"]["opportunity_reject_scope"] | null;
          review_status?: Database["public"]["Enums"]["opportunity_review_status"];
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          row_version?: number;
          score?: number | null;
          score_at_review?: number | null;
          score_breakdown?: Json | null;
          tier?: Database["public"]["Enums"]["opportunity_tier"] | null;
          tier_at_review?:
            Database["public"]["Enums"]["opportunity_tier"] | null;
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
          external_metrics?: NonNullable<Json>;
          extras?: NonNullable<Json>;
          fetch_summary?: Json | null;
          filter_detail?: string | null;
          filter_reason?: string | null;
          first_ready?: boolean;
          first_ready_rank?: number | null;
          first_source_type?: string;
          flags?: NonNullable<Json>;
          found_by_count?: number;
          host?: string;
          id?: string;
          job_id?: string;
          lease_expires_at?: string | null;
          locked_by?: string | null;
          normalized_url?: string;
          notes?: string | null;
          original_url?: string;
          overlap_count?: number;
          priority?: number;
          queue_group?:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          reject_reason?:
            Database["public"]["Enums"]["opportunity_reject_reason"] | null;
          reject_scope?:
            Database["public"]["Enums"]["opportunity_reject_scope"] | null;
          review_status?: Database["public"]["Enums"]["opportunity_review_status"];
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          row_version?: number;
          score?: number | null;
          score_at_review?: number | null;
          score_breakdown?: Json | null;
          tier?: Database["public"]["Enums"]["opportunity_tier"] | null;
          tier_at_review?:
            Database["public"]["Enums"]["opportunity_tier"] | null;
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
      opportunity_check_admissions: {
        Row: {
          admitted_at: string;
          domain: string;
          job_id: string;
          opportunity_id: string;
        };
        ComputedFields: never;
        Insert: {
          admitted_at?: string;
          domain: string;
          job_id: string;
          opportunity_id: string;
        };
        Update: {
          admitted_at?: string;
          domain?: string;
          job_id?: string;
          opportunity_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "opportunity_check_admissions_job_id_domain_fkey";
            columns: ["job_id", "domain"];
            isOneToOne: false;
            referencedRelation: "domain_check_budgets";
            referencedColumns: ["job_id", "domain"];
          },
          {
            foreignKeyName: "opportunity_check_admissions_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: true;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      opportunity_checks: {
        Row: {
          check_key: string;
          checked_at: string;
          config_version: number;
          detail: string;
          evidence: NonNullable<Json>;
          opportunity_id: string;
          reason_code: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          check_key: string;
          checked_at?: string;
          config_version: number;
          detail?: string;
          evidence?: NonNullable<Json>;
          opportunity_id: string;
          reason_code: string;
          status: string;
        };
        Update: {
          check_key?: string;
          checked_at?: string;
          config_version?: number;
          detail?: string;
          evidence?: NonNullable<Json>;
          opportunity_id?: string;
          reason_code?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "opportunity_checks_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      opportunity_reviews: {
        Row: {
          at: string;
          config_version: number;
          external_metrics: NonNullable<Json>;
          from_status: Database["public"]["Enums"]["opportunity_review_status"];
          id: number;
          notes: string | null;
          opportunity_id: string;
          queue_group:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          reject_reason:
            Database["public"]["Enums"]["opportunity_reject_reason"] | null;
          reject_scope:
            Database["public"]["Enums"]["opportunity_reject_scope"] | null;
          reviewer_id: string | null;
          row_version: number;
          score: number | null;
          scoring_inputs: Json | null;
          source_summary: NonNullable<Json>;
          tier: Database["public"]["Enums"]["opportunity_tier"] | null;
          to_status: Database["public"]["Enums"]["opportunity_review_status"];
        };
        ComputedFields: never;
        Insert: {
          at: string;
          config_version: number;
          external_metrics: NonNullable<Json>;
          from_status: Database["public"]["Enums"]["opportunity_review_status"];
          id?: never;
          notes?: string | null;
          opportunity_id: string;
          queue_group?:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          reject_reason?:
            Database["public"]["Enums"]["opportunity_reject_reason"] | null;
          reject_scope?:
            Database["public"]["Enums"]["opportunity_reject_scope"] | null;
          reviewer_id?: string | null;
          row_version: number;
          score?: number | null;
          scoring_inputs?: Json | null;
          source_summary: NonNullable<Json>;
          tier?: Database["public"]["Enums"]["opportunity_tier"] | null;
          to_status: Database["public"]["Enums"]["opportunity_review_status"];
        };
        Update: {
          at?: string;
          config_version?: number;
          external_metrics?: NonNullable<Json>;
          from_status?: Database["public"]["Enums"]["opportunity_review_status"];
          id?: never;
          notes?: string | null;
          opportunity_id?: string;
          queue_group?:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          reject_reason?:
            Database["public"]["Enums"]["opportunity_reject_reason"] | null;
          reject_scope?:
            Database["public"]["Enums"]["opportunity_reject_scope"] | null;
          reviewer_id?: string | null;
          row_version?: number;
          score?: number | null;
          scoring_inputs?: Json | null;
          source_summary?: NonNullable<Json>;
          tier?: Database["public"]["Enums"]["opportunity_tier"] | null;
          to_status?: Database["public"]["Enums"]["opportunity_review_status"];
        };
        Relationships: [
          {
            foreignKeyName: "opportunity_reviews_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
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
      origin_robots_cache: {
        Row: {
          blocked_until: string;
          expires_at: string;
          fetched_at: string | null;
          origin: string;
          refresh_token: string | null;
          refresh_until: string;
          registered_domain: string | null;
          robots_txt: string;
          state: string;
        };
        ComputedFields: never;
        Insert: {
          blocked_until?: string;
          expires_at?: string;
          fetched_at?: string | null;
          origin: string;
          refresh_token?: string | null;
          refresh_until?: string;
          registered_domain?: string | null;
          robots_txt?: string;
          state?: string;
        };
        Update: {
          blocked_until?: string;
          expires_at?: string;
          fetched_at?: string | null;
          origin?: string;
          refresh_token?: string | null;
          refresh_until?: string;
          registered_domain?: string | null;
          robots_txt?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "origin_robots_cache_registered_domain_fkey";
            columns: ["registered_domain"];
            isOneToOne: false;
            referencedRelation: "domains";
            referencedColumns: ["registered_domain"];
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
      profile_role_changes: {
        Row: {
          actor_id: string | null;
          changed_at: string;
          id: number;
          new_role_id: string | null;
          old_role_id: string | null;
          profile_id: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          changed_at?: string;
          id?: never;
          new_role_id?: string | null;
          old_role_id?: string | null;
          profile_id: string;
        };
        Update: {
          actor_id?: string | null;
          changed_at?: string;
          id?: never;
          new_role_id?: string | null;
          old_role_id?: string | null;
          profile_id?: string;
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
      scoring_policy: {
        Row: {
          config: NonNullable<Json>;
          singleton: boolean;
        };
        ComputedFields: never;
        Insert: {
          config: NonNullable<Json>;
          singleton?: boolean;
        };
        Update: {
          config?: NonNullable<Json>;
          singleton?: boolean;
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
      block_rejected_domain: {
        Args: {
          p_domain: string;
          p_job_id: string;
          p_reason: string;
          p_result_id: string;
        };
        Returns: {
          blocked_domain: string;
          entry_id: string;
          outcome: string;
        }[];
      };
      can_assign_role: { Args: { p_role_id: string }; Returns: boolean };
      claim_budgeted_query: {
        Args: {
          p_lease_seconds?: number;
          p_max_attempts?: number;
          p_worker_id: string;
        };
        Returns: {
          accepted_result_count: number | null;
          activity_key: string;
          attempts: number;
          completed_at: string | null;
          created_at: string;
          credit_spend_uncertain: boolean;
          credits_used: number | null;
          duplicate_result_count: number | null;
          error: string | null;
          gl: string | null;
          hl: string | null;
          id: string;
          job_id: string;
          lease_expires_at: string | null;
          location: string | null;
          locked_by: string | null;
          new_unique_domains: number | null;
          num: number;
          page: number;
          pre_redirect_new_unique_domains: number | null;
          priority: number;
          query_text: string;
          rejected_result_count: number | null;
          result_count: number | null;
          status: string;
          template_id: string;
          template_version: number;
        }[];
        SetofOptions: {
          from: "*";
          to: "job_queries";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
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
      confirm_csv_upload: { Args: { p_upload_id: string }; Returns: undefined };
      current_role_id: { Args: Record<PropertyKey, never>; Returns: string };
      current_scoring_snapshot: { Args: { p_keys: string[] }; Returns: Json };
      delete_csv_upload: { Args: { p_upload_id: string }; Returns: string };
      discard_csv_upload: { Args: { p_upload_id: string }; Returns: undefined };
      evaluate_job_saturation: { Args: { p_job_id: string }; Returns: boolean };
      export_result_batch: {
        Args: {
          p_activity?: string;
          p_after?: string;
          p_domain?: string;
          p_flag?: string;
          p_job_id: string;
          p_limit?: number;
          p_query?: string;
          p_queue?: Database["public"]["Enums"]["opportunity_queue_group"];
          p_source?: string;
          p_status?: Database["public"]["Enums"]["opportunity_review_status"];
          p_tier?: Database["public"]["Enums"]["opportunity_tier"];
        };
        Returns: {
          activity_key: string;
          created_at: string;
          domain: string;
          external_metrics: Json;
          id: string;
          normalized_url: string;
          notes: string;
          original_url: string;
          overlap_count: number;
          reject_reason: Database["public"]["Enums"]["opportunity_reject_reason"];
          review_status: Database["public"]["Enums"]["opportunity_review_status"];
          score: number;
          score_breakdown: Json;
          source_types: string[];
          tier: Database["public"]["Enums"]["opportunity_tier"];
        }[];
      };
      extend_opportunity_leases: {
        Args: {
          p_ids: string[];
          p_lease_seconds?: number;
          p_worker_id: string;
        };
        Returns: string[];
      };
      get_csv_upload_error_counts: {
        Args: { p_upload_id: string };
        Returns: {
          count: number;
          error_code: string;
        }[];
      };
      get_job_gap_domains: {
        Args: { p_job_id: string };
        Returns: {
          client_link_status: string;
          competitor_labels: string[];
          domain: string;
          overlap_count: number;
        }[];
      };
      get_job_gap_preview: {
        Args: { p_job_id: string };
        Returns: {
          client_link_status: string;
          has_client_file: boolean;
          overlap_distribution: Json;
          total_gap_domains: number;
        }[];
      };
      has_permission: { Args: { p_key: string }; Returns: boolean };
      import_job_gap_opportunities: {
        Args: { p_job_id: string };
        Returns: {
          duplicates_skipped: number;
          opportunities_created: number;
          total_candidates: number;
        }[];
      };
      import_job_seed_opportunities: {
        Args: { p_job_id: string; p_seeds: Json };
        Returns: {
          duplicates_skipped: number;
          opportunities_created: number;
          total_candidates: number;
        }[];
      };
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
      job_query_yield: {
        Args: { p_job_id: string };
        Returns: {
          activity_key: string;
          credits_used: number;
          new_unique_domains: number;
          queries_done: number;
          queries_failed: number;
          queries_total: number;
          result_count: number;
          template_id: string;
          template_version: number;
        }[];
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
      list_job_result_domains: {
        Args: {
          p_activity?: string;
          p_after?: string;
          p_domain?: string;
          p_flag?: string;
          p_job_id: string;
          p_limit?: number;
          p_query?: string;
          p_queue?: Database["public"]["Enums"]["opportunity_queue_group"];
          p_source?: string;
          p_status?: Database["public"]["Enums"]["opportunity_review_status"];
          p_tier?: Database["public"]["Enums"]["opportunity_tier"];
        };
        Returns: {
          best_score: number;
          domain: string;
          preview_urls: string[];
          result_count: number;
        }[];
      };
      list_job_results: {
        Args: {
          p_activity?: string;
          p_after?: string;
          p_domain?: string;
          p_flag?: string;
          p_job_id: string;
          p_limit?: number;
          p_query?: string;
          p_queue?: Database["public"]["Enums"]["opportunity_queue_group"];
          p_sort?: string;
          p_source?: string;
          p_status?: Database["public"]["Enums"]["opportunity_review_status"];
          p_tier?: Database["public"]["Enums"]["opportunity_tier"];
        };
        Returns: {
          activity_key: string;
          check_reason: string;
          client_link_status: string;
          created_at: string;
          domain: string;
          first_source_type: string;
          flags: Json;
          id: string;
          normalized_url: string;
          overlap_count: number;
          review_status: Database["public"]["Enums"]["opportunity_review_status"];
          score: number;
          score_breakdown: Json;
          source_types: string[];
          tier: Database["public"]["Enums"]["opportunity_tier"];
        }[];
      };
      log_result_export: {
        Args: { p_columns: string[]; p_filters: Json; p_job_id: string };
        Returns: undefined;
      };
      merge_opportunity_after_fetch: {
        Args: { p_final_normalized_url: string; p_opportunity_id: string };
        Returns: {
          canonical_id: string;
          outcome: string;
        }[];
      };
      normalized_review_niche: { Args: { p_value: string }; Returns: string };
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
      record_site_crawl_candidates: {
        Args: { p_candidates: Json; p_job_id: string; p_parent_id: string };
        Returns: number;
      };
      release_backlog: {
        Args: { p_job_id: string; p_limit?: number };
        Returns: number;
      };
      release_opportunity_claims: {
        Args: { p_worker_id: string };
        Returns: number;
      };
      report_link_delivery: {
        Args: { p_activity?: string; p_job_id?: string };
        Returns: {
          credits_per_verified: number;
          credits_used: number;
          dimension: string;
          dimension_key: string;
          submitted_count: number;
          unknown_count: number;
          unverified_count: number;
          verified_count: number;
        }[];
      };
      report_metrics: {
        Args: {
          p_activity?: string;
          p_from?: string;
          p_job_id?: string;
          p_to?: string;
        };
        Returns: {
          approval_rate: number;
          approved_count: number;
          decided_count: number;
          dimension: string;
          dimension_key: string;
          low_sample: boolean;
          rejected_count: number;
          undecided_count: number;
          used_count: number;
        }[];
      };
      report_reject_reasons: {
        Args: {
          p_activity?: string;
          p_from?: string;
          p_job_id?: string;
          p_to?: string;
        };
        Returns: {
          reject_reason: Database["public"]["Enums"]["opportunity_reject_reason"];
          rejected_count: number;
        }[];
      };
      report_review_throughput: {
        Args: {
          p_activity?: string;
          p_from?: string;
          p_job_id?: string;
          p_to?: string;
        };
        Returns: {
          approved_count: number;
          day: string;
          decided_count: number;
          rejected_count: number;
        }[];
      };
      request_job_rescore: {
        Args: { p_confirmed: boolean; p_job_id: string };
        Returns: string;
      };
      result_matches: {
        Args: {
          p_activity: string;
          p_domain: string;
          p_flag: string;
          p_include_filtered: boolean;
          p_job_id: string;
          p_query: string;
          p_queue: Database["public"]["Enums"]["opportunity_queue_group"];
          p_source: string;
          p_status: Database["public"]["Enums"]["opportunity_review_status"];
          p_tier: Database["public"]["Enums"]["opportunity_tier"];
        };
        Returns: {
          activity_key: string | null;
          attempts: number;
          check_reason: string | null;
          check_status: Database["public"]["Enums"]["opportunity_check_status"];
          client_link_status: string;
          config_version: number;
          created_at: string;
          domain: string;
          duplicate_of: string | null;
          external_metrics: NonNullable<Json>;
          extras: NonNullable<Json>;
          fetch_summary: Json | null;
          filter_detail: string | null;
          filter_reason: string | null;
          first_ready: boolean;
          first_ready_rank: number | null;
          first_source_type: string;
          flags: NonNullable<Json>;
          found_by_count: number;
          host: string;
          id: string;
          job_id: string;
          lease_expires_at: string | null;
          locked_by: string | null;
          normalized_url: string;
          notes: string | null;
          original_url: string;
          overlap_count: number;
          priority: number;
          queue_group:
            Database["public"]["Enums"]["opportunity_queue_group"] | null;
          reject_reason:
            Database["public"]["Enums"]["opportunity_reject_reason"] | null;
          reject_scope:
            Database["public"]["Enums"]["opportunity_reject_scope"] | null;
          review_status: Database["public"]["Enums"]["opportunity_review_status"];
          reviewed_at: string | null;
          reviewer_id: string | null;
          row_version: number;
          score: number | null;
          score_at_review: number | null;
          score_breakdown: Json | null;
          tier: Database["public"]["Enums"]["opportunity_tier"] | null;
          tier_at_review:
            Database["public"]["Enums"]["opportunity_tier"] | null;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "opportunities";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      result_review_state: {
        Args: { p_ids: string[] };
        Returns: {
          id: string;
          reviewer_name: string;
          row_version: number;
        }[];
      };
      retry_job_query: {
        Args: { p_job_id: string; p_query_id: string };
        Returns: string;
      };
      review_opportunities: {
        Args: {
          p_action: string;
          p_job_id: string;
          p_note?: string;
          p_reason?: string;
          p_rows: Json;
        };
        Returns: string;
      };
      role_user_counts: {
        Args: Record<PropertyKey, never>;
        Returns: {
          role_id: string;
          user_count: number;
        }[];
      };
      save_csv_mapping: {
        Args: { p_mapping: Json; p_template_id?: string; p_upload_id: string };
        Returns: undefined;
      };
      save_link_placement: {
        Args: {
          p_opportunity_id: string;
          p_placed_at: string;
          p_source_url: string;
          p_status: string;
          p_target_url: string;
          p_version: number;
        };
        Returns: string;
      };
      save_opportunity_metadata: {
        Args: {
          p_id: string;
          p_metrics: Json;
          p_notes: string;
          p_row_version: number;
        };
        Returns: string;
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
      worker_acquire_fetch_slot: {
        Args: { p_delay_seconds: number; p_domain: string };
        Returns: number;
      };
      worker_assign_opportunity_queue: {
        Args: {
          p_attempt: number;
          p_config_version: number;
          p_id: string;
          p_worker: string;
        };
        Returns: Database["public"]["Enums"]["opportunity_queue_group"];
      };
      worker_block_origin: {
        Args: { p_origin: string; p_seconds: number };
        Returns: boolean;
      };
      worker_claim_csv_upload: {
        Args: {
          p_lease_seconds: number;
          p_max_attempts: number;
          p_worker_id: string;
        };
        Returns: {
          claim_token: string | null;
          competitor_label: string | null;
          confirmed_at: string | null;
          created_at: string;
          duplicate_rows: number;
          empty_rows: number;
          error_report_path: string | null;
          file_info: NonNullable<Json>;
          filename: string;
          id: string;
          invalid_rows: number;
          job_id: string;
          kind: string;
          lease_expires_at: string | null;
          locked_by: string | null;
          mapping: Json | null;
          processing_attempts: number;
          size_bytes: number;
          status: Database["public"]["Enums"]["csv_upload_status"];
          status_reason: string | null;
          storage_path: string;
          template_id: string | null;
          total_rows: number;
          updated_at: string;
          uploaded_by: string | null;
          valid_rows: number;
        }[];
        SetofOptions: {
          from: "*";
          to: "csv_uploads";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      worker_claim_link_placement: {
        Args: { p_lease_seconds: number; p_worker: string };
        Returns: {
          attempts: number;
          created_at: string;
          failure_reason: string | null;
          final_url: string | null;
          first_seen_at: string | null;
          id: string;
          job_id: string;
          last_checked_at: string | null;
          lease_expires_at: string | null;
          link_rel: string[];
          locked_by: string | null;
          next_check_at: string | null;
          opportunity_id: string;
          outreach_status: string;
          placed_at: string | null;
          row_version: number;
          source_url: string | null;
          target_url: string | null;
          updated_at: string;
          verification_status: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "link_placements";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      worker_claim_next_csv_upload: {
        Args: Record<PropertyKey, never>;
        Returns: {
          competitor_label: string;
          file_info: Json;
          filename: string;
          id: string;
          job_id: string;
          kind: string;
          mapping: Json;
          storage_path: string;
        }[];
      };
      worker_claim_robots: {
        Args: { p_domain: string; p_origin: string; p_token: string };
        Returns: Json;
      };
      worker_complete_drained_jobs: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      worker_complete_robots: {
        Args: {
          p_origin: string;
          p_state: string;
          p_text: string;
          p_token: string;
          p_ttl: number;
        };
        Returns: boolean;
      };
      worker_finish_link_placement: {
        Args: {
          p_attempt: number;
          p_final_url: string;
          p_id: string;
          p_reason: string;
          p_rel: string[];
          p_status: string;
          p_worker: string;
        };
        Returns: boolean;
      };
      worker_lock_search_job: { Args: { p_job_id: string }; Returns: boolean };
      worker_next_rescore: {
        Args: Record<PropertyKey, never>;
        Returns: {
          error_code: string | null;
          finished_at: string | null;
          id: string;
          job_id: string;
          requested_at: string;
          requested_by: string | null;
          scored_count: number;
          scoring_snapshot: NonNullable<Json>;
          status: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "job_rescore_requests";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      worker_pick_up_next_job: {
        Args: Record<PropertyKey, never>;
        Returns: {
          job_id: string;
          outcome: string;
        }[];
      };
      worker_publish_check_filter: {
        Args: {
          p_attempt: number;
          p_check_key: string;
          p_config_version: number;
          p_detail: string;
          p_id: string;
          p_reason: string;
          p_results: Json;
          p_worker: string;
        };
        Returns: boolean;
      };
      worker_reap_csv_uploads: {
        Args: { p_limit?: number; p_max_attempts: number };
        Returns: number;
      };
      worker_renew_csv_claim: {
        Args: {
          p_claim_token: string;
          p_lease_seconds: number;
          p_upload_id: string;
        };
        Returns: boolean;
      };
      worker_save_fetch_summary: {
        Args: {
          p_attempt: number;
          p_config_version: number;
          p_id: string;
          p_summary: Json;
          p_worker: string;
        };
        Returns: boolean;
      };
      worker_save_opportunity_checks: {
        Args: {
          p_attempt: number;
          p_config_version: number;
          p_id: string;
          p_results: Json;
          p_worker: string;
        };
        Returns: boolean;
      };
      worker_save_opportunity_score: {
        Args: {
          p_attempt: number;
          p_breakdown: Json;
          p_config_version: number;
          p_id: string;
          p_score: number;
          p_tier: Database["public"]["Enums"]["opportunity_tier"];
          p_worker: string;
        };
        Returns: boolean;
      };
      worker_transition_job: {
        Args: { p_action: string; p_job_id: string; p_reason?: string };
        Returns: Database["public"]["Enums"]["job_status"];
      };
    };
    Enums: {
      csv_upload_status:
        | "uploaded"
        | "mapped"
        | "processing"
        | "ready"
        | "confirmed"
        | "failed"
        | "discarded";
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
      opportunity_reject_reason:
        "spam" | "off_topic" | "no_link_option" | "already_have" | "other";
      opportunity_reject_scope: "job" | "niche" | "global";
      opportunity_review_status:
        "new" | "in_review" | "approved" | "rejected" | "used";
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
      csv_upload_status: [
        "uploaded",
        "mapped",
        "processing",
        "ready",
        "confirmed",
        "failed",
        "discarded",
      ],
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
      opportunity_reject_reason: [
        "spam",
        "off_topic",
        "no_link_option",
        "already_have",
        "other",
      ],
      opportunity_reject_scope: ["job", "niche", "global"],
      opportunity_review_status: [
        "new",
        "in_review",
        "approved",
        "rejected",
        "used",
      ],
      opportunity_tier: ["high", "medium", "low", "unchecked"],
      profile_status: ["pending", "active", "rejected", "deactivated"],
    },
  },
} as const;
