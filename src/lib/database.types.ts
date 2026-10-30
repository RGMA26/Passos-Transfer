
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "adjustments": {
                  Row: {
                    "amount": number,"created_at": string,"description": string,"driver_id": string,"id": string,"kind": string,"period_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"description": string,"driver_id": string,"id"?: string,"kind": string,"period_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"description"?: string,"driver_id"?: string,"id"?: string,"kind"?: string,"period_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "adjustments_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "adjustments_period_id_fkey"
      columns: ["period_id"]
isOneToOne: false
      referencedRelation: "periods"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string | null,"actor_id": string | null,"at": string,"created_at": string,"id": string,"new_data": Json | null,"old_data": Json | null,"row_id": string | null,"table_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action"?: string | null,"actor_id"?: string | null,"at"?: string,"created_at"?: string,"id"?: string,"new_data"?: Json | null,"old_data"?: Json | null,"row_id"?: string | null,"table_name"?: string | null
                  }
                  Update: {
                    "action"?: string | null,"actor_id"?: string | null,"at"?: string,"created_at"?: string,"id"?: string,"new_data"?: Json | null,"old_data"?: Json | null,"row_id"?: string | null,"table_name"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"cars": {
                  Row: {
                    "consumption_km_l": number,"created_at": string,"current_driver_id": string | null,"id": string,"model": string,"ownership": string,"plate": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consumption_km_l": number,"created_at"?: string,"current_driver_id"?: string | null,"id"?: string,"model": string,"ownership": string,"plate": string
                  }
                  Update: {
                    "consumption_km_l"?: number,"created_at"?: string,"current_driver_id"?: string | null,"id"?: string,"model"?: string,"ownership"?: string,"plate"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cars_current_driver_id_fkey"
      columns: ["current_driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"fuelings": {
                  Row: {
                    "amount": number,"car_id": string,"created_at": string,"driver_id": string,"fueled_on": string,"id": string,"liters": number,"photo_path": string,"reject_reason": string | null,"review_status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"car_id": string,"created_at"?: string,"driver_id": string,"fueled_on": string,"id"?: string,"liters": number,"photo_path": string,"reject_reason"?: string | null,"review_status"?: string
                  }
                  Update: {
                    "amount"?: number,"car_id"?: string,"created_at"?: string,"driver_id"?: string,"fueled_on"?: string,"id"?: string,"liters"?: number,"photo_path"?: string,"reject_reason"?: string | null,"review_status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fuelings_car_id_fkey"
      columns: ["car_id"]
isOneToOne: false
      referencedRelation: "cars"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fuelings_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"periods": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"end_date": string,"id": string,"reference_fuel_price": number | null,"start_date": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"end_date": string,"id"?: string,"reference_fuel_price"?: number | null,"start_date": string,"status"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"end_date"?: string,"id"?: string,"reference_fuel_price"?: number | null,"start_date"?: string,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "active": boolean,"created_at": string,"current_car_id": string | null,"driver_type": string | null,"id": string,"login_code": string | null,"must_change_password": boolean,"name": string | null,"phone": string | null,"role": string,"seq_number": number | null,"transfer_pct": number | null,"uber_pct": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"current_car_id"?: string | null,"driver_type"?: string | null,"id": string,"login_code"?: string | null,"must_change_password"?: boolean,"name"?: string | null,"phone"?: string | null,"role": string,"seq_number"?: number | null,"transfer_pct"?: number | null,"uber_pct"?: number | null
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"current_car_id"?: string | null,"driver_type"?: string | null,"id"?: string,"login_code"?: string | null,"must_change_password"?: boolean,"name"?: string | null,"phone"?: string | null,"role"?: string,"seq_number"?: number | null,"transfer_pct"?: number | null,"uber_pct"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_current_car_fk"
      columns: ["current_car_id"]
isOneToOne: false
      referencedRelation: "cars"
      referencedColumns: ["id"]
    }
                  ]
                },"ride_expenses": {
                  Row: {
                    "amount": number,"created_at": string,"id": string,"kind": string,"photo_path": string,"reject_reason": string | null,"review_status": string,"ride_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"id"?: string,"kind": string,"photo_path": string,"reject_reason"?: string | null,"review_status"?: string,"ride_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"id"?: string,"kind"?: string,"photo_path"?: string,"reject_reason"?: string | null,"review_status"?: string,"ride_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ride_expenses_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "rides"
      referencedColumns: ["id"]
    }
                  ]
                },"rides": {
                  Row: {
                    "amount": number,"client_name": string | null,"consumption_km_l": number | null,"created_at": string,"destination": string | null,"driver_id": string,"driver_pct": number | null,"id": string,"km": number | null,"origin": string | null,"platform": string,"reject_reason": string | null,"ride_date": string,"scheduled_at": string | null,"shift_id": string | null,"transfer_status": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"client_name"?: string | null,"consumption_km_l"?: number | null,"created_at"?: string,"destination"?: string | null,"driver_id": string,"driver_pct"?: number | null,"id"?: string,"km"?: number | null,"origin"?: string | null,"platform": string,"reject_reason"?: string | null,"ride_date": string,"scheduled_at"?: string | null,"shift_id"?: string | null,"transfer_status"?: string | null
                  }
                  Update: {
                    "amount"?: number,"client_name"?: string | null,"consumption_km_l"?: number | null,"created_at"?: string,"destination"?: string | null,"driver_id"?: string,"driver_pct"?: number | null,"id"?: string,"km"?: number | null,"origin"?: string | null,"platform"?: string,"reject_reason"?: string | null,"ride_date"?: string,"scheduled_at"?: string | null,"shift_id"?: string | null,"transfer_status"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rides_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rides_shift_id_fkey"
      columns: ["shift_id"]
isOneToOne: false
      referencedRelation: "shifts"
      referencedColumns: ["id"]
    }
                  ]
                },"shifts": {
                  Row: {
                    "car_id": string,"consumption_km_l": number,"created_at": string,"driver_id": string,"ended_at": string | null,"id": string,"odometer_end": number | null,"odometer_end_photo": string | null,"odometer_start": number,"odometer_start_photo": string | null,"reject_reason": string | null,"review_status": string,"start_date": string,"started_at": string,"uber_earnings_photo": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "car_id": string,"consumption_km_l": number,"created_at"?: string,"driver_id": string,"ended_at"?: string | null,"id"?: string,"odometer_end"?: number | null,"odometer_end_photo"?: string | null,"odometer_start": number,"odometer_start_photo"?: string | null,"reject_reason"?: string | null,"review_status"?: string,"start_date": string,"started_at"?: string,"uber_earnings_photo"?: string | null
                  }
                  Update: {
                    "car_id"?: string,"consumption_km_l"?: number,"created_at"?: string,"driver_id"?: string,"ended_at"?: string | null,"id"?: string,"odometer_end"?: number | null,"odometer_end_photo"?: string | null,"odometer_start"?: number,"odometer_start_photo"?: string | null,"reject_reason"?: string | null,"review_status"?: string,"start_date"?: string,"started_at"?: string,"uber_earnings_photo"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "shifts_car_id_fkey"
      columns: ["car_id"]
isOneToOne: false
      referencedRelation: "cars"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shifts_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"statements": {
                  Row: {
                    "created_at": string,"driver_id": string,"id": string,"lines": Json | null,"paid_at": string | null,"payment_method": string | null,"period_id": string,"total": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"driver_id": string,"id"?: string,"lines"?: Json | null,"paid_at"?: string | null,"payment_method"?: string | null,"period_id": string,"total"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"driver_id"?: string,"id"?: string,"lines"?: Json | null,"paid_at"?: string | null,"payment_method"?: string | null,"period_id"?: string,"total"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "statements_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "statements_period_id_fkey"
      columns: ["period_id"]
isOneToOne: false
      referencedRelation: "periods"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_alerts":
{ Args: Record<PropertyKey, never>; Returns: {
              "detail": Json,"driver_id": string,"kind": string,"shift_id": string
            }[]
                           },
"clear_must_change_password":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"close_period":
{ Args: { "p_period": string }; Returns: number
                           },
"complete_transfer":
{ Args: { "p_km": number,"p_ride_id": string }; Returns: {
              "amount": number,
"client_name": string | null,
"consumption_km_l": number | null,
"created_at": string,
"destination": string | null,
"driver_id": string,
"driver_pct": number | null,
"id": string,
"km": number | null,
"origin": string | null,
"platform": string,
"reject_reason": string | null,
"ride_date": string,
"scheduled_at": string | null,
"shift_id": string | null,
"transfer_status": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "rides"
        isOneToOne: true
        isSetofReturn: false
      } },
"compute_statement":
{ Args: { "p_driver": string,"p_period": string }; Returns: Json
                           },
"end_shift":
{ Args: { "p_odometer": number,"p_photo": string,"p_shift_id": string,"p_uber_photo": string }; Returns: Json
                           },
"fuel_price_for":
{ Args: { "p_driver": string,"p_period": string }; Returns: number
                           },
"generate_login_code":
{ Args: { "p_name": string }; Returns: string
                           },
"is_active_driver":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"mark_statement_paid":
{ Args: { "p_method": string,"p_paid_at": string,"p_statement": string }; Returns: undefined
                           },
"period_for_date":
{ Args: { "d": string }; Returns: string
                           },
"period_movement_drivers":
{ Args: { "p_period": string }; Returns: string[]
                           },
"period_summary":
{ Args: { "p_period": string }; Returns: Json
                           },
"review_item":
{ Args: { "p_approved": boolean,"p_id": string,"p_kind": string,"p_reason": string }; Returns: undefined
                           },
"row_in_closed_period":
{ Args: { "p_table": string,"r": Json }; Returns: boolean
                           },
"start_shift":
{ Args: { "p_car_id": string,"p_id": string,"p_odometer": number,"p_photo": string }; Returns: {
              "car_id": string,
"consumption_km_l": number,
"created_at": string,
"driver_id": string,
"ended_at": string | null,
"id": string,
"odometer_end": number | null,
"odometer_end_photo": string | null,
"odometer_start": number,
"odometer_start_photo": string | null,
"reject_reason": string | null,
"review_status": string,
"start_date": string,
"started_at": string,
"uber_earnings_photo": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "shifts"
        isOneToOne: true
        isSetofReturn: false
      } },
"unaccent":
{ Args: { "": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
