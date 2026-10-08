import { StartButton } from "@/components/StartButton";
import { ProofLoop } from "@/components/ProofLoop";

export default function Landing() {
  return (
    <main className="landing">
      <section className="hero">
        <div className="stack" style={{ gap: 20 }}>
          <p className="tiny">Lane</p>
          <h1>Your counter takes card now. Without the card machine.</h1>
          <p className="lede">Set up with your fingerprint in under a minute. Payments land in your account while the customer is still standing there.</p>
          <div className="cta">
            <StartButton />
          </div>
        </div>
        <div className="art">
          <TillInHand />
        </div>
      </section>

      <section className="section">
        <h2>What it does</h2>
        <div className="statements">
          <div className="statement">
            <h3>Nothing to apply for.</h3>
            <p>Open Lane, use your fingerprint, start selling. There is no form, no approval and no waiting.</p>
          </div>
          <div className="statement">
            <h3>The money is yours when it lands.</h3>
            <p>It goes straight to your till, not into someone else&rsquo;s account to be released later.</p>
          </div>
          <div className="statement">
            <h3>One fingerprint, every till.</h3>
            <p>Each till has its own account, so you can see exactly what each one took today.</p>
          </div>
        </div>
      </section>

      <section className="section proof">
        <div className="stack">
          <h2>Thirty seconds, start to paid.</h2>
          <p className="muted">Fingerprint, amount, code, paid. That is the whole sequence.</p>
        </div>
        <ProofLoop />
      </section>

      <section className="section">
        <h2>What Lane does not do</h2>
        <div className="quiet mt">
          <p>Nobody approves you.</p>
          <p>Lane never holds your money.</p>
          <p>You can take your account and leave whenever you want.</p>
        </div>
      </section>

      <section className="section dense">
        <h2>How it works, precisely</h2>
        <ul>
          <li>Each shop&rsquo;s accounts are derived on the merchant&rsquo;s own phone from their passkey. Fingerprint or face unlocks them.</li>
          <li>Lane never receives or stores a key. There is no server that can move a merchant&rsquo;s money.</li>
          <li>Payments settle on Monad in about a second, in dollars.</li>
          <li>Every till is a separate account, so takings never mix and staff phones hold nothing that can spend.</li>
          <li>The merchant can export a standard recovery phrase at any time. It opens the same accounts in any compatible app.</li>
        </ul>
      </section>

      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="cta">
          <StartButton />
        </div>
      </section>
    </main>
  );
}

/** A till pad held in a hand, drawn rather than photographed so the first screen loads instantly. */
function TillInHand() {
  return (
    <figure style={{ margin: 0, position: "relative", maxWidth: 340 }} aria-label="Lane till pad showing 12.50">
      <div className="phone">
        <div className="row between small">
          <span>Till 1</span>
          <span className="muted">Ama&rsquo;s Kiosk</span>
        </div>
        <p className="amount-display amount-lg mt" style={{ textAlign: "right" }}>
          12.50
        </p>
        <div className="pad mt">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((k) => (
            <button key={k} tabIndex={-1} aria-hidden>
              {k}
            </button>
          ))}
        </div>
        <div className="btn btn-primary mt" aria-hidden>
          Request 12.50
        </div>
      </div>
      <svg viewBox="0 0 200 120" style={{ width: "70%", marginTop: -40, marginLeft: "18%", display: "block" }} aria-hidden>
        <path d="M10 110 C 30 60, 60 40, 100 38 L 160 30 C 175 28, 182 44, 168 50 L 120 60 C 150 62, 170 70, 190 110 Z" fill="#C79A74" stroke="#14110E" strokeWidth="2" />
      </svg>
    </figure>
  );
}
