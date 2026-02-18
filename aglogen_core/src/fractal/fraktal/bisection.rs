//! Bisection solver for finding fractal dimension.
//!
//! Implements the iterative bisection method used in FRAKTAL to solve
//! the equation: kf × (dp/dpo)^Df = (Ap/Apo)^zp
//!
//! This module provides the core numerical solver for the FRAKTAL fractal
//! analysis algorithm. It finds the fractal dimension (Df) where the
//! objective function crosses zero, using a combination of bracketing
//! and bisection refinement.

/// Convergence threshold for function value.
/// Solution is considered converged when |f(Df)| < this value.
const CONVERGENCE_THRESHOLD: f64 = 0.1;

/// Bisection solver for fractal dimension.
///
/// Uses a two-phase approach:
/// 1. Search for a bracket where the function changes sign
/// 2. Refine using bisection until convergence
///
/// Falls back to golden section optimization if no bracket is found.
pub struct BisectionSolver {
    /// Convergence tolerance for interval width (default: 1e-5)
    pub tolerance: f64,
    /// Maximum iterations for refinement (default: 100)
    pub max_iterations: usize,
    /// Search step size for initial bracket finding (default: 0.05)
    pub step_size: f64,
}

impl Default for BisectionSolver {
    /// Create solver with defaults tuned for FRAKTAL Df search.
    ///
    /// - tolerance: 1e-5 (sufficient precision for Df)
    /// - max_iterations: 100 (ample for convergence)
    /// - step_size: 0.05 (gives ~40 points in Df range 1.0-3.0)
    fn default() -> Self {
        Self {
            tolerance: 1e-5,
            max_iterations: 100,
            step_size: 0.05,
        }
    }
}

/// Result of bisection search for fractal dimension.
///
/// Contains the found Df value along with convergence information.
/// A successful result has `converged = true` and `function_value` near zero.
#[derive(Debug, Clone)]
pub struct BisectionResult {
    /// Found fractal dimension (0.0 if not found)
    pub df: f64,
    /// Prefactor kf at the solution point
    pub kf: f64,
    /// Number of iterations performed
    pub iterations: usize,
    /// Final function value (should be near zero for good solution)
    pub function_value: f64,
    /// Whether a valid solution was found within tolerance
    pub converged: bool,
}

impl BisectionSolver {
    /// Create a new bisection solver with custom parameters.
    ///
    /// # Arguments
    /// * `tolerance` - Convergence tolerance for interval width
    /// * `max_iterations` - Maximum iterations for refinement
    /// * `step_size` - Search step size for initial bracket finding
    pub fn new(tolerance: f64, max_iterations: usize, step_size: f64) -> Self {
        Self {
            tolerance,
            max_iterations,
            step_size,
        }
    }

    /// Solve for Df using bisection method.
    ///
    /// The objective function should return (function_value, kf) for a given Df.
    /// We search for the Df where function_value crosses zero.
    ///
    /// # Arguments
    /// * `objective_fn` - Function that takes Df and returns (function_value, kf)
    /// * `df_min` - Minimum Df to search (typically 1.0)
    /// * `df_max` - Maximum Df to search (typically 3.0)
    ///
    /// # Example
    /// ```ignore
    /// let solver = BisectionSolver::default();
    /// let result = solver.solve(|df| {
    ///     let kf = calculate_kf(df);
    ///     let value = kf * (dp/dpo).powf(df) - (ap/apo).powf(zp);
    ///     (value, kf)
    /// }, 1.0, 3.0);
    /// ```
    pub fn solve<F>(&self, objective_fn: F, df_min: f64, df_max: f64) -> BisectionResult
    where
        F: Fn(f64) -> (f64, f64),
    {
        // Find bracket where function changes sign
        // Use iterator to generate Df values on-the-fly (memory efficient)
        let mut dfa = df_min;
        let mut dfb = df_min + self.step_size;
        let mut found_bracket = false;

        // Evaluate first point
        let (mut funa, _) = objective_fn(dfa);

        // Search for bracket by stepping through Df values
        while dfb < df_max + self.step_size {
            let (fb, _kb) = objective_fn(dfb);

            // Check for sign change (found a bracket)
            if funa.signum() != fb.signum() && funa.is_finite() && fb.is_finite() {
                found_bracket = true;
                break;
            }

            // Move to next interval
            dfa = dfb;
            funa = fb;
            dfb += self.step_size;
        }

        // Clamp dfb to df_max to avoid exceeding range
        if dfb > df_max {
            dfb = df_max;
        }

        if !found_bracket {
            // Try using optimization to find minimum of |f(df)|
            return self.fallback_optimization(&objective_fn, df_min, df_max);
        }

        // Bisection refinement
        let mut iterations = 0;
        let mut dfc = (dfa + dfb) / 2.0;

        while (dfa - dfb).abs() > self.tolerance && iterations < self.max_iterations {
            dfc = (dfa + dfb) / 2.0;
            let (func, _) = objective_fn(dfc);

            if funa.signum() == func.signum() {
                dfa = dfc;
                funa = func;
            } else {
                dfb = dfc;
            }

            iterations += 1;
        }

        let (final_value, final_kf) = objective_fn(dfc);

        BisectionResult {
            df: dfc,
            kf: final_kf,
            iterations,
            function_value: final_value,
            converged: final_value.abs() < CONVERGENCE_THRESHOLD,
        }
    }

    /// Fallback optimization when no bracket is found.
    ///
    /// Uses golden section search to find the minimum of |f(Df)|.
    /// This is called when the objective function doesn't change sign
    /// across the search range, which can happen for certain parameter
    /// combinations where the function is always positive or negative.
    fn fallback_optimization<F>(&self, objective_fn: &F, df_min: f64, df_max: f64) -> BisectionResult
    where
        F: Fn(f64) -> (f64, f64),
    {
        // Golden section search for minimum of |f(df)|
        let phi = (1.0 + 5.0_f64.sqrt()) / 2.0;
        let resphi = 2.0 - phi;

        let mut a = df_min;
        let mut b = df_max;
        let mut x1 = a + resphi * (b - a);
        let mut x2 = b - resphi * (b - a);

        let (f1, _) = objective_fn(x1);
        let (f2, _) = objective_fn(x2);
        let mut f1_abs = f1.abs();
        let mut f2_abs = f2.abs();

        let mut iterations = 0;
        while (b - a).abs() > self.tolerance && iterations < self.max_iterations {
            if f1_abs < f2_abs {
                b = x2;
                x2 = x1;
                f2_abs = f1_abs;
                x1 = a + resphi * (b - a);
                let (f, _) = objective_fn(x1);
                f1_abs = f.abs();
            } else {
                a = x1;
                x1 = x2;
                f1_abs = f2_abs;
                x2 = b - resphi * (b - a);
                let (f, _) = objective_fn(x2);
                f2_abs = f.abs();
            }
            iterations += 1;
        }

        let df_opt = (a + b) / 2.0;
        let (fun_value, kf) = objective_fn(df_opt);

        // Check if solution is in valid range
        let valid = df_opt > 1.001 && df_opt < 2.999;

        BisectionResult {
            df: if valid { df_opt } else { 0.0 },
            kf: if valid { kf } else { 0.0 },
            iterations,
            function_value: fun_value,
            converged: valid && fun_value.abs() < CONVERGENCE_THRESHOLD,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bisection_simple() {
        let solver = BisectionSolver::default();

        // Simple test: find x where x - 2 = 0
        let objective = |x: f64| (x - 2.0, x);

        let result = solver.solve(objective, 1.0, 3.0);

        assert!(result.converged);
        assert!((result.df - 2.0).abs() < 0.01);
    }

    #[test]
    fn test_bisection_quadratic() {
        let solver = BisectionSolver::default();

        // Find x where x² - 4 = 0, i.e., x = 2
        let objective = |x: f64| (x * x - 4.0, x);

        let result = solver.solve(objective, 1.0, 3.0);

        assert!(result.converged);
        assert!((result.df - 2.0).abs() < 0.01);
    }
}
