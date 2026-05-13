import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { click, getButtonByText, render } from "../test/render.tsx";
import { LoginPage } from "./LoginPage.tsx";

function LoginHarness({ onRegister }: { onRegister: () => void }) {
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });

  return (
    <LoginPage
      error={null}
      notice="注册已提交，请等待管理员审批。"
      loginForm={loginForm}
      setLoginForm={setLoginForm}
      onSubmit={(event) => event.preventDefault()}
      onRegister={onRegister}
    />
  );
}

describe("LoginPage", () => {
  const activeRenders: Array<{ unmount: () => Promise<void> }> = [];

  afterEach(async () => {
    while (activeRenders.length > 0) {
      await activeRenders.pop()?.unmount();
    }
  });

  it("shows registration feedback and enters the register screen from the login page", async () => {
    const onRegister = vi.fn();
    const view = await render(<LoginHarness onRegister={onRegister} />);
    activeRenders.push(view);

    expect(view.container.textContent).toContain("注册已提交，请等待管理员审批。");

    await click(getButtonByText(view.container, "注册账号"));
    expect(onRegister).toHaveBeenCalledTimes(1);
  });
});
