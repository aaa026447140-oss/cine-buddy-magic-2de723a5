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
      bot_settings: {
        Row: {
          builder_username: string | null
          id: number
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
          updated_at: string
          updates_channel_url: string | null
        }
        Insert: {
          builder_username?: string | null
          id?: number
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
          updated_at?: string
          updates_channel_url?: string | null
        }
        Update: {
          builder_username?: string | null
          id?: number
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
