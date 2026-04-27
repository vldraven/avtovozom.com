function PinDots({ value, maxLength }) {
  return (
    <div className="pin-dots" aria-label={`Введено ${value.length} цифр`}>
      {Array.from({ length: maxLength }).map((_, idx) => (
        <span
          // eslint-disable-next-line react/no-array-index-key
          key={idx}
          className={`pin-dots__dot${idx < value.length ? " pin-dots__dot--filled" : ""}`}
        />
      ))}
    </div>
  );
}

export default function PinPad({
  value,
  onChange,
  onSubmit,
  className = "",
  submitLabel = "Продолжить",
  minLength = 4,
  maxLength = 6,
  disabled = false,
}) {
  function appendDigit(digit) {
    if (disabled || value.length >= maxLength) return;
    onChange(`${value}${digit}`);
  }

  function backspace() {
    if (disabled) return;
    onChange(value.slice(0, -1));
  }

  const canSubmit = !disabled && value.length >= minLength;
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className={`pin-pad ${className}`.trim()}>
      <PinDots value={value} maxLength={maxLength} />
      <div className="pin-keypad" aria-label="Цифровая клавиатура">
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            className="pin-keypad__key"
            onClick={() => appendDigit(digit)}
            disabled={disabled}
          >
            {digit}
          </button>
        ))}
        <span aria-hidden />
        <button
          type="button"
          className="pin-keypad__key"
          onClick={() => appendDigit("0")}
          disabled={disabled}
        >
          0
        </button>
        <button
          type="button"
          className="pin-keypad__key pin-keypad__key--muted"
          onClick={backspace}
          disabled={disabled || !value}
          aria-label="Удалить цифру"
        >
          ←
        </button>
      </div>
      <button type="button" className="btn btn-primary pin-pad__submit" onClick={onSubmit} disabled={!canSubmit}>
        {submitLabel}
      </button>
    </div>
  );
}
