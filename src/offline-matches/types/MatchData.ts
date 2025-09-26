import { Lineup } from "./Lineup";
import { MatchMap } from "./MatchMap";
import { MatchOptions } from "./MatchOptions";

export interface MatchData {
  id: string;
  password: string;
  lineup_1_id: string;
  lineup_2_id: string;
  current_match_map_id: string;
  options: MatchOptions;
  match_maps: MatchMap[];
  lineup_1: Lineup;
  lineup_2: Lineup;
  is_lan: boolean;
  server_port?: number;
  tv_port?: number;
}
