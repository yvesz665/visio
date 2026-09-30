"use client";

import {
  Wallet,
  ShoppingCart,
  Home,
  Car,
  Utensils,
  HeartPulse,
  GraduationCap,
  Plane,
  Gift,
  PiggyBank,
  Zap,
  Shirt,
  Baby,
  Dog,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

export const ENVELOPE_ICONS: Record<string, LucideIcon> = {
  wallet: Wallet,
  cart: ShoppingCart,
  home: Home,
  car: Car,
  food: Utensils,
  health: HeartPulse,
  education: GraduationCap,
  travel: Plane,
  gift: Gift,
  savings: PiggyBank,
  utilities: Zap,
  clothing: Shirt,
  family: Baby,
  pet: Dog,
  phone: Smartphone,
};

export const ENVELOPE_COLORS = [
  "#158454",
  "#2563eb",
  "#db2777",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#65a30d",
  "#64748b",
  "#ea580c",
];

export function EnvelopeIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ENVELOPE_ICONS[icon] ?? Wallet;
  return <Icon className={className} aria-hidden />;
}

export function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.keys(ENVELOPE_ICONS).map((key) => {
        const Icon = ENVELOPE_ICONS[key] ?? Wallet;
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={key}
            aria-pressed={selected}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
              selected
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ENVELOPE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={color}
          aria-pressed={value === color}
          className="h-7 w-7 rounded-full ring-offset-2 transition-shadow"
          style={{
            backgroundColor: color,
            boxShadow: value === color ? `0 0 0 2px white, 0 0 0 4px ${color}` : "none",
          }}
        />
      ))}
    </div>
  );
}
