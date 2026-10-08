"use client";
import { useCallback, useEffect, useState } from "react";
import { onStorageChange, shopStore, type Shop } from "./storage";

export function useShop(): { shop: Shop | null; ready: boolean; refresh: () => void } {
  const [shop, setShop] = useState<Shop | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(() => setShop(shopStore.get()), []);
  useEffect(() => {
    refresh();
    setReady(true);
    return onStorageChange(refresh);
  }, [refresh]);
  return { shop, ready, refresh };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useFragment(): string {
  const [frag, setFrag] = useState("");
  useEffect(() => {
    const read = () => setFrag(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return frag;
}
