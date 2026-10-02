"use client";

import { createClient } from "@/lib/supabase/client";

const DB_NAME = "stripclub-pending-profile-photo";
const STORE = "photos";
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function validateProfilePhoto(file: File): string | null {
  if (!ALLOWED.includes(file.type) || file.size > 5_000_000) {
    return "Choose a JPG, PNG, or WebP photo under 5 MB.";
  }
  return null;
}

function openPhotoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function photoStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openPhotoDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

function emailKey(email: string) {
  return email.trim().toLowerCase();
}

export async function rememberSignupPhoto(email: string, file: File): Promise<void> {
  const invalid = validateProfilePhoto(file);
  if (invalid) throw new Error(invalid);
  await photoStore("readwrite", (store) => store.put(file, emailKey(email)));
}

export async function uploadProfilePhoto(file: File): Promise<void> {
  const invalid = validateProfilePhoto(file);
  if (invalid) throw new Error(invalid);
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sign in again to save your photo.");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/avatar-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from("seller-avatars")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const { error: saveError } = await supabase.rpc("set_own_profile_photo", { _path: path });
  if (saveError) {
    void supabase.storage.from("seller-avatars").remove([path]);
    throw new Error(saveError.message);
  }
}

export async function applyPendingSignupPhoto(email: string): Promise<boolean> {
  const file = await photoStore<File | undefined>("readonly", (store) => store.get(emailKey(email)));
  if (!file) return false;
  await uploadProfilePhoto(file);
  await photoStore("readwrite", (store) => store.delete(emailKey(email)));
  return true;
}
