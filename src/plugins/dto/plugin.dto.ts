export type InstalledPlugin = {
  slug: string;
  version: string | null;
  runtime: string | null;
  source: "managed" | "manual";
  path: string;
  // The plugin's own directory relative to the custom-plugins root, which is
  // what the node file browser shows; null for anything outside it.
  directory: string | null;
  files: Array<string>;
  digest: string | null;
};
