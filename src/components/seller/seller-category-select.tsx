"use client";

import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { Select } from "radix-ui";
import gsap from "gsap";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

gsap.registerPlugin(useGSAP);

export type CategoryOption = {
  id: string;
  name: string;
  slug: string;
};

export function SellerCategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: CategoryOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!open || !contentRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(contentRef.current,
      { autoAlpha: 0, y: -8, scale: 0.985, transformOrigin: "top center" },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.22, ease: "power2.out" }
    );
  }, { dependencies: [open], scope: contentRef, revertOnUpdate: true });

  return (
    <Select.Root value={value} onValueChange={onChange} open={open} onOpenChange={setOpen}>
      <Select.Trigger
        id="category"
        aria-label="Category"
        className="flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-gold/30 bg-elevated px-3.5 text-left text-sm text-foreground shadow-sm outline-none transition-colors hover:border-gold/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/25 data-[state=open]:border-gold data-[state=open]:ring-2 data-[state=open]:ring-gold/20"
      >
        <Select.Value placeholder="Select a category" />
        <Select.Icon className="text-gold"><ChevronDownIcon className="size-4" aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          ref={contentRef}
          data-testid="seller-category-menu"
          position="popper"
          sideOffset={8}
          collisionPadding={12}
          className="z-[100] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-gold/40 bg-popover p-1.5 text-popover-foreground shadow-gold outline-none"
        >
          <Select.Viewport className="max-h-64 overflow-y-auto">
            {categories.map((category) => (
              <Select.Item
                key={category.id}
                value={category.id}
                className="relative flex min-h-11 cursor-pointer items-center rounded-lg py-2 pl-3.5 pr-9 text-sm font-medium text-popover-foreground outline-none transition-colors data-[highlighted]:bg-gold/15 data-[highlighted]:text-gold data-[state=checked]:text-gold"
              >
                <Select.ItemText>{category.name}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-3 text-gold"><CheckIcon className="size-4" aria-hidden="true" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
