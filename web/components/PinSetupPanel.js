import { useState } from "react";

import { canUseWebAuthn, getStoredToken, registerPasskey, setupPin } from "../lib/auth";

export default function PinSetupPanel({ onComplete }) {
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [enableBio, setEnableBio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!/^\d{4,6}$/.test(pin)) {
      setError("Введите ПИН из 4-6 цифр.");
      return;
    }
    if (pin !== pinConfirm) {
      setError("ПИН-коды не совпадают.");
      return;
    }
    setBusy(true);
    try {
      if (enableBio && canUseWebAuthn()) {
        await registerPasskey(getStoredToken());
      }
      await setupPin(pin);
      onComplete?.();
    } catch (err) {
      setError(err?.message || "Не удалось сохранить ПИН-код");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pin-panel" onSubmit={submit}>
      <h2>Создайте ПИН-код</h2>
      <p>Он будет использоваться для быстрого входа в установленное приложение на этом устройстве.</p>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      <input
        className="input pin-panel__input"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        placeholder="ПИН-код"
        type="password"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
      />
      <input
        className="input pin-panel__input"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        placeholder="Повторите ПИН"
        type="password"
        value={pinConfirm}
        onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
      />
      {canUseWebAuthn() ? (
        <label className="pin-panel__check">
          <input
            type="checkbox"
            checked={enableBio}
            onChange={(e) => setEnableBio(e.target.checked)}
          />
          Включить вход по Face ID, Touch ID или биометрии устройства
        </label>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Сохраняем..." : "Продолжить"}
      </button>
    </form>
  );
}
