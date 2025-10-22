import {
  RxJsonSchema,
  toTypedRxJsonSchema,
  ExtractDocumentTypeFromTypedRxJsonSchema,
} from 'rxdb';

export const DOOR_SCHEMA_LITERAL = {
  title: 'Door',
  description: 'Door schema for access control',
  version: 0, // Increment version to trigger migration
  primaryKey: 'id',
  keyCompression: false,
  type: 'object',
  properties: {
    id: { type: 'string', primary: true, maxLength: 100 },
    name: { type: 'string', maxLength: 200 },
    checkpoint: { type: 'string', maxLength: 100 },
    client_created_at: { type: 'string', maxLength: 20 },
    client_updated_at: { type: 'string', maxLength: 20 },
    server_created_at: { type: 'string', maxLength: 20 },
    server_updated_at: { type: 'string', maxLength: 20 },
  },

  required: ['id', 'name', 'checkpoint', 'client_created_at'],
};

export const doorSchema = toTypedRxJsonSchema(DOOR_SCHEMA_LITERAL);

export type RxDoorDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof doorSchema
>;

export const DOOR_SCHEMA: RxJsonSchema<RxDoorDocumentType> =
  DOOR_SCHEMA_LITERAL;
