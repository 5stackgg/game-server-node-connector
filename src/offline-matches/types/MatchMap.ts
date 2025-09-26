export interface MatchMap {
  id: string;
  map: {
    name: string;
    workshop_map_id?: string;
  };
  order: number;
  status: string;
  lineup_1_side: string;
  lineup_2_side: string;
}
