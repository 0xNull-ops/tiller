import { ChevronDownIcon, SparklesIcon } from "lucide-react";
import { credentialBrandRecord, searchCredentialBrands } from "@t3tools/shared/credentialBrand";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { CredentialBrandIcon } from "./CredentialBrandIcon";

const MAX_RESULTS = 60;

const ROW_CLASS_NAME =
  "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * Pick a brand for one credential, or hand matching back to the automatic rules.
 * Each row mounts its own `CredentialBrandIcon`, so only the rows on screen load
 * an icon chunk (at most {@link MAX_RESULTS} of them, and each chunk is ~1 KB).
 */
export function CredentialIconPicker({
  name,
  value,
  onValueChange,
}: {
  readonly name: string;
  readonly value: string | null;
  readonly onValueChange: (slug: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = searchCredentialBrands(query, MAX_RESULTS);
  const selected = value ? credentialBrandRecord(value) : null;

  const select = (slug: string | null) => {
    onValueChange(slug);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <CredentialBrandIcon name={name} iconOverride={value} size="sm" />
        <span className="min-w-0 flex-1 truncate text-left">{selected?.title ?? "Automatic"}</span>
        <ChevronDownIcon />
      </PopoverTrigger>
      <PopoverPopup align="start" width="md">
        <div className="flex flex-col gap-2 p-2">
          <Input
            autoFocus
            type="search"
            size="sm"
            aria-label="Search brands"
            placeholder="Search brands…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex max-h-72 flex-col overflow-y-auto">
            <button type="button" className={ROW_CLASS_NAME} onClick={() => select(null)}>
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground/8 text-muted-foreground">
                <SparklesIcon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="block text-sm">Automatic</span>
                <span className="block truncate text-2xs text-muted-foreground">
                  Detect from the name, URL and environment variables
                </span>
              </span>
              {value === null ? (
                <span className="shrink-0 text-2xs text-muted-foreground">Current</span>
              ) : null}
            </button>
            {results.map((record) => (
              <button
                key={record.slug}
                type="button"
                className={cn(ROW_CLASS_NAME, record.slug === value && "bg-accent")}
                onClick={() => select(record.slug)}
              >
                <CredentialBrandIcon name={record.title} iconOverride={record.slug} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{record.title}</span>
                {record.slug === value ? (
                  <span className="shrink-0 text-2xs text-muted-foreground">Current</span>
                ) : null}
              </button>
            ))}
            {results.length === 0 ? (
              <p className="px-1.5 py-3 text-center text-sm text-muted-foreground">
                No brands match.
              </p>
            ) : null}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
