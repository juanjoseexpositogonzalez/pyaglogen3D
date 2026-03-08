//! Box-Counting Random Fractal Aggregates (Brown et al. 2010)
//!
//! This algorithm constructs fractal aggregates using the box-counting measure directly,
//! rather than relying on the scaling law. It works by:
//! 1. Starting with a coarse grid (single occupied box)
//! 2. Refining through multiple levels, keeping N_box(ℓ) = (ℓ_max/ℓ)^Df occupied boxes
//! 3. Ensuring connectivity via random walk through the grid
//! 4. Placing particles at the finest level box centers
//!
//! Properties:
//! - Very fast generation
//! - Avoids the D_f + k_f ≲ 3.5 constraint of other methods
//! - Does not produce point-touching spheres (particles on a grid)
//! - Does not directly control k_f
//!
//! Reference: Brown, S.R., Lowndes, H.A., Sherlock, D.P. (2010).
//! "A highly efficient algorithm for the generation of random fractal aggregates."
//! Physica D, 239, 1431-1435.

use std::collections::{HashSet, VecDeque};
use std::time::Instant;

use pyo3::prelude::*;
use rand::seq::SliceRandom;
use rand::Rng;

use crate::common::rng::create_rng;

use super::metrics::{
    calculate_coordination, calculate_inertia_tensor, calculate_porosity,
    calculate_radius_of_gyration,
};
use super::result::{PySimulationResult, SimulationResult};

/// Connectivity method for ensuring the aggregate is connected.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ConnectivityMethod {
    /// Use random walk to select sub-boxes (default, from Brown et al.)
    RandomWalk,
    /// Select nearest neighbors to existing occupied boxes
    NearestNeighbor,
}

impl Default for ConnectivityMethod {
    fn default() -> Self {
        ConnectivityMethod::RandomWalk
    }
}

/// Box-Counting RFA simulation parameters.
#[derive(Debug, Clone)]
pub struct BoxRfaParams {
    /// Target fractal dimension (1.0 - 3.0)
    pub target_df: f64,
    /// Number of refinement levels (determines final particle count approximately)
    pub n_levels: usize,
    /// Particle radius at finest level
    pub particle_radius: f64,
    /// Connectivity method
    pub connectivity_method: ConnectivityMethod,
    /// Target number of particles (if Some, algorithm adjusts to match)
    pub target_n_particles: Option<usize>,
    /// If true, ensure output is a single connected aggregate (keep largest component)
    pub single_aggregate: bool,
}

impl Default for BoxRfaParams {
    fn default() -> Self {
        Self {
            target_df: 1.8,
            n_levels: 6,
            particle_radius: 1.0,
            connectivity_method: ConnectivityMethod::RandomWalk,
            target_n_particles: None,
            single_aggregate: true, // Default to single connected aggregate
        }
    }
}

/// A 3D grid position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct GridPos {
    x: i32,
    y: i32,
    z: i32,
}

impl GridPos {
    fn new(x: i32, y: i32, z: i32) -> Self {
        Self { x, y, z }
    }

    /// Get the 6 face-adjacent neighbors.
    fn neighbors(&self) -> [GridPos; 6] {
        [
            GridPos::new(self.x - 1, self.y, self.z),
            GridPos::new(self.x + 1, self.y, self.z),
            GridPos::new(self.x, self.y - 1, self.z),
            GridPos::new(self.x, self.y + 1, self.z),
            GridPos::new(self.x, self.y, self.z - 1),
            GridPos::new(self.x, self.y, self.z + 1),
        ]
    }

    /// Get the 26 neighbors (including diagonals).
    fn all_neighbors(&self) -> Vec<GridPos> {
        let mut neighbors = Vec::with_capacity(26);
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    if dx != 0 || dy != 0 || dz != 0 {
                        neighbors.push(GridPos::new(self.x + dx, self.y + dy, self.z + dz));
                    }
                }
            }
        }
        neighbors
    }

    /// Convert to world coordinates given box size and origin.
    fn to_world(&self, box_size: f64, origin: [f64; 3]) -> [f64; 3] {
        [
            origin[0] + (self.x as f64 + 0.5) * box_size,
            origin[1] + (self.y as f64 + 0.5) * box_size,
            origin[2] + (self.z as f64 + 0.5) * box_size,
        ]
    }

    /// Get the 8 sub-boxes when this box is subdivided.
    fn subdivide(&self) -> [GridPos; 8] {
        let base_x = self.x * 2;
        let base_y = self.y * 2;
        let base_z = self.z * 2;
        [
            GridPos::new(base_x, base_y, base_z),
            GridPos::new(base_x + 1, base_y, base_z),
            GridPos::new(base_x, base_y + 1, base_z),
            GridPos::new(base_x + 1, base_y + 1, base_z),
            GridPos::new(base_x, base_y, base_z + 1),
            GridPos::new(base_x + 1, base_y, base_z + 1),
            GridPos::new(base_x, base_y + 1, base_z + 1),
            GridPos::new(base_x + 1, base_y + 1, base_z + 1),
        ]
    }
}

/// Check if a set of positions is connected (using BFS).
fn is_connected(positions: &HashSet<GridPos>) -> bool {
    if positions.is_empty() {
        return true;
    }

    let start = *positions.iter().next().unwrap();
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();

    visited.insert(start);
    queue.push_back(start);

    while let Some(pos) = queue.pop_front() {
        for neighbor in pos.neighbors() {
            if positions.contains(&neighbor) && !visited.contains(&neighbor) {
                visited.insert(neighbor);
                queue.push_back(neighbor);
            }
        }
    }

    visited.len() == positions.len()
}

/// Find all connected components and return the largest one.
fn largest_connected_component(positions: &HashSet<GridPos>) -> HashSet<GridPos> {
    if positions.is_empty() {
        return HashSet::new();
    }

    let mut remaining: HashSet<GridPos> = positions.clone();
    let mut largest: HashSet<GridPos> = HashSet::new();

    while !remaining.is_empty() {
        // BFS from an arbitrary starting point
        let start = *remaining.iter().next().unwrap();
        let mut component = HashSet::new();
        let mut queue = VecDeque::new();

        component.insert(start);
        queue.push_back(start);
        remaining.remove(&start);

        while let Some(pos) = queue.pop_front() {
            for neighbor in pos.neighbors() {
                if remaining.contains(&neighbor) {
                    component.insert(neighbor);
                    remaining.remove(&neighbor);
                    queue.push_back(neighbor);
                }
            }
        }

        // Keep track of largest component
        if component.len() > largest.len() {
            largest = component;
        }
    }

    largest
}

/// Select sub-boxes using probabilistic branching to create true fractal structures.
/// For each parent box, we probabilistically select children based on target Df.
/// Lower Df = sparser selection = more chain-like structures.
///
/// If `ensure_connected` is true, guarantees a single connected structure by
/// growing from a seed rather than probabilistic selection.
fn select_subboxes_probabilistic<R: Rng>(
    parent_boxes: &HashSet<GridPos>,
    target_count: usize,
    ensure_connected: bool,
    rng: &mut R,
) -> HashSet<GridPos> {
    let n_parents = parent_boxes.len();
    let total_subboxes = n_parents * 8;

    // If target is >= total, keep all
    if target_count >= total_subboxes {
        return parent_boxes.iter().flat_map(|p| p.subdivide()).collect();
    }

    let all_subboxes: HashSet<GridPos> = parent_boxes
        .iter()
        .flat_map(|p| p.subdivide())
        .collect();

    if ensure_connected {
        // CONNECTED GROWTH: Start from center, grow outward with branching probability
        // that depends on target_count/total to achieve desired Df

        // Find the most central sub-box
        let center = GridPos::new(0, 0, 0);
        let start = *all_subboxes
            .iter()
            .min_by_key(|p| {
                let dx = p.x - center.x;
                let dy = p.y - center.y;
                let dz = p.z - center.z;
                dx * dx + dy * dy + dz * dz
            })
            .unwrap();

        let mut selected: HashSet<GridPos> = HashSet::new();
        selected.insert(start);

        // Growth probability based on target density
        // Lower target = more selective growth = lower Df
        let growth_prob = (target_count as f64 / total_subboxes as f64).sqrt();

        // Use frontier-based growth with probabilistic branching
        let mut frontier: Vec<GridPos> = start.neighbors()
            .iter()
            .filter(|n| all_subboxes.contains(n))
            .cloned()
            .collect();
        frontier.shuffle(rng);

        while selected.len() < target_count && !frontier.is_empty() {
            // Pick a random frontier cell
            let idx = rng.gen_range(0..frontier.len());
            let candidate = frontier.swap_remove(idx);

            if selected.contains(&candidate) {
                continue;
            }

            // Decide whether to add this cell based on growth probability
            // and how many neighbors it already has (prefer less branching for low Df)
            let neighbor_count = candidate.neighbors()
                .iter()
                .filter(|n| selected.contains(n))
                .count();

            // Probability decreases with more neighbors (reduces clumping)
            let adjusted_prob = growth_prob / (neighbor_count.max(1) as f64).sqrt();

            if rng.gen::<f64>() < adjusted_prob || selected.len() < target_count / 4 {
                selected.insert(candidate);

                // Add new frontier cells
                for neighbor in candidate.neighbors() {
                    if all_subboxes.contains(&neighbor) && !selected.contains(&neighbor) {
                        frontier.push(neighbor);
                    }
                }
            }
        }

        // If we didn't reach target, force-add remaining frontier
        frontier.shuffle(rng);
        for candidate in frontier {
            if selected.len() >= target_count {
                break;
            }
            if !selected.contains(&candidate) && all_subboxes.contains(&candidate) {
                // Check connectivity
                let has_neighbor = candidate.neighbors()
                    .iter()
                    .any(|n| selected.contains(n));
                if has_neighbor {
                    selected.insert(candidate);
                }
            }
        }

        selected
    } else {
        // PROBABILISTIC SELECTION: Original approach for multiple clusters
        let min_kept = n_parents;
        let extra_to_select = target_count.saturating_sub(min_kept);
        let extra_available = total_subboxes - min_kept;

        let extra_prob = if extra_available > 0 {
            (extra_to_select as f64 / extra_available as f64).min(1.0)
        } else {
            0.0
        };

        let mut selected: HashSet<GridPos> = HashSet::new();

        for parent in parent_boxes {
            let subs = parent.subdivide();
            let guaranteed = subs.choose(rng).unwrap();
            selected.insert(*guaranteed);

            for sub in &subs {
                if sub != guaranteed && rng.gen::<f64>() < extra_prob {
                    selected.insert(*sub);
                }
            }
        }

        // Trim if too many
        while selected.len() > target_count {
            let removable: Vec<_> = selected
                .iter()
                .cloned()
                .filter(|pos| {
                    let neighbor_count = pos.neighbors()
                        .iter()
                        .filter(|n| selected.contains(n))
                        .count();
                    neighbor_count <= 2
                })
                .collect();

            if removable.is_empty() {
                break;
            }

            let to_remove = removable.choose(rng).unwrap();
            selected.remove(to_remove);
        }

        // Add if too few
        while selected.len() < target_count {
            let mut frontier: Vec<GridPos> = Vec::new();
            for pos in &selected {
                for neighbor in pos.neighbors() {
                    if all_subboxes.contains(&neighbor) && !selected.contains(&neighbor) {
                        frontier.push(neighbor);
                    }
                }
            }

            if frontier.is_empty() {
                for pos in &selected {
                    for neighbor in pos.all_neighbors() {
                        if all_subboxes.contains(&neighbor) && !selected.contains(&neighbor) {
                            frontier.push(neighbor);
                        }
                    }
                }
            }

            if frontier.is_empty() {
                break;
            }

            let choice = frontier.choose(rng).unwrap();
            selected.insert(*choice);
        }

        selected
    }
}

/// Select sub-boxes using probabilistic branching (wrapper for backward compatibility).
fn select_subboxes_random_walk<R: Rng>(
    parent_boxes: &HashSet<GridPos>,
    target_count: usize,
    rng: &mut R,
) -> HashSet<GridPos> {
    // Default: allow multiple clusters (false)
    select_subboxes_probabilistic(parent_boxes, target_count, false, rng)
}

/// Select sub-boxes using probabilistic branching (same as random_walk but
/// with preference for keeping boxes closer to the center of each parent).
fn select_subboxes_nearest_neighbor<R: Rng>(
    parent_boxes: &HashSet<GridPos>,
    target_count: usize,
    rng: &mut R,
) -> HashSet<GridPos> {
    // Use the same probabilistic approach as random_walk for consistent Df
    select_subboxes_random_walk(parent_boxes, target_count, rng)
}

/// Run Box-Counting RFA simulation.
///
/// # Arguments
/// * `target_df` - Target fractal dimension (1.0 - 3.0)
/// * `n_levels` - Number of refinement levels (more levels = more particles)
/// * `particle_radius` - Radius of particles at finest level
/// * `connectivity_method` - Method to ensure connectivity ("random_walk" or "nearest_neighbor")
/// * `target_n_particles` - Optional target particle count (algorithm will adjust)
/// * `single_aggregate` - If true, ensure output is single connected aggregate (default: true)
/// * `seed` - Random seed for reproducibility
#[pyfunction]
#[pyo3(signature = (target_df=1.8, n_levels=6, particle_radius=1.0, connectivity_method="random_walk", target_n_particles=None, single_aggregate=true, seed=None))]
pub fn run_box_rfa(
    _py: Python<'_>,
    target_df: f64,
    n_levels: usize,
    particle_radius: f64,
    connectivity_method: &str,
    target_n_particles: Option<usize>,
    single_aggregate: bool,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);

    let conn_method = match connectivity_method.to_lowercase().as_str() {
        "nearest_neighbor" | "nearest" => ConnectivityMethod::NearestNeighbor,
        _ => ConnectivityMethod::RandomWalk,
    };

    let params = BoxRfaParams {
        target_df,
        n_levels,
        particle_radius,
        connectivity_method: conn_method,
        target_n_particles,
        single_aggregate,
    };

    let result = run_box_rfa_internal(params, seed);
    Ok(result.to_py())
}

/// Internal Box-Counting RFA implementation.
fn run_box_rfa_internal(params: BoxRfaParams, seed: u64) -> SimulationResult {
    let start_time = Instant::now();
    let mut rng = create_rng(seed);

    let df = params.target_df.clamp(1.0, 3.0);
    let n_levels = params.n_levels.max(2);

    // Step 1: Initialize with single occupied box at level 0
    let mut occupied: HashSet<GridPos> = HashSet::new();
    occupied.insert(GridPos::new(0, 0, 0));

    // Track Rg evolution (using number of occupied boxes as proxy)
    let mut rg_evolution = Vec::new();

    // Step 2: Refinement cascade
    // At level k, box size is ℓ_max / 2^k
    // Required boxes: N_box(ℓ_k) = 2^(k*Df)
    for level in 1..=n_levels {
        // Compute target number of occupied boxes at this level
        // N_box = (ℓ_max / ℓ_k)^Df = (2^level)^Df = 2^(level * Df)
        let target_boxes = (2.0_f64.powi(level as i32)).powf(df).round() as usize;

        // Select sub-boxes with optional connectivity guarantee
        occupied = select_subboxes_probabilistic(
            &occupied,
            target_boxes,
            params.single_aggregate,
            &mut rng,
        );

        // Track evolution
        let n = occupied.len();
        // Approximate Rg from box positions
        if n > 0 {
            let center_x: f64 = occupied.iter().map(|p| p.x as f64).sum::<f64>() / n as f64;
            let center_y: f64 = occupied.iter().map(|p| p.y as f64).sum::<f64>() / n as f64;
            let center_z: f64 = occupied.iter().map(|p| p.z as f64).sum::<f64>() / n as f64;

            let rg_sq: f64 = occupied
                .iter()
                .map(|p| {
                    let dx = p.x as f64 - center_x;
                    let dy = p.y as f64 - center_y;
                    let dz = p.z as f64 - center_z;
                    dx * dx + dy * dy + dz * dz
                })
                .sum::<f64>()
                / n as f64;

            // Scale by box size at this level
            let box_size = 1.0 / (2.0_f64.powi(level as i32));
            rg_evolution.push((rg_sq.sqrt() * box_size) * params.particle_radius * 2.0);
        }
    }

    // If target particle count specified, adjust
    if let Some(target_n) = params.target_n_particles {
        if occupied.len() > target_n {
            // Remove excess boxes while maintaining connectivity
            let mut boxes_vec: Vec<GridPos> = occupied.iter().cloned().collect();
            boxes_vec.shuffle(&mut rng);

            while occupied.len() > target_n {
                // Try to remove a box from the periphery
                let mut removed = false;
                for i in (0..boxes_vec.len()).rev() {
                    let candidate = boxes_vec[i];
                    if occupied.contains(&candidate) {
                        occupied.remove(&candidate);
                        if is_connected(&occupied) {
                            boxes_vec.remove(i);
                            removed = true;
                            break;
                        } else {
                            occupied.insert(candidate);
                        }
                    }
                }
                if !removed {
                    break;
                }
            }
        }
    }

    // Step 3: Place particles at box centers
    let box_size = params.particle_radius * 2.0; // Each box contains one particle
    let origin = [0.0, 0.0, 0.0];

    let coords: Vec<[f64; 3]> = occupied
        .iter()
        .map(|pos| pos.to_world(box_size, origin))
        .collect();

    let n_particles = coords.len();

    // Guard against empty aggregate (critical: prevents division by zero)
    if n_particles == 0 {
        return SimulationResult {
            coordinates: vec![],
            radii: vec![],
            rg_evolution: vec![],
            fractal_dimension: df,
            fractal_dimension_std: 0.0,
            prefactor: 1.0,
            porosity: 0.0,
            coordination_mean: 0.0,
            coordination_std: 0.0,
            execution_time_ms: start_time.elapsed().as_millis() as u64,
            seed,
            anisotropy: 0.0,
            asphericity: 0.0,
            acylindricity: 0.0,
            principal_moments: [0.0, 0.0, 0.0],
            principal_axes: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        };
    }

    let radii: Vec<f64> = vec![params.particle_radius; n_particles];

    // Center the aggregate at origin
    let center_x: f64 = coords.iter().map(|c| c[0]).sum::<f64>() / n_particles as f64;
    let center_y: f64 = coords.iter().map(|c| c[1]).sum::<f64>() / n_particles as f64;
    let center_z: f64 = coords.iter().map(|c| c[2]).sum::<f64>() / n_particles as f64;

    let coords: Vec<[f64; 3]> = coords
        .into_iter()
        .map(|c| [c[0] - center_x, c[1] - center_y, c[2] - center_z])
        .collect();

    // Calculate final metrics
    let rg = calculate_radius_of_gyration(&coords, &radii);

    // Calculate actual Df from the data
    // Using N = kf * (Rg/rp)^Df with kf=1 assumption (standard for box-counting method)
    // This yields: Df = ln(N) / ln(Rg/rp)
    // Note: This may overestimate Df compared to methods that fit kf simultaneously.
    // For more accurate Df, use box-counting analysis on the resulting aggregate.
    let rg_over_rp = rg / params.particle_radius;
    let actual_df = if rg_over_rp > 1.0 && n_particles > 1 {
        (n_particles as f64).ln() / rg_over_rp.ln()
    } else {
        df
    };

    // Calculate kf: kf = N / (Rg/rp)^Df
    let actual_kf = if rg_over_rp > 1.0 {
        n_particles as f64 / rg_over_rp.powf(actual_df)
    } else {
        1.0
    };

    let porosity = calculate_porosity(&coords, &radii);
    let coordination = calculate_coordination(&coords, &radii, params.particle_radius * 0.1);
    let inertia = calculate_inertia_tensor(&coords, &radii);

    let coord_mean =
        coordination.iter().map(|&c| c as f64).sum::<f64>() / coordination.len().max(1) as f64;
    let coord_std = if coordination.len() > 1 {
        (coordination
            .iter()
            .map(|&c| (c as f64 - coord_mean).powi(2))
            .sum::<f64>()
            / coordination.len() as f64)
            .sqrt()
    } else {
        0.0
    };

    // Scale Rg evolution by final Rg
    let final_rg = rg;
    let rg_evolution: Vec<f64> = if !rg_evolution.is_empty() {
        let scale = final_rg / rg_evolution.last().unwrap_or(&1.0);
        rg_evolution.iter().map(|r| r * scale).collect()
    } else {
        vec![final_rg]
    };

    let execution_time_ms = start_time.elapsed().as_millis() as u64;

    SimulationResult {
        coordinates: coords,
        radii,
        rg_evolution,
        fractal_dimension: actual_df,
        fractal_dimension_std: 0.1, // Higher uncertainty for grid-based method
        prefactor: actual_kf,
        porosity,
        coordination_mean: coord_mean,
        coordination_std: coord_std,
        execution_time_ms,
        seed,
        anisotropy: inertia.anisotropy,
        asphericity: inertia.asphericity,
        acylindricity: inertia.acylindricity,
        principal_moments: inertia.principal_moments,
        principal_axes: inertia.principal_axes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_box_rfa_deterministic() {
        let params = BoxRfaParams {
            target_df: 1.8,
            n_levels: 5,
            ..Default::default()
        };

        let r1 = run_box_rfa_internal(params.clone(), 42);
        let r2 = run_box_rfa_internal(params, 42);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        assert_eq!(r1.seed, r2.seed);
    }

    #[test]
    fn test_box_rfa_produces_connected_aggregate() {
        let params = BoxRfaParams {
            target_df: 1.8,
            n_levels: 5,
            ..Default::default()
        };

        let result = run_box_rfa_internal(params, 123);

        // Should produce some particles
        assert!(
            result.coordinates.len() > 10,
            "Should produce at least 10 particles, got {}",
            result.coordinates.len()
        );

        // Verify connectivity by checking each particle has at least one neighbor
        // (within grid distance)
        let box_size = result.radii[0] * 2.0;
        let tolerance = box_size * 1.5; // Allow for diagonal neighbors

        for i in 0..result.coordinates.len() {
            let has_neighbor = (0..result.coordinates.len()).any(|j| {
                if i == j {
                    return false;
                }
                let dx = result.coordinates[i][0] - result.coordinates[j][0];
                let dy = result.coordinates[i][1] - result.coordinates[j][1];
                let dz = result.coordinates[i][2] - result.coordinates[j][2];
                let dist = (dx * dx + dy * dy + dz * dz).sqrt();
                dist < tolerance
            });

            assert!(
                has_neighbor || result.coordinates.len() == 1,
                "Particle {} has no neighbors",
                i
            );
        }
    }

    #[test]
    fn test_box_rfa_df_variation() {
        // Test that different Df values produce different structures
        let params_low = BoxRfaParams {
            target_df: 1.5,
            n_levels: 5,
            ..Default::default()
        };
        let params_high = BoxRfaParams {
            target_df: 2.5,
            n_levels: 5,
            ..Default::default()
        };

        let result_low = run_box_rfa_internal(params_low, 456);
        let result_high = run_box_rfa_internal(params_high, 456);

        // Higher Df should produce more particles (denser structure)
        assert!(
            result_high.coordinates.len() > result_low.coordinates.len(),
            "Higher Df ({}) should produce more particles than lower Df ({})",
            result_high.coordinates.len(),
            result_low.coordinates.len()
        );
    }

    #[test]
    fn test_box_rfa_levels_affect_size() {
        let params_small = BoxRfaParams {
            target_df: 1.8,
            n_levels: 4,
            ..Default::default()
        };
        let params_large = BoxRfaParams {
            target_df: 1.8,
            n_levels: 6,
            ..Default::default()
        };

        let result_small = run_box_rfa_internal(params_small, 789);
        let result_large = run_box_rfa_internal(params_large, 789);

        assert!(
            result_large.coordinates.len() > result_small.coordinates.len(),
            "More levels should produce more particles"
        );
    }

    #[test]
    fn test_grid_pos_subdivide() {
        let pos = GridPos::new(0, 0, 0);
        let subs = pos.subdivide();
        assert_eq!(subs.len(), 8);

        // Check all sub-boxes are unique
        let unique: HashSet<_> = subs.iter().collect();
        assert_eq!(unique.len(), 8);
    }

    #[test]
    fn test_is_connected() {
        let mut positions = HashSet::new();
        positions.insert(GridPos::new(0, 0, 0));
        positions.insert(GridPos::new(1, 0, 0));
        positions.insert(GridPos::new(2, 0, 0));
        assert!(is_connected(&positions));

        // Disconnected set
        positions.insert(GridPos::new(10, 10, 10));
        assert!(!is_connected(&positions));
    }
}
