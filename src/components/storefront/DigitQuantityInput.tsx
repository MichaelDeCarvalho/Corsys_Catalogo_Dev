import React, { useState, useEffect } from 'react';
import { Plus, Minus } from 'lucide-react';

export interface DigitQuantityInputProps {
  quantity: number;
  stock?: number;
  min?: number;
  disabled?: boolean;
  onUpdate: (qty: number) => void;
  size?: 'sm' | 'md' | 'lg';
}

export const DigitQuantityInput: React.FC<DigitQuantityInputProps> = ({
  quantity,
  stock,
  min = 1,
  disabled = false,
  onUpdate,
  size = 'md',
}) => {
  const [inputValue, setInputValue] = useState<string>(String(quantity));
  const [isFocused, setIsFocused] = useState<boolean>(false);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(String(quantity));
    }
  }, [quantity, isFocused]);

  const maxAllowed = stock !== undefined && stock > 0 ? stock : Infinity;

  const commitValue = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setInputValue(String(quantity));
      return;
    }

    let parsed = parseInt(trimmed, 10);
    if (isNaN(parsed) || parsed < min) {
      parsed = min;
    }

    if (parsed > maxAllowed) {
      parsed = maxAllowed;
    }

    setInputValue(String(parsed));
    if (parsed !== quantity) {
      onUpdate(parsed);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/\D/g, '');
    setInputValue(cleaned);
  };

  const handleBlur = () => {
    setIsFocused(false);
    commitValue(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setInputValue(String(quantity));
      e.currentTarget.blur();
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    e.target.select();
  };

  const handleDecrease = () => {
    if (disabled) return;
    const next = Math.max(min, quantity - 1);
    setInputValue(String(next));
    onUpdate(next);
  };

  const handleIncrease = () => {
    if (disabled) return;
    const next = Math.min(maxAllowed, quantity + 1);
    setInputValue(String(next));
    onUpdate(next);
  };

  const isSm = size === 'sm';
  const isLg = size === 'lg';

  const btnClasses = isSm
    ? 'w-6 h-6'
    : isLg
    ? 'w-10 h-10'
    : 'w-7 h-7';

  const iconClasses = isSm ? 'w-2.5 h-2.5' : isLg ? 'w-4 h-4' : 'w-3 h-3';

  const inputClasses = isSm
    ? 'w-9 h-6 text-[11px]'
    : isLg
    ? 'w-14 h-10 text-sm'
    : 'w-11 h-7 text-xs';

  return (
    <div
      className={`inline-flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden shadow-2xs ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      <button
        type="button"
        onClick={handleDecrease}
        disabled={disabled || quantity <= min}
        className={`${btnClasses} flex items-center justify-center text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer`}
        title="Diminuir quantidade"
      >
        <Minus className={iconClasses} />
      </button>

      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={inputValue}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        className={`${inputClasses} text-center font-bold text-slate-800 bg-white border-x border-slate-200 focus:bg-amber-50/50 focus:border-[#FF5A00] focus:ring-1 focus:ring-[#FF5A00] focus:outline-none transition-all`}
        title="Digite a quantidade desejada"
      />

      <button
        type="button"
        onClick={handleIncrease}
        disabled={disabled || quantity >= maxAllowed}
        className={`${btnClasses} flex items-center justify-center text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer`}
        title="Aumentar quantidade"
      >
        <Plus className={iconClasses} />
      </button>
    </div>
  );
};
