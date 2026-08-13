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
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          gym_id: string | null
          id: string
          ip_address: string | null
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          gym_id?: string | null
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          gym_id?: string | null
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      business_hours: {
        Row: {
          close_time: string | null
          created_at: string | null
          day_of_week: number
          gym_id: string | null
          id: string
          is_closed: boolean | null
          open_time: string | null
        }
        Insert: {
          close_time?: string | null
          created_at?: string | null
          day_of_week: number
          gym_id?: string | null
          id?: string
          is_closed?: boolean | null
          open_time?: string | null
        }
        Update: {
          close_time?: string | null
          created_at?: string | null
          day_of_week?: number
          gym_id?: string | null
          id?: string
          is_closed?: boolean | null
          open_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          check_in_method: string | null
          checked_in_at: string | null
          checked_out_at: string | null
          created_at: string | null
          device_info: string | null
          gym_id: string | null
          id: string
          member_id: string | null
          notes: string | null
          status: string | null
        }
        Insert: {
          check_in_method?: string | null
          checked_in_at?: string | null
          checked_out_at?: string | null
          created_at?: string | null
          device_info?: string | null
          gym_id?: string | null
          id?: string
          member_id?: string | null
          notes?: string | null
          status?: string | null
        }
        Update: {
          check_in_method?: string | null
          checked_in_at?: string | null
          checked_out_at?: string | null
          created_at?: string | null
          device_info?: string | null
          gym_id?: string | null
          id?: string
          member_id?: string | null
          notes?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checkin_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          gym_id: string
          id: string
          member_id: string
          source: string
          used_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          gym_id: string
          id?: string
          member_id: string
          source?: string
          used_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          gym_id?: string
          id?: string
          member_id?: string
          source?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkin_codes_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkin_codes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_bookings: {
        Row: {
          booked_at: string | null
          booking_date: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          checked_in: boolean | null
          class_id: string | null
          class_schedule_id: string | null
          gym_id: string | null
          id: string
          member_id: string | null
          status: string | null
        }
        Insert: {
          booked_at?: string | null
          booking_date?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          checked_in?: boolean | null
          class_id?: string | null
          class_schedule_id?: string | null
          gym_id?: string | null
          id?: string
          member_id?: string | null
          status?: string | null
        }
        Update: {
          booked_at?: string | null
          booking_date?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          checked_in?: boolean | null
          class_id?: string | null
          class_schedule_id?: string | null
          gym_id?: string | null
          id?: string
          member_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_bookings_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_bookings_class_schedule_id_fkey"
            columns: ["class_schedule_id"]
            isOneToOne: false
            referencedRelation: "class_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_bookings_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_bookings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_schedules: {
        Row: {
          class_id: string | null
          created_at: string | null
          day_of_week: number
          end_time: string
          gym_id: string | null
          id: string
          instructor_id: string | null
          is_active: boolean | null
          room: string | null
          start_time: string
        }
        Insert: {
          class_id?: string | null
          created_at?: string | null
          day_of_week: number
          end_time: string
          gym_id?: string | null
          id?: string
          instructor_id?: string | null
          is_active?: boolean | null
          room?: string | null
          start_time: string
        }
        Update: {
          class_id?: string | null
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          gym_id?: string | null
          id?: string
          instructor_id?: string | null
          is_active?: boolean | null
          room?: string | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_schedules_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_schedules_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          category: string | null
          created_at: string | null
          day_of_week: string
          description: string | null
          duration_minutes: number | null
          end_time: string
          gym_id: string | null
          id: string
          instructor: string | null
          instructor_id: string | null
          is_active: boolean | null
          level: string | null
          max_capacity: number | null
          name: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          day_of_week?: string
          description?: string | null
          duration_minutes?: number | null
          end_time?: string
          gym_id?: string | null
          id?: string
          instructor?: string | null
          instructor_id?: string | null
          is_active?: boolean | null
          level?: string | null
          max_capacity?: number | null
          name: string
          start_time?: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          day_of_week?: string
          description?: string | null
          duration_minutes?: number | null
          end_time?: string
          gym_id?: string | null
          id?: string
          instructor?: string | null
          instructor_id?: string | null
          is_active?: boolean | null
          level?: string | null
          max_capacity?: number | null
          name?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_errors: {
        Row: {
          created_at: string | null
          error_type: string | null
          gym_id: string | null
          id: string
          message: string | null
          page: string | null
          page_url: string | null
          severity: string | null
          stack: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_type?: string | null
          gym_id?: string | null
          id?: string
          message?: string | null
          page?: string | null
          page_url?: string | null
          severity?: string | null
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_type?: string | null
          gym_id?: string | null
          id?: string
          message?: string | null
          page?: string | null
          page_url?: string | null
          severity?: string | null
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_errors_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          gym_id: string | null
          id: string
          last_maintenance_date: string | null
          location: string | null
          maintenance_notes: string | null
          name: string
          next_maintenance_date: string | null
          photo_url: string | null
          purchase_date: string | null
          purchase_price: number | null
          serial_number: string | null
          status: string | null
          updated_at: string | null
          vendor: string | null
          warranty_expiry: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          gym_id?: string | null
          id?: string
          last_maintenance_date?: string | null
          location?: string | null
          maintenance_notes?: string | null
          name: string
          next_maintenance_date?: string | null
          photo_url?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          serial_number?: string | null
          status?: string | null
          updated_at?: string | null
          vendor?: string | null
          warranty_expiry?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          gym_id?: string | null
          id?: string
          last_maintenance_date?: string | null
          location?: string | null
          maintenance_notes?: string | null
          name?: string
          next_maintenance_date?: string | null
          photo_url?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          serial_number?: string | null
          status?: string | null
          updated_at?: string | null
          vendor?: string | null
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_maintenance: {
        Row: {
          cost: number | null
          created_at: string | null
          description: string | null
          equipment_id: string
          gym_id: string
          id: string
          maintenance_type: string
          next_due: string | null
          notes: string | null
          performed_at: string | null
          performed_by: string | null
          status: string | null
        }
        Insert: {
          cost?: number | null
          created_at?: string | null
          description?: string | null
          equipment_id: string
          gym_id: string
          id?: string
          maintenance_type: string
          next_due?: string | null
          notes?: string | null
          performed_at?: string | null
          performed_by?: string | null
          status?: string | null
        }
        Update: {
          cost?: number | null
          created_at?: string | null
          description?: string | null
          equipment_id?: string
          gym_id?: string
          id?: string
          maintenance_type?: string
          next_due?: string | null
          notes?: string | null
          performed_at?: string | null
          performed_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_maintenance_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_maintenance_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string | null
          created_by: string | null
          description: string | null
          expense_date: string | null
          gym_id: string | null
          id: string
          is_recurring: boolean | null
          receipt_url: string | null
          recurring_frequency: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expense_date?: string | null
          gym_id?: string | null
          id?: string
          is_recurring?: boolean | null
          receipt_url?: string | null
          recurring_frequency?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expense_date?: string | null
          gym_id?: string | null
          id?: string
          is_recurring?: boolean | null
          receipt_url?: string | null
          recurring_frequency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      export_logs: {
        Row: {
          created_at: string | null
          filter: string | null
          gym_id: string | null
          id: string
          member_count: number | null
        }
        Insert: {
          created_at?: string | null
          filter?: string | null
          gym_id?: string | null
          id?: string
          member_count?: number | null
        }
        Update: {
          created_at?: string | null
          filter?: string | null
          gym_id?: string | null
          id?: string
          member_count?: number | null
        }
        Relationships: []
      }
      gym_member_links: {
        Row: {
          gym_id: string | null
          id: string
          is_active: boolean | null
          joined_at: string | null
          member_id: string | null
          onboarding_method: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          gym_id?: string | null
          id?: string
          is_active?: boolean | null
          joined_at?: string | null
          member_id?: string | null
          onboarding_method?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          gym_id?: string | null
          id?: string
          is_active?: boolean | null
          joined_at?: string | null
          member_id?: string | null
          onboarding_method?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gym_member_links_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_member_links_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_staff_links: {
        Row: {
          bank_account_number: string | null
          bank_name: string | null
          created_at: string
          gym_id: string
          hire_date: string | null
          id: string
          is_active: boolean | null
          joined_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          salary: number | null
          salary_frequency:
            | Database["public"]["Enums"]["salary_frequency"]
            | null
          status: string | null
          terminated_at: string | null
          termination_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string
          gym_id: string
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          joined_at?: string | null
          role: Database["public"]["Enums"]["user_role"]
          salary?: number | null
          salary_frequency?:
            | Database["public"]["Enums"]["salary_frequency"]
            | null
          status?: string | null
          terminated_at?: string | null
          termination_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string
          gym_id?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          salary?: number | null
          salary_frequency?:
            | Database["public"]["Enums"]["salary_frequency"]
            | null
          status?: string | null
          terminated_at?: string | null
          termination_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gyms: {
        Row: {
          account_name: string | null
          account_number: string | null
          address: string | null
          backup_email: boolean
          backup_frequency: string
          backup_last_run_at: string | null
          bank_code: string | null
          bank_name: string | null
          city: string | null
          country: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          email: string | null
          hero_image_url: string | null
          id: string
          instructor_revenue_share_pct: number
          landing_content: string | null
          landing_enabled: boolean
          logo_url: string | null
          max_members: number | null
          member_code: string
          member_freeze_enabled: boolean
          name: string
          paystack_customer_code: string | null
          paystack_subaccount_code: string | null
          paystack_subscription_code: string | null
          phone: string | null
          platform_commission_pct: number
          slug: string
          state: string | null
          status: string | null
          subscription_billing_cycle: string | null
          subscription_current_period_end: string | null
          subscription_plan: string | null
          subscription_status: string | null
          tagline: string | null
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          address?: string | null
          backup_email?: boolean
          backup_frequency?: string
          backup_last_run_at?: string | null
          bank_code?: string | null
          bank_name?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          email?: string | null
          hero_image_url?: string | null
          id?: string
          instructor_revenue_share_pct?: number
          landing_content?: string | null
          landing_enabled?: boolean
          logo_url?: string | null
          max_members?: number | null
          member_code?: string
          member_freeze_enabled?: boolean
          name: string
          paystack_customer_code?: string | null
          paystack_subaccount_code?: string | null
          paystack_subscription_code?: string | null
          phone?: string | null
          platform_commission_pct?: number
          slug: string
          state?: string | null
          status?: string | null
          subscription_billing_cycle?: string | null
          subscription_current_period_end?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          tagline?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          address?: string | null
          backup_email?: boolean
          backup_frequency?: string
          backup_last_run_at?: string | null
          bank_code?: string | null
          bank_name?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          email?: string | null
          hero_image_url?: string | null
          id?: string
          instructor_revenue_share_pct?: number
          landing_content?: string | null
          landing_enabled?: boolean
          logo_url?: string | null
          max_members?: number | null
          member_code?: string
          member_freeze_enabled?: boolean
          name?: string
          paystack_customer_code?: string | null
          paystack_subaccount_code?: string | null
          paystack_subscription_code?: string | null
          phone?: string | null
          platform_commission_pct?: number
          slug?: string
          state?: string | null
          status?: string | null
          subscription_billing_cycle?: string | null
          subscription_current_period_end?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          tagline?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      instructor_bank_details: {
        Row: {
          account_name: string
          account_number: string
          bank_code: string
          bank_name: string
          created_at: string
          instructor_id: string
          updated_at: string
        }
        Insert: {
          account_name: string
          account_number: string
          bank_code: string
          bank_name: string
          created_at?: string
          instructor_id: string
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          bank_code?: string
          bank_name?: string
          created_at?: string
          instructor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      instructor_payouts: {
        Row: {
          account_name: string | null
          account_number: string | null
          amount: number
          bank_code: string | null
          bank_name: string | null
          created_at: string
          gym_id: string
          id: string
          instructor_id: string
          notes: string | null
          paystack_recipient_code: string | null
          paystack_transfer_code: string | null
          processed_at: string | null
          processed_by: string | null
          requested_at: string
          status: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          amount: number
          bank_code?: string | null
          bank_name?: string | null
          created_at?: string
          gym_id: string
          id?: string
          instructor_id: string
          notes?: string | null
          paystack_recipient_code?: string | null
          paystack_transfer_code?: string | null
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          status?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          amount?: number
          bank_code?: string | null
          bank_name?: string | null
          created_at?: string
          gym_id?: string
          id?: string
          instructor_id?: string
          notes?: string | null
          paystack_recipient_code?: string | null
          paystack_transfer_code?: string | null
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "instructor_payouts_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructor_payouts_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructor_payouts_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      instructor_pricing: {
        Row: {
          billing_period: string | null
          created_at: string
          currency: string | null
          duration_days: number
          features: Json | null
          gym_id: string
          id: string
          instructor_id: string
          is_active: boolean | null
          plan_name: string | null
          price: number
          updated_at: string
        }
        Insert: {
          billing_period?: string | null
          created_at?: string
          currency?: string | null
          duration_days: number
          features?: Json | null
          gym_id: string
          id?: string
          instructor_id: string
          is_active?: boolean | null
          plan_name?: string | null
          price: number
          updated_at?: string
        }
        Update: {
          billing_period?: string | null
          created_at?: string
          currency?: string | null
          duration_days?: number
          features?: Json | null
          gym_id?: string
          id?: string
          instructor_id?: string
          is_active?: boolean | null
          plan_name?: string | null
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      instructor_sessions: {
        Row: {
          created_at: string
          duration_minutes: number
          gym_id: string
          id: string
          instructor_id: string
          marked_at: string | null
          member_id: string
          notes: string | null
          scheduled_at: string
          status: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number
          gym_id: string
          id?: string
          instructor_id: string
          marked_at?: string | null
          member_id: string
          notes?: string | null
          scheduled_at: string
          status?: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number
          gym_id?: string
          id?: string
          instructor_id?: string
          marked_at?: string | null
          member_id?: string
          notes?: string | null
          scheduled_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "instructor_sessions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructor_sessions_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructor_sessions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      instructor_subscriptions: {
        Row: {
          amount_paid: number | null
          auto_renew: boolean
          created_at: string | null
          end_date: string | null
          gym_id: string
          id: string
          instructor_id: string
          member_id: string | null
          payment_reference: string | null
          plan_id: string | null
          start_date: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          amount_paid?: number | null
          auto_renew?: boolean
          created_at?: string | null
          end_date?: string | null
          gym_id: string
          id?: string
          instructor_id: string
          member_id?: string | null
          payment_reference?: string | null
          plan_id?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount_paid?: number | null
          auto_renew?: boolean
          created_at?: string | null
          end_date?: string | null
          gym_id?: string
          id?: string
          instructor_id?: string
          member_id?: string | null
          payment_reference?: string | null
          plan_id?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instructor_subscriptions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructor_subscriptions_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructor_subscriptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructor_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructor_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pricing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      member_subscriptions: {
        Row: {
          auto_debit_enabled: boolean | null
          created_at: string | null
          end_date: string
          gym_id: string
          id: string
          member_id: string
          paused_at: string | null
          pause_end: string | null
          pause_reason: string | null
          pause_start: string | null
          payment_method: string | null
          paystack_customer_code: string | null
          paystack_email_token: string | null
          paystack_subscription_code: string | null
          plan_id: string | null
          start_date: string
          status: string | null
          trainer_addon: boolean
          updated_at: string | null
        }
        Insert: {
          auto_debit_enabled?: boolean | null
          created_at?: string | null
          end_date: string
          gym_id: string
          id?: string
          member_id: string
          paused_at?: string | null
          pause_end?: string | null
          pause_reason?: string | null
          pause_start?: string | null
          payment_method?: string | null
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          plan_id?: string | null
          start_date?: string
          status?: string | null
          trainer_addon?: boolean
          updated_at?: string | null
        }
        Update: {
          auto_debit_enabled?: boolean | null
          created_at?: string | null
          end_date?: string
          gym_id?: string
          id?: string
          member_id?: string
          paused_at?: string | null
          pause_end?: string | null
          pause_reason?: string | null
          pause_start?: string | null
          payment_method?: string | null
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          plan_id?: string | null
          start_date?: string
          status?: string | null
          trainer_addon?: boolean
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_subscriptions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_subscriptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pricing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_plans: {
        Row: {
          created_at: string | null
          currency: string | null
          description: string | null
          duration_days: number | null
          duration_months: number
          features: Json | null
          gym_id: string | null
          id: string
          is_active: boolean | null
          name: string
          paystack_plan_code: string | null
          paystack_plan_code_trainer: string | null
          price: number
          trainer_addon_enabled: boolean
          trainer_addon_price: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          description?: string | null
          duration_days?: number | null
          duration_months: number
          features?: Json | null
          gym_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          paystack_plan_code?: string | null
          paystack_plan_code_trainer?: string | null
          price: number
          trainer_addon_enabled?: boolean
          trainer_addon_price?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          description?: string | null
          duration_days?: number | null
          duration_months?: number
          features?: Json | null
          gym_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          paystack_plan_code?: string | null
          paystack_plan_code_trainer?: string | null
          price?: number
          trainer_addon_enabled?: boolean
          trainer_addon_price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_plans_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          auto_debit_enabled: boolean | null
          auto_renew: boolean | null
          created_at: string | null
          end_date: string
          gym_id: string | null
          id: string
          member_id: string | null
          pause_end: string | null
          pause_reason: string | null
          pause_start: string | null
          paused_at: string | null
          payment_method: string | null
          plan_id: string | null
          start_date: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          auto_debit_enabled?: boolean | null
          auto_renew?: boolean | null
          created_at?: string | null
          end_date: string
          gym_id?: string | null
          id?: string
          member_id?: string | null
          pause_end?: string | null
          pause_reason?: string | null
          pause_start?: string | null
          paused_at?: string | null
          payment_method?: string | null
          plan_id?: string | null
          start_date: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_debit_enabled?: boolean | null
          auto_renew?: boolean | null
          created_at?: string | null
          end_date?: string
          gym_id?: string | null
          id?: string
          member_id?: string | null
          pause_end?: string | null
          pause_reason?: string | null
          pause_start?: string | null
          paused_at?: string | null
          payment_method?: string | null
          plan_id?: string | null
          start_date?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pricing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          channel: string | null
          created_at: string | null
          gym_id: string | null
          id: string
          is_read: boolean | null
          metadata: Json | null
          read_at: string | null
          sent_at: string | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          body?: string | null
          channel?: string | null
          created_at?: string | null
          gym_id?: string | null
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          read_at?: string | null
          sent_at?: string | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string | null
          channel?: string | null
          created_at?: string | null
          gym_id?: string | null
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          read_at?: string | null
          sent_at?: string | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string | null
          currency: string | null
          gym_id: string | null
          id: string
          member_id: string | null
          metadata: Json | null
          payment_date: string | null
          payment_method: string | null
          payment_status: string | null
          paystack_authorization_code: string | null
          paystack_reference: string | null
          plan_id: string | null
          status: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string | null
          gym_id?: string | null
          id?: string
          member_id?: string | null
          metadata?: Json | null
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          paystack_authorization_code?: string | null
          paystack_reference?: string | null
          plan_id?: string | null
          status?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string | null
          gym_id?: string | null
          id?: string
          member_id?: string | null
          metadata?: Json | null
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          paystack_authorization_code?: string | null
          paystack_reference?: string | null
          plan_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pricing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_payments: {
        Row: {
          amount: number
          billing_period_end: string
          billing_period_start: string
          created_at: string
          currency: string | null
          gym_id: string
          id: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          paystack_reference: string | null
          plan: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          billing_period_end: string
          billing_period_start: string
          created_at?: string
          currency?: string | null
          gym_id: string
          id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          paystack_reference?: string | null
          plan?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          billing_period_end?: string
          billing_period_start?: string
          created_at?: string
          currency?: string | null
          gym_id?: string
          id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          paystack_reference?: string | null
          plan?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          bio: string | null
          certifications: string | null
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          first_name: string | null
          full_name: string | null
          gender: string | null
          gym_id: string | null
          health_notes: string | null
          id: string
          is_active: boolean | null
          last_name: string | null
          member_id: string | null
          nok_address: string | null
          nok_name: string | null
          nok_phone: string | null
          nok_relationship: string | null
          notification_email: boolean
          notification_whatsapp: boolean
          phone: string | null
          photo_url: string | null
          role: string | null
          specialisation: string | null
          updated_at: string | null
          user_id: string | null
          waiver_signature: string | null
          waiver_signed_at: string | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          bio?: string | null
          certifications?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name?: string | null
          full_name?: string | null
          gender?: string | null
          gym_id?: string | null
          health_notes?: string | null
          id: string
          is_active?: boolean | null
          last_name?: string | null
          member_id?: string | null
          nok_address?: string | null
          nok_name?: string | null
          nok_phone?: string | null
          nok_relationship?: string | null
          notification_email?: boolean
          notification_whatsapp?: boolean
          phone?: string | null
          photo_url?: string | null
          role?: string | null
          specialisation?: string | null
          updated_at?: string | null
          user_id?: string | null
          waiver_signature?: string | null
          waiver_signed_at?: string | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          bio?: string | null
          certifications?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name?: string | null
          full_name?: string | null
          gender?: string | null
          gym_id?: string | null
          health_notes?: string | null
          id?: string
          is_active?: boolean | null
          last_name?: string | null
          member_id?: string | null
          nok_address?: string | null
          nok_name?: string | null
          nok_phone?: string | null
          nok_relationship?: string | null
          notification_email?: boolean
          notification_whatsapp?: boolean
          phone?: string | null
          photo_url?: string | null
          role?: string | null
          specialisation?: string | null
          updated_at?: string | null
          user_id?: string | null
          waiver_signature?: string | null
          waiver_signed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      reminder_logs: {
        Row: {
          action: string
          channel: string
          created_at: string | null
          failed_count: number
          gym_id: string | null
          id: string
          message_preview: string | null
          recipient_count: number
          sent_count: number
        }
        Insert: {
          action: string
          channel?: string
          created_at?: string | null
          failed_count?: number
          gym_id?: string | null
          id?: string
          message_preview?: string | null
          recipient_count?: number
          sent_count?: number
        }
        Update: {
          action?: string
          channel?: string
          created_at?: string | null
          failed_count?: number
          gym_id?: string | null
          id?: string
          message_preview?: string | null
          recipient_count?: number
          sent_count?: number
        }
        Relationships: []
      }
      reminders: {
        Row: {
          channel: string
          created_at: string | null
          days_before: number | null
          gym_id: string | null
          id: string
          is_active: boolean | null
          schedule: string | null
          template: string | null
          type: string
        }
        Insert: {
          channel: string
          created_at?: string | null
          days_before?: number | null
          gym_id?: string | null
          id?: string
          is_active?: boolean | null
          schedule?: string | null
          template?: string | null
          type: string
        }
        Update: {
          channel?: string
          created_at?: string | null
          days_before?: number | null
          gym_id?: string | null
          id?: string
          is_active?: boolean | null
          schedule?: string | null
          template?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_payments: {
        Row: {
          amount: number
          created_at: string
          gym_id: string
          id: string
          notes: string | null
          paid_by: string | null
          payment_date: string
          payment_method: string | null
          payment_period: string | null
          period_end: string | null
          period_start: string | null
          staff_id: string | null
          staff_link_id: string
          status: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          gym_id: string
          id?: string
          notes?: string | null
          paid_by?: string | null
          payment_date: string
          payment_method?: string | null
          payment_period?: string | null
          period_end?: string | null
          period_start?: string | null
          staff_id?: string | null
          staff_link_id: string
          status?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          gym_id?: string
          id?: string
          notes?: string | null
          paid_by?: string | null
          payment_date?: string
          payment_method?: string | null
          payment_period?: string | null
          period_end?: string | null
          period_start?: string | null
          staff_id?: string | null
          staff_link_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salary_payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_payments_staff_link_id_fkey"
            columns: ["staff_link_id"]
            isOneToOne: false
            referencedRelation: "gym_staff_links"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_cards: {
        Row: {
          authorization_code: string
          bank: string | null
          brand: string | null
          card_type: string | null
          created_at: string | null
          email: string | null
          exp_month: string | null
          exp_year: string | null
          expiry_month: number | null
          expiry_year: number | null
          gym_id: string
          id: string
          is_active: boolean | null
          is_default: boolean | null
          last4: string | null
          member_id: string
          paystack_authorization_code: string | null
          reusable: boolean | null
        }
        Insert: {
          authorization_code: string
          bank?: string | null
          brand?: string | null
          card_type?: string | null
          created_at?: string | null
          email?: string | null
          exp_month?: string | null
          exp_year?: string | null
          expiry_month?: number | null
          expiry_year?: number | null
          gym_id: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          last4?: string | null
          member_id: string
          paystack_authorization_code?: string | null
          reusable?: boolean | null
        }
        Update: {
          authorization_code?: string
          bank?: string | null
          brand?: string | null
          card_type?: string | null
          created_at?: string | null
          email?: string | null
          exp_month?: string | null
          exp_year?: string | null
          expiry_month?: number | null
          expiry_year?: number | null
          gym_id?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          last4?: string | null
          member_id?: string
          paystack_authorization_code?: string | null
          reusable?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_cards_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_cards_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string | null
          gym_id: string | null
          hire_date: string | null
          id: string
          is_active: boolean | null
          profile_id: string | null
          role: string
          salary: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          gym_id?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          profile_id?: string | null
          role: string
          salary?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          gym_id?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          profile_id?: string | null
          role?: string
          salary?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          gym_id: string | null
          id: string
          priority: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          gym_id?: string | null
          id?: string
          priority?: string
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          gym_id?: string | null
          id?: string
          priority?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      waiver_signatures: {
        Row: {
          gym_id: string | null
          id: string
          ip_address: string | null
          member_id: string | null
          signature: string | null
          signature_data: string | null
          signed_at: string | null
          user_agent: string | null
          waiver_id: string | null
        }
        Insert: {
          gym_id?: string | null
          id?: string
          ip_address?: string | null
          member_id?: string | null
          signature?: string | null
          signature_data?: string | null
          signed_at?: string | null
          user_agent?: string | null
          waiver_id?: string | null
        }
        Update: {
          gym_id?: string | null
          id?: string
          ip_address?: string | null
          member_id?: string | null
          signature?: string | null
          signature_data?: string | null
          signed_at?: string | null
          user_agent?: string | null
          waiver_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waiver_signatures_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_signatures_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_signatures_waiver_id_fkey"
            columns: ["waiver_id"]
            isOneToOne: false
            referencedRelation: "waivers"
            referencedColumns: ["id"]
          },
        ]
      }
      waivers: {
        Row: {
          content: string
          created_at: string | null
          gym_id: string | null
          id: string
          is_active: boolean | null
          title: string
          updated_at: string | null
          version: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          gym_id?: string | null
          id?: string
          is_active?: boolean | null
          title: string
          updated_at?: string | null
          version?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          gym_id?: string | null
          id?: string
          is_active?: boolean | null
          title?: string
          updated_at?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waivers_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_whatsapp_settings: {
        Row: {
          ai_enabled: boolean
          app_home_url: string | null
          created_at: string
          enabled: boolean
          gym_id: string
          qr_checkin_enabled: boolean
          support_phone: string | null
          updated_at: string
          welcome_message: string | null
        }
        Insert: {
          ai_enabled?: boolean
          app_home_url?: string | null
          created_at?: string
          enabled?: boolean
          gym_id: string
          qr_checkin_enabled?: boolean
          support_phone?: string | null
          updated_at?: string
          welcome_message?: string | null
        }
        Update: {
          ai_enabled?: boolean
          app_home_url?: string | null
          created_at?: string
          enabled?: boolean
          gym_id?: string
          qr_checkin_enabled?: boolean
          support_phone?: string | null
          updated_at?: string
          welcome_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gym_whatsapp_settings_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: true
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contacts: {
        Row: {
          active_gym_id: string | null
          blocked: boolean
          created_at: string
          display_name: string | null
          id: string
          last_inbound_at: string | null
          last_outbound_at: string | null
          opted_in: boolean
          opted_out_at: string | null
          profile_id: string | null
          state: Json
          updated_at: string
          wa_id: string
        }
        Insert: {
          active_gym_id?: string | null
          blocked?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          opted_in?: boolean
          opted_out_at?: string | null
          profile_id?: string | null
          state?: Json
          updated_at?: string
          wa_id: string
        }
        Update: {
          active_gym_id?: string | null
          blocked?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          opted_in?: boolean
          opted_out_at?: string | null
          profile_id?: string | null
          state?: Json
          updated_at?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_contacts_active_gym_id_fkey"
            columns: ["active_gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          authored_by: string | null
          body: string | null
          contact_id: string
          created_at: string
          direction: string
          error: string | null
          gym_id: string | null
          id: string
          kind: string
          payload: Json | null
          status: string | null
          wa_message_id: string | null
        }
        Insert: {
          authored_by?: string | null
          body?: string | null
          contact_id: string
          created_at?: string
          direction: string
          error?: string | null
          gym_id?: string | null
          id?: string
          kind?: string
          payload?: Json | null
          status?: string | null
          wa_message_id?: string | null
        }
        Update: {
          authored_by?: string | null
          body?: string | null
          contact_id?: string
          created_at?: string
          direction?: string
          error?: string | null
          gym_id?: string | null
          id?: string
          kind?: string
          payload?: Json | null
          status?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_flow_sessions: {
        Row: {
          consumed_at: string | null
          created_at: string
          data: Json
          expires_at: string
          flow_token: string
          gym_id: string | null
          kind: string
          wa_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          data?: Json
          expires_at: string
          flow_token: string
          gym_id?: string | null
          kind: string
          wa_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          data?: Json
          expires_at?: string
          flow_token?: string
          gym_id?: string | null
          kind?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_flow_sessions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_email_otps: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          gym_id: string | null
          id: string
          purpose: string
          user_id: string | null
          wa_id: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          gym_id?: string | null
          id?: string
          purpose?: string
          user_id?: string | null
          wa_id?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          gym_id?: string | null
          id?: string
          purpose?: string
          user_id?: string | null
          wa_id?: string | null
        }
        Relationships: []
      }
      whatsapp_payment_intents: {
        Row: {
          amount_kobo: number
          authorization_url: string | null
          completed_at: string | null
          contact_id: string
          created_at: string
          gym_id: string
          id: string
          member_id: string
          plan_id: string | null
          reference: string
          status: string
          with_trainer: boolean
        }
        Insert: {
          amount_kobo: number
          authorization_url?: string | null
          completed_at?: string | null
          contact_id: string
          created_at?: string
          gym_id: string
          id?: string
          member_id: string
          plan_id?: string | null
          reference: string
          status?: string
          with_trainer?: boolean
        }
        Update: {
          amount_kobo?: number
          authorization_url?: string | null
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          gym_id?: string
          id?: string
          member_id?: string
          plan_id?: string | null
          reference?: string
          status?: string
          with_trainer?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_payment_intents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_payment_intents_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_providers: {
        Row: {
          api_key_encrypted: string | null
          base_url: string | null
          created_at: string
          default_model: string | null
          docs_url: string | null
          enabled: boolean
          id: string
          models: Json
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          base_url?: string | null
          created_at?: string
          default_model?: string | null
          docs_url?: string | null
          enabled?: boolean
          id?: string
          models?: Json
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          base_url?: string | null
          created_at?: string
          default_model?: string | null
          docs_url?: string | null
          enabled?: boolean
          id?: string
          models?: Json
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      gym_ai_settings: {
        Row: {
          api_key_encrypted: string | null
          created_at: string
          enabled: boolean
          gym_id: string
          handoff_keywords: string[]
          max_tokens: number
          model: string | null
          monthly_token_cap: number
          provider_slug: string | null
          system_prompt: string | null
          temperature: number
          tokens_used_this_month: number
          updated_at: string
          usage_period_start: string
        }
        Insert: {
          api_key_encrypted?: string | null
          created_at?: string
          enabled?: boolean
          gym_id: string
          handoff_keywords?: string[]
          max_tokens?: number
          model?: string | null
          monthly_token_cap?: number
          provider_slug?: string | null
          system_prompt?: string | null
          temperature?: number
          tokens_used_this_month?: number
          updated_at?: string
          usage_period_start?: string
        }
        Update: {
          api_key_encrypted?: string | null
          created_at?: string
          enabled?: boolean
          gym_id?: string
          handoff_keywords?: string[]
          max_tokens?: number
          model?: string | null
          monthly_token_cap?: number
          provider_slug?: string | null
          system_prompt?: string | null
          temperature?: number
          tokens_used_this_month?: number
          updated_at?: string
          usage_period_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "gym_ai_settings_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: true
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      pricing_plans: {
        Row: {
          created_at: string | null
          currency: string | null
          description: string | null
          duration_months: number | null
          features: Json | null
          gym_id: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          price: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          description?: string | null
          duration_months?: number | null
          features?: Json | null
          gym_id?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          price?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          description?: string | null
          duration_months?: number | null
          features?: Json | null
          gym_id?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          price?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_plans_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_see_profile: { Args: { target_user_id: string }; Returns: boolean }
      rate_limit_hit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      expire_subscriptions: { Args: never; Returns: number }
      get_current_gym_id: { Args: never; Returns: string }
      get_my_profile_id: { Args: never; Returns: string }
      get_user_gyms: { Args: never; Returns: string[] }
      gym_id_from_waiver: { Args: { _waiver_id: string }; Returns: string }
      has_gym_role: {
        Args: {
          p_gym_id: string
          p_roles: Database["public"]["Enums"]["user_role"][]
        }
        Returns: boolean
      }
      is_gym_member: { Args: { _gym_id: string }; Returns: boolean }
      is_gym_owner: { Args: { _gym_id: string }; Returns: boolean }
      is_gym_staff: { Args: { _gym_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      equipment_condition:
        | "excellent"
        | "good"
        | "fair"
        | "needs_repair"
        | "out_of_service"
      expense_category:
        | "utilities"
        | "maintenance"
        | "supplies"
        | "salaries"
        | "rent"
        | "marketing"
        | "equipment"
        | "other"
      gym_status: "active" | "suspended" | "terminated" | "trial"
      notification_channel: "email" | "whatsapp" | "sms"
      notification_event:
        | "welcome"
        | "payment_receipt"
        | "expiry_reminder_7"
        | "expiry_reminder_3"
        | "expiry_reminder_1"
        | "membership_expired"
        | "auto_renewal_success"
        | "auto_renewal_failed"
        | "pause_approved"
        | "login_credentials"
        | "check_in_confirmation"
      payment_method: "card" | "bank_transfer" | "cash" | "auto_debit"
      payment_status: "successful" | "failed" | "pending" | "refunded"
      salary_frequency: "monthly" | "weekly" | "biweekly"
      subscription_status:
        | "active"
        | "paused"
        | "pause_requested"
        | "expired"
        | "cancelled"
      user_role:
        | "platform_admin"
        | "gym_owner"
        | "manager"
        | "front_desk"
        | "accountant"
        | "instructor"
        | "member"
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
    Enums: {
      equipment_condition: [
        "excellent",
        "good",
        "fair",
        "needs_repair",
        "out_of_service",
      ],
      expense_category: [
        "utilities",
        "maintenance",
        "supplies",
        "salaries",
        "rent",
        "marketing",
        "equipment",
        "other",
      ],
      gym_status: ["active", "suspended", "terminated", "trial"],
      notification_channel: ["email", "whatsapp", "sms"],
      notification_event: [
        "welcome",
        "payment_receipt",
        "expiry_reminder_7",
        "expiry_reminder_3",
        "expiry_reminder_1",
        "membership_expired",
        "auto_renewal_success",
        "auto_renewal_failed",
        "pause_approved",
        "login_credentials",
        "check_in_confirmation",
      ],
      payment_method: ["card", "bank_transfer", "cash", "auto_debit"],
      payment_status: ["successful", "failed", "pending", "refunded"],
      salary_frequency: ["monthly", "weekly", "biweekly"],
      subscription_status: [
        "active",
        "paused",
        "pause_requested",
        "expired",
        "cancelled",
      ],
      user_role: [
        "platform_admin",
        "gym_owner",
        "manager",
        "front_desk",
        "accountant",
        "instructor",
        "member",
      ],
    },
  },
} as const
