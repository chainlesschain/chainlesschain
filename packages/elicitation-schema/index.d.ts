export type ElicitationFieldKind =
  | "boolean"
  | "text"
  | "number"
  | "integer"
  | "single-select"
  | "multi-select";

export interface ElicitationOption {
  value: string;
  label: string;
}

export interface ElicitationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ElicitationField {
  name: string;
  type: string;
  title: string;
  description: string;
  required: boolean;
  hasDefault: boolean;
  default?: unknown;
  kind: ElicitationFieldKind;
  options?: ElicitationOption[];
  format?: "email" | "uri" | "date" | "date-time" | null;
  inputType?: "text" | "email" | "url" | "date" | "datetime-local";
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  step?: number | "any";
}

export interface ElicitationFormModel {
  version: string;
  supported: boolean;
  fields: ElicitationField[];
  required: string[];
  errors: ElicitationIssue[];
}

export interface ElicitationValidation {
  valid: boolean;
  errors: ElicitationIssue[];
}

export const VOCABULARY_VERSION: string;
export function compileElicitationSchema(schema: unknown): ElicitationFormModel;
export function initialElicitationValues(
  modelOrSchema: ElicitationFormModel | unknown,
): Record<string, unknown>;
export function coerceElicitationAnswer(
  modelOrSchema: ElicitationFormModel | unknown,
  rawValues: unknown,
): Record<string, unknown>;
export function validateElicitationAnswer(
  modelOrSchema: ElicitationFormModel | unknown,
  answer: unknown,
): ElicitationValidation;
export function prepareElicitationSubmission(
  schemaOrModel: ElicitationFormModel | unknown,
  rawValues: unknown,
): ElicitationValidation & {
  value: Record<string, unknown>;
  model: ElicitationFormModel;
};
