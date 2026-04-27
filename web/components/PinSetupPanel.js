import { useState } from "react";

import { canUseWebAuthn, getStoredToken, registerPasskey, setupPin } from "../lib/auth";
import PinPad from "./PinPad";

export default function PinSetupPanel({ onComplete }) {
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [step, setStep] = useState("create");
  const [enableBio, setEnableBio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bioWarning, setBioWarning] = useState("");

  function validatePinPair() {
    if (!/^\d{4,6}$/.test(pin)) {
      setError("Введите ПИН из 4-6 цифр.");
      return false;
    }
    if (pin !== pinConfirm) {
      setError("ПИН-коды не совпадают.");
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
              "ПИН сохранён, но биометрию не удалось включить. Её можно включить позже в профиле."
          );
          return;
        }
      }
      onComplete?.();
    } catch (err) {
      setError(err?.message || "Не удалось сохранить ПИН-код");
    } finally {
      setBusy(false);
    }
  }

  async function submitMobile() {
    setError("");
    setBioWarning("");
    if (step === "create") {
      if (!/^\d{4,6}$/.test(pin)) {
        setError("Введите ПИН из 4-6 цифр.");
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

  return (
    <div className="pin-panel">
      <div className="pin-panel__hero">
        <div className="pin-panel__app-icon">A</div>
        <h2>{step === "confirm" ? "Повторите ПИН" : "Создайте ПИН-код"}</h2>
        <p>
          {step === "confirm"
            ? "Введите код ещё раз, чтобы мы точно сохранили его без ошибки."
            : "Он будет использоваться для быстрого входа в приложение на этом устройстве."}
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
          placeholder="ПИН-код"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <input
          className="input"
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
          {busy ? "Сохраняем..." : "Сохранить ПИН"}
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
      {step === "confirm" ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={resetPin} disabled={busy}>
          Изменить ПИН
        </button>
      ) : null}
      {step === "confirm" && canUseWebAuthn() ? (
        <label className="pin-panel__check">
          <input
            type="checkbox"
            checked={enableBio}
            onChange={(e) => setEnableBio(e.target.checked)}
          />
          Включить вход по Face ID, Touch ID или биометрии устройства
        </label>
      ) : null}
    </div>
  );
}
