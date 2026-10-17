import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { LAUNCH_PROGRAMS } from "../../server/lib/register.js";

test("every program a launch may call is a real address", () => {
  for (const id of LAUNCH_PROGRAMS) assert.doesNotThrow(() => new PublicKey(id), id);
});

test("Lighthouse, the guard Phantom adds to the transactions it signs, is allowed", () => {
  assert.ok(LAUNCH_PROGRAMS.has("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"));
});
