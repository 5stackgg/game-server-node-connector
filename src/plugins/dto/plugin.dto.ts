import { IsString, IsNotEmpty, IsOptional, Matches, IsUrl } from "class-validator";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class InstallPluginDto {
  @IsString()
  @Matches(SLUG, { message: "slug must be lowercase kebab-case" })
  slug: string;

  @IsString()
  @Matches(VERSION, { message: "version must not contain path separators" })
  version: string;

  @IsUrl({ protocols: ["https"], require_protocol: true })
  url: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: "sha256 must be a hex digest" })
  sha256: string;

  @IsString()
  @IsOptional()
  layout?: "csgo" | "plugin";

  @IsString()
  @IsOptional()
  installPath?: string;
}

export class RemovePluginDto {
  @IsString()
  @Matches(SLUG)
  @IsNotEmpty()
  slug: string;

  @IsString()
  @Matches(VERSION)
  @IsOptional()
  version?: string;
}

export type InstalledPlugin = {
  slug: string;
  version: string | null;
  runtime: string | null;
  source: "managed" | "manual";
  path: string;
  files: Array<string>;
  digest: string | null;
};
