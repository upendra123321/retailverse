/**
 * Closed-form affine least-squares regression mapping normalized iris-position
 * features to normalized screen coordinates (0..1).
 */

export interface Coefficients {
  x: number[];
  y: number[];
}

export interface CalibrationSample {
  avgX: number;
  avgY: number;
  targetX: number;
  targetY: number;
}

const FEATURE_DIM = 3;

function polynomialFeatures(avgX: number, avgY: number): number[] {
  return [1, avgX, avgY];
}

function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];

    const pivotVal = m[col][col];
    if (Math.abs(pivotVal) < 1e-10) continue;
    for (let k = col; k <= n; k++) m[col][k] /= pivotVal;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }

  return m.map((row) => row[n]);
}

function solveNormalEquations(features: number[][], targets: number[]): number[] {
  const n = FEATURE_DIM;
  const ata: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const atb: number[] = Array(n).fill(0);

  for (let s = 0; s < features.length; s++) {
    const f = features[s];
    for (let i = 0; i < n; i++) {
      atb[i] += f[i] * targets[s];
      for (let j = 0; j < n; j++) {
        ata[i][j] += f[i] * f[j];
      }
    }
  }

  // Ridge term keeps the system stable when the eyes move in a narrow range.
  for (let i = 1; i < n; i++) ata[i][i] += 1e-3;

  return solveLinearSystem(ata, atb);
}

export function fitCalibration(samples: CalibrationSample[]): Coefficients {
  const features = samples.map((s) => polynomialFeatures(s.avgX, s.avgY));
  return {
    x: solveNormalEquations(features, samples.map((s) => s.targetX)),
    y: solveNormalEquations(features, samples.map((s) => s.targetY)),
  };
}

export function predictGaze(coeffs: Coefficients, avgX: number, avgY: number) {
  const f = polynomialFeatures(avgX, avgY);
  const dot = (c: number[]) => c.reduce((sum, v, i) => sum + v * f[i], 0);
  return { x: dot(coeffs.x), y: dot(coeffs.y) };
}
