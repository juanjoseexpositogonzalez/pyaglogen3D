//! Spatial data structures for efficient collision detection.

use std::collections::HashMap;

use super::geometry::{Sphere, Vector3};

/// Spatial hash grid for O(1) neighbor queries.
pub struct SpatialHash {
    cell_size: f64,
    cells: HashMap<(i32, i32, i32), Vec<usize>>,
}

impl SpatialHash {
    pub fn new(cell_size: f64) -> Self {
        Self {
            cell_size,
            cells: HashMap::new(),
        }
    }

    /// Get cell coordinates for a point.
    fn cell_coords(&self, point: &Vector3) -> (i32, i32, i32) {
        (
            (point.x / self.cell_size).floor() as i32,
            (point.y / self.cell_size).floor() as i32,
            (point.z / self.cell_size).floor() as i32,
        )
    }

    /// Insert a sphere into the hash.
    pub fn insert(&mut self, index: usize, sphere: &Sphere) {
        let (cx, cy, cz) = self.cell_coords(&sphere.center);
        self.cells.entry((cx, cy, cz)).or_default().push(index);
    }

    /// Remove a sphere from the hash.
    pub fn remove(&mut self, index: usize, sphere: &Sphere) {
        let (cx, cy, cz) = self.cell_coords(&sphere.center);
        if let Some(cell) = self.cells.get_mut(&(cx, cy, cz)) {
            cell.retain(|&i| i != index);
        }
    }

    /// Find all sphere indices that might collide with given sphere.
    pub fn query_potential_collisions(&self, sphere: &Sphere) -> Vec<usize> {
        let mut result = Vec::new();
        let (cx, cy, cz) = self.cell_coords(&sphere.center);

        // Check 3x3x3 neighborhood
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    let key = (cx + dx, cy + dy, cz + dz);
                    if let Some(indices) = self.cells.get(&key) {
                        result.extend(indices);
                    }
                }
            }
        }

        result
    }

    /// Clear all entries.
    pub fn clear(&mut self) {
        self.cells.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spatial_hash() {
        let mut hash = SpatialHash::new(2.0);

        let s1 = Sphere::new(Vector3::new(0.0, 0.0, 0.0), 1.0);
        let s2 = Sphere::new(Vector3::new(1.5, 0.0, 0.0), 1.0);
        let s3 = Sphere::new(Vector3::new(10.0, 0.0, 0.0), 1.0);

        hash.insert(0, &s1);
        hash.insert(1, &s2);
        hash.insert(2, &s3);

        // s1 should find s2 nearby but not s3
        let neighbors = hash.query_potential_collisions(&s1);
        assert!(neighbors.contains(&0));
        assert!(neighbors.contains(&1));
        assert!(!neighbors.contains(&2));
    }
}
