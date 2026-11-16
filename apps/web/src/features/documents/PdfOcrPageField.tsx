import { useId } from 'react';
import { Input } from '../../components/ui/input';

export interface PdfOcrPageFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  error?: string | undefined;
  range: boolean;
  onRangeChange: (value: boolean) => void;
  end: string;
  onEndChange: (value: string) => void;
}

export function PdfOcrPageField({
  value,
  onChange,
  disabled,
  error,
  range,
  onRangeChange,
  end,
  onEndChange,
}: PdfOcrPageFieldProps) {
  const inputId = useId();
  const helperId = useId();
  const errorId = useId();
  const endId = useId();

  const describedBy = error ? `${helperId} ${errorId}` : helperId;

  return (
    <div className="min-w-0">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-foreground"
      >
        {range ? 'Start page' : 'Page number'}
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
        {range
          ? 'Choose consecutive pages from 1–50, up to 5 pages.'
          : 'Choose one page (1–50). Only the selected page will be recognized.'}
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={range}
          disabled={disabled}
          onChange={(event) => onRangeChange(event.target.checked)}
        />
        Recognize a page range (up to 5 pages)
      </label>
      {range && (
        <div className="mt-3">
          <label
            htmlFor={endId}
            className="block text-sm font-medium text-foreground"
          >
            End page
          </label>
          <Input
            id={endId}
            type="number"
            min={1}
            max={50}
            step={1}
            inputMode="numeric"
            value={end}
            onChange={(event) => onEndChange(event.target.value)}
            disabled={disabled}
            aria-describedby={error ? `${helperId} ${errorId}` : helperId}
            aria-invalid={error ? true : undefined}
            className="mt-1.5 w-full min-w-0 min-h-11"
          />
        </div>
      )}
      {error ? (
        <p id={errorId} className="mt-1.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
