import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { OceanGatewayClient, OceanGatewayError } from "../api/OceanGatewayClient";
import { bootstrapCloudGateway } from "../bootstrapCloud";
import { assetPath } from "../utils/assetPath";

type GateState = "checking" | "login" | "bootstrapping" | "ready";

export function OceanAccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const bootstrapped = useRef(false);

  const enterOcean = async () => {
    if (bootstrapped.current) return setState("ready");
    bootstrapped.current = true;
    setState("bootstrapping");
    await bootstrapCloudGateway().catch(() => undefined);
    setState("ready");
  };

  useEffect(() => {
    const controller = new AbortController();
    const client = new OceanGatewayClient();
    void client.accessStatus(controller.signal)
      .then((status) => status.required && !status.authenticated ? setState("login") : void enterOcean())
      .catch(() => void enterOcean());
    return () => controller.abort();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await new OceanGatewayClient().login(password);
      setPassword("");
      await enterOcean();
    } catch (caught) {
      if (caught instanceof OceanGatewayError && caught.status === 429) setError("尝试次数较多，请稍后再试。\u3000");
      else setError("密码不对，再轻轻试一次。\u3000");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "ready") return children;

  return (
    <main className="ocean-app ocean-access theme-ocean">
      <section className="ocean-access-shell" aria-busy={state !== "login"} aria-label="进入 Ocean">
        <img className="ocean-access-wallpaper" src={assetPath("assets/ocean-home-bg.png")} alt="" aria-hidden="true" />
        <p className="ocean-access-kicker">FISH WITH OCTOPUS</p>
        <img className="ocean-access-wordmark" src={assetPath("assets/ocean-wordmark.svg")} alt="Ocean" />
        {state === "login" ? (
          <form className="ocean-access-card" onSubmit={submit}>
            <div className="ocean-access-copy">
              <h1>回到房子里</h1>
              <p>输入 Ocean 密码。这台设备会记住登录状态，不会保存模型 API Key。</p>
            </div>
            <label>
              <span className="sr-only">Ocean 密码</span>
              <input
                autoComplete="current-password"
                autoFocus
                disabled={submitting}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Ocean 密码"
                type="password"
                value={password}
              />
            </label>
            <button disabled={!password || submitting} type="submit">{submitting ? "正在开门…" : "开门"}</button>
            <p aria-live="polite" className="ocean-access-error">{error}</p>
          </form>
        ) : (
          <div
            aria-label={state === "checking" ? "正在确认这台设备" : "正在接回房间"}
            className="ocean-access-loading"
            role="status"
          >
            <span aria-hidden="true" className="ocean-access-dots">
              <i /><i /><i />
            </span>
            <p>{state === "checking" ? "正在确认这台设备" : "正在接回房间"}</p>
            <span aria-hidden="true" className="ocean-access-dots">
              <i /><i /><i />
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
