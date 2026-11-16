import type { ComponentProps, ReactNode } from "react";

export function WorkflowInspectorSection({
  label,
  count,
  action,
  hint,
  children,
  ...props
}: Omit<ComponentProps<"section">, "className"> & {
  label: string;
  count?: number;
  action?: ReactNode;
  hint?: string | undefined;
}) {
  return (
    <section aria-label={label} {...props} className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
          {count === undefined ? "" : ` · ${count}`}
        </h4>
        {action}
        {hint ? <span className="text-2xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function WorkflowInspectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,360px)] items-start gap-3 py-0.5 text-xs">
      <span className="pt-1 text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
