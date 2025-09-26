import { Player } from "./Player";

export interface Lineup {
  id: string;
  name: string;
  coach_steam_id?: string;
  lineup_players: Player[];
}
