import type { Dispatch, FormEvent, SetStateAction } from "react";

interface LoginPageProps {
  error: string | null;
  notice?: string | null;
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
  onRegister: () => void;
}

export function LoginPage({
  error,
  notice = null,
  loginForm,
  setLoginForm,
  onSubmit,
  onRegister
}: LoginPageProps) {
  return (
    <main className="shell auth-shell">
      <section className="panel auth-panel">
        <div className="stack compact-stack">
          <p className="eyebrow">LLM Router</p>
          <h1>控制台登录</h1>
          <p className="muted">登录后可查看路由、审计、API Key 和账号权限。</p>
        </div>

        <form className="stack" onSubmit={onSubmit}>
          <label>
            <span>用户名</span>
            <input
              name="username"
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
              name="password"
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="请输入密码"
            />
          </label>

          <button type="submit" className="primary">
            登录
          </button>
          <button type="button" className="secondary" onClick={onRegister}>
            注册账号
          </button>
        </form>

        {notice ? <p className="feedback success">{notice}</p> : null}
        {error ? <p className="feedback error">{error}</p> : null}
      </section>
    </main>
  );
}
