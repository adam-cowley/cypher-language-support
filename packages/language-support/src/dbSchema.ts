import { SignatureInformation } from 'vscode-languageserver-types';

export interface DbSchema {
  procedureSignatures?: Record<string, SignatureInformation>;
  functionSignatures?: Record<string, SignatureInformation>;
  labels?: string[];
  relationshipTypes?: string[];
  databaseNames?: string[];
  aliasNames?: string[];
  parameters?: Record<string, unknown>;
  propertyKeys?: string[];
}
