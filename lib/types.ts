// 슬라임 경주 데이터 모델

export const LANE_COUNT = 5;

export interface RaceLane {
  lane: number;          // 1..5
  slime: string;         // 슬라임 이름
  number?: number;       // 경기 번호 (1~20 등, 표의 숫자 칸)
}

export interface Race {
  id: string;            // uuid
  date: string;          // "YYYY-MM-DD"
  time: string;          // "HH:mm" (24h, 로컬 기준)
  lanes: RaceLane[];     // 길이 5 (5레인)
  winnerLane: number | null;  // 1..5, null이면 미확정
  createdAt: number;     // epoch ms
}

export interface AppSettings {
  recentWindow: number;  // 최근 N경기 기준 (기본 20)
}

export const DEFAULT_SETTINGS: AppSettings = {
  recentWindow: 20,
};

export interface SlimeStat {
  name: string;
  total: number;
  wins: number;
  winRate: number;       // 0..1
  recentTotal: number;
  recentWins: number;
  recentWinRate: number; // 0..1
  todayTotal: number;
  todayWins: number;
}

export interface LaneStat {
  lane: number;
  wins: number;          // 오늘 기준
}

export interface Banner {
  id: string;
  imageUrl: string;
  linkUrl?: string;
  title?: string;
  enabled: boolean;
  order: number;
  createdAt: number;
}
