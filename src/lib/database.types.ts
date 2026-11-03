
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
                    "amount": number,"created_at": string,"description": string,"driver_id": string,"driver_period_id": string,"effective_date": string,"id": string,"kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"description": string,"driver_id": string,"driver_period_id": string,"effective_date"?: string,"id"?: string,"kind": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"description"?: string,"driver_id"?: string,"driver_period_id"?: string,"effective_date"?: string,"id"?: string,"kind"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "adjustments_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "adjustments_driver_period_id_fkey"
      columns: ["driver_period_id"]
isOneToOne: false
      referencedRelation: "driver_periods"
      referencedColumns: ["id"]
    }
                  ]
                },"admin_documents": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"driver_id": string,"file_path": string,"id": string,"kind": string,"mime_type": string,"size_bytes": number,"statement_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"driver_id": string,"file_path": string,"id"?: string,"kind": string,"mime_type": string,"size_bytes": number,"statement_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"driver_id"?: string,"file_path"?: string,"id"?: string,"kind"?: string,"mime_type"?: string,"size_bytes"?: number,"statement_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_documents_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_documents_statement_id_fkey"
      columns: ["statement_id"]
isOneToOne: false
      referencedRelation: "statements"
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
                },"car_expenses": {
                  Row: {
                    "amount": number,"car_id": string,"created_at": string,"deleted_on": string | null,"description": string | null,"end_date": string | null,"finished": boolean,"id": string,"installments": number | null,"kind": string,"mode": string,"start_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"car_id": string,"created_at"?: string,"deleted_on"?: string | null,"description"?: string | null,"end_date"?: string | null,"finished"?: boolean,"id"?: string,"installments"?: number | null,"kind": string,"mode": string,"start_date": string
                  }
                  Update: {
                    "amount"?: number,"car_id"?: string,"created_at"?: string,"deleted_on"?: string | null,"description"?: string | null,"end_date"?: string | null,"finished"?: boolean,"id"?: string,"installments"?: number | null,"kind"?: string,"mode"?: string,"start_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "car_expenses_car_id_fkey"
      columns: ["car_id"]
isOneToOne: false
      referencedRelation: "cars"
      referencedColumns: ["id"]
    }
                  ]
                },"cars": {
                  Row: {
                    "created_at": string,"current_driver_id": string | null,"fuel_type": string | null,"fuels": (string)[],"id": string,"km_per_kwh": number | null,"km_per_l_alcool": number | null,"km_per_l_diesel": number | null,"km_per_l_gasolina": number | null,"km_per_m3_gnv": number | null,"model": string,"ownership": string,"plate": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"current_driver_id"?: string | null,"fuel_type"?: string | null,"fuels": (string)[],"id"?: string,"km_per_kwh"?: number | null,"km_per_l_alcool"?: number | null,"km_per_l_diesel"?: number | null,"km_per_l_gasolina"?: number | null,"km_per_m3_gnv"?: number | null,"model": string,"ownership": string,"plate": string
                  }
                  Update: {
                    "created_at"?: string,"current_driver_id"?: string | null,"fuel_type"?: string | null,"fuels"?: (string)[],"id"?: string,"km_per_kwh"?: number | null,"km_per_l_alcool"?: number | null,"km_per_l_diesel"?: number | null,"km_per_l_gasolina"?: number | null,"km_per_m3_gnv"?: number | null,"model"?: string,"ownership"?: string,"plate"?: string
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
                },"driver_pauses": {
                  Row: {
                    "created_at": string,"driver_id": string,"id": string,"paused_on": string,"reason": string | null,"resumed_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"driver_id": string,"id"?: string,"paused_on": string,"reason"?: string | null,"resumed_on"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"driver_id"?: string,"id"?: string,"paused_on"?: string,"reason"?: string | null,"resumed_on"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "driver_pauses_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"driver_periods": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"driver_id": string,"end_date": string,"id": string,"missing_fuel_price": boolean,"start_date": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"driver_id": string,"end_date": string,"id"?: string,"missing_fuel_price"?: boolean,"start_date": string,"status"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"driver_id"?: string,"end_date"?: string,"id"?: string,"missing_fuel_price"?: boolean,"start_date"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "driver_periods_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"fuelings": {
                  Row: {
                    "amount": number,"car_id": string,"created_at": string,"driver_id": string,"fuel": string,"fueled_on": string,"id": string,"km_equivalent": number | null,"photo_path": string,"quantity": number,"reject_reason": string | null,"review_status": string,"unit_price": number,"values_conflict": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"car_id": string,"created_at"?: string,"driver_id": string,"fuel": string,"fueled_on": string,"id"?: string,"km_equivalent"?: number | null,"photo_path": string,"quantity": number,"reject_reason"?: string | null,"review_status"?: string,"unit_price": number,"values_conflict"?: boolean
                  }
                  Update: {
                    "amount"?: number,"car_id"?: string,"created_at"?: string,"driver_id"?: string,"fuel"?: string,"fueled_on"?: string,"id"?: string,"km_equivalent"?: number | null,"photo_path"?: string,"quantity"?: number,"reject_reason"?: string | null,"review_status"?: string,"unit_price"?: number,"values_conflict"?: boolean
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
                },"profiles": {
                  Row: {
                    "active": boolean,"cpf": string | null,"created_at": string,"current_car_id": string | null,"cycle_start_date": string | null,"driver_type": string | null,"id": string,"login_code": string | null,"must_change_password": boolean,"name": string | null,"paused": boolean,"phone": string | null,"role": string,"seq_number": number | null,"transfer_pct": number | null,"uber_pct": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"cpf"?: string | null,"created_at"?: string,"current_car_id"?: string | null,"cycle_start_date"?: string | null,"driver_type"?: string | null,"id": string,"login_code"?: string | null,"must_change_password"?: boolean,"name"?: string | null,"paused"?: boolean,"phone"?: string | null,"role": string,"seq_number"?: number | null,"transfer_pct"?: number | null,"uber_pct"?: number | null
                  }
                  Update: {
                    "active"?: boolean,"cpf"?: string | null,"created_at"?: string,"current_car_id"?: string | null,"cycle_start_date"?: string | null,"driver_type"?: string | null,"id"?: string,"login_code"?: string | null,"must_change_password"?: boolean,"name"?: string | null,"paused"?: boolean,"phone"?: string | null,"role"?: string,"seq_number"?: number | null,"transfer_pct"?: number | null,"uber_pct"?: number | null
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
                    "amount": number,"car_id": string | null,"client_name": string | null,"created_at": string,"dest_city": string | null,"dest_district": string | null,"dest_ref": string | null,"dest_state": string | null,"dest_street": string | null,"dest_zip": string | null,"destination": string | null,"driver_id": string,"driver_pct": number | null,"estimated_km": number | null,"id": string,"km": number | null,"odometer_end": number | null,"odometer_end_photo": string | null,"odometer_start": number | null,"odometer_start_photo": string | null,"origin": string | null,"origin_city": string | null,"origin_district": string | null,"origin_ref": string | null,"origin_state": string | null,"origin_street": string | null,"origin_zip": string | null,"platform": string,"receipt_path": string | null,"reject_reason": string | null,"ride_date": string,"scheduled_at": string | null,"shift_id": string | null,"started_at": string | null,"transfer_status": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"car_id"?: string | null,"client_name"?: string | null,"created_at"?: string,"dest_city"?: string | null,"dest_district"?: string | null,"dest_ref"?: string | null,"dest_state"?: string | null,"dest_street"?: string | null,"dest_zip"?: string | null,"destination"?: string | null,"driver_id": string,"driver_pct"?: number | null,"estimated_km"?: number | null,"id"?: string,"km"?: number | null,"odometer_end"?: number | null,"odometer_end_photo"?: string | null,"odometer_start"?: number | null,"odometer_start_photo"?: string | null,"origin"?: string | null,"origin_city"?: string | null,"origin_district"?: string | null,"origin_ref"?: string | null,"origin_state"?: string | null,"origin_street"?: string | null,"origin_zip"?: string | null,"platform": string,"receipt_path"?: string | null,"reject_reason"?: string | null,"ride_date": string,"scheduled_at"?: string | null,"shift_id"?: string | null,"started_at"?: string | null,"transfer_status"?: string | null
                  }
                  Update: {
                    "amount"?: number,"car_id"?: string | null,"client_name"?: string | null,"created_at"?: string,"dest_city"?: string | null,"dest_district"?: string | null,"dest_ref"?: string | null,"dest_state"?: string | null,"dest_street"?: string | null,"dest_zip"?: string | null,"destination"?: string | null,"driver_id"?: string,"driver_pct"?: number | null,"estimated_km"?: number | null,"id"?: string,"km"?: number | null,"odometer_end"?: number | null,"odometer_end_photo"?: string | null,"odometer_start"?: number | null,"odometer_start_photo"?: string | null,"origin"?: string | null,"origin_city"?: string | null,"origin_district"?: string | null,"origin_ref"?: string | null,"origin_state"?: string | null,"origin_street"?: string | null,"origin_zip"?: string | null,"platform"?: string,"receipt_path"?: string | null,"reject_reason"?: string | null,"ride_date"?: string,"scheduled_at"?: string | null,"shift_id"?: string | null,"started_at"?: string | null,"transfer_status"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rides_car_id_fkey"
      columns: ["car_id"]
isOneToOne: false
      referencedRelation: "cars"
      referencedColumns: ["id"]
    },{
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
                    "car_id": string,"created_at": string,"driver_id": string,"ended_at": string | null,"id": string,"odometer_end": number | null,"odometer_end_photo": string | null,"odometer_start": number,"odometer_start_photo": string | null,"reject_reason": string | null,"review_status": string,"start_date": string,"started_at": string,"uber_earnings_photo": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "car_id": string,"created_at"?: string,"driver_id": string,"ended_at"?: string | null,"id"?: string,"odometer_end"?: number | null,"odometer_end_photo"?: string | null,"odometer_start": number,"odometer_start_photo"?: string | null,"reject_reason"?: string | null,"review_status"?: string,"start_date": string,"started_at"?: string,"uber_earnings_photo"?: string | null
                  }
                  Update: {
                    "car_id"?: string,"created_at"?: string,"driver_id"?: string,"ended_at"?: string | null,"id"?: string,"odometer_end"?: number | null,"odometer_end_photo"?: string | null,"odometer_start"?: number,"odometer_start_photo"?: string | null,"reject_reason"?: string | null,"review_status"?: string,"start_date"?: string,"started_at"?: string,"uber_earnings_photo"?: string | null
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
                    "created_at": string,"driver_id": string,"driver_period_id": string,"id": string,"lines": Json | null,"paid_at": string | null,"payment_method": string | null,"total": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"driver_id": string,"driver_period_id": string,"id"?: string,"lines"?: Json | null,"paid_at"?: string | null,"payment_method"?: string | null,"total"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"driver_id"?: string,"driver_period_id"?: string,"id"?: string,"lines"?: Json | null,"paid_at"?: string | null,"payment_method"?: string | null,"total"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "statements_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "statements_driver_period_id_fkey"
      columns: ["driver_period_id"]
isOneToOne: true
      referencedRelation: "driver_periods"
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
"admin_pendencies":
{ Args: Record<PropertyKey, never>; Returns: {
              "category": string,"driver_id": string,"driver_name": string,"item_id": string,"item_type": string,"label": string,"occurred_on": string
            }[]
                           },
"attach_photo":
{ Args: { "p_id": string,"p_path": string,"p_target": string }; Returns: undefined
                           },
"car_consumption":
{ Args: { "p_car": string,"p_fuel": string }; Returns: number
                           },
"car_expenses_for_month":
{ Args: { "p_month": string }; Returns: {
              "amount": number,"car_id": string,"description": string,"expense_id": string,"installment_no": number,"installments": number,"kind": string,"mode": string,"model": string,"plate": string
            }[]
                           },
"car_last_odometer":
{ Args: { "p_car": string }; Returns: number
                           },
"clear_must_change_password":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"close_driver_period":
{ Args: { "p_allow_missing_fuel_price"?: boolean,"p_force"?: boolean,"p_period": string }; Returns: string
                           },
"complete_transfer":
{ Args: { "p_odometer": number,"p_photo": string,"p_ride_id": string }; Returns: {
              "amount": number,
"car_id": string | null,
"client_name": string | null,
"created_at": string,
"dest_city": string | null,
"dest_district": string | null,
"dest_ref": string | null,
"dest_state": string | null,
"dest_street": string | null,
"dest_zip": string | null,
"destination": string | null,
"driver_id": string,
"driver_pct": number | null,
"estimated_km": number | null,
"id": string,
"km": number | null,
"odometer_end": number | null,
"odometer_end_photo": string | null,
"odometer_start": number | null,
"odometer_start_photo": string | null,
"origin": string | null,
"origin_city": string | null,
"origin_district": string | null,
"origin_ref": string | null,
"origin_state": string | null,
"origin_street": string | null,
"origin_zip": string | null,
"platform": string,
"receipt_path": string | null,
"reject_reason": string | null,
"ride_date": string,
"scheduled_at": string | null,
"shift_id": string | null,
"started_at": string | null,
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
"cost_per_km_for":
{ Args: { "p_driver": string,"p_period": string }; Returns: Json
                           },
"delete_driver":
{ Args: { "p_driver_id": string }; Returns: string
                           },
"driver_period_for":
{ Args: { "p_date": string,"p_driver": string }; Returns: string
                           },
"driver_period_signals":
{ Args: Record<PropertyKey, never>; Returns: {
              "active": boolean,"current_period_id": string,"days_left": number,"driver_id": string,"end_date": string,"name": string,"paused": boolean,"signal": string,"start_date": string
            }[]
                           },
"end_shift":
{ Args: { "p_odometer": number,"p_photo": string,"p_shift_id": string,"p_uber_photo": string }; Returns: Json
                           },
"fuel_type_label":
{ Args: { "p_fuels": (string)[] }; Returns: string
                           },
"fuels_for_type":
{ Args: { "p_type": string }; Returns: (string)[]
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
"is_valid_cpf":
{ Args: { "p": string }; Returns: boolean
                           },
"mark_statement_paid":
{ Args: { "p_method": string,"p_paid_at": string,"p_statement": string }; Returns: undefined
                           },
"month_result":
{ Args: { "p_month": string }; Returns: Json
                           },
"monthly_balance":
{ Args: { "p_month": string }; Returns: Json
                           },
"monthly_detail":
{ Args: { "p_month": string }; Returns: {
              "cpf": string,"description": string,"driver_amount": number,"driver_name": string,"gross": number,"kind": string,"login_code": string,"occurred_on": string,"period_label": string,"status": string
            }[]
                           },
"normalize_fuels":
{ Args: { "p_fuels": (string)[] }; Returns: (string)[]
                           },
"pause_driver":
{ Args: { "p_driver": string,"p_paused_on": string,"p_reason": string }; Returns: undefined
                           },
"period_month_owed":
{ Args: { "p_month_end": string,"p_month_start": string,"p_period": string }; Returns: Json
                           },
"resolve_driver_period":
{ Args: { "p_date": string,"p_driver": string }; Returns: string
                           },
"resume_driver":
{ Args: { "p_driver": string,"p_resume_on": string }; Returns: undefined
                           },
"review_item":
{ Args: { "p_approved": boolean,"p_expense_ids"?: (string)[],"p_id": string,"p_kind": string,"p_reason": string }; Returns: undefined
                           },
"row_driver_date":
{ Args: { "p_table": string,"r": Json }; Returns: Record<string, unknown>
                           },
"row_in_closed_period":
{ Args: { "p_table": string,"r": Json }; Returns: boolean
                           },
"start_shift":
{ Args: { "p_car_id": string,"p_id": string,"p_odometer": number,"p_photo": string }; Returns: {
              "car_id": string,
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
"start_transfer":
{ Args: { "p_odometer": number,"p_photo": string,"p_ride_id": string }; Returns: {
              "amount": number,
"car_id": string | null,
"client_name": string | null,
"created_at": string,
"dest_city": string | null,
"dest_district": string | null,
"dest_ref": string | null,
"dest_state": string | null,
"dest_street": string | null,
"dest_zip": string | null,
"destination": string | null,
"driver_id": string,
"driver_pct": number | null,
"estimated_km": number | null,
"id": string,
"km": number | null,
"odometer_end": number | null,
"odometer_end_photo": string | null,
"odometer_start": number | null,
"odometer_start_photo": string | null,
"origin": string | null,
"origin_city": string | null,
"origin_district": string | null,
"origin_ref": string | null,
"origin_state": string | null,
"origin_street": string | null,
"origin_zip": string | null,
"platform": string,
"receipt_path": string | null,
"reject_reason": string | null,
"ride_date": string,
"scheduled_at": string | null,
"shift_id": string | null,
"started_at": string | null,
"transfer_status": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "rides"
        isOneToOne: true
        isSetofReturn: false
      } },
"statement_lines":
{ Args: { "p_driver": string,"p_from": string,"p_frozen"?: Json,"p_period": string,"p_to": string }; Returns: Json
                           },
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
