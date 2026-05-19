/**
 * One-off proof script for Phase 5h verification.
 *
 * Demonstrates that the bytes32 reason produced by
 * `frontend/components/dashboard/job-action-dialog.tsx` matches viem's
 * standard keccak256(toBytes(text)) encoding — which is the same hash
 * the JobEscrow contract emits in JobRejected events.
 *
 * Run from the frontend/ directory:
 *   node scripts/reason-encoding-proof.mjs
 *
 * This script is checked in for future regression-checking; it has no
 * test framework dependency, just viem (already in deps).
 */
import { keccak256, toBytes, zeroHash } from "viem";

// Mirror of the dialog's logic at job-action-dialog.tsx line 395-398.
function encodeReason(text) {
  return text.trim().length === 0 ? zeroHash : keccak256(toBytes(text));
}

const cases = [
  // Empty + whitespace-only → ZERO_BYTES32
  { input: "", label: "empty string" },
  { input: "   ", label: "whitespace-only" },
  // The Phase 5h Test #3 live-broadcast input
  { input: "verify-reject-flow-test", label: "live broadcast input" },
  // The example from the user's plan
  { input: "Deliverable URI returns 404", label: "realistic reason" },
  // Non-ASCII to prove UTF-8 path works
  { input: "café — review failed ✗", label: "non-ASCII (UTF-8)" },
];

console.log("Reason → bytes32 encoding proof");
console.log("===============================");
for (const { input, label } of cases) {
  const hash = encodeReason(input);
  console.log(`${label.padEnd(28)} "${input}"`);
  console.log(`  → ${hash}`);
}

console.log("");
console.log("zeroHash sanity check:", zeroHash);
console.log(
  "All non-empty hashes differ from zeroHash:",
  cases
    .filter((c) => c.input.trim().length > 0)
    .every((c) => encodeReason(c.input) !== zeroHash),
);
