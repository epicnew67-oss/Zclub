import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { DesignShowcase } from "@/components/design/design-showcase";

export const metadata: Metadata = {
  title: "Design system",
  description: `${brand.name} brand tokens, component variants, and effects — the design system reference page.`,
};

export default function DesignPage() {
  return <DesignShowcase />;
}
