# Smoke Test: contacts-graph-viz

## Pre-conditions

- Deploy frontend (no backend changes, no migration required)
- At least one simulation with status `completed` and N~100-500 particles available
- For edge-case testing: simulations with N=1, a disconnected aggregate, and N>1000

---

## Steps

### Step 1: Open simulation topology section
Open a simulation with N~100-500 particles. Scroll to the **Topology Analysis** section.

**Pass**: Section renders with a card header "Topology Analysis".

### Step 2: Verify stats banner
Check that the stats banner shows **4 cards**:
- Particles (count)
- Connections (edge count)
- Avg. Coordination (number)
- Connected / Disconnected (badge)

**Pass**: All 4 cards render with correct numeric values matching the simulation.

### Step 3: Verify force-directed graph
Below the stats banner, a force-directed graph should render:
- Nodes colored by coordination number (gray→red→orange→amber→yellow→lime→green→blue)
- Nodes sized proportionally (larger = higher coordination)
- Edges rendered as gray lines connecting neighboring particles

**Pass**: Graph is visible, nodes have distinct colors/sizes, edges are visible.

### Step 4: Stabilization feedback
On initial load, a semi-transparent overlay with "Stabilizing..." text should appear briefly while physics simulation runs, then disappear when the graph settles.

**Pass**: Spinner appears and then disappears within 1-5 seconds (depends on N).

### Step 5: Hover interaction
Hover over any node. The node and its connecting edges should be visually highlighted.

**Pass**: Node hover triggers emphasis (vis-network native hover behavior).

### Step 6: Click node → detail panel
Click a node in the graph. A detail panel should appear below the graph showing:
- Particle ID
- Position (x, y, z)
- Radius
- Coordination number
- Distance from CDG
- List of neighbor buttons (clickable, showing `#<neighbor_id>`)

**Pass**: Panel appears with all fields populated correctly.

### Step 7: Navigate via neighbor buttons
Click a neighbor button in the detail panel.

**Pass**: Graph focuses/pans to the clicked neighbor, and the detail panel updates to show the neighbor's data.

### Step 8: Edge cases
- **N=1**: Single node renders, no edges, no crash. Detail panel shows coordination 0 and no neighbor buttons.
- **Disconnected aggregate**: Multiple connected components visible in the graph (separate clusters).
- **N>1000**: A warning alert appears: "Large graph warning: X particles. The force-directed layout may take longer to stabilize."

**Pass**: All three edge cases behave as described.

### Step 9: Dark mode
Toggle the system's dark/light mode (OS-level preference).

**Pass**: Graph edges switch between light color (`#cbd5e1`) and dark color (`#475569`). Node labels remain readable in both modes.

---

## Post-test

No cleanup needed. This is a pure frontend change — no backend state is modified.
