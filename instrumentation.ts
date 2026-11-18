// Runs once when the server starts (Node runtime only). See instrumentation-node.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
