import { useId } from 'react';
import { Input } from '../../components/ui/input';

export interface PdfOcrPageFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  error?: string | undefined;
}

export function PdfOcrPageField({
  value,
  onChange,
  disabled,
  error,
}: PdfOcrPageFieldProps) {
  const inputId = useId();
  const helperId = useId();
  const errorId = useId();

  const describedBy = error ? `${helperId} ${errorId}` : helperId;

  return (
    <div className="min-w-0">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-foreground"
      >
        Page number
      </label>
      <Input
        id={inputId}
        type="number"
        min={1}
        max={50}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="mt-1.5 w-full min-w-0 min-h-11 rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p id={helperId} className="mt-1.5 text-sm text-muted-foreground">
        Choose one page (1–50). Only the selected page will be recognized.
      </p>
      {error ? (
        <p id={errorId} className="mt-1.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
