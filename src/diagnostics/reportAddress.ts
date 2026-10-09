export const REPORT_ONLY_PARAMETER = "report";
export const wantsReportOnly = (search: string): boolean => new URLSearchParams(search).has(REPORT_ONLY_PARAMETER);
export function addressWithoutReport(href: string): string {
  const url = new URL(href); url.searchParams.delete(REPORT_ONLY_PARAMETER); return url.href;
}
