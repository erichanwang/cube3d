# Rubik's Cube Simulation

Standalone React/Vite extraction of the portfolio's watchable Rubik's Cube simulation.
The original C++/Python implementations in this repository remain untouched.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL, drag the cube to orbit it, and use **Scramble** to start another solve.

## Verify

```bash
npm run build
node scripts/verify-cube.mjs
```

The verifier checks move legality, cubelet orientation, stage invariants, and 2,000 random CFOP solves.
