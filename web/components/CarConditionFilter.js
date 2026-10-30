const OPTIONS = [
  { value: null, label: "Все" },
  { value: true, label: "Новые" },
  { value: false, label: "С пробегом" },
];

export default function CarConditionFilter({ value = null, onChange }) {
  return (
    <div className="car-condition-filter" role="group" aria-label="Состояние автомобиля">
      {OPTIONS.map((option) => (
        <button key={option.label} type="button" aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
