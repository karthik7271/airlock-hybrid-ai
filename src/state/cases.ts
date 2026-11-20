import { createStore, del, get, set } from "idb-keyval";
import { collection, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { firestore, isConfigured, rcBool } from "../firebase/app";
import type { Analysis } from "../ai/tasks";
import type { Entity } from "../shield/types";

/**
 * Split storage, by design:
 *   Firestore (cloud)   -> the redacted letter and the analysis, which only ever contain placeholders.
 *   IndexedDB (device)  -> the vault that maps placeholders back to real values, AES-GCM encrypted
 *                          with a non-extractable key that never leaves this browser.
 * Open the same case on another device and you'll see placeholders: the server can't re-identify you.
 */

export interface CloudCase {
  id: string;
  title: string;
  docType: string;
  urgency: Analysis["urgency"] | "unknown";
  redactedText: string;
  analysis?: Analysis;
  lang: string;
  protectedCount: number;
  createdAt?: unknown;
}

export interface Vault {
  original: string;
  entities: Entity[];
}

const store = createStore("airlock", "vault");

async function vaultKey(): Promise<CryptoKey> {
  const existing = await get<CryptoKey>("__key__", store);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await set("__key__", key, store);
  return key;
}

export async function saveVault(caseId: string, vault: Vault): Promise<void> {
  const key = await vaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(vault));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  await set(caseId, { iv, sealed }, store);
}

export async function loadVault(caseId: string): Promise<Vault | undefined> {
  const rec = await get<{ iv: Uint8Array; sealed: ArrayBuffer }>(caseId, store);
  if (!rec) return undefined;
  try {
    const key = await vaultKey();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv as BufferSource }, key, rec.sealed);
    return JSON.parse(new TextDecoder().decode(plain)) as Vault;
  } catch {
    return undefined;
  }
}

export const cloudHistoryOn = () => isConfigured && rcBool("cloud_history_enabled");

export async function saveCase(uid: string | undefined, c: CloudCase, vault: Vault): Promise<void> {
  await saveVault(c.id, vault);
  if (!uid || !cloudHistoryOn()) return;
  // Firestore's offline cache queues this write if we're offline.
  await setDoc(doc(firestore(), "users", uid, "cases", c.id), { ...c, analysis: c.analysis ?? null, createdAt: serverTimestamp() });
}

export async function listCases(uid: string | undefined): Promise<CloudCase[]> {
  if (!uid || !cloudHistoryOn()) return [];
  const snap = await getDocs(query(collection(firestore(), "users", uid, "cases"), orderBy("createdAt", "desc"), limit(20)));
  return snap.docs.map((d) => ({ ...(d.data() as CloudCase), id: d.id }));
}

export async function deleteCase(uid: string | undefined, id: string): Promise<void> {
  await del(id, store);
  if (uid && cloudHistoryOn()) await deleteDoc(doc(firestore(), "users", uid, "cases", id));
}

export function newCaseId(): string {
  return `c_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}
