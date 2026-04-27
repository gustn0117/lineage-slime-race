// 일회성 마이그레이션: races.json 에서 알려진 오타를 공식 이름으로 정정.
// 사용: 서버 컨테이너 내부에서 `node scripts/fix-slime-typos.mjs`
//       (data/races.json 이 보이는 워킹디렉터리에서 실행)

import { promises as fs } from "fs";
import path from "path";

const TYPO_MAP = {
  슈퍼블래: "슈퍼블랙",
  팰컨: "펠컨",
};

const file = path.join(process.cwd(), "data", "races.json");
const raw = await fs.readFile(file, "utf-8");
const races = JSON.parse(raw);

let fixed = 0;
const fixes = new Map();
for (const r of races) {
  for (const l of r.lanes ?? []) {
    const s = (l.slime ?? "").trim();
    if (TYPO_MAP[s]) {
      const before = l.slime;
      l.slime = TYPO_MAP[s];
      fixes.set(before, (fixes.get(before) ?? 0) + 1);
      fixed++;
    }
  }
}

if (fixed === 0) {
  console.log("정정 대상 없음.");
  process.exit(0);
}

const tmp = `${file}.tmp`;
await fs.writeFile(tmp, JSON.stringify(races, null, 2), "utf-8");
await fs.rename(tmp, file);

console.log(`총 ${races.length}경기 중 ${fixed}개 레인 정정:`);
for (const [from, count] of fixes) {
  console.log(`  ${from} → ${TYPO_MAP[from]}: ${count}건`);
}
