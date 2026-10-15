import assert from "node:assert/strict";
import { Objective, PlanOrder, PlanParams, planRoutes, riderFee } from "../engine/planner";

const params: PlanParams = {
  depotLat: 16.2467,
  depotLng: 103.2554,
  speedKmh: 30,
  serviceMin: 3,
  baseFee: 15,
  ratePerKmBox: 2,
  departMin: 11 * 60 + 30,
  deadlineMin: 12 * 60 + 30,
  maxOrders: 3,
  roadFactor: 1.3,
  boxPrice: 65,
  boxCost: 40,
};

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function makeOrders(n: number): PlanOrder[] {
  return Array.from({ length: n }, (_, i) => {
    const ang = rnd() * 2 * Math.PI;
    const km = 0.3 + rnd() * 2.7;
    return {
      id: i + 1,
      lat: params.depotLat + (km * Math.sin(ang)) / 111.32,
      lng: params.depotLng + (km * Math.cos(ang)) / (111.32 * Math.cos((params.depotLat * Math.PI) / 180)),
      boxes: 1 + Math.floor(rnd() * 3),
    };
  });
}

// T-ENG-01
assert.equal(riderFee(15, 2, 6, 2), 39);

// T-ENG-02, 03, 06, 07
const orders = makeOrders(30);
const t0 = Date.now();
for (const obj of ["MIN_COST", "MIN_DISTANCE", "MIN_LATEST_ARRIVAL"] as Objective[]) {
  const r = planRoutes(orders, params, obj, { seed: 1 });
  const ids = r.routes.flatMap((x) => x.stops.map((s) => s.orderId)).sort((a, b) => a - b);
  assert.deepEqual(ids, orders.map((o) => o.id), "ทุกออเดอร์ถูกจัดพอดี 1 ครั้ง");
  assert.ok(r.routes.every((x) => x.stops.length >= 1 && x.stops.length <= 3));
  assert.ok(r.routes.every((x) => x.finishMin <= params.deadlineMin));
  const B = orders.reduce((s, o) => s + o.boxes, 0);
  assert.ok(Math.abs(r.profit - (25 * B - r.deliveryCost)) < 0.01);
}
assert.ok((Date.now() - t0) / 3 < 5000, "คำนวณ 30 ออเดอร์ต้อง <= 5 วินาที");

// T-ENG-04: เทียบ brute force (MIN_COST, N=7)
function bruteMinCost(os: PlanOrder[]): number {
  let best = Infinity;
  const used = new Array(os.length).fill(false);
  const groups: number[][] = [];
  const cost = (g: number[]) => {
    const r = planRoutes(g.map((i) => os[i]!), params, "MIN_COST", { restarts: 1 });
    return r.deliveryCost;
  };
  const rec = () => {
    const first = used.indexOf(false);
    if (first < 0) {
      best = Math.min(best, groups.reduce((s, g) => s + cost(g), 0));
      return;
    }
    const others = os.map((_, i) => i).filter((i) => i > first && !used[i]);
    const subsets: number[][] = [[first]];
    others.forEach((a, ai) => {
      subsets.push([first, a]);
      others.slice(ai + 1).forEach((b) => subsets.push([first, a, b]));
    });
    for (const s of subsets) {
      s.forEach((i) => (used[i] = true));
      groups.push(s);
      rec();
      groups.pop();
      s.forEach((i) => (used[i] = false));
    }
  };
  rec();
  return best;
}
let match = 0;
for (let t = 0; t < 6; t++) {
  const os = makeOrders(7);
  const got = planRoutes(os, params, "MIN_COST", { seed: t + 1 }).deliveryCost;
  const opt = bruteMinCost(os);
  if (Math.abs(got - opt) < 0.02) match++;
}
assert.equal(match, 6, "ผล solver ต้องเท่ากับ brute force");

// T-ENG-05: 3 จุดเรียงเป็นเส้นตรง ต้องส่งใกล้ -> ไกล
const line: PlanOrder[] = [3, 1, 2].map((km, i) => ({
  id: i + 1,
  lat: params.depotLat + km / 111.32 / 1.3,
  lng: params.depotLng,
  boxes: 1,
}));
const lr = planRoutes(line, params, "MIN_COST", { seed: 1 });
for (const route of lr.routes) {
  const d = route.stops.map((s) => s.cumM);
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
}

// recalculate ต้องได้แผนที่ต่างจากเดิม (ถ้ามีทางเลือก)
const a = planRoutes(orders, params, "MIN_COST", { seed: 1 });
const b = planRoutes(orders, params, "MIN_COST", { seed: 2, exclude: new Set([a.signature]) });
assert.notEqual(a.signature, b.signature);

console.log("engine tests passed");
