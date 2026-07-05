import { Schema } from "effect";

export class WorkConfig extends Schema.Class<WorkConfig>("WorkConfig")({
  sourceBranches: Schema.optional(Schema.Array(Schema.String)),
  branchPattern: Schema.optional(Schema.String),
  branchTypeAliases: Schema.optional(
    Schema.Record(Schema.String, Schema.String),
  ),
  startStatus: Schema.optional(Schema.String),
}) {}

export class MonoConfig extends Schema.Class<MonoConfig>("MonoConfig")({
  $schema: Schema.optional(Schema.String),
  work: Schema.optional(WorkConfig),
}) {}

export interface ResolvedConfig {
  readonly sourceBranches: ReadonlyArray<string>;
  readonly branchPattern: string;
  readonly branchTypeAliases: Readonly<Record<string, string>>;
  readonly startStatus: string | undefined;
}

export const defaultConfig: ResolvedConfig = {
  sourceBranches: [],
  branchPattern: "{key}-{slug}",
  branchTypeAliases: {},
  startStatus: undefined,
};

export const mergeConfig = (
  global: MonoConfig | undefined,
  project: MonoConfig | undefined,
): ResolvedConfig => ({
  sourceBranches:
    project?.work?.sourceBranches ??
    global?.work?.sourceBranches ??
    defaultConfig.sourceBranches,
  branchPattern:
    project?.work?.branchPattern ??
    global?.work?.branchPattern ??
    defaultConfig.branchPattern,
  branchTypeAliases:
    project?.work?.branchTypeAliases ??
    global?.work?.branchTypeAliases ??
    defaultConfig.branchTypeAliases,
  startStatus:
    project?.work?.startStatus ??
    global?.work?.startStatus ??
    defaultConfig.startStatus,
});
