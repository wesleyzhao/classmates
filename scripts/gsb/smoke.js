// Deployment smoke checks verify the focused shell and authentication boundary without inventing a verified user.
const origin = process.argv[2];
if(!origin)throw new Error('Pass your own deployment origin.');
const publicRoutes = [
  ["/api/health", 200],
  ["/api/session", 200],
];
const privateRoutes = [
  "/api/deck",
  "/api/progress",
  "/api/learning",
  "/api/sprint/records?direction=face&length=short",
  "/api/leaderboard",
  "/api/rooms/ABCD",
  "/api/media/missing",
];
for (const [path, status] of [
  ...publicRoutes,
  ...privateRoutes.map((path) => [path, 401]),
]) {
  const response = await fetch(origin + path,{signal:AbortSignal.timeout(20000)});
  if (response.status !== status)
    throw new Error(`${path}: expected ${status}, received ${response.status}`);
  if (!response.headers.get("cache-control")?.includes("no-store"))
    throw new Error(`${path}: missing private cache policy`);
  console.log(`${path}: ${response.status}`);
}
const shell = await fetch(origin,{signal:AbortSignal.timeout(20000)}),
  text = await shell.text();
if (!shell.ok || !text.includes("/gsb/app.js"))
  throw new Error("Wrong app shell.");
console.log(
  "Classmates shell and unauthenticated boundary verified. Verify live email delivery separately.",
);
