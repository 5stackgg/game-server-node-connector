export type InstalledPlugin = {
  slug: string;
  version: string | null;
  runtime: string | null;
  source: "managed" | "manual";
  path: string;
  files: Array<string>;
  digest: string | null;
};
