import { IsString, IsNumber } from "class-validator";

export class MatchMap {
  @IsString()
  id: string;

  map: {
    name: string;
    workshop_map_id?: string;
  };

  @IsNumber()
  order: number;

  @IsString()
  status: string;

  @IsString()
  lineup_1_side: string;

  @IsString()
  lineup_2_side: string;
}
