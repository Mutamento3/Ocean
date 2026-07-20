import { once } from "node:events";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOceanGateway } from "./index.js";

const password = "ocean-access-smoke";
process.env.OCEAN_ACCESS_PASSWORD_B64 = Buffer.from(password, "utf8").toString("base64");
delete process.env.OCEAN_ACCESS_PASSWORD;
delete process.env.OCEAN_MEMORY_MCP_URL;
delete process.env.FISHING_GAME_SCRIPT_PATH;

const dataPath = join(tmpdir(), `ocean-access-smoke-${process.pid}.json`);
const server = await createOceanGateway(dataPath);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Access smoke server did not bind");
const base = `http://127.0.0.1:${address.port}`;

const anonymousStatus = await fetch(`${base}/v1/auth/status`).then((response) => response.json()) as { required: boolean; authenticated: boolean };
const anonymousApi = await fetch(`${base}/v1/providers`);
const wrongLogin = await fetch(`${base}/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: "wrong" }),
});
const login = await fetch(`${base}/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https", "X-Forwarded-Prefix": "/ocean-api/" },
  body: JSON.stringify({ password }),
});
const setCookie = login.headers.get("set-cookie") ?? "";
const cookie = setCookie.split(";")[0];
const authenticatedApi = await fetch(`${base}/v1/providers`, { headers: { Cookie: cookie } });
const authenticatedStatus = await fetch(`${base}/v1/auth/status`, { headers: { Cookie: cookie } }).then((response) => response.json()) as typeof anonymousStatus;
const logout = await fetch(`${base}/v1/auth/logout`, { method: "POST", headers: { Cookie: cookie } });

if (!anonymousStatus.required || anonymousStatus.authenticated) throw new Error("Anonymous auth status is incorrect");
if (anonymousApi.status !== 401 || wrongLogin.status !== 401) throw new Error("Anonymous and wrong-password requests must be rejected");
if (!login.ok || !setCookie.includes("HttpOnly") || !setCookie.includes("Secure") || !setCookie.includes("Path=/ocean-api")) throw new Error("Login did not issue a scoped secure cookie");
if (!authenticatedApi.ok || !authenticatedStatus.authenticated) throw new Error("Authenticated session was not accepted");
if (!logout.ok || !logout.headers.get("set-cookie")?.includes("Max-Age=0")) throw new Error("Logout did not expire the session cookie");

console.log(JSON.stringify({ anonymousApi: anonymousApi.status, wrongLogin: wrongLogin.status, authenticatedApi: authenticatedApi.status, secureCookie: true, logout: logout.status }));
server.close();
await unlink(dataPath).catch(() => undefined);
