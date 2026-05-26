import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Safely parse a data URI without using regex on the potentially huge base64 data portion.
 * This prevents RangeError: Maximum call stack size exceeded.
 */
export function parseDataUri(uri: string) {
  if (!uri || !uri.startsWith('data:')) return null
  const commaIndex = uri.indexOf(',')
  if (commaIndex === -1) return null
  const header = uri.substring(0, commaIndex) // e.g. "data:image/png;base64"
  if (!header.includes(';base64')) return null
  const mime = header.substring(5, header.indexOf(';')) // extract MIME after "data:"
  const base64Data = uri.substring(commaIndex + 1)
  return { mime, base64Data }
}
