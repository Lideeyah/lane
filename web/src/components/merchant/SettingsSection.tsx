"use client";
import { useState } from "react";
import { Band, Field } from "../ui";
import { withSigner } from "@/lib/accounts";
import { PasskeyError } from "@/lib/passkey";
import { shopStore, type Shop } from "@/lib/storage";

export function SettingsSection({ shop, onTills }: { shop: Shop; onTills: () => void }) {
  const [name, setName] = useState(shop.name);
  const [recovery, setRecovery] = useState(false);
  if (recovery) return <Recovery shop={shop} onBack={() => setRecovery(false)} />;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <h2>Settings</h2>
      <Field label="Shop name">
        <input
          className="input"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && shopStore.update((s) => ({ ...s, name: name.trim() }))}
        />
      </Field>
      <div className="list">
        <button className="list-row" onClick={onTills}>
          <span>Tills</span>
          <span className="num muted">{shop.tills.length}</span>
        </button>
        <button className="list-row" onClick={() => setRecovery(true)}>
          <span>Recovery phrase</span>
          <span className="muted small">{shop.recoveryShownAt ? "Saved" : "Not saved yet"}</span>
        </button>
      </div>
    </div>
  );
}

export function Recovery({ shop, onBack }: { shop: Shop; onBack: () => void }) {
  const [words, setWords] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reveal() {
    setErr(null);
    try {
      const w = await withSigner(shop.credentialId, async (s) => s.mnemonic.split(" "));
      setWords(w);
      shopStore.update((s) => ({ ...s, recoveryShownAt: Date.now() }));
    } catch (e) {
      if (e instanceof PasskeyError && e.kind === "dismissed") return;
      setErr((e as Error).message);
    }
  }

  function back() {
    setWords(null);
    onBack();
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <button className="btn btn-text" style={{ justifyContent: "flex-start", padding: 0, width: "auto" }} onClick={back}>
        Back
      </button>
      <h2>Recovery phrase</h2>
      <div className="stack" style={{ gap: 10 }}>
        <p>Lane holds nothing. It cannot recover your account for you.</p>
        <p>This phrase is the way back in if this phone and its passkey are both gone.</p>
        <p>The same phrase opens your account in any other wallet app. Your money and your tills go with it.</p>
      </div>
      {words ? (
        <>
          <ol className="phrase" aria-label="Recovery phrase">
            {words.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ol>
          <p className="small muted">Write the words down in order and keep them somewhere only you can reach.</p>
          <button className="btn btn-ink" onClick={back}>
            I have written it down
          </button>
        </>
      ) : (
        <button className="btn btn-primary btn-xl" onClick={reveal}>
          Show recovery phrase
        </button>
      )}
      {err && (
        <Band kind="error">
          <p>{err}</p>
        </Band>
      )}
    </div>
  );
}
