# Delta Spec: fraktal-batch-extensions → capability fraktal-batch-persistence

> r2 BLOCKER-2: la migración nullable `pixels_per_100nm` muta la capability persistence — el
> canonical R2 enumera los campos de fila exhaustivamente (`fraktal-batch-persistence.md:33-38`),
> así que el archive sin este bloque dejaría la spec canónica contradiciendo el código (lección
> Cycle 2 AGENTS.md: sync canónico explícito). Estilo del bloque espeja R-DELTA-F/H/I/K (aditivo
> nullable, sin backfill, reversible).

## MODIFIED Requirements

### Requirement: R2. FraktalBatchImage rows store per-image data + PNG bytes

Each row MUST additionally contain:

- `pixels_per_100nm: FloatField, null=True, blank=True` —

**AND** the field is populated at analysis time from `directions[i].pixels_per_100nm` when the
corresponding ZIP `directions[]` entry carries it, and from the batch-level broadcast value
when it does not (same two sources as the calibration semantics of `fraktal-batch-contract.md` R1),
**AND** existing rows written before this migration have `pixels_per_100nm = NULL` and MUST
remain fully accessible without error (additive nullable field, no backfill, reversible migration),
**AND** the bulk re-analysis of R13 (capability `fraktal-batch-contract`, this change) uses the
persisted per-image value when present and falls back to the batch scale when NULL, recording the
batch-level `calibration_source` unchanged (per-image provenance is observable through this field
only).

#### Scenario P.1 — Additive and reversible

- **GIVEN** rows written before the migration
- **WHEN** the migration runs and the batch is served
- **THEN** all rows are accessible with `pixels_per_100nm = NULL` and no behavior change
- **AND** new analyses populate the field per the two-source rule; the migration is reversible
  (removes only the new column)
