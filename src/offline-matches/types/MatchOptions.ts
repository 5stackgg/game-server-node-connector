import { IsString, IsNumber, IsBoolean, IsOptional } from "class-validator";

export class MatchOptions {
  @IsNumber()
  mr: number;

  @IsString()
  type: string;

  @IsNumber()
  best_of: number;

  @IsBoolean()
  coaches: boolean;

  @IsBoolean()
  overtime: boolean;

  @IsNumber()
  tv_delay: number;

  @IsBoolean()
  knife_round: boolean;

  @IsString()
  ready_setting: string;

  @IsString()
  timeout_setting: string;

  @IsString()
  tech_timeout_setting: string;

  @IsNumber()
  number_of_substitutes: number;

  @IsOptional()
  @IsString()
  cfg_override: string;
}
