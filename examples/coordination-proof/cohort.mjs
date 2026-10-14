import { createHash } from "node:crypto";
import { createProofCohort as createCoreCohort } from "./cohort-core.mjs";
export { PROOF_FRAME } from "./cohort-core.mjs";

export function hashBytes(chunks) {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex");
}

/** Node reference API; only the hash primitive differs from the browser caller. */
export function createProofCohort(coordination, specifications) {
  return createCoreCohort(coordination, specifications, { hashBytes });
}
