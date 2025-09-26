export interface Player {
  captain: boolean;
  steam_id: string;
  match_lineup_id: string;
  placeholder_name?: string;
  name?: string;
  is_banned: boolean;
  is_gagged: boolean;
  is_muted: boolean;
}
