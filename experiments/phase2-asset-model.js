/* ==========================================================================
   [격리 보관]  Phase 2 자산군·상관행렬 모델 — 아직 앱에 반영하지 않습니다
   ==========================================================================
   이 파일은 어디에서도 로드되지 않습니다. index.html 에 붙이기 전에
   아래 미해결 사항을 먼저 정리해야 합니다.

   왜 보류하는가
   ─────────────
   수학 자체는 검증됐습니다 — CORR_BASE / CORR_CRISIS 둘 다 대칭이고
   양의 정부호이며, cholesky() 복원오차 0, ridge 폴백이 필요 없습니다.
   프리셋 25종의 비중 합계도 전부 100 이고 미정의 자산도 없습니다.

   문제는 ASSETS 표의 **숫자 규약이 자산군마다 다르다**는 점입니다.

     자산            er    div   er+div   현행 프리셋      어느 쪽이 맞나
     eqDM 선진주식   8.5   1.8    10.2    sp500   10.5    er+div
     bondKR 한국국채  3.2   3.0     6.1    (국채 6%?)      er 만
     cash 현금       3.0   3.0     6.0    deposit  3.0    er 만
     lev 2배         13.0  0      12.1    nasdaq2x 21.0   기하평균

   · 주식은 er 이 가격수익률이라 배당(div)을 더해야 맞고,
     채권·현금은 er 이 이미 총수익이라 div 를 더하면 쿠폰을 두 번 센다.
   · lev 만 혼자 기하평균이다 (21 − 39.6²/200 = 13.2 ≈ 13.0).
     앱에는 arith / geo / exact 토글이 따로 있으므로 규약이 충돌한다.

   프리셋 전체 평균 오차: er−fee 기준 2.12%p, er+div−fee 기준 1.35%p.
   **어느 쪽으로 통일해도 한 무리는 3%p 틀립니다.**

   그대로 배선했을 때 움직이는 폭 (er+div−fee 가정)
     conservative      8.5 → 6.9    allweather   6.5 → 7.7
     very-conservative 8.0 → 6.4    dividend     8.5 → 9.9
     deposit           3.0 → 6.0  ← 명백한 오류
     nasdaq2x         21.0 → 12.1  ← 규약 불일치

   프리셋 기대수익이 평균 2%p 움직이면 55년 복리에서 최종자산이 3배
   가까이 갈립니다. 안전 생활비 기준선이 통째로 흔들리므로, 규약을
   확정하고 프리셋 재보정까지 끝난 뒤에 반영해야 합니다.

   반영 전 체크리스트
   ─────────────────
   □ er 을 '총수익 기하평균'으로 통일하고 div 는 건보료·배당세 계산에만
     쓰는 별도 필드로 명시할 것 (또는 그 반대로 통일하되 채권·현금 수정)
   □ lev 를 다른 자산과 같은 규약으로 다시 적을 것
   □ 통일 후 프리셋 25종의 accum/risk/late 를 혼합모델 값으로 재보정
   □ 재보정 후 안전 생활비·파산율이 얼마나 움직이는지 먼저 측정
   □ fx / dur / infl / beta 는 아직 어떤 식에도 쓰이지 않음 — 쓸 곳을
     정하거나 지울 것
   ========================================================================== */

/* ==================================================================
   [자산군 정의]  ASSETS
   ──────────────────────────────────────────────────────────────────
   기존 모델은 포트폴리오 전체를 '평균 + 표준편차' 한 쌍으로만 다뤘다.
   그래서 2022년처럼 주식과 채권이 같이 빠지는 상황이나, 환헤지 여부에
   따라 결과가 갈리는 상황을 표현할 수 없었다.

   필드 뜻
     er    기대수익률(%, 로컬통화 기준)   vol  변동성(%)
     div   배당·이자수익률(%)             fee  연간 보수(%)
     fx    환노출 0~1 (1 = 100% 달러 등 외화 노출)
     dur   금리 민감도(듀레이션, 년). 채권만 의미 있음
     infl  물가 민감도 (+면 인플레에 강함)
     beta  위기 민감도 — 시나리오 충격을 얼마나 크게 받는지
   숫자는 장기 가정치이지 예측이 아니다.
   ================================================================== */
const ASSETS = [
  { id:"eqKR",    name:"한국 주식",       short:"한국주식", er: 6.5, vol:18.0, div:2.0, fee:0.15, fx:0.0, dur:0,    infl:-0.2, beta:1.00, kind:"equity" },
  { id:"eqDM",    name:"선진국 주식",     short:"선진주식", er: 8.5, vol:15.0, div:1.8, fee:0.10, fx:1.0, dur:0,    infl:-0.2, beta:1.00, kind:"equity" },
  { id:"eqUSG",   name:"미국 성장·기술주", short:"미국성장", er:10.5, vol:20.0, div:0.8, fee:0.15, fx:1.0, dur:0,    infl:-0.5, beta:1.25, kind:"equity" },
  { id:"eqEM",    name:"신흥국 주식",     short:"신흥주식", er: 8.0, vol:22.0, div:2.5, fee:0.30, fx:1.0, dur:0,    infl:-0.1, beta:1.30, kind:"equity" },
  { id:"bondKR",  name:"한국 국채",       short:"한국국채", er: 3.2, vol: 5.0, div:3.0, fee:0.10, fx:0.0, dur:6.0,  infl:-0.8, beta:0.20, kind:"bond" },
  { id:"bondGL",  name:"글로벌 국채",     short:"글로벌채", er: 3.5, vol: 7.0, div:3.0, fee:0.20, fx:1.0, dur:7.5,  infl:-0.8, beta:0.25, kind:"bond" },
  { id:"bondCorp",name:"회사채",          short:"회사채",   er: 4.5, vol: 8.0, div:4.2, fee:0.25, fx:0.6, dur:5.0,  infl:-0.6, beta:0.60, kind:"bond" },
  { id:"gold",    name:"금",              short:"금",       er: 5.0, vol:15.0, div:0.0, fee:0.25, fx:1.0, dur:0,    infl: 0.8, beta:0.20, kind:"real" },
  { id:"cash",    name:"현금·예금",       short:"현금",     er: 3.0, vol: 0.5, div:3.0, fee:0.00, fx:0.0, dur:0.1,  infl:-0.3, beta:0.00, kind:"cash" },
  { id:"reit",    name:"부동산·리츠",     short:"리츠",     er: 7.0, vol:17.0, div:4.0, fee:0.35, fx:0.5, dur:3.0,  infl: 0.4, beta:1.10, kind:"real" },
  { id:"lev",     name:"레버리지(2x)",    short:"레버리지", er:13.0, vol:39.0, div:0.0, fee:0.90, fx:1.0, dur:0,    infl:-0.6, beta:2.20, kind:"equity" },
];
const AS_ID = ASSETS.map(a => a.id);
const ASSET_BY = Object.fromEntries(ASSETS.map(a => [a.id, a]));

/** 비중 객체를 만든다 — 빠진 자산군은 0 */
function mixOf(o) {
  const w = Object.fromEntries(AS_ID.map(id => [id, 0]));
  for (const k in (o || {})) if (k in w) w[k] = +o[k] || 0;
  return w;
}
/** 합이 100이 되도록 정규화. 전부 0이면 현금 100으로 되돌린다. */
function normalizeMix(w) {
  const out = mixOf(w);
  const s = AS_ID.reduce((t, id) => t + clamp0(out[id]), 0);
  if (s <= 0) { const z = mixOf({}); z.cash = 100; return z; }
  for (const id of AS_ID) out[id] = clamp0(out[id]) / s * 100;
  return out;
}

/* 프리셋을 '자산 비중'으로 재정의한다. 기존 이름은 그대로 두어
   저장본이 preset 문자열만으로 계속 살아나게 한다. */
const PRESET_MIX = {
  deposit:             { cash:100 },
  "very-conservative": { cash:40, bondKR:35, bondGL:10, eqDM:10, gold:5 },
  conservative:        { cash:20, bondKR:30, bondGL:15, eqDM:20, eqKR:5, gold:10 },
  balanced60:          { eqDM:40, eqKR:5, eqUSG:15, bondKR:20, bondGL:15, gold:5 },
  standard:            { eqDM:35, eqUSG:20, eqKR:5, eqEM:5, bondKR:15, bondGL:10, gold:5, cash:5 },
  aggressive:          { eqDM:35, eqUSG:30, eqEM:10, eqKR:5, bondGL:10, gold:5, cash:5 },
  sp500:               { eqDM:100 },
  nasdaq:              { eqUSG:100 },
  "sp-nasdaq":         { eqDM:70, eqUSG:30 },
  "sp-nasdaq-5050":    { eqDM:50, eqUSG:50 },
  "option-f":          { eqDM:45, eqUSG:25, eqEM:5, gold:6, bondKR:9, reit:10 },
  buffett:             { eqDM:90, cash:10 },
  twofund:             { eqDM:80, bondGL:20 },
  dividend:            { eqDM:60, reit:20, bondCorp:20 },
  "3fund":             { eqDM:50, eqEM:20, bondGL:30 },
  lazy:                { eqDM:40, eqKR:10, bondKR:30, reit:20 },
  tdf2040:             { eqDM:45, eqEM:10, bondKR:25, bondGL:15, cash:5 },
  allweather:          { eqDM:30, bondGL:40, bondKR:15, gold:7.5, reit:7.5 },
  permanent:           { eqDM:25, bondGL:25, gold:25, cash:25 },
  butterfly:           { eqDM:20, eqKR:20, bondGL:20, cash:20, gold:20 },
  vt:                  { eqDM:60, eqUSG:15, eqEM:20, eqKR:5 },
  "korea-tax":         { eqKR:30, eqDM:35, bondKR:25, gold:10 },
  kospi:               { eqKR:100 },
  gold100:             { gold:100 },
  nasdaq2x:            { lev:100 },
};

/* ── 상관계수 행렬 ────────────────────────────────────────────────
   자산군을 독립적으로 뽑으면 분산효과가 과대평가된다.
   평상시 행렬과 위기 행렬을 따로 둔다 — 위기에는 상관이 올라간다
   ("위기에는 상관관계가 1로 수렴한다"는 관찰).
   대칭이어야 하고, Cholesky 가 실패하면 자동 보정한다. */
const CORR_BASE = (() => {
  const c = {
    eqKR:  { eqKR:1, eqDM:.62, eqUSG:.55, eqEM:.70, bondKR:.05, bondGL:.00, bondCorp:.35, gold:.10, cash:0, reit:.45, lev:.55 },
    eqDM:  { eqDM:1, eqUSG:.92, eqEM:.75, bondKR:.05, bondGL:.15, bondCorp:.55, gold:.08, cash:0, reit:.65, lev:.92 },
    eqUSG: { eqUSG:1, eqEM:.68, bondKR:.02, bondGL:.10, bondCorp:.50, gold:.05, cash:0, reit:.55, lev:.99 },
    eqEM:  { eqEM:1, bondKR:.08, bondGL:.15, bondCorp:.50, gold:.18, cash:0, reit:.50, lev:.68 },
    bondKR:{ bondKR:1, bondGL:.55, bondCorp:.45, gold:.20, cash:.30, reit:.20, lev:.02 },
    bondGL:{ bondGL:1, bondCorp:.60, gold:.28, cash:.25, reit:.25, lev:.10 },
    bondCorp:{ bondCorp:1, gold:.15, cash:.15, reit:.45, lev:.50 },
    gold:  { gold:1, cash:.05, reit:.15, lev:.05 },
    cash:  { cash:1, reit:.05, lev:0 },
    reit:  { reit:1, lev:.55 },
    lev:   { lev:1 },
  };
  return buildSymmetric(c);
})();
/* 위기 국면 — 주식끼리는 거의 한 몸이 되고, 안전자산과의 음의 상관도 약해진다 */
const CORR_CRISIS = (() => {
  const c = {
    eqKR:  { eqKR:1, eqDM:.85, eqUSG:.82, eqEM:.88, bondKR:-.10, bondGL:-.15, bondCorp:.65, gold:.05, cash:0, reit:.70, lev:.82 },
    eqDM:  { eqDM:1, eqUSG:.96, eqEM:.90, bondKR:-.10, bondGL:-.05, bondCorp:.75, gold:.02, cash:0, reit:.82, lev:.96 },
    eqUSG: { eqUSG:1, eqEM:.85, bondKR:-.12, bondGL:-.08, bondCorp:.70, gold:0, cash:0, reit:.75, lev:.99 },
    eqEM:  { eqEM:1, bondKR:-.05, bondGL:0, bondCorp:.70, gold:.10, cash:0, reit:.70, lev:.85 },
    bondKR:{ bondKR:1, bondGL:.65, bondCorp:.35, gold:.25, cash:.35, reit:.05, lev:-.10 },
    bondGL:{ bondGL:1, bondCorp:.45, gold:.35, cash:.30, reit:.10, lev:-.05 },
    bondCorp:{ bondCorp:1, gold:.10, cash:.10, reit:.60, lev:.70 },
    gold:  { gold:1, cash:.10, reit:.10, lev:0 },
    cash:  { cash:1, reit:0, lev:0 },
    reit:  { reit:1, lev:.75 },
    lev:   { lev:1 },
  };
  return buildSymmetric(c);
})();

/** 반쪽만 적은 상관표를 대칭 정방행렬로 편다 */
function buildSymmetric(c) {
  const n = AS_ID.length;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = AS_ID[i], b = AS_ID[j];
      let v = (c[a] && c[a][b] !== undefined) ? c[a][b]
            : (c[b] && c[b][a] !== undefined) ? c[b][a] : 0;
      if (i === j) v = 1;
      m[i][j] = v;
    }
  }
  return m;
}

/* ── Cholesky 분해 ────────────────────────────────────────────────
   상관 있는 정규난수를 만들려면 A·Aᵀ = C 인 하한삼각 A 가 필요하다.
   손으로 적은 상관표는 양의 정부호가 아닐 수 있다(대각합이 안 맞는 조합).
   그때는 대각을 조금씩 키워(ridge) 다시 시도하고, 끝내 실패하면
   상관을 포기하고 단위행렬(=독립)로 안전하게 되돌린다. */
function cholesky(C) {
  const n = C.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = C[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 1e-12) return null;          // 양의 정부호가 아니다
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
      if (!isFinite(L[i][j])) return null;
    }
  }
  return L;
}
/** 실패하면 ridge 를 키워 가며 재시도, 그래도 안 되면 독립(단위행렬) */
function safeCholesky(C) {
  let L = cholesky(C);
  if (L) return L;
  for (const ridge of [1e-6, 1e-4, 1e-3, 1e-2, 5e-2, .1, .2]) {
    const D = C.map((row, i) => row.map((v, j) => i === j ? v + ridge : v / (1 + ridge)));
    L = cholesky(D);
    if (L) return L;
  }
  return AS_ID.map((_, i) => AS_ID.map((_, j) => i === j ? 1 : 0));
}
const CHOL_BASE = safeCholesky(CORR_BASE);
const CHOL_CRISIS = safeCholesky(CORR_CRISIS);
