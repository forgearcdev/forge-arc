/**
 * Barrel re-export for the contract ABIs the indexer cares about.
 *
 * Mirrors `frontend/lib/abi/*` structure to keep cross-team mental
 * models consistent. Individual ABI files are copied verbatim from
 * the frontend at backend-scaffold time (Phase 6.3-A); future work
 * could consolidate into a shared `@forge/abi` package.
 */

export { JOB_ESCROW_ABI } from "./abi/job-escrow.js";
export {
  IDENTITY_REGISTRY_ABI,
  IDENTITY_REGISTRY_TRANSFER_EVENT,
} from "./abi/identity-registry.js";
