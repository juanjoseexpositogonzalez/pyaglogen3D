## Why

The canonical R4 states, without qualifying the algorithm, that the system MUST accept
`parameter_grid.seed_type`. The server now refuses it for every algorithm except `tunable_cc`, because
`run_simulation_task` reads `simulation.seed_type` in exactly one branch and no other engine call
declares the parameter. R10 still lists "Seed type (monomer/dimer/trimer)" as an option offered to
every algorithm but `limiting`.

Left as is, the record promises a payload the API rejects: an implementer reading R4 builds a client the
server refuses, and a reviewer cannot tell whether the refusal is the contract or a bug. This is #115
point 14, and it follows the two precedents of the same class - #97 added R11 for the sintering setting
and #141 added R13 for the two distribution grids, each with its delta.

## What Changes

- **R4** gains the algorithm scope and the refusal: the value is accepted only for `tunable_cc`, and any
  other algorithm answers 400 naming the surface that carried it.
- **R4.1** names the algorithm its GIVEN always meant; until now it passed only because the test's
  default algorithm is `tunable_cc`.
- **R4.4** is new: the refusal, its per-surface key, the no-row-written guarantee, and the escape R11.8
  established - a stored row can still be renamed, and changing the algorithm judges it.
- **R10** qualifies the seed-type dropdown bullet the way its three siblings already are.
