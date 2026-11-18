import LoginForm from "./LoginForm";
export default function LoginPage() {
  return (
    <main className="login-shell login-dr" data-theme="login" data-brand="DR">
      <div className="login-frame">
        <section className="login-brand" aria-label="DR Fitout">
          <div className="login-brand-logos">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/dr-logo.png" alt="DR Fitout" className="login-logo login-logo-dr" />
          </div>
          <div className="login-brand-copy">
            <p className="login-eyebrow">DR Fitout CRM · Private</p>
            <h2 className="login-brand-title">Back of house for DR Fitout.</h2>
            <p className="login-brand-sub">Leads, jobs, WIP, estimating, accounts, leases and clients — all in one place.</p>
          </div>
          <div className="login-accent" aria-hidden="true"><span className="dr" /></div>
        </section>
        <section className="login-card">
          <div className="login-card-logos" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/dr-logo.png" alt="" className="card-logo-dr" />
          </div>
          <p className="login-eyebrow login-eyebrow-card">DR Fitout CRM · Private</p>
          <h1 className="login-title">Sign in</h1>
          <p className="login-sub">Staff only. Use your work email.</p>
          <LoginForm />
          <p className="login-foot">DR Fitout</p>
        </section>
      </div>
    </main>
  );
}
