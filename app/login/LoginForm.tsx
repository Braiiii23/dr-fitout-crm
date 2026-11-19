"use client";
import { useActionState } from "react";
import { login } from "./actions";
export default function LoginForm() {
  const [state, action, pending] = useActionState(login, null as null | { error: string });
  return (
    <form action={action} className="space-y-4">
      <div><label className="label" htmlFor="email">Username or email</label><input id="email" name="email" type="text" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input" /></div>
      <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" className="input" /></div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn w-full justify-center" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
