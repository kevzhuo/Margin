import { isPdf } from "../backend";

/** Whether a drag carries files from outside the app (Finder, a browser, the desktop). */
export function carriesFiles(data: DataTransfer | null): boolean {
  return !!data && [...data.types].includes("Files");
}

/** The PDFs among dropped files. */
export function droppedPdfs(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((f) => isPdf(f.name) || f.type === "application/pdf");
}
