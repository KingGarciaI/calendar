"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Centered dialog on desktop, bottom sheet on phones. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  hideTitle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  hideTitle?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 flex max-h-[92dvh] flex-col overflow-hidden border border-line bg-surface shadow-pop focus:outline-none",
            "inset-x-0 bottom-0 rounded-t-[16px] animate-sheet pb-safe",
            "md:inset-auto md:left-1/2 md:top-[12vh] md:w-[min(560px,calc(100vw-32px))] md:-translate-x-1/2 md:rounded-[var(--radius-panel)] md:animate-pop md:pb-0",
            className,
          )}
        >
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong md:hidden" />
          <div className={cn("flex items-start justify-between gap-4 px-5 pb-1 pt-4", hideTitle && "sr-only")}>
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-0.5 text-sm text-ink-2">{description}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close className="-mr-1.5 rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Fermer">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          {!description && <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  tone = "danger",
  options,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm?: () => void;
  tone?: "danger" | "primary";
  /** Several choices instead of a single confirm (e.g. recurring scope). */
  options?: { label: string; onSelect: () => void; tone?: "danger" | "primary" | "secondary" }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} className="md:w-[400px]">
      <div className="px-5 pb-5">
        {body ? <p className="text-sm text-ink-2">{body}</p> : null}
        <div className="mt-5 flex flex-col gap-2 md:flex-row-reverse">
          {options ? (
            options.map((o) => (
              <button
                key={o.label}
                onClick={() => {
                  o.onSelect();
                  onOpenChange(false);
                }}
                className={cn(
                  "h-10 rounded-[var(--radius-ctl)] px-4 text-sm font-semibold md:h-9",
                  o.tone === "danger" ? "bg-danger text-white hover:brightness-110" : o.tone === "primary" ? "bg-accent text-accent-fg hover:bg-accent-hover" : "border border-line bg-surface hover:bg-surface-hover",
                )}
              >
                {o.label}
              </button>
            ))
          ) : (
            <>
              <button
                onClick={() => {
                  onConfirm?.();
                  onOpenChange(false);
                }}
                className={cn(
                  "h-10 rounded-[var(--radius-ctl)] px-4 text-sm font-semibold md:h-9",
                  tone === "danger" ? "bg-danger text-white hover:brightness-110" : "bg-accent text-accent-fg hover:bg-accent-hover",
                )}
              >
                {confirmLabel ?? "Confirmer"}
              </button>
              <button onClick={() => onOpenChange(false)} className="h-10 rounded-[var(--radius-ctl)] border border-line px-4 text-sm font-semibold hover:bg-surface-hover md:h-9">
                Annuler
              </button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, align = "start", ...p }: PopoverPrimitive.PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cn("animate-pop z-50 rounded-[10px] border border-line bg-surface p-1 shadow-pop focus:outline-none", className)}
        {...p}
      />
    </PopoverPrimitive.Portal>
  );
}

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;
export function MenuContent({ className, align = "end", ...p }: DropdownPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cn("animate-pop z-50 min-w-44 rounded-[10px] border border-line bg-surface p-1 shadow-pop", className)}
        {...p}
      />
    </DropdownPrimitive.Portal>
  );
}
export function MenuItem({ className, tone, ...p }: DropdownPrimitive.DropdownMenuItemProps & { tone?: "danger" }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-surface-2 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-ink-3",
        tone === "danger" && "text-danger [&_svg]:text-danger",
        className,
      )}
      {...p}
    />
  );
}
export const MenuSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;
