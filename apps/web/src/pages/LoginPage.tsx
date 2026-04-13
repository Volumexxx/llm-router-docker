import type { Dispatch, FormEvent, SetStateAction } from "react";

interface LoginPageProps {
  error: string | null;
  loginForm: {
    username: string;
    password: string;
  };
  setLoginForm: Dispatch<
    SetStateAction<{
      username: string;
      password: string;
    }>
  >;
  onSubmit: (event: FormEvent) => void;
}

export function LoginPage({ error, loginForm, setLoginForm, onSubmit }: LoginPageProps) {
  return (
    <main className="shell auth-shell">
      <section className="panel auth-panel">
        <p className="eyebrow">LLM Router Admin</p>
        <h1>Docker / NAS 公网版控制台</h1>
        <p className="muted">
          使用管理员账号登录后，即可管理 Provider、模型路由、安全策略和审计数据。
        </p>
        <form className="stack" onSubmit={onSubmit}>
          <label>
            <span>用户名</span>
            <input
              value={loginForm.username}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, username: event.target.value }))
              }
              placeholder="admin"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="至少 8 位"
            />
          </label>
          <button type="submit" className="primary">
            登录后台
          </button>
        </form>
        {error ? <p className="feedback error">{error}</p> : null}
      </section>
    </main>
  );
}
