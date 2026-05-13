import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";

export type RegisterForm = {
  username: string;
  password: string;
  confirmPassword: string;
};

interface RegisterPageProps {
  error: string | null;
  registerForm: RegisterForm;
  setRegisterForm: Dispatch<SetStateAction<RegisterForm>>;
  onSubmit: (username: string, password: string) => void;
  onBackToLogin: () => void;
}

export function RegisterPage({
  error,
  registerForm,
  setRegisterForm,
  onSubmit,
  onBackToLogin
}: RegisterPageProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const username = registerForm.username.trim();
    if (!username) {
      setValidationError("请输入用户名");
      return;
    }

    if (!registerForm.password) {
      setValidationError("请输入密码");
      return;
    }

    if (registerForm.password !== registerForm.confirmPassword) {
      setValidationError("两次密码不一致");
      return;
    }

    setValidationError(null);
    onSubmit(username, registerForm.password);
  };

  return (
    <main className="shell auth-shell">
      <section className="panel auth-panel">
        <div className="stack compact-stack">
          <p className="eyebrow">LLM Router</p>
          <h1>注册账号</h1>
          <p className="muted">提交后需要管理员审批，通过后才能登录控制台并使用 API Key。</p>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          <label>
            <span>用户名</span>
            <input
              name="username"
              value={registerForm.username}
              onChange={(event) => {
                setValidationError(null);
                setRegisterForm((current) => ({ ...current, username: event.target.value }));
              }}
              placeholder="请输入用户名"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              value={registerForm.password}
              onChange={(event) => {
                setValidationError(null);
                setRegisterForm((current) => ({ ...current, password: event.target.value }));
              }}
              placeholder="请输入密码"
            />
          </label>
          <label>
            <span>确认密码</span>
            <input
              name="confirmPassword"
              type="password"
              value={registerForm.confirmPassword}
              onChange={(event) => {
                setValidationError(null);
                setRegisterForm((current) => ({
                  ...current,
                  confirmPassword: event.target.value
                }));
              }}
              placeholder="请再次输入密码"
            />
          </label>

          <button type="submit" className="primary">
            提交注册
          </button>
          <button type="button" className="secondary" onClick={onBackToLogin}>
            返回登录
          </button>
        </form>

        {validationError ? <p className="feedback error">{validationError}</p> : null}
        {error ? <p className="feedback error">{error}</p> : null}
      </section>
    </main>
  );
}
