import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { click, getButtonByText, render } from "../test/render.tsx";
import { RegisterPage, type RegisterForm } from "./RegisterPage.tsx";

function RegisterHarness({
  onSubmit,
  onBackToLogin
}: {
  onSubmit: (username: string, password: string) => void;
  onBackToLogin: () => void;
}) {
  const [registerForm, setRegisterForm] = useState<RegisterForm>({
    username: "",
    password: "",
    confirmPassword: ""
  });

  return (
    <RegisterPage
      error={null}
      registerForm={registerForm}
      setRegisterForm={setRegisterForm}
      onSubmit={onSubmit}
      onBackToLogin={onBackToLogin}
    />
  );
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

  await act(async () => {
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("RegisterPage", () => {
  const activeRenders: Array<{ unmount: () => Promise<void> }> = [];

  afterEach(async () => {
    while (activeRenders.length > 0) {
      await activeRenders.pop()?.unmount();
    }
  });

  it("blocks registration when password confirmation does not match", async () => {
    const onSubmit = vi.fn();
    const view = await render(<RegisterHarness onSubmit={onSubmit} onBackToLogin={() => undefined} />);
    activeRenders.push(view);

    await setInputValue(view.container.querySelector('input[name="username"]') as HTMLInputElement, "alice");
    await setInputValue(
      view.container.querySelector('input[name="password"]') as HTMLInputElement,
      "secret123"
    );
    await setInputValue(
      view.container.querySelector('input[name="confirmPassword"]') as HTMLInputElement,
      "secret456"
    );
    await submitForm(view.container.querySelector("form") as HTMLFormElement);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("两次密码不一致");
  });

  it("submits matching credentials and exposes a back-to-login action", async () => {
    const onSubmit = vi.fn();
    const onBackToLogin = vi.fn();
    const view = await render(
      <RegisterHarness onSubmit={onSubmit} onBackToLogin={onBackToLogin} />
    );
    activeRenders.push(view);

    await setInputValue(view.container.querySelector('input[name="username"]') as HTMLInputElement, "alice");
    await setInputValue(
      view.container.querySelector('input[name="password"]') as HTMLInputElement,
      "secret123"
    );
    await setInputValue(
      view.container.querySelector('input[name="confirmPassword"]') as HTMLInputElement,
      "secret123"
    );
    await submitForm(view.container.querySelector("form") as HTMLFormElement);
    await click(getButtonByText(view.container, "返回登录"));

    expect(onSubmit).toHaveBeenCalledWith("alice", "secret123");
    expect(onBackToLogin).toHaveBeenCalledTimes(1);
  });
});
