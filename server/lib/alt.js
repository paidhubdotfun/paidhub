// Creating and loading the lookup table. Kept apart from table.js so the derivation (which needs
// no signer) can be unit tested without a wallet.
import {
  AddressLookupTableProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { deriveTableAddresses } from "./table.js";

const CHUNK = 20; // extend_lookup_table carries about this many addresses in one packet

/**
 * Create the table and fill it. `send` takes a VersionedTransaction, signs it with the authority
 * and lands it; the caller owns the signing so this file never touches a key.
 */
export async function createLookupTable({ connection, authority, payer = authority, send, extra = [], existing = null, onCreated = () => {} }) {
  let addresses = await deriveTableAddresses(connection, extra);
  let table;
  const found = existing ? (await connection.getAddressLookupTable(new PublicKey(existing))).value : null;
  if (found) {
    // a run that stopped half way: fill in what the table still lacks
    table = new PublicKey(existing);
    const have = new Set(found.state.addresses.map((a) => a.toBase58()));
    addresses = addresses.filter((a) => !have.has(a.toBase58()));
  } else {
    const slot = await connection.getSlot("finalized");
    const [createIx, made] = AddressLookupTableProgram.createLookupTable({
      authority,
      payer,
      recentSlot: slot,
    });
    table = made;
    // saved before it is sent: a creation that lands after the wait is found and filled by the next run
    onCreated(table.toBase58());
    await send(await message(connection, payer, [createIx]), "create lookup table");
  }
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const ix = AddressLookupTableProgram.extendLookupTable({
      payer,
      authority,
      lookupTable: table,
      addresses: addresses.slice(i, i + CHUNK),
    });
    await send(await message(connection, payer, [ix]), `extend lookup table ${i / CHUNK + 1}`);
  }
  return { table, count: addresses.length };
}

async function message(connection, payer, instructions) {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message()
  );
}

/** A table is only usable one slot after it was written, so this waits for it. */
export async function loadLookupTable(connection, address) {
  if (!address) return null;
  const key = new PublicKey(address);
  for (let i = 0; i < 30; i++) {
    const { value } = await connection.getAddressLookupTable(key);
    if (value && value.state.addresses.length) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
