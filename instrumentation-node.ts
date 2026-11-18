// Background work every 15 minutes, so pages never wait on it:
// refresh Xero (if older than 15 min), read BuilderTrend's schedule (if older than 30 min), then tell accounts about claims.
const tick = async () => {
  try {
    const { syncIfStale } = await import("./lib/xero");
    await syncIfStale();
  } catch (e) { console.error("background Xero refresh failed:", (e as Error).message); }
  try {
    const { syncBuildertrendIfStale } = await import("./lib/buildertrend");
    await syncBuildertrendIfStale();
    const { syncAllGoogle } = await import("./lib/myday");
    await syncAllGoogle();
    const { syncAvailability } = await import("./lib/availability");
    await syncAvailability();
    const { runClaimNotices } = await import("./lib/claim-notify");
    await runClaimNotices();
  } catch (e) { console.error("background check failed:", (e as Error).message); }
};
setTimeout(tick, 60_000);
setInterval(tick, 15 * 60_000);
export {};
