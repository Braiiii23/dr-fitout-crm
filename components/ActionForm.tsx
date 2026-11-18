"use client";
import { useRef, useTransition, type FormHTMLAttributes, type ReactNode } from "react";

/** A form that runs a server action, then always refreshes the page and clears itself,
 *  so what you just saved shows straight away (the plain <form action> sometimes missed the refresh). */
export default function ActionForm({ action, children, keep, ...rest }: { action: (fd: FormData) => Promise<unknown>; children: ReactNode; keep?: boolean } & Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit">) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  return (
    <form
      ref={ref}
      {...rest}
      aria-busy={pending || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          await action(fd);
          if (!keep) ref.current?.reset();
        });
      }}
    >
      {children}
    </form>
  );
}
