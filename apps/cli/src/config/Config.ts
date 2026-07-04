import { Schema } from "effect";

export class GitConfig extends Schema.Class<GitConfig>("GitConfig")({
  baseBranches: Schema.optional(Schema.Array(Schema.String)),
  branchTemplate: Schema.optional(Schema.String),
  issueTypeAliases: Schema.optional(
    Schema.Record(Schema.String, Schema.String),
  ),
}) {}

export class JiraWorkConfig extends Schema.Class<JiraWorkConfig>(
  "JiraWorkConfig",
)({
  startTransitionStatus: Schema.optional(Schema.String),
}) {}

export class MonoConfig extends Schema.Class<MonoConfig>("MonoConfig")({
  $schema: Schema.optional(Schema.String),
  git: Schema.optional(GitConfig),
  jira: Schema.optional(JiraWorkConfig),
}) {}

export interface ResolvedConfig {
  readonly baseBranches: ReadonlyArray<string>;
  readonly branchTemplate: string;
  readonly issueTypeAliases: Readonly<Record<string, string>>;
  readonly startTransitionStatus: string | undefined;
}

export const defaultConfig: ResolvedConfig = {
  baseBranches: [],
  branchTemplate: "{key}-{slug}",
  issueTypeAliases: {},
  startTransitionStatus: undefined,
};

export const mergeConfig = (
  global: MonoConfig | undefined,
  project: MonoConfig | undefined,
): ResolvedConfig => ({
  baseBranches:
    project?.git?.baseBranches ??
    global?.git?.baseBranches ??
    defaultConfig.baseBranches,
  branchTemplate:
    project?.git?.branchTemplate ??
    global?.git?.branchTemplate ??
    defaultConfig.branchTemplate,
  issueTypeAliases:
    project?.git?.issueTypeAliases ??
    global?.git?.issueTypeAliases ??
    defaultConfig.issueTypeAliases,
  startTransitionStatus:
    project?.jira?.startTransitionStatus ??
    global?.jira?.startTransitionStatus ??
    defaultConfig.startTransitionStatus,
});
