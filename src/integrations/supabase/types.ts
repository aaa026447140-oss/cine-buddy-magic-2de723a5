export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_state: {
        Row: {
          data: Json | null
          state: string | null
          telegram_id: number
          updated_at: string
        }
        Insert: {
          data?: Json | null
          state?: string | null
          telegram_id: number
          updated_at?: string
        }
        Update: {
          data?: Json | null
          state?: string | null
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      blocked_words: {
        Row: {
          added_by: number | null
          created_at: string
          word: string
        }
        Insert: {
          added_by?: number | null
          created_at?: string
          word: string
        }
        Update: {
          added_by?: number | null
          created_at?: string
          word?: string
        }
        Relationships: []
      }
      bot_admins: {
        Row: {
          added_by: number
          created_at: string
          expires_at: string | null
          note: string | null
          telegram_id: number
        }
        Insert: {
          added_by: number
          created_at?: string
          expires_at?: string | null
          note?: string | null
          telegram_id: number
        }
        Update: {
          added_by?: number
          created_at?: string
          expires_at?: string | null
          note?: string | null
          telegram_id?: number
        }
        Relationships: []
      }
      bot_groups: {
        Row: {
          added_at: string
          chat_id: number
          is_active: boolean
          last_seen: string
          title: string | null
          type: string | null
        }
        Insert: {
          added_at?: string
          chat_id: number
          is_active?: boolean
          last_seen?: string
          title?: string | null
          type?: string | null
        }
        Update: {
          added_at?: string
          chat_id?: number
          is_active?: boolean
          last_seen?: string
          title?: string | null
          type?: string | null
        }
        Relationships: []
      }
      bot_metric_counters: {
        Row: {
          metric: string
          updated_at: string
          value: number
        }
        Insert: {
          metric: string
          updated_at?: string
          value?: number
        }
        Update: {
          metric?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      bot_settings: {
        Row: {
          builder_username: string | null
          enable_daily: boolean
          enable_premium: boolean
          enable_premium_forever: boolean
          enable_premium_year: boolean
          enable_single: boolean
          free_searches_per_day: number
          id: number
          price_daily_extra: number
          price_premium: number
          price_premium_forever: number
          price_premium_year: number
          price_single_search: number
          quota_enabled: boolean
          required_channel_id: number | null
          required_channel_invite_link: string | null
          required_channel_title: string | null
          required_channel_username: string | null
          search_group_title: string | null
          search_group_url: string | null
          source_channel_id: number | null
          source_channel_title: string | null
          source_channel_username: string | null
          support_chat_url: string | null
          support_group_id: number | null
          support_group_title: string | null
          updated_at: string
          updates_channel_url: string | null
        }
        Insert: {
          builder_username?: string | null
          enable_daily?: boolean
          enable_premium?: boolean
          enable_premium_forever?: boolean
          enable_premium_year?: boolean
          enable_single?: boolean
          free_searches_per_day?: number
          id?: number
          price_daily_extra?: number
          price_premium?: number
          price_premium_forever?: number
          price_premium_year?: number
          price_single_search?: number
          quota_enabled?: boolean
          required_channel_id?: number | null
          required_channel_invite_link?: string | null
          required_channel_title?: string | null
          required_channel_username?: string | null
          search_group_title?: string | null
          search_group_url?: string | null
          source_channel_id?: number | null
          source_channel_title?: string | null
          source_channel_username?: string | null
          support_chat_url?: string | null
          support_group_id?: number | null
          support_group_title?: string | null
          updated_at?: string
          updates_channel_url?: string | null
        }
        Update: {
          builder_username?: string | null
          enable_daily?: boolean
          enable_premium?: boolean
          enable_premium_forever?: boolean
          enable_premium_year?: boolean
          enable_single?: boolean
          free_searches_per_day?: number
          id?: number
          price_daily_extra?: number
          price_premium?: number
          price_premium_forever?: number
          price_premium_year?: number
          price_single_search?: number
          quota_enabled?: boolean
          required_channel_id?: number | null
          required_channel_invite_link?: string | null
          required_channel_title?: string | null
          required_channel_username?: string | null
          search_group_title?: string | null
          search_group_url?: string | null
          source_channel_id?: number | null
          source_channel_title?: string | null
          source_channel_username?: string | null
          support_chat_url?: string | null
          support_group_id?: number | null
          support_group_title?: string | null
          updated_at?: string
          updates_channel_url?: string | null
        }
        Relationships: []
      }
      bot_source_channels: {
        Row: {
          added_by: number | null
          chat_id: number
          created_at: string
          title: string | null
          username: string | null
        }
        Insert: {
          added_by?: number | null
          chat_id: number
          created_at?: string
          title?: string | null
          username?: string | null
        }
        Update: {
          added_by?: number | null
          chat_id?: number
          created_at?: string
          title?: string | null
          username?: string | null
        }
        Relationships: []
      }
      bot_users: {
        Row: {
          block_reason: string | null
          block_strikes: number
          blocked_until: string | null
          first_name: string | null
          first_seen: string
          is_blocked: boolean
          language_code: string | null
          last_name: string | null
          last_seen: string
          telegram_id: number
          username: string | null
        }
        Insert: {
          block_reason?: string | null
          block_strikes?: number
          blocked_until?: string | null
          first_name?: string | null
          first_seen?: string
          is_blocked?: boolean
          language_code?: string | null
          last_name?: string | null
          last_seen?: string
          telegram_id: number
          username?: string | null
        }
        Update: {
          block_reason?: string | null
          block_strikes?: number
          blocked_until?: string | null
          first_name?: string | null
          first_seen?: string
          is_blocked?: boolean
          language_code?: string | null
          last_name?: string | null
          last_seen?: string
          telegram_id?: number
          username?: string | null
        }
        Relationships: []
      }
      broadcast_jobs: {
        Row: {
          admin_chat_id: number
          admin_user_id: number
          created_at: string
          cursor_id: number
          failed: number
          from_chat_id: number
          id: number
          last_error: string | null
          locked_at: string | null
          message_id: number
          notify_chat_id: number | null
          notify_msg_id: number | null
          phase: string
          resume_after: string
          sent: number
          status: string
          status_msg_id: number | null
          target: string
          total: number
          updated_at: string
        }
        Insert: {
          admin_chat_id: number
          admin_user_id: number
          created_at?: string
          cursor_id?: number
          failed?: number
          from_chat_id: number
          id?: number
          last_error?: string | null
          locked_at?: string | null
          message_id: number
          notify_chat_id?: number | null
          notify_msg_id?: number | null
          phase?: string
          resume_after?: string
          sent?: number
          status?: string
          status_msg_id?: number | null
          target: string
          total?: number
          updated_at?: string
        }
        Update: {
          admin_chat_id?: number
          admin_user_id?: number
          created_at?: string
          cursor_id?: number
          failed?: number
          from_chat_id?: number
          id?: number
          last_error?: string | null
          locked_at?: string | null
          message_id?: number
          notify_chat_id?: number | null
          notify_msg_id?: number | null
          phase?: string
          resume_after?: string
          sent?: number
          status?: string
          status_msg_id?: number | null
          target?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      broadcast_log: {
        Row: {
          created_at: string
          failed: number
          id: number
          message_text: string | null
          sent: number
          target: string
          total: number
        }
        Insert: {
          created_at?: string
          failed?: number
          id?: number
          message_text?: string | null
          sent?: number
          target: string
          total?: number
        }
        Update: {
          created_at?: string
          failed?: number
          id?: number
          message_text?: string | null
          sent?: number
          target?: string
          total?: number
        }
        Relationships: []
      }
      broadcast_requests: {
        Row: {
          created_at: string
          from_chat_id: number
          id: number
          message_id: number
          preview: string | null
          requester_chat_id: number
          requester_id: number
          reviewed_by: number | null
          status: string
          target: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_chat_id: number
          id?: number
          message_id: number
          preview?: string | null
          requester_chat_id: number
          requester_id: number
          reviewed_by?: number | null
          status?: string
          target: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_chat_id?: number
          id?: number
          message_id?: number
          preview?: string | null
          requester_chat_id?: number
          requester_id?: number
          reviewed_by?: number | null
          status?: string
          target?: string
          updated_at?: string
        }
        Relationships: []
      }
      group_members: {
        Row: {
          chat_id: number
          last_seen: string
          user_id: number
        }
        Insert: {
          chat_id: number
          last_seen?: string
          user_id: number
        }
        Update: {
          chat_id?: number
          last_seen?: string
          user_id?: number
        }
        Relationships: []
      }
      movies: {
        Row: {
          created_at: string
          duration: number | null
          file_size: number | null
          file_type: string | null
          file_unique_id: string | null
          id: number
          message_id: number
          raw_caption: string | null
          source_channel_id: number
          title: string
        }
        Insert: {
          created_at?: string
          duration?: number | null
          file_size?: number | null
          file_type?: string | null
          file_unique_id?: string | null
          id?: number
          message_id: number
          raw_caption?: string | null
          source_channel_id: number
          title: string
        }
        Update: {
          created_at?: string
          duration?: number | null
          file_size?: number | null
          file_type?: string | null
          file_unique_id?: string | null
          id?: number
          message_id?: number
          raw_caption?: string | null
          source_channel_id?: number
          title?: string
        }
        Relationships: []
      }
      query_cache: {
        Row: {
          created_at: string
          id: string
          query: string
        }
        Insert: {
          created_at?: string
          id: string
          query: string
        }
        Update: {
          created_at?: string
          id?: string
          query?: string
        }
        Relationships: []
      }
      required_channels: {
        Row: {
          added_by: number | null
          chat_id: number
          created_at: string
          expires_at: string | null
          invite_link: string | null
          kind: string
          title: string | null
          username: string | null
        }
        Insert: {
          added_by?: number | null
          chat_id: number
          created_at?: string
          expires_at?: string | null
          invite_link?: string | null
          kind?: string
          title?: string | null
          username?: string | null
        }
        Update: {
          added_by?: number | null
          chat_id?: number
          created_at?: string
          expires_at?: string | null
          invite_link?: string | null
          kind?: string
          title?: string | null
          username?: string | null
        }
        Relationships: []
      }
      search_log: {
        Row: {
          created_at: string
          id: number
          query: string
          telegram_id: number
        }
        Insert: {
          created_at?: string
          id?: number
          query: string
          telegram_id: number
        }
        Update: {
          created_at?: string
          id?: number
          query?: string
          telegram_id?: number
        }
        Relationships: []
      }
      search_usage: {
        Row: {
          day: string
          telegram_id: number
          used: number
        }
        Insert: {
          day?: string
          telegram_id: number
          used?: number
        }
        Update: {
          day?: string
          telegram_id?: number
          used?: number
        }
        Relationships: []
      }
      star_payments: {
        Row: {
          created_at: string
          id: number
          payload: string | null
          stars_amount: number
          telegram_payment_charge_id: string | null
          telegram_provider_charge_id: string | null
          telegram_user_id: number
        }
        Insert: {
          created_at?: string
          id?: number
          payload?: string | null
          stars_amount: number
          telegram_payment_charge_id?: string | null
          telegram_provider_charge_id?: string | null
          telegram_user_id: number
        }
        Update: {
          created_at?: string
          id?: number
          payload?: string | null
          stars_amount?: number
          telegram_payment_charge_id?: string | null
          telegram_provider_charge_id?: string | null
          telegram_user_id?: number
        }
        Relationships: []
      }
      support_threads: {
        Row: {
          created_at: string
          group_chat_id: number
          group_message_id: number
          telegram_id: number
        }
        Insert: {
          created_at?: string
          group_chat_id: number
          group_message_id: number
          telegram_id: number
        }
        Update: {
          created_at?: string
          group_chat_id?: number
          group_message_id?: number
          telegram_id?: number
        }
        Relationships: []
      }
      support_topics: {
        Row: {
          created_at: string
          group_chat_id: number
          telegram_id: number
          topic_id: number
        }
        Insert: {
          created_at?: string
          group_chat_id: number
          telegram_id: number
          topic_id: number
        }
        Update: {
          created_at?: string
          group_chat_id?: number
          telegram_id?: number
          topic_id?: number
        }
        Relationships: []
      }
      unblock_requests: {
        Row: {
          created_at: string
          id: number
          permanent: boolean
          reviewed_by: number | null
          stars: number
          status: string
          telegram_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          permanent?: boolean
          reviewed_by?: number | null
          stars: number
          status?: string
          telegram_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          permanent?: boolean
          reviewed_by?: number | null
          stars?: number
          status?: string
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_entitlements: {
        Row: {
          bonus_daily: number
          created_at: string
          extra_credits: number
          is_premium: boolean
          premium_expired_notified_at: string | null
          premium_since: string | null
          premium_until: string | null
          premium_warned_at: string | null
          referrals_count: number
          referred_by: number | null
          telegram_id: number
          updated_at: string
        }
        Insert: {
          bonus_daily?: number
          created_at?: string
          extra_credits?: number
          is_premium?: boolean
          premium_expired_notified_at?: string | null
          premium_since?: string | null
          premium_until?: string | null
          premium_warned_at?: string | null
          referrals_count?: number
          referred_by?: number | null
          telegram_id: number
          updated_at?: string
        }
        Update: {
          bonus_daily?: number
          created_at?: string
          extra_credits?: number
          is_premium?: boolean
          premium_expired_notified_at?: string | null
          premium_since?: string | null
          premium_until?: string | null
          premium_warned_at?: string | null
          referrals_count?: number
          referred_by?: number | null
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_search: {
        Args: { _limit: number; _telegram_id: number }
        Returns: {
          allowed: boolean
          used: number
        }[]
      }
      purge_bot_logs: { Args: never; Returns: Json }
      server_metrics: { Args: never; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
