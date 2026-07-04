export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export interface BranchNameParts {
  readonly type: string;
  readonly key: string;
  readonly slug: string;
}

export const renderBranchName = (
  template: string,
  parts: BranchNameParts,
): string =>
  template
    .replace("{type}", parts.type)
    .replace("{key}", parts.key)
    .replace("{slug}", parts.slug);

export const resolveBranchType = (
  issueType: string,
  aliases: Readonly<Record<string, string>>,
): string => aliases[issueType] ?? issueType.toLowerCase();
