const { createSimWorld, destroySimWorld, nextU32 } = require("@jbdevprimary/koota-kit");

const sim = createSimWorld({ gen: "commonjs", events: "run-1" });
try {
  console.log({ firstEventDraw: nextU32(sim.rng.events) });
} finally {
  destroySimWorld(sim);
}
