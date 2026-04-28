import { IsBoolean, IsOptional, IsString } from "class-validator";

// Class (not an interface) so class-transformer's `@Type(() => Player)`
// in Lineup.ts has a runtime constructor to call. The shape is
// otherwise identical to the prior interface.
export class Player {
  @IsBoolean()
  captain: boolean;

  @IsString()
  steam_id: string;

  @IsString()
  match_lineup_id: string;

  @IsOptional()
  @IsString()
  placeholder_name?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsBoolean()
  is_banned: boolean;

  @IsBoolean()
  is_gagged: boolean;

  @IsBoolean()
  is_muted: boolean;
}
