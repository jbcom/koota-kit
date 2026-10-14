import { createProofCohort as createCoreCohort } from "./cohort-core.mjs";
export { PROOF_FRAME } from "./cohort-core.mjs";

/** Supply sha256 from the private consumer's pinned @noble/hashes/sha2.js install. */
export function createBrowserHashBytes(sha256) {
  return (chunks) => {
    const hash = sha256.create();
    for (const chunk of chunks) hash.update(chunk);
    return Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
}

export function createBrowserProofCohort(coordination, specifications, sha256) {
  return createCoreCohort(coordination, specifications, {
    hashBytes: createBrowserHashBytes(sha256),
  });
}
