import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface MultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({ options, selected, onChange, placeholder = "Select...", className }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };
  const label = selected.length === 0 ? placeholder : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={cn("w-full justify-between font-normal", className)}>
          <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>{label}</span>
          <div className="flex items-center gap-1">
            {selected.length > 0 && (
              <X
                className="h-4 w-4 opacity-60 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); onChange([]); }}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
          <button className="text-primary hover:underline" onClick={() => onChange(options)}>Select all</button>
          <button className="text-muted-foreground hover:underline" onClick={() => onChange([])}>Clear</button>
        </div>
        <div className="max-h-64 overflow-auto py-1">
          {options.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No options</div>}
          {options.map(opt => {
            const checked = selected.includes(opt);
            return (
              <div
                key={opt}
                onClick={() => toggle(opt)}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(opt)} onClick={(e) => e.stopPropagation()} />
                <span className="flex-1 truncate">{opt}</span>
                {checked && <Check className="h-4 w-4 text-primary" />}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
