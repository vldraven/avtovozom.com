import { useState } from "react";

import { canUseWebAuthn, getStoredToken, registerPasskey, setupPin } from "../lib/auth";
import { humanizeWebAuthnError } from "../lib/webauthnErrors";
import PinPad from "./PinPad";

const PIN_LENGTH = 4;

export default function PinSetupPanel({ onComplete, onSkip, hideStepLabel = false }) {
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [step, setStep] = useState("create");
  const [enableBio, setEnableBio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bioWarning, setBioWarning] = useState("");

  function validatePinPair() {
    if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
      setError(`Введите PIN из ${PIN_LENGTH} цифр.`);
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
            humanizeWebAuthnError(
              err,
              "PIN сохранён, но биометрию не удалось включить. Её можно включить позже в профиле."
            )
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
      if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
        setError(`Введите PIN из ${PIN_LENGTH} цифр.`);
        return;
      }
      setPinConfirm("");
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

  function goBackToCreate() {
    setPinConfirm("");
    setStep("create");
    setError("");
    setBioWarning("");
  }

  const skip = onSkip || onComplete;
  const isConfirm = step === "confirm";

  return (
    <div className="pin-panel">
      {error ? <div className="alert alert--danger">{error}</div> : null}
      {bioWarning ? (
        <div className="alert alert--warn">
          <p className="pin-panel__bio-warn">{bioWarning}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onComplete}>
            Продолжить без биометрии
          </button>
        </div>
      ) : null}

      {/* Desktop: прежняя светлая форма + «Позже» */}
      <div className="pin-panel__desktop">
        <div className="pin-panel__hero">
          {hideStepLabel ? null : <p className="pin-panel__step muted">Шаг 2</p>}
          <h2>Придумайте PIN-код</h2>
          <p>{`${PIN_LENGTH} цифры для быстрого входа в приложение вместо пароля.`}</p>
        </div>
        <form className="pin-panel__desktop-form" onSubmit={submitDesktop}>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={PIN_LENGTH}
            placeholder="PIN-код"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
          />
          <input
            className="input"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={PIN_LENGTH}
            placeholder="Повторите PIN"
            type="password"
            value={pinConfirm}
            onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
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
          <button type="submit" className="btn btn-primary auth-submit-wide" disabled={busy}>
            {busy ? "Сохраняем..." : "Сохранить PIN"}
          </button>
        </form>
        {skip ? (
          <button type="button" className="btn btn-secondary auth-submit-wide" onClick={skip} disabled={busy}>
            Позже
          </button>
        ) : null}
      </div>

      {/* Mobile: тёмный keypad */}
      <div className={`pin-panel__mobile pin-panel--keypad pin-panel--dark${isConfirm ? " pin-panel--confirm" : ""}`}>
        {isConfirm ? (
          <button type="button" className="pin-panel__back" onClick={goBackToCreate} disabled={busy}>
            ← Назад
          </button>
        ) : null}
        <div className="pin-panel__hero">
          {!isConfirm ? (
            <div className="app-lock__brand" aria-hidden>
              <img src="/logo-avtovozom-white.png" alt="" className="app-lock__brand-mark" width={22} height={26} />
              <span className="app-lock__brand-text">avtovozom</span>
            </div>
          ) : null}
          {hideStepLabel ? null : <p className="pin-panel__step">Шаг 2</p>}
          <h2>{isConfirm ? "Повторите PIN-код" : "Придумайте PIN-код"}</h2>
          <p>
            {isConfirm
              ? "Введите тот же код ещё раз."
              : `${PIN_LENGTH} цифры для быстрого входа в приложение вместо пароля.`}
          </p>
        </div>
        <PinPad
          className="pin-panel__pad"
          value={isConfirm ? pinConfirm : pin}
          onChange={isConfirm ? setPinConfirm : setPin}
          onSubmit={submitMobile}
          submitLabel={busy ? "Сохраняем..." : isConfirm ? "Сохранить" : "Продолжить"}
          minLength={PIN_LENGTH}
          maxLength={PIN_LENGTH}
          disabled={busy}
        />
        <div className="pin-panel__footer">
          {canUseWebAuthn() && isConfirm ? (
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
            <button type="button" className="btn btn-secondary auth-submit-wide" onClick={skip} disabled={busy}>
              Позже
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
