import {
  advanceClock,
  createSimWorld,
  defineEventLog,
  defineTrait,
  destroySimWorld,
  nextInt,
  snapshotWorld,
} from "koota-kit";

const Position = defineTrait({ x: 0, y: 0 });
const moves = defineEventLog("movement:completed");
const sim = createSimWorld({ gen: "map-42", events: "run-1" });

try {
  const scout = sim.world.spawn(Position({ x: 4, y: 9 }));
  advanceClock(sim, 1 / 60);

  const distance = nextInt(sim.rng.events, 1, 5);
  scout.set(Position, ({ x, y }) => ({ x: x + distance, y }));
  moves.push(sim, { entity: Number(scout), distance });

  const saveHeader = snapshotWorld(sim);
  console.log({ position: scout.get(Position), events: moves.drain(sim), saveHeader });
} finally {
  destroySimWorld(sim);
}
