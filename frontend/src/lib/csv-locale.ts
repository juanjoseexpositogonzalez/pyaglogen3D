/**
 * Client-side CSV locale detection + metadata extraction.
 *
 * Mirrors backend/apps/simulations/utils.py::parse_csv_geometry metadata/sniffer
 * logic so the frontend preview shows the same decimal/delimiter the backend
 * will use. Any divergence here is a contract bug.
 *
 * Backend parity rules (locked):
 *   - `#key=value` lines at the top of the file are stripped into a metadata
 *     dict. Malformed `#` lines (no `=` or empty key) are skipped silently.
 *   - After metadata is stripped, the first 5 data lines are sampled.
 *   - Delimiter: if any sample line contains `;` → `;`; else → `,`.
 *   - Decimal: scan numeric-looking tokens in the sample. If only `.` appears
 *     → `.`; if only `,` → `,`; otherwise default `.`.
 *   - If fewer than 5 sample rows are available, `warning = true`.
 */
// -----------------------------------------------------------------------------

export interface CsvMetadata {
  unit?: "nm" | "dimensionless";
  primary_particle_diameter_nm?: number;
  source?: string;
  generated_at?: string;
  /** Metadata keys the backend does not recognize — kept for display only. */
  _unknown_keys?: Record<string, string>;
}

export interface CsvLocale {
  decimal: "." | ",";
  delimiter: "," | ";";
  /** True when the sample has < 5 rows — UI should surface an override. */
  warning: boolean;
}

export interface ParsedCsvPreview {
  metadata: CsvMetadata;
  locale: CsvLocale;
  headerRow: string[] | null;
  /** Up to 5 rows, already split by the detected delimiter. */
  firstDataRows: string[][];
  /** Total data rows in the file (excluding header). Used for size info. */
  rowCount: number;
  /** Text after stripping metadata lines; includes header. */
  body: string;
}

// -----------------------------------------------------------------------------

const KNOWN_KEYS = new Set<keyof CsvMetadata>([
  "unit",
  "primary_particle_diameter_nm",
  "source",
  "generated_at",
]);

/**
 * Strip leading `#key=value` lines into a metadata dict; return the remaining
 * body. Scans line by line from the start and stops at the first line that
 * does not start with `#`.
 */
export function stripMetadataComments(text: string): {
  metadata: CsvMetadata;
  body: string;
} {
  const metadata: CsvMetadata = {};
  const unknown: Record<string, string> = {};
  // Use \n as line separator; keep CR for body output untouched so downstream
  // re-split is consistent.
  const lines = text.split(/\r?\n/);

  let cursor = 0;
  for (; cursor < lines.length; cursor++) {
    const raw = lines[cursor];
    const trimmed = raw.trim();
    if (!trimmed) {
      // Blank line before data: include it in body, stop metadata scan.
      break;
    }
    if (!trimmed.startsWith("#")) {
      break;
    }
    const inner = trimmed.slice(1).trim();
    const eq = inner.indexOf("=");
    if (eq <= 0) {
      // Malformed: no `=`, or `=` at position 0 (empty key). Skip silently.
      continue;
    }
    const key = inner.slice(0, eq).trim();
    const value = inner.slice(eq + 1).trim();
    if (!key) continue;

    if (key === "unit") {
      if (value === "nm" || value === "dimensionless") {
        metadata.unit = value;
      } else {
        unknown[key] = value;
      }
    } else if (key === "primary_particle_diameter_nm") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        metadata.primary_particle_diameter_nm = parsed;
      } else {
        unknown[key] = value;
      }
    } else if (key === "source") {
      metadata.source = value;
    } else if (key === "generated_at") {
      metadata.generated_at = value;
    } else if (!KNOWN_KEYS.has(key as keyof CsvMetadata)) {
      unknown[key] = value;
    }
  }

  if (Object.keys(unknown).length > 0) {
    metadata._unknown_keys = unknown;
  }

  const body = lines.slice(cursor).join("\n");
  return { metadata, body };
}

// -----------------------------------------------------------------------------

/** Pull the first N non-empty lines from body text. */
function sampleLines(bodyText: string, n: number): string[] {
  const out: string[] = [];
  const lines = bodyText.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "") continue;
    out.push(line);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Detect decimal and delimiter from a sample of the body (post-metadata).
 *
 * Sample size is the first 5 NON-EMPTY lines. Note the sample includes the
 * header row if present — it is safe to count `;` vs `,` in it because
 * headers follow the same delimiter as data.
 */
export function detectCsvLocale(bodyText: string): CsvLocale {
  const sample = sampleLines(bodyText, 5);

  // Delimiter: if any line contains `;` → `;`; else `,`.
  let delimiter: "," | ";" = ",";
  for (const line of sample) {
    if (line.includes(";")) {
      delimiter = ";";
      break;
    }
  }

  // Decimal: scan numeric-looking tokens across the sample.
  // A numeric-looking token is a cell that contains at least one digit and
  // nothing other than digits / `.` / `,` / `-` / `+` / whitespace.
  // We skip the first line (typically the header) if we have more than one
  // sampled line, otherwise we scan whatever we have.
  const dataLines = sample.length > 1 ? sample.slice(1) : sample;

  let dotSeen = 0;
  let commaSeen = 0;
  const numericCellRe = /^[\s+\-\d.,]+$/;

  for (const line of dataLines) {
    const cells = line.split(delimiter);
    for (const cellRaw of cells) {
      const cell = cellRaw.trim();
      if (!cell) continue;
      if (!/\d/.test(cell)) continue;
      if (!numericCellRe.test(cell)) continue;
      if (cell.includes(".")) dotSeen += (cell.match(/\./g) ?? []).length;
      if (cell.includes(",")) commaSeen += (cell.match(/,/g) ?? []).length;
    }
  }

  let decimal: "." | ",";
  if (dotSeen > 0 && commaSeen === 0) {
    decimal = ".";
  } else if (commaSeen > 0 && dotSeen === 0) {
    decimal = ",";
  } else {
    // Both or neither → default to "." (backend parity).
    decimal = ".";
  }

  const warning = sample.length < 5;
  return { decimal, delimiter, warning };
}

// -----------------------------------------------------------------------------

/**
 * Full preview pipeline used by the import dialog: strip metadata → detect
 * locale → split first 5 rows for display.
 *
 * Does NOT parse all rows — the backend is authoritative for full parsing.
 */
export function previewCsv(text: string): ParsedCsvPreview {
  const { metadata, body } = stripMetadataComments(text);
  const locale = detectCsvLocale(body);

  const allLines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  const headerLine = allLines.length > 0 ? allLines[0] : null;
  const dataLines = allLines.slice(1);

  const headerRow = headerLine ? headerLine.split(locale.delimiter) : null;
  const firstDataRows: string[][] = [];
  for (let i = 0; i < Math.min(5, dataLines.length); i++) {
    firstDataRows.push(dataLines[i].split(locale.delimiter));
  }

  return {
    metadata,
    locale,
    headerRow,
    firstDataRows,
    rowCount: dataLines.length,
    body,
  };
}
