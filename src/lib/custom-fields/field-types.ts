import type { CustomFieldType } from '@/types'

/** Single source of truth for allowed `custom_fields.field_type`
 *  values — kept in sync with the DB CHECK constraint added in
 *  migration 046 (`custom_fields_field_type_check`). */
export const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = [
  'text',
  'textarea',
  'number',
  'date',
  'url',
] as const

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return typeof value === 'string' && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value)
}
