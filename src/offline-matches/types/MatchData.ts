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

  options: MatchOptions;

  @IsArray()
  match_maps: MatchMap[];

  lineup_1: Lineup;

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
