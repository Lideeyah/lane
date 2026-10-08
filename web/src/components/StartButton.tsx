"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { shopStore } from "@/lib/storage";

/** Start for a new merchant, continue for a returning one. Never redirects automatically. */
export function StartButton() {
  const [returning, setReturning] = useState(false);
  useEffect(() => setReturning(shopStore.hasShop()), []);
  return returning ? (
    <Link href="/till" className="btn btn-primary btn-xl">
      Continue to your till
    </Link>
  ) : (
    <Link href="/start" className="btn btn-primary btn-xl">
      Start taking payments
    </Link>
  );
}
