//! Geometric primitives for 3D operations.

use std::ops::{Add, Mul, Sub};

/// 3D vector with basic operations.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vector3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vector3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn zero() -> Self {
        Self::new(0.0, 0.0, 0.0)
    }

    pub fn length(&self) -> f64 {
        self.length_squared().sqrt()
    }

    pub fn length_squared(&self) -> f64 {
        self.x * self.x + self.y * self.y + self.z * self.z
    }

    pub fn normalize(&self) -> Self {
        let len = self.length();
        if len > 0.0 {
            Self::new(self.x / len, self.y / len, self.z / len)
        } else {
            Self::zero()
        }
    }

    pub fn dot(&self, other: &Self) -> f64 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    pub fn distance_to(&self, other: &Self) -> f64 {
        (*self - *other).length()
    }
}

impl Add for Vector3 {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self::new(self.x + other.x, self.y + other.y, self.z + other.z)
    }
}

impl Sub for Vector3 {
    type Output = Self;

    fn sub(self, other: Self) -> Self {
        Self::new(self.x - other.x, self.y - other.y, self.z - other.z)
    }
}

impl Mul<f64> for Vector3 {
    type Output = Self;

    fn mul(self, scalar: f64) -> Self {
        Self::new(self.x * scalar, self.y * scalar, self.z * scalar)
    }
}

/// Sphere representation.
#[derive(Debug, Clone, Copy)]
pub struct Sphere {
    pub center: Vector3,
    pub radius: f64,
}

impl Sphere {
    pub fn new(center: Vector3, radius: f64) -> Self {
        Self { center, radius }
    }

    /// Check if this sphere intersects with another.
    pub fn intersects(&self, other: &Sphere) -> bool {
        let dist = self.center.distance_to(&other.center);
        dist < self.radius + other.radius
    }

    /// Check if this sphere touches another (within tolerance).
    pub fn touches(&self, other: &Sphere, tolerance: f64) -> bool {
        let dist = self.center.distance_to(&other.center);
        let contact_dist = self.radius + other.radius;
        (dist - contact_dist).abs() <= tolerance
    }
}

/// Axis-aligned bounding box.
#[derive(Debug, Clone, Copy)]
pub struct AABB {
    pub min: Vector3,
    pub max: Vector3,
}

impl AABB {
    pub fn new(min: Vector3, max: Vector3) -> Self {
        Self { min, max }
    }

    pub fn from_spheres(spheres: &[Sphere]) -> Self {
        if spheres.is_empty() {
            return Self::new(Vector3::zero(), Vector3::zero());
        }

        let mut min = Vector3::new(f64::MAX, f64::MAX, f64::MAX);
        let mut max = Vector3::new(f64::MIN, f64::MIN, f64::MIN);

        for sphere in spheres {
            let c = &sphere.center;
            let r = sphere.radius;

            min.x = min.x.min(c.x - r);
            min.y = min.y.min(c.y - r);
            min.z = min.z.min(c.z - r);

            max.x = max.x.max(c.x + r);
            max.y = max.y.max(c.y + r);
            max.z = max.z.max(c.z + r);
        }

        Self { min, max }
    }

    pub fn contains(&self, point: &Vector3) -> bool {
        point.x >= self.min.x
            && point.x <= self.max.x
            && point.y >= self.min.y
            && point.y <= self.max.y
            && point.z >= self.min.z
            && point.z <= self.max.z
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vector3_operations() {
        let v1 = Vector3::new(1.0, 2.0, 3.0);
        let v2 = Vector3::new(4.0, 5.0, 6.0);

        let sum = v1 + v2;
        assert!((sum.x - 5.0).abs() < 1e-10);
        assert!((sum.y - 7.0).abs() < 1e-10);
        assert!((sum.z - 9.0).abs() < 1e-10);
    }

    #[test]
    fn test_sphere_intersection() {
        let s1 = Sphere::new(Vector3::zero(), 1.0);
        let s2 = Sphere::new(Vector3::new(1.5, 0.0, 0.0), 1.0);
        let s3 = Sphere::new(Vector3::new(3.0, 0.0, 0.0), 1.0);

        assert!(s1.intersects(&s2)); // overlapping
        assert!(!s1.intersects(&s3)); // not overlapping
    }
}
