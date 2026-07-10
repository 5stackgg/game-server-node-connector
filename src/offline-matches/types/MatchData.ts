import {
  IsString,
  IsBoolean,
  IsArray,
  IsOptional,
  IsNumber,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Lineup } from "./Lineup";
import { MatchMap } from "./MatchMap";
import { MatchOptions } from "./MatchOptions";

export class MatchData {
  // Constrained to path-safe characters: the id is interpolated into
  // /pod-manifests/<id>.yaml and .json file paths, so a value containing
  // "/" or ".." would escape that directory. Match ids are UUIDs, which
  // this pattern accepts.
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: "id must contain only letters, numbers, underscores, and hyphens",
  })
  id: string;

  @IsString()
  password: string;

  @IsString()
  lineup_1_id: string;

  @IsString()
  lineup_2_id: string;

  @IsString()
  current_match_map_id: string;

  @ValidateNested()
  @Type(() => MatchOptions)
  options: MatchOptions;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchMap)
  match_maps: MatchMap[];

  @ValidateNested()
  @Type(() => Lineup)
  lineup_1: Lineup;

  @ValidateNested()
  @Type(() => Lineup)
  lineup_2: Lineup;

  @IsBoolean()
  is_lan: boolean;

  @IsOptional()
  @IsNumber()
  server_port?: number;

  @IsOptional()
  @IsNumber()
  tv_port?: number;
}
