// 슬라임 이름 → 고정 번호 매핑.
// 리니지 클래식 슬라임 경주에서 각 슬라임에 부여된 공식 번호.
// 키는 공백을 제거한 정규화 이름 (캐논 보이 → 캐논보이).

const SLIME_NUMBERS: Record<string, number> = {
  가버너: 1,
  영이글: 2,
  세인트라이트: 3,
  글루디아: 4,
  캐논보이: 5,
  레이디호크: 6,
  라이트닝: 7,
  가디안: 8,
  이븐스타: 9,
  슈퍼블랙: 10,
  마키아벨리: 11,
  마이베이비: 12,
  슈팅스타: 13,
  뷸렛: 14,
  엘븐애로우: 15,
  사이하: 16,
  호크윈드: 17,
  펠컨: 18,
  펌블: 19,
  젤리피쉬: 20,
};

export function slimeNumber(name: string): number | undefined {
  if (!name) return undefined;
  const key = name.trim().replace(/\s+/g, "");
  return SLIME_NUMBERS[key];
}

/**
 * 슬라임 이름 앞에 `#N` 을 붙여 반환. 매핑이 없으면 이름 그대로.
 */
export function slimeLabel(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return trimmed;
  const n = slimeNumber(trimmed);
  return n ? `#${n} ${trimmed}` : trimmed;
}
