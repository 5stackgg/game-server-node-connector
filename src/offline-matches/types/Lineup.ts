import { IsString, IsOptional, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { Player } from "./Player";

export class Lineup {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  coach_steam_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Player)
  lineup_players: Player[];
}
