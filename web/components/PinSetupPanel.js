import { useState } from "react";

import { canUseWebAuthn, getStoredToken, registerPasskey, setupPin } from "../lib/auth";
import PinPad from "./PinPad";

export default function PinSetupPanel({ onComplete, onSkip, hideStepLabel = false }) {
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [step, setStep] = useState("create");
  const [enableBio, setEnableBio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bioWarning, setBioWarning] = useState("");

  function validatePinPair() {
    if (!/^\d{4,6}$/.test(pin)) {
      setError("Введите PIN из 4-6 цифр.");
      return false;
    }
    if (pin !== pinConfirm) {
      setError("PIN-коды не совпадают.");
      return false;
    }
    return true;
  }

  async function completeSetup() {
    setBusy(true);
    try {
      await setupPin(pin);
      if (enableBio && canUseWebAuthn()) {
        try {
          await registerPasskey(getStoredToken());
        } catch (err) {
          setBioWarning(
            err?.message ||
              "PIN сохранён, но биометрию не удалось включить. Её можно включить позже в профиле."
          );
          return;
        }
      }
      onComplete?.();
    } catch (err) {
      setError(err?.message || "Не удалось сохранить PIN-код");
    } finally {
      setBusy(false);
    }
  }

  async function submitMobile() {
    setError("");
    setBioWarning("");
    if (step === "create") {
      if (!/^\d{4,6}$/.test(pin)) {
        setError("Введите PIN из 4-6 цифр.");
        return;
      }
      setStep("confirm");
      return;
    }
    if (!validatePinPair()) return;
    await completeSetup();
  }

  async function submitDesktop(e) {
    e.preventDefault();
    setError("");
    setBioWarning("");
    if (!validatePinPair()) return;
    await completeSetup();
  }

  function resetPin() {
    setPin("");
    setPinConfirm("");
    setStep("create");
    setError("");
    setBioWarning("");
  }

  const skip = onSkip || onComplete;

  return (
    <div className="pin-panel">
      <div className="pin-panel__hero">
        <div className="pin-panel__app-icon" aria-hidden>
          A
        </div>
        {hideStepLabel ? null : <p className="pin-panel__step muted">Шаг 2</p>}
        <h2>{step === "confirm" ? "Повторите PIN-код" : "Придумайте PIN-код"}</h2>
        <p>
          {step === "confirm"
            ? "Введите тот же код ещё раз."
            : "4–6 цифр для быстрого входа в приложение вместо пароля."}
        </p>
      </div>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      {bioWarning ? (
        <div className="alert alert--warn">
          {bioWarning}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onComplete}>
            Продолжить без биометрии
          </button>
        </div>
      ) : null}
      <form className="pin-panel__desktop-form" onSubmit={submitDesktop}>
        <input
          className="input"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          placeholder="PIN-код"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <input
          className="input"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          placeholder="Повторите PIN"
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
          {busy ? "Сохраняем..." : "Сохранить PIN"}
        </button>
      </form>
      <PinPad
        className="pin-panel__mobile-pad"
        value={step === "confirm" ? pinConfirm : pin}
        onChange={step === "confirm" ? setPinConfirm : setPin}
        onSubmit={submitMobile}
        submitLabel={busy ? "Сохраняем..." : step === "confirm" ? "Сохранить" : "Продолжить"}
        disabled={busy}
      />
      <div className="pin-panel__footer">
        {step === "confirm" ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetPin} disabled={busy}>
            Изменить PIN
          </button>
        ) : null}
        {canUseWebAuthn() && step === "confirm" ? (
          <label className="pin-panel__check">
            <input
              type="checkbox"
              checked={enableBio}
              onChange={(e) => setEnableBio(e.target.checked)}
            />
            Вход по Face ID / Touch ID / биометрии
          </label>
        ) : null}
        {skip ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={skip} disabled={busy}>
            Позже
          </button>
        ) : null}
      </div>
    </div>
  );
}
