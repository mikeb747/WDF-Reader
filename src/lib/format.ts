/**
 * Strip a trailing `.wdf` extension (case-insensitive) for clean UI display.
 */
export function stripWdfExtension(name: string): string {
  return name.replace(/\.wdf$/i, '');
}
