/** File types the ingestion pipeline reads, by extension. Images are stored and wait for OCR. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

/** null for files the pipeline can't read (old .doc, spreadsheets, audio, ...). */
export function mimeTypeFor(filename: string): string | null {
  return MIME_TYPES[extensionOf(filename)] ?? null;
}

/** Originals are stored once per organization and content hash, whatever the file was called. */
export function originalKey(orgId: string, sha256: string, filename: string): string {
  return `org/${orgId}/originals/${sha256}${extensionOf(filename)}`;
}
