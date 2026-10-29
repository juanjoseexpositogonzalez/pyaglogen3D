import type { SimulationAlgorithm } from '@/lib/types'

export interface SimulationAlgorithmMetadata {
  value: SimulationAlgorithm
  label: string
  description: string
  supportsSingle: boolean
  supportsBatch: boolean
}

export const simulationAlgorithms: SimulationAlgorithmMetadata[] = [
  {
    value: 'dla',
    label: 'DLA (Diffusion-Limited Aggregation)',
    description: 'Diffusion-Limited Aggregation: Particles undergo random walks and stick upon contact. Produces fractal structures with Df ~ 2.4-2.6.',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'cca',
    label: 'CCA (Brownian Cluster-Cluster)',
    description: 'Brownian CCA: Clusters move via Brownian motion and merge on collision. Produces open structures with Df ~ 1.8-2.0.',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'ballistic',
    label: 'Ballistic PC (Particle-Cluster)',
    description: 'Ballistic PC: Particles travel in straight lines towards a growing cluster. Produces denser structures with Df ~ 2.8-3.0.',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'ballistic_cc',
    label: 'Ballistic CC (Cluster-Cluster)',
    description: 'Ballistic CC: Clusters travel in straight lines and merge on collision. Produces branched structures with Df ~ 1.8-2.2 (thesis section 6.2).',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'tunable',
    label: 'Tunable PC (Filippov method)',
    description: 'Tunable PC (Filippov method): Generate aggregates with target fractal dimension and prefactor. Based on N = kf × (Rg/rp)^Df power law.',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'tunable_cc',
    label: 'Tunable CC (Cluster-Cluster)',
    description: 'Tunable CC (Cluster-Cluster): Similar to Tunable PC but merges clusters instead of single particles. Produces more realistic aggregates with controlled Df and kf.',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'fracval',
    label: 'FracVAL (Polydisperse CC)',
    description: 'FracVAL (Morán et al. 2019): Polydisperse cluster-cluster aggregation with lognormal size distribution. Adaptive pairing strategy ensures Df and kf control for each aggregate.',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'gcca',
    label: 'Generalized CCA (Tomchuk)',
    description: 'Generalized CCA (Tomchuk & Avdeev 2020): Unified cluster-cluster framework with configurable split strategies. Symmetric recovers Filippov, particle-cluster recovers DLCA-like growth.',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'box_rfa',
    label: 'Box-Counting RFA (Brown et al.)',
    description: 'Box-Counting RFA (Brown et al. 2010): Grid-based fractal construction using box-counting measure directly. Creates aggregates with exact target Df through recursive grid refinement.',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'limiting',
    label: 'Limiting Case Geometry (Reference)',
    description: 'Reference Geometry: Deterministic canonical structures for calibration. Choose between linear chain (Df=1), hexagonal plane (Df=2), or compact sphere (Df=3).',
    supportsSingle: true,
    supportsBatch: true,
  },
  {
    value: 'imported',
    label: 'Import from CSV File (advanced — prefer "Import Aggregate" button)',
    description: 'Import from CSV: Load existing agglomerate geometry from a CSV file. File must contain columns: x, y, z, radius (one particle per row). Metrics will be computed automatically. For most users, the top-level "Import Aggregate" button on the project page is the recommended flow — it supports MATLAB .mat files and locale auto-detection.',
    supportsSingle: true,
    supportsBatch: false,
  },
]

export const singleSimulationAlgorithmOptions = simulationAlgorithms
  .filter((algorithm) => algorithm.supportsSingle)
  .map(({ value, label }) => ({ value, label }))

export const batchSimulationAlgorithmOptions = simulationAlgorithms
  .filter((algorithm) => algorithm.supportsBatch)
  .map(({ value, label }) => ({ value, label }))

export const simulationAlgorithmDescriptions: Record<SimulationAlgorithm, string> = Object.fromEntries(
  simulationAlgorithms.map(({ value, description }) => [value, description])
) as Record<SimulationAlgorithm, string>

export const simulationAlgorithmLabels: Record<SimulationAlgorithm, string> = Object.fromEntries(
  simulationAlgorithms.map(({ value, label }) => [value, label])
) as Record<SimulationAlgorithm, string>

export function getSimulationAlgorithmLabel(algorithm: SimulationAlgorithm): string {
  return simulationAlgorithmLabels[algorithm]
}
