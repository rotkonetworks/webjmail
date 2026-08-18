import clsx, { type ClassValue } from 'clsx'

// Single import point for conditional class composition (penumbra-web style).
// Swap in tailwind-merge here later if class conflicts become an issue.
export const cn = (...inputs: ClassValue[]): string => clsx(inputs)
