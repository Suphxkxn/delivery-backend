// Routing Engine: แบ่งออเดอร์ให้ไรเดอร์ + เรียงลำดับจุดส่ง
// เป็น pure function ไม่ยุ่งกับ DB / HTTP

export type Objective = "MIN_COST" | "MIN_DISTANCE" | "MIN_LATEST_ARRIVAL";

export interface PlanOrder {
  id: number;
  lat: number;
  lng: number;
  boxes: number;
}

export interface PlanParams {
  depotLat: number;
  depotLng: number;
  speedKmh: number;
  serviceMin: number;
  baseFee: number;
  ratePerKmBox: number;
  departMin: number; // นาทีนับจากเที่ยงคืน
  deadlineMin: number;
  maxOrders: number;
  roadFactor: number;
  boxPrice: number;
  boxCost: number;
}

export interface PlanStop {
  orderId: number;
  seq: number;
  legM: number;
  cumM: number;
  etaMin: number;
}

export interface PlanRoute {
  stops: PlanStop[];
  totalBoxes: number;
  distanceM: number;
  durationMin: number;
  finishMin: number;
  fee: number;
}

export interface PlanResult {
  routes: PlanRoute[];
  totalBoxes: number;
  totalDistanceM: number;
  latestArrivalMin: number;
  revenue: number;
  foodCost: number;
  deliveryCost: number;
  profit: number;
  onTime: boolean;
  signature: string;
}

export class InfeasibleError extends Error {
  constructor(
    public orderId: number,
    message: string,
  ) {
    super(message);
  }
}

// ค่าไรเดอร์ต่อรอบ = ฐาน + (อัตรา × กล่อง × กม.)
export function riderFee(base: number, rate: number, boxes: number, km: number): number {
  return base + rate * boxes * km;
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ตัวสุ่มแบบกำหนด seed ได้ (ผลซ้ำได้)
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const permCache = new Map<number, number[][]>();
// ทุกลำดับของ index 0..len-1 (จำผลไว้)
function permsOf(len: number): number[][] {
  let r = permCache.get(len);
  if (!r) {
    r = permutations(Array.from({ length: len }, (_, i) => i));
    permCache.set(len, r);
  }
  return r;
}

function permutations(a: number[]): number[][] {
  if (a.length <= 1) return [a];
  const out: number[][] = [];
  a.forEach((x, i) => {
    for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

export interface PlanOptions {
  seed?: number;
  restarts?: number;
  timeBudgetMs?: number; // งบเวลาต่อการคำนวณ 1 เป้าหมาย (ค่าเริ่มต้น 1200 ms)
  exclude?: Set<string>; // signature ที่ห้ามได้ซ้ำ (ใช้ตอน "คำนวณใหม่")
}

export function planRoutes(
  orders: PlanOrder[],
  p: PlanParams,
  objective: Objective,
  opts: PlanOptions = {},
): PlanResult {
  const n = orders.length;
  const rand = rng(opts.seed ?? 1);

  // ตารางระยะทาง (เมตร) index 0 = ร้าน, i+1 = ออเดอร์ i
  const pts = [{ lat: p.depotLat, lng: p.depotLng }, ...orders];
  const D = pts.map((a) =>
    pts.map((b) => haversineM(a.lat, a.lng, b.lat, b.lng) * p.roadFactor),
  );
  const boxesOf = (i: number) => orders[i]!.boxes;

  interface Eval {
    seq: number[];
    distM: number;
    finishMin: number;
    fee: number;
    boxes: number;
  }
  const memo = new Map<number, Eval | null>();

  // ประเมิน 1 รอบ: ลองทุกลำดับ เลือกลำดับที่ทันเวลาและระยะสั้นสุด
  function evalGroup(group: number[]): Eval | null {
    const sorted = [...group].sort((a, b) => a - b);
    // key ตัวเลข (เร็วกว่า string) ไม่ขึ้นกับลำดับของออเดอร์ในกลุ่ม
    let key = 0;
    for (const i of sorted) key = key * (n + 1) + i + 1;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best: Eval | null = null;
    let boxes = 0;
    for (const i of sorted) boxes += boxesOf(i);
    for (const pm of permsOf(sorted.length)) {
      let cum = 0;
      let prev = 0;
      let lastEta = 0;
      for (let k = 0; k < pm.length; k++) {
        const o = sorted[pm[k]!]! + 1;
        cum += D[prev]![o]!;
        prev = o;
        lastEta = p.departMin + (cum / 1000 / p.speedKmh) * 60 + p.serviceMin * k;
      }
      if (lastEta > p.deadlineMin + 1e-9) continue;
      if (!best || cum < best.distM - 1e-9) {
        best = {
          seq: pm.map((j) => sorted[j]!),
          distM: cum,
          finishMin: lastEta,
          fee: riderFee(p.baseFee, p.ratePerKmBox, boxes, cum / 1000),
          boxes,
        };
      }
    }
    memo.set(key, best);
    return best;
  }

  // ออเดอร์เดี่ยวที่ส่งไม่ทันแน่ ๆ
  for (let i = 0; i < n; i++) {
    if (!evalGroup([i])) {
      throw new InfeasibleError(orders[i]!.id, `ออเดอร์ #${orders[i]!.id} อยู่ไกลเกินกว่าจะส่งทันเวลา`);
    }
  }

  // คะแนนของคำตอบ (ต่ำ = ดี) จากผลประเมินของทุกกลุ่ม
  function total(evs: Eval[]): number {
    let fee = 0;
    let dist = 0;
    let latest = 0;
    for (const e of evs) {
      fee += e.fee;
      dist += e.distM;
      if (e.finishMin > latest) latest = e.finishMin;
    }
    if (objective === "MIN_COST") return fee + dist / 1e9;
    if (objective === "MIN_DISTANCE") return dist + fee / 1e9;
    return latest * 1e6 + fee;
  }

  const sig = (groups: number[][]) =>
    groups
      .map((g) => evalGroup(g)!.seq.map((i) => orders[i]!.id).join(","))
      .sort()
      .join("|");

  const EPS = 1e-9;
  function localSearch(start: number[][]): { groups: number[][]; score: number } {
    let groups = start.map((g) => [...g]);
    let evs = groups.map((g) => evalGroup(g)!);
    let cur = total(evs);

    // ลองเปลี่ยนกลุ่ม a -> na และกลุ่ม b -> nb (b = -1 คือสร้างกลุ่มใหม่, กลุ่มว่าง = ลบทิ้ง)
    // ประเมินเฉพาะ 2 กลุ่มที่เปลี่ยน ที่เหลือใช้ผลเดิม; ดีขึ้นจึงรับ
    const attempt = (a: number, na: number[], b: number, nb: number[]): boolean => {
      const ea = na.length ? evalGroup(na) : null;
      if (na.length && !ea) return false;
      const eb = nb.length ? evalGroup(nb) : null;
      if (nb.length && !eb) return false;
      const candEvs: Eval[] = [];
      for (let i = 0; i < evs.length; i++) if (i !== a && i !== b) candEvs.push(evs[i]!);
      if (ea) candEvs.push(ea);
      if (eb) candEvs.push(eb);
      const s = total(candEvs);
      if (!(s < cur - EPS)) return false;
      const ng: number[][] = [];
      for (let i = 0; i < groups.length; i++) if (i !== a && i !== b) ng.push(groups[i]!);
      if (ea) ng.push(na);
      if (eb) ng.push(nb);
      groups = ng;
      evs = candEvs;
      cur = s;
      return true;
    };

    const findImprovement = (): boolean => {
      const G = groups.length;
      // merge: รวมสองกลุ่มเล็กเป็นหนึ่ง
      for (let a = 0; a < G; a++)
        for (let b = a + 1; b < G; b++) {
          if (groups[a]!.length + groups[b]!.length > p.maxOrders) continue;
          if (attempt(a, [...groups[a]!, ...groups[b]!], b, [])) return true;
        }
      // relocate: ย้ายไปกลุ่มอื่น หรือแยกเป็นกลุ่มใหม่
      for (let a = 0; a < G; a++)
        for (let xi = 0; xi < groups[a]!.length; xi++)
          for (let b = 0; b <= G; b++) {
            if (b === a) continue;
            if (b < G && groups[b]!.length >= p.maxOrders) continue;
            if (b === G && groups[a]!.length === 1) continue;
            const x = groups[a]![xi]!;
            const na = groups[a]!.filter((_, i) => i !== xi);
            const nb = b < G ? [...groups[b]!, x] : [x];
            if (attempt(a, na, b < G ? b : -1, nb)) return true;
          }
      // swap: สลับออเดอร์ระหว่างสองกลุ่ม
      for (let a = 0; a < G; a++)
        for (let b = a + 1; b < G; b++)
          for (let xi = 0; xi < groups[a]!.length; xi++)
            for (let yi = 0; yi < groups[b]!.length; yi++) {
              const na = [...groups[a]!];
              const nb = [...groups[b]!];
              na[xi] = groups[b]![yi]!;
              nb[yi] = groups[a]![xi]!;
              if (attempt(a, na, b, nb)) return true;
            }
      return false;
    };

    while (findImprovement()) {
      /* วนจนไม่มีอะไรดีขึ้น */
    }
    return { groups, score: cur };
  }

  // คำตอบเริ่มต้น: เอาออเดอร์สุ่มมาตั้ง แล้วดึงจุดใกล้สุดมาต่อให้เต็มกลุ่ม
  function initial(): number[][] {
    const left = new Set<number>(Array.from({ length: n }, (_, i) => i));
    const groups: number[][] = [];
    while (left.size) {
      const arr = [...left];
      const first = arr[Math.floor(rand() * arr.length)]!;
      const g = [first];
      left.delete(first);
      const size = 1 + Math.floor(rand() * p.maxOrders);
      while (g.length < size && left.size) {
        let best = -1;
        let bd = Infinity;
        for (const j of left) {
          const d = D[g[g.length - 1]! + 1]![j + 1]!;
          if (d < bd && evalGroup([...g, j])) {
            bd = d;
            best = j;
          }
        }
        if (best < 0) break;
        g.push(best);
        left.delete(best);
      }
      groups.push(g);
    }
    return groups;
  }

  const restarts = opts.restarts ?? 40;
  // งบเวลา: restart ต่อได้ถ้ายังไม่เกินงบ (อย่างน้อย 3 รอบ) ทำให้เครื่องช้าก็ยังตอบทันเวลา
  const budgetMs = opts.timeBudgetMs ?? 1200;
  const t0 = Date.now();
  const found = new Map<string, { groups: number[][]; score: number }>();
  for (let r = 0; r < restarts; r++) {
    if (r >= 3 && Date.now() - t0 > budgetMs) break;
    const res = localSearch(initial());
    const k = sig(res.groups);
    if (!found.has(k) || found.get(k)!.score > res.score) found.set(k, res);
  }
  const ranked = [...found.entries()].sort((a, b) => a[1].score - b[1].score);
  const pick = ranked.find(([k]) => !opts.exclude?.has(k)) ?? ranked[0]!;
  const groups = pick[1].groups;

  const routes: PlanRoute[] = groups
    .map((g) => {
      const e = evalGroup(g)!;
      let prev = 0;
      let cum = 0;
      const stops: PlanStop[] = e.seq.map((i, k) => {
        const leg = D[prev]![i + 1]!;
        cum += leg;
        prev = i + 1;
        return {
          orderId: orders[i]!.id,
          seq: k + 1,
          legM: Math.round(leg),
          cumM: Math.round(cum),
          etaMin: p.departMin + (cum / 1000 / p.speedKmh) * 60 + p.serviceMin * k,
        };
      });
      return {
        stops,
        totalBoxes: e.boxes,
        distanceM: Math.round(e.distM),
        durationMin: e.finishMin - p.departMin,
        finishMin: e.finishMin,
        fee: Math.round(e.fee * 100) / 100,
      };
    })
    .sort((a, b) => Math.min(...a.stops.map((s) => s.orderId)) - Math.min(...b.stops.map((s) => s.orderId)));

  const totalBoxes = routes.reduce((s, r) => s + r.totalBoxes, 0);
  const deliveryCost = Math.round(routes.reduce((s, r) => s + r.fee, 0) * 100) / 100;
  const revenue = totalBoxes * p.boxPrice;
  const foodCost = totalBoxes * p.boxCost;
  const latest = Math.max(...routes.map((r) => r.finishMin));
  return {
    routes,
    totalBoxes,
    totalDistanceM: routes.reduce((s, r) => s + r.distanceM, 0),
    latestArrivalMin: latest,
    revenue,
    foodCost,
    deliveryCost,
    profit: Math.round((revenue - foodCost - deliveryCost) * 100) / 100,
    onTime: latest <= p.deadlineMin + 1e-9,
    signature: pick[0],
  };
}
