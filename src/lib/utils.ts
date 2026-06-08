import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { v4 as uuidv4 } from 'uuid';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Stable unique id for reorder lists / React keys (avoids duplicate weak random ids). */
export function uniqueRefItemId(prefix = 'ref'): string {
  return `${prefix}_${uuidv4()}`;
}
