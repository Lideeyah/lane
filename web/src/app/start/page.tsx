"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Band, Field } from "@/components/ui";
import { QR } from "@/components/QR";
import { PasskeyError } from "@/lib/passkey";
import { createShop, restoreShop, renameTillLocal, type SetupProgress } from "@/lib/shop";
import { shopStore } from "@/lib/storage";

type Step =
  | { s: "open" }
  | { s: "prompting" }
  | { s: "dismissed" }
  | { s: "unsupported" }
  | { s: "insecure" }
  | { s: "error"; message: string }
  | { s: "setup" }
  | { s: "restore" }
  | { s: "restoring" };

export default function Start() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ s: "open" });
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [name, setName] = useState("");
  const [till, setTill] = useState("Till 1");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    if (!window.isSecureContext) setStep({ s: "insecure" });
    // A shop already set up on this phone goes straight past onboarding.
    const shop = shopStore.get();
    if (shop?.name) router.replace("/till");
    else if (shop) setStep({ s: "setup" });
  }, [router]);

  function fail(e: unknown) {
    if (e instanceof PasskeyError) {
      if (e.kind === "dismissed") return setStep({ s: "dismissed" });
      if (e.kind === "prf-unsupported" || e.kind === "unsupported") return setStep({ s: "unsupported" });
      if (e.kind === "insecure") return setStep({ s: "insecure" });
    }
    setStep({ s: "error", message: (e as Error)?.message ?? "Something went wrong." });
  }

  // The prompt fires in the same tap that shows the explanation: no second confirmation.
  async function start() {
    setStep({ s: "prompting" });
    try {
      await createShop(setProgress);
      setStep({ s: "setup" });
    } catch (e) {
      fail(e);
    }
  }

  async function restore() {
    setStep({ s: "restoring" });
    try {
      await restoreShop(name);
      router.replace("/till");
    } catch (e) {
      fail(e);
    }
  }

  function finish(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    shopStore.update((s) => ({ ...s, name: name.trim() }));
    const t = shopStore.get()?.tills[0];
    if (t && till.trim() && till.trim() !== t.label) renameTillLocal(t.address, till);
    router.replace("/till");
  }

  if (step.s === "insecure") {
    return (
      <main className="screen">
        <div className="grow" />
        <Band kind="error">
          <p>Lane only creates accounts over a secure connection, and this page was not opened over one.</p>
        </Band>
        <div className="grow" />
      </main>
    );
  }

  if (step.s === "unsupported") {
    return (
      <main className="screen" style={{ padding: 0 }}>
        <div className="warn-screen" style={{ margin: 0 }}>
          <div className="stack" style={{ gap: 20 }}>
            <Band kind="warning">
              <h2>This phone cannot create a Lane account yet.</h2>
            </Band>
            <p className="lede">Its passkey store did not give Lane what it needs. Two things usually fix it.</p>
            <ol className="stack" style={{ paddingLeft: 20, margin: 0 }}>
              <li>Save the passkey to your phone&rsquo;s own account, such as Google Password Manager or iCloud Keychain, rather than to this browser.</li>
              <li>Make sure the phone has a screen lock set, with a fingerprint, face or PIN.</li>
            </ol>
          </div>
          <div className="grow" />
          <div className="stack mt-lg">
            <button className="btn btn-primary" onClick={start}>
              Try again
            </button>
            <p className="small">Or continue on another phone by opening this link there.</p>
            {origin && <QR value={`${origin}/start`} label="Link to open Lane on another phone" />}
            <p className="small center num">{origin}/start</p>
          </div>
        </div>
      </main>
    );
  }

  if (step.s === "setup") {
    return (
      <main className="screen">
        <form className="stack grow" style={{ gap: 20 }} onSubmit={finish}>
          <h1>Name your shop</h1>
          <Field label="Shop name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ama's Kiosk" autoFocus maxLength={64} autoComplete="organization" />
          </Field>
          <Field label="Your first till">
            <input className="input" value={till} onChange={(e) => setTill(e.target.value)} maxLength={32} />
          </Field>
          <p className="small muted" aria-live="polite">
            {progress === "funding" && "Preparing your account. You can carry on."}
            {progress === "registering" && "Preparing your account. You can carry on."}
            {progress === "ready" && "Your account is ready."}
            {progress === "deferred" && "Your account will finish setting up the next time you are online. Taking payments works now."}
          </p>
          <div className="grow" />
          <button className="btn btn-primary btn-xl" type="submit" disabled={!name.trim()}>
            Open the till
          </button>
        </form>
      </main>
    );
  }

  if (step.s === "restore" || step.s === "restoring") {
    return (
      <main className="screen">
        <form
          className="stack grow"
          style={{ gap: 20 }}
          onSubmit={(e) => {
            e.preventDefault();
            void restore();
          }}
        >
          <h1>Open your shop on this phone</h1>
          <p className="lede">Use the same fingerprint or face you set Lane up with. Your tills and sales come back with it.</p>
          <Field label="Shop name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ama's Kiosk" maxLength={64} />
          </Field>
          <div className="grow" />
          <button className="btn btn-primary btn-xl" type="submit" disabled={!name.trim() || step.s === "restoring"}>
            {step.s === "restoring" ? "Waiting for your fingerprint" : "Continue"}
          </button>
          <button type="button" className="btn btn-text" onClick={() => setStep({ s: "open" })}>
            I am new to Lane
          </button>
        </form>
      </main>
    );
  }

  // open, prompting, dismissed, error
  return (
    <main className="screen">
      <div className="grow" />
      <div className="stack" style={{ gap: 20 }}>
        {step.s === "prompting" ? (
          <>
            <h1>Lane is creating your account with this phone&rsquo;s fingerprint or face.</h1>
            <p className="statusline" aria-live="polite">
              Waiting for your phone.
            </p>
          </>
        ) : (
          <>
            <h1>Take payments on this phone. Money lands in your account in about a second.</h1>
            {step.s === "dismissed" && <p className="statusline">The fingerprint prompt was closed. Nothing was created.</p>}
            {step.s === "error" && (
              <Band kind="error">
                <p>{step.message}</p>
              </Band>
            )}
          </>
        )}
      </div>
      <div className="grow" />
      <div className="stack">
        <button className="btn btn-primary btn-xl" onClick={start} disabled={step.s === "prompting"}>
          {step.s === "dismissed" || step.s === "error" ? "Try again" : "Start"}
        </button>
        {step.s === "open" && (
          <button className="btn btn-text" onClick={() => setStep({ s: "restore" })}>
            I already have a shop
          </button>
        )}
      </div>
    </main>
  );
}
