//! Bisection solver for finding fractal dimension.
//!
//! Implements the iterative bisection method used in FRAKTAL to solve
//! the equation: kf × (dp/dpo)^Df = (Ap/Apo)^zp

/// Bisection solver for fractal dimension.
pub struct BisectionSolver {
    /// Convergence tolerance
    pub tolerance: f64,
    /// Maximum iterations
    pub max_iterations: usize,
    /// Search step size for initial bracket
    pub step_size: f64,
}

impl Default for BisectionSolver {
    fn default() -> Self {
        Self {
            tolerance: 1e-5,
            max_iterations: 100,
            step_size: 0.05,
        }
    }
}

/// Result of bisection search.
#[derive(Debug, Clone)]
pub struct BisectionResult {
    /// Found fractal dimension
    pub df: f64,
    /// Prefactor at solution
    pub kf: f64,
    /// Number of iterations
    pub iterations: usize,
    /// Final function value (should be near zero)
    pub function_value: f64,
    /// Whether solution was found
    pub converged: bool,
}

impl BisectionSolver {
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
    pub fn solve<F>(&self, objective_fn: F, df_min: f64, df_max: f64) -> BisectionResult
    where
        F: Fn(f64) -> (f64, f64),
    {
        // Generate Df values to test
        let mut df_values: Vec<f64> = Vec::new();
        let mut df = df_min;
        while df <= df_max + 1e-10 {
            df_values.push(df);
            df += self.step_size;
        }

        // Find bracket where function changes sign
        let mut dfa = 0.0;
        let mut dfb = 0.0;
        let mut funa = 0.0;
        let mut funb;
        let mut kfa = 0.0;
        let mut kfb;
        let mut found_bracket = false;

        for i in 0..df_values.len() - 1 {
            dfa = df_values[i];
            dfb = df_values[i + 1];

            let (fa, ka) = objective_fn(dfa);
            let (fb, kb) = objective_fn(dfb);
            funa = fa;
            funb = fb;
            kfa = ka;
            kfb = kb;

            // Check for sign change
            if funa.signum() != funb.signum() && funa.is_finite() && funb.is_finite() {
                found_bracket = true;
                break;
            }
        }

        if !found_bracket {
            // Try using optimization to find minimum of |f(df)|
            return self.fallback_optimization(&objective_fn, df_min, df_max);
        }

        // Bisection refinement
        let mut iterations = 0;
        let mut dfc = (dfa + dfb) / 2.0;
        let mut kfc = kfa;

        while (dfa - dfb).abs() > self.tolerance && iterations < self.max_iterations {
            dfc = (dfa + dfb) / 2.0;
            let (func, kc) = objective_fn(dfc);
            kfc = kc;

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
            converged: final_value.abs() < 0.1, // Reasonable convergence threshold
        }
    }

    /// Fallback optimization when no bracket is found.
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
            converged: valid && fun_value.abs() < 0.1,
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
