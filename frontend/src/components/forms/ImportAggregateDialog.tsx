"use client";

import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { simulationsApi, ApiError } from "@/lib/api";
import { previewCsv, type ParsedCsvPreview } from "@/lib/csv-locale";
import type { CreateSimulationInput } from "@/lib/types";
import { AlertTriangle, FileText, Info, Loader2, Upload } from "lucide-react";

/**
 * ImportAggregateDialog — top-level dialog for importing an aggregate from
 * a CSV or MATLAB .mat file.
 *
 * - CSV tab: client-side metadata + locale sniffer, preview of first 5 rows,
 *   optional override of decimal / delimiter before POSTing.
 * - MATLAB tab: accepts a single-agglomerate .mat v7 file.
 * - `.dat` files are rejected client-side with the spec R7 message before any
 *   backend call.
 * - 10 MB size cap enforced before reading the file.
 *
 * The POST payload extends the existing `imported` algorithm payload used by
 * SimulationForm. The backend accepts the existing `csv_data` key today; new
 * fields (`format`, `locale_override`, `original_filename`) are stamped into
 * `parameters` alongside it so the server can distinguish CSV vs MAT and pick
 * up user overrides without requiring an API shape change that's out of scope.
 */

// -----------------------------------------------------------------------------
// Types

type TabValue = "csv" | "mat";

type DecimalChoice = "." | ",";
type DelimiterChoice = "," | ";";

interface Props {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: (simulationId: string) => void;
}

// -----------------------------------------------------------------------------
// Helpers

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const DAT_REJECTION =
  "The .dat format from Box-Counter contains tessellated surface points, " +
  "not per-particle coordinates. To import an aggregate, use CSV (.csv) or " +
  "MATLAB (.mat) with per-particle (x, y, z, radius) data.";

/**
 * Read a file as text, trying UTF-8 strict first and falling back to
 * Latin-1 (ISO-8859-1) if the bytes are not valid UTF-8.
 *
 * The backend parser in `backend/apps/simulations/utils.py::parse_csv_geometry`
 * applies the same strategy (UTF-8-sig → Latin-1), so the preview the user
 * sees must match what the server will decode. `FileReader.readAsText()`
 * defaults to UTF-8 and silently emits U+FFFD replacement chars for any
 * invalid byte — that's what produced mojibake in the preview of
 * MATLAB `writematrix` Spanish exports (e.g. `Partícula` → `Part�cula`).
 */
async function readFileAsText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    // `fatal: true` → throw on any invalid byte instead of substituting U+FFFD.
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(buffer);
  } catch {
    // ISO-8859-1 decoder never fails — every byte maps to a codepoint.
    const decoder = new TextDecoder("iso-8859-1");
    return decoder.decode(buffer);
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const parts = result.split(",");
      resolve(parts[1] ?? "");
    };
    reader.onerror = () =>
      reject(new Error(reader.error?.message ?? "Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function formatKB(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// -----------------------------------------------------------------------------
// CSV tab

function CsvTab({
  projectId,
  onSuccess,
  onClose,
}: {
  projectId: string;
  onSuccess: (id: string) => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedCsvPreview | null>(null);
  const [decimalOverride, setDecimalOverride] = useState<DecimalChoice | null>(
    null,
  );
  const [delimiterOverride, setDelimiterOverride] =
    useState<DelimiterChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setDecimalOverride(null);
    setDelimiterOverride(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setPreview(null);
    setDecimalOverride(null);
    setDelimiterOverride(null);

    const picked = e.target.files?.[0] ?? null;
    if (!picked) {
      setFile(null);
      return;
    }

    const lower = picked.name.toLowerCase();
    if (lower.endsWith(".dat")) {
      setError(DAT_REJECTION);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!lower.endsWith(".csv")) {
      setError("Please select a .csv file.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (picked.size > MAX_SIZE_BYTES) {
      setError(`File is larger than 10 MB (got ${formatKB(picked.size)}).`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setFile(picked);
    try {
      const text = await readFileAsText(picked);
      setPreview(previewCsv(text));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
      setFile(null);
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      setError("Please select a CSV file to import.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const base64 = await readFileAsBase64(file);
      const effectiveDecimal = decimalOverride ?? preview?.locale.decimal ?? ".";
      const effectiveDelimiter =
        delimiterOverride ?? preview?.locale.delimiter ?? ",";

      const localeOverride =
        decimalOverride !== null || delimiterOverride !== null
          ? { decimal: effectiveDecimal, delimiter: effectiveDelimiter }
          : undefined;

      const payload = {
        algorithm: "imported" as const,
        parameters: {
          original_filename: file.name,
          format: "csv",
          ...(localeOverride ? { locale_override: localeOverride } : {}),
        },
        csv_data: base64,
      };

      const created = await simulationsApi.create(
        projectId,
        payload as unknown as CreateSimulationInput,
      );
      onSuccess(created.id);
      reset();
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="csv-file">CSV file</Label>
        <Input
          ref={fileInputRef}
          id="csv-file"
          type="file"
          accept=".csv,.dat"
          onChange={handleFileChange}
          aria-describedby="csv-file-error"
        />
        <p className="text-xs text-muted-foreground">
          Columns required: <code className="rounded bg-muted px-1">x, y, z, radius</code>.
          Optional <code className="rounded bg-muted px-1">#key=value</code>{" "}
          metadata lines above the header (e.g. <code>#unit=nm</code>).
          Max 10 MB.
        </p>
      </div>

      {file && (
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatKB(file.size)}
            </p>
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-3 rounded-lg border p-3 text-sm">
          {/* Metadata */}
          <div>
            <p className="mb-1 font-medium">Metadata</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {preview.metadata.unit && (
                <>
                  <dt className="text-muted-foreground">unit</dt>
                  <dd className="font-mono">{preview.metadata.unit}</dd>
                </>
              )}
              {preview.metadata.primary_particle_diameter_nm !== undefined && (
                <>
                  <dt className="text-muted-foreground">
                    primary_particle_diameter_nm
                  </dt>
                  <dd className="font-mono">
                    {preview.metadata.primary_particle_diameter_nm}
                  </dd>
                </>
              )}
              {preview.metadata.source && (
                <>
                  <dt className="text-muted-foreground">source</dt>
                  <dd className="font-mono">{preview.metadata.source}</dd>
                </>
              )}
              {preview.metadata.generated_at && (
                <>
                  <dt className="text-muted-foreground">generated_at</dt>
                  <dd className="font-mono">{preview.metadata.generated_at}</dd>
                </>
              )}
              {!preview.metadata.unit &&
                preview.metadata.primary_particle_diameter_nm === undefined &&
                !preview.metadata.source &&
                !preview.metadata.generated_at && (
                  <p className="col-span-2 text-xs text-muted-foreground">
                    No metadata lines detected (defaults will be applied).
                  </p>
                )}
            </dl>
          </div>

          {/* Locale */}
          <div>
            <p className="mb-1 font-medium">Detected locale</p>
            <p className="text-xs">
              Decimal: <code className="rounded bg-muted px-1">{decimalOverride ?? preview.locale.decimal}</code>{" "}
              / Delimiter:{" "}
              <code className="rounded bg-muted px-1">
                {delimiterOverride ?? preview.locale.delimiter}
              </code>
            </p>
            {preview.locale.warning && (
              <Alert
                variant="default"
                className="mt-2 border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30"
                data-testid="csv-locale-warning"
              >
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-xs">
                  We detected this format from a small sample. Override below
                  if incorrect.
                </AlertDescription>
              </Alert>
            )}

            {/* Override controls */}
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-xs font-medium">Decimal override</p>
                <div className="flex gap-2">
                  {(["" , ".", ","] as const).map((opt) => {
                    const checked =
                      (opt === "" && decimalOverride === null) ||
                      (opt !== "" && decimalOverride === opt);
                    return (
                      <label
                        key={`dec-${opt || "auto"}`}
                        className="flex items-center gap-1 text-xs"
                      >
                        <input
                          type="radio"
                          name="decimal-override"
                          value={opt}
                          checked={checked}
                          onChange={() =>
                            setDecimalOverride(
                              opt === "" ? null : (opt as DecimalChoice),
                            )
                          }
                        />
                        <span>
                          {opt === "" ? "Auto" : opt}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Delimiter override</p>
                <div className="flex gap-2">
                  {(["" , ",", ";"] as const).map((opt) => {
                    const checked =
                      (opt === "" && delimiterOverride === null) ||
                      (opt !== "" && delimiterOverride === opt);
                    return (
                      <label
                        key={`del-${opt || "auto"}`}
                        className="flex items-center gap-1 text-xs"
                      >
                        <input
                          type="radio"
                          name="delimiter-override"
                          value={opt}
                          checked={checked}
                          onChange={() =>
                            setDelimiterOverride(
                              opt === "" ? null : (opt as DelimiterChoice),
                            )
                          }
                        />
                        <span>
                          {opt === "" ? "Auto" : opt}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Preview table */}
          <div>
            <p className="mb-1 font-medium">
              Preview ({preview.rowCount} row
              {preview.rowCount === 1 ? "" : "s"})
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    {(preview.headerRow ?? []).map((h, idx) => (
                      <th
                        key={`h-${idx}`}
                        className="border px-2 py-1 text-left font-mono"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.firstDataRows.map((row, rIdx) => (
                    <tr key={`r-${rIdx}`}>
                      {row.map((cell, cIdx) => (
                        <td
                          key={`c-${rIdx}-${cIdx}`}
                          className="border px-2 py-1 font-mono"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" id="csv-file-error">
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!file || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Importing…
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Import CSV
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// MAT tab

function MatTab({
  projectId,
  onSuccess,
  onClose,
}: {
  projectId: string;
  onSuccess: (id: string) => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const picked = e.target.files?.[0] ?? null;
    if (!picked) {
      setFile(null);
      return;
    }
    const lower = picked.name.toLowerCase();
    if (lower.endsWith(".dat")) {
      setError(DAT_REJECTION);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!lower.endsWith(".mat")) {
      setError("Please select a .mat file.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (picked.size > MAX_SIZE_BYTES) {
      setError(`File is larger than 10 MB (got ${formatKB(picked.size)}).`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(picked);
  };

  const handleSubmit = async () => {
    if (!file) {
      setError("Please select a .mat file to import.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const base64 = await readFileAsBase64(file);
      const payload = {
        algorithm: "imported" as const,
        parameters: {
          original_filename: file.name,
          format: "mat",
        },
        // Reuse the existing `csv_data` field for the base64 payload; the
        // `format: "mat"` in parameters tells the backend to dispatch to the
        // MATLAB parser.
        csv_data: base64,
      };
      const created = await simulationsApi.create(
        projectId,
        payload as unknown as CreateSimulationInput,
      );
      onSuccess(created.id);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Alert variant="default" className="border-primary/30 bg-primary/5">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Upload a single-agglomerate <code>.mat</code> file (v7 or earlier).
          Multi-agglomerate files and v7.3 / HDF5 files are not supported in
          this release.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="mat-file">MATLAB file</Label>
        <Input
          ref={fileInputRef}
          id="mat-file"
          type="file"
          accept=".mat,.dat"
          onChange={handleFileChange}
          aria-describedby="mat-file-error"
        />
      </div>

      {file && (
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatKB(file.size)}
            </p>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" id="mat-file-error">
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!file || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Importing…
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Import .mat
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Root

export function ImportAggregateDialog({
  projectId,
  open,
  onClose,
  onSuccess,
}: Props) {
  const [tab, setTab] = useState<TabValue>("csv");

  // Reset tab state when dialog is re-opened (no leaked state across opens).
  useEffect(() => {
    if (open) setTab("csv");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import aggregate</DialogTitle>
          <DialogDescription>
            Import a pre-computed aggregate from a CSV or MATLAB file. The
            engine will compute metrics (Rg, porosity, box-counting Df) on
            import.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabValue)}
          defaultValue="csv"
        >
          <TabsList>
            <TabsTrigger value="csv">CSV</TabsTrigger>
            <TabsTrigger value="mat">MATLAB (.mat)</TabsTrigger>
          </TabsList>
          <TabsContent value="csv">
            <CsvTab
              projectId={projectId}
              onSuccess={onSuccess}
              onClose={onClose}
            />
          </TabsContent>
          <TabsContent value="mat">
            <MatTab
              projectId={projectId}
              onSuccess={onSuccess}
              onClose={onClose}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
