import LoginForm from "./LoginForm";
export default function LoginPage() {
  return (
    <main className="login-shell" data-theme="login">
      <div className="login-frame">
        <section className="login-brand" aria-label="ENP Fitouts and DR Fitout">
          <div className="login-brand-logos">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/enp-logo.png" alt="ENP Fitouts" className="login-logo login-logo-enp" />
            <span className="login-brand-divider" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/dr-logo.png" alt="DR Fitout" className="login-logo login-logo-dr" />
          </div>
          <div className="login-brand-copy">
            <p className="login-eyebrow">Leads CRM · Private</p>
            <h2 className="login-brand-title">One workspace for ENP Fitouts and DR Fitout.</h2>
            <p className="login-brand-sub">Leads, calls and follow-ups for the admin, setters and the team — all in one place.</p>
          </div>
          <div className="login-accent" aria-hidden="true"><span className="enp" /><span className="dr" /></div>
        </section>
        <section className="login-card">
          <div className="login-card-logos" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/enp-logo.png" alt="" className="card-logo-enp" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/dr-logo.png" alt="" className="card-logo-dr" />
          </div>
          <p className="login-eyebrow login-eyebrow-card">Leads CRM · Private</p>
          <h1 className="login-title">Sign in</h1>
          <p className="login-sub">Staff and setters only. Use your work email.</p>
          <LoginForm />
          <p className="login-foot">ENP Fitouts · DR Fitout</p>
        </section>
      </div>
    </main>
  );
}
