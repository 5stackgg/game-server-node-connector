import {
  IsString,
  IsBoolean,
  IsArray,
  IsOptional,
  IsNumber,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Lineup } from "./Lineup";
import { MatchMap } from "./MatchMap";
import { MatchOptions } from "./MatchOptions";

export class MatchData {
  @IsString()
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
